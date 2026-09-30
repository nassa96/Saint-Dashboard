/* ============================================================
   MEMECOIN DETECTION SCANNER
   Uses DexScreener's free public API to surface freshly-launched
   / trending pairs, then scores them with a transparent heuristic
   and flags obvious risk factors.

   Falls back to clearly-labeled SIM candidates when the API is
   unreachable so the radar remains functional in restricted envs.
   ============================================================ */

const { httpJson } = require("../util/http");
const log = require("../util/logger");

const BOOSTS_URL = "https://api.dexscreener.com/token-boosts/latest/v1";
const SEARCH_URL = "https://api.dexscreener.com/latest/dex/search";

class MemecoinScanner {
  constructor(config) {
    this.cfg = config.memecoin;
    this.candidates = [];
    this.source = "UNKNOWN";
    this.lastError = null;
    this.lastScan = null;
  }

  _num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Transparent detection score 0..100.
   * Rewards: volume/liquidity turnover, positive short-term momentum,
   * young age, healthy buy/sell ratio. Penalizes: thin liquidity.
   */
  score(pair) {
    const liq = this._num(pair.liquidity?.usd);
    const vol24 = this._num(pair.volume?.h24);
    const vol1 = this._num(pair.volume?.h1);
    const chg1 = this._num(pair.priceChange?.h1);
    const chg24 = this._num(pair.priceChange?.h24);
    const buys = this._num(pair.txns?.h1?.buys);
    const sells = this._num(pair.txns?.h1?.sells);
    const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : null;
    const ageHours = ageMs != null ? ageMs / 3.6e6 : null;

    const flags = [];
    let score = 0;

    // Turnover (vol/liq) — real momentum of capital
    const turnover = liq > 0 ? vol24 / liq : 0;
    score += Math.min(30, turnover * 6);

    // Acceleration: 1h volume annualized vs 24h avg
    const hourlyAvg = vol24 / 24;
    if (hourlyAvg > 0 && vol1 > hourlyAvg * 1.5) {
      score += Math.min(20, (vol1 / hourlyAvg) * 4);
      flags.push("volume-spike");
    }

    // Momentum
    score += Math.max(-10, Math.min(20, chg1 * 0.5));
    score += Math.max(-10, Math.min(10, chg24 * 0.1));

    // Buy pressure
    const totalTx = buys + sells;
    if (totalTx > 0) {
      const buyRatio = buys / totalTx;
      score += (buyRatio - 0.5) * 30;
      if (buyRatio > 0.65) flags.push("buy-pressure");
    }

    // Youth bonus (fresh launches)
    if (ageHours != null) {
      if (ageHours < 24) {
        score += 12;
        flags.push("fresh<24h");
      } else if (ageHours < 72) {
        score += 6;
      }
    }

    // ---- Risk penalties / flags ----
    if (liq < this.cfg.minLiquidityUsd) {
      score -= 25;
      flags.push("LOW-LIQUIDITY");
    }
    if (vol24 < this.cfg.minVolumeUsd) {
      score -= 10;
      flags.push("low-volume");
    }
    if (chg1 > 80) flags.push("parabolic-risk");
    if (totalTx > 0 && sells > buys * 2) flags.push("sell-off");

    score = Math.max(0, Math.min(100, Math.round(score)));

    let rating = "WATCH";
    if (score >= 70 && !flags.includes("LOW-LIQUIDITY")) rating = "STRONG";
    else if (score >= 50) rating = "PROMISING";
    else if (score < 25) rating = "AVOID";

    return { score, rating, flags, turnover: Number(turnover.toFixed(2)), ageHours };
  }

  _normalize(pair, extra = {}) {
    const s = this.score(pair);
    return {
      chain: pair.chainId,
      dex: pair.dexId,
      symbol: pair.baseToken?.symbol,
      name: pair.baseToken?.name,
      address: pair.baseToken?.address,
      pairAddress: pair.pairAddress,
      priceUsd: this._num(pair.priceUsd),
      liquidityUsd: Math.round(this._num(pair.liquidity?.usd)),
      volume24h: Math.round(this._num(pair.volume?.h24)),
      change1h: this._num(pair.priceChange?.h1),
      change24h: this._num(pair.priceChange?.h24),
      ageHours: s.ageHours != null ? Number(s.ageHours.toFixed(1)) : null,
      url: pair.url,
      ...s,
      source: extra.source || "LIVE",
    };
  }

  async _fetchLive() {
    // Search across configured chains for active pairs.
    const seen = new Set();
    const results = [];
    const queries = this.cfg.chains.length ? this.cfg.chains : ["solana"];
    for (const chain of queries) {
      try {
        const data = await httpJson(`${SEARCH_URL}?q=${encodeURIComponent(chain)}`, {
          timeout: 7000,
          headers: { "User-Agent": "saint-dashboard/2.0" },
        });
        const pairs = (data && data.pairs) || [];
        for (const p of pairs) {
          if (!p.pairAddress || seen.has(p.pairAddress)) continue;
          if (this.cfg.chains.length && !this.cfg.chains.includes(p.chainId)) continue;
          seen.add(p.pairAddress);
          results.push(this._normalize(p, { source: "LIVE" }));
        }
      } catch (e) {
        this.lastError = e.message;
        throw e;
      }
    }
    return results;
  }

  _simCandidates() {
    const names = [
      ["SAINT", "Saint Protocol"],
      ["MOONX", "MoonX"],
      ["PEPE2", "Pepe Reborn"],
      ["GIGA", "Gigachad"],
      ["WIFHAT", "dogwifhat2"],
      ["BONKAI", "Bonk AI"],
      ["TURBO", "Turbo Toad"],
      ["FOMO", "Fomo Finance"],
    ];
    const chains = this.cfg.chains.length ? this.cfg.chains : ["solana"];
    return names.map(([sym, name], i) => {
      const liq = 8000 + Math.random() * 400000;
      const vol = liq * (0.5 + Math.random() * 8);
      const fake = {
        chainId: chains[i % chains.length],
        dexId: "raydium",
        baseToken: { symbol: sym, name, address: "Sim" + i + "x".repeat(30) },
        pairAddress: "simpair" + i,
        priceUsd: (Math.random() * 0.01).toFixed(8),
        liquidity: { usd: liq },
        volume: { h24: vol, h1: (vol / 24) * (0.5 + Math.random() * 4) },
        priceChange: { h1: (Math.random() - 0.4) * 40, h24: (Math.random() - 0.4) * 120 },
        txns: { h1: { buys: Math.floor(Math.random() * 400), sells: Math.floor(Math.random() * 300) } },
        pairCreatedAt: Date.now() - Math.random() * 96 * 3.6e6,
        url: "https://dexscreener.com",
      };
      return this._normalize(fake, { source: "SIM" });
    });
  }

  async scan() {
    let list;
    try {
      list = await this._fetchLive();
      this.source = "LIVE";
    } catch (e) {
      list = this._simCandidates();
      this.source = "SIM";
      if (!this._warned) {
        log.warn("MEMECOIN", `DexScreener unreachable — radar on clearly-labeled SIM data (${e.message})`);
        this._warned = true;
      }
    }
    list.sort((a, b) => b.score - a.score);
    this.candidates = list.slice(0, 25);
    this.lastScan = Date.now();
    return this.snapshot();
  }

  snapshot() {
    return {
      source: this.source,
      lastScan: this.lastScan,
      lastError: this.lastError,
      count: this.candidates.length,
      candidates: this.candidates,
      config: this.cfg,
    };
  }
}

module.exports = MemecoinScanner;
