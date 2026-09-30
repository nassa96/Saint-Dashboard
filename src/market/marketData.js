/* ============================================================
   MARKET DATA SERVICE
   Pulls REAL spot prices from public exchange REST APIs.
   Maintains a rolling price history per symbol for indicators.

   If the network/endpoint is unreachable (e.g. restricted host),
   it transparently falls back to a synthetic price walk that is
   ALWAYS tagged source:"SIM" so nothing is misrepresented as live.
   ============================================================ */

const { httpJson } = require("../util/http");
const log = require("../util/logger");

const HISTORY_MAX = 300;

class MarketData {
  constructor(universe) {
    this.universe = universe; // e.g. ["BTC-USD","ETH-USD"]
    this.history = {}; // symbol -> [{ts, price}]
    this.latest = {}; // symbol -> { price, source, ts, change24h }
    this.source = "UNKNOWN"; // LIVE | SIM
    this.lastError = null;
    // seed synthetic anchors for fallback so numbers look plausible
    this._anchors = {
      "BTC-USD": 64000,
      "ETH-USD": 3200,
      "SOL-USD": 150,
      "AVAX-USD": 35,
      "LINK-USD": 15,
      "DOGE-USD": 0.14,
    };
    for (const s of universe) if (!this._anchors[s]) this._anchors[s] = 10 + Math.random() * 100;
    // Persistent per-symbol trend for SIM mode (occasionally flips) so the
    // rotation engine has coherent regimes to act on. SIM-only; ignored live.
    this._simTrend = {};
    for (const s of universe) this._simTrend[s] = (Math.random() - 0.5) * 0.012;
  }

  _record(symbol, price, source, change24h = null) {
    if (!Number.isFinite(price) || price <= 0) return;
    const ts = Date.now();
    if (!this.history[symbol]) this.history[symbol] = [];
    this.history[symbol].push({ ts, price });
    if (this.history[symbol].length > HISTORY_MAX) this.history[symbol].shift();
    this.latest[symbol] = { price, source, ts, change24h };
  }

  getPrices(symbol) {
    return (this.history[symbol] || []).map((p) => p.price);
  }

  snapshot() {
    return {
      source: this.source,
      lastError: this.lastError,
      symbols: this.universe.map((s) => ({
        symbol: s,
        ...(this.latest[s] || { price: null, source: null, ts: null }),
        bars: (this.history[s] || []).length,
      })),
    };
  }

  /**
   * Warm up indicator history. Tries REAL historical candles from
   * Coinbase; if unreachable, seeds a synthetic (SIM) price path so
   * the strategy has data to work with immediately.
   */
  async warmup(bars = 60, granularity = 300) {
    for (const symbol of this.universe) {
      try {
        const data = await httpJson(
          `https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=${granularity}`,
          { timeout: 7000, headers: { "User-Agent": "saint-dashboard/2.0" } }
        );
        // Coinbase returns [time, low, high, open, close, volume], newest first
        const candles = (data || []).slice(0, bars).reverse();
        for (const c of candles) this._record(symbol, parseFloat(c[4]), "LIVE");
        if (candles.length) {
          log.info("MARKET", `Warm-started ${symbol} with ${candles.length} LIVE candles`);
          continue;
        }
        throw new Error("no candles");
      } catch (e) {
        // synthetic warm-up path (clearly SIM)
        // realistic-ish walk with a coherent regime trend so indicators are meaningful
        let px = this._anchors[symbol];
        const trend = this._simTrend[symbol];
        const seed = [];
        for (let i = 0; i < bars; i++) {
          px = px * (1 + trend + (Math.random() - 0.5) * 0.004);
          seed.push(px);
        }
        for (const p of seed) this._record(symbol, p, "SIM");
      }
    }
    return this.snapshot();
  }

  // ---- Live fetchers (Coinbase public, no key) ----
  async _fetchCoinbase(symbol) {
    // symbol like BTC-USD works directly on Coinbase
    const data = await httpJson(
      `https://api.exchange.coinbase.com/products/${symbol}/ticker`,
      { timeout: 6000, headers: { "User-Agent": "saint-dashboard/2.0" } }
    );
    const price = parseFloat(data.price);
    if (!Number.isFinite(price)) throw new Error("bad price");
    return price;
  }

  async _fetch24hCoinbase(symbol) {
    try {
      const data = await httpJson(
        `https://api.exchange.coinbase.com/products/${symbol}/stats`,
        { timeout: 6000, headers: { "User-Agent": "saint-dashboard/2.0" } }
      );
      const open = parseFloat(data.open);
      const last = parseFloat(data.last);
      if (Number.isFinite(open) && Number.isFinite(last) && open > 0) {
        return ((last - open) / open) * 100;
      }
    } catch (_) {}
    return null;
  }

  _simTick(symbol) {
    // coherent trend + small noise; occasionally flip the regime (rotation)
    const last = this.latest[symbol]?.price || this._anchors[symbol];
    if (Math.random() < 0.02) this._simTrend[symbol] = (Math.random() - 0.5) * 0.012;
    const trend = last * this._simTrend[symbol];
    const shock = last * (Math.random() - 0.5) * 0.003; // ~0.15% noise
    let next = last + trend + shock;
    if (next <= 0) next = last * 0.99;
    return next;
  }

  async refresh() {
    let liveCount = 0;
    let simCount = 0;
    for (const symbol of this.universe) {
      try {
        const price = await this._fetchCoinbase(symbol);
        const change24h = await this._fetch24hCoinbase(symbol);
        this._record(symbol, price, "LIVE", change24h);
        liveCount++;
      } catch (e) {
        this.lastError = e.message;
        const price = this._simTick(symbol);
        // derive a synthetic 24h change from history
        const arr = this.getPrices(symbol);
        const change24h =
          arr.length > 1 ? ((price - arr[0]) / arr[0]) * 100 : 0;
        this._record(symbol, price, "SIM", change24h);
        simCount++;
      }
    }
    this.source = liveCount > 0 && simCount === 0 ? "LIVE" : simCount > 0 && liveCount === 0 ? "SIM" : "MIXED";
    if (this.source === "SIM" && !this._warned) {
      log.warn(
        "MARKET",
        `Live exchange feed unreachable — running on clearly-labeled SIM data. (${this.lastError})`
      );
      this._warned = true;
    }
    return this.snapshot();
  }
}

module.exports = MarketData;
