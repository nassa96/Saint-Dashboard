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
    this.bars = {}; // symbol -> [{ts, open, high, low, close, volume, source}] — real OHLCV candles
    this.orderBookSnapshots = {}; // symbol -> [{ts, bids:[[px,size]], asks:[[px,size]]}] last 2 kept, for OFI deltas
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

  /** Real OHLCV bars (oldest -> newest). Needed by strategies that require
   *  more than a close price: ATR, stochastic, swing-high/low/Fibonacci. */
  getBars(symbol, limit = 200) {
    return (this.bars[symbol] || []).slice(-limit);
  }

  /** Last 2 L2 order-book snapshots for a symbol (oldest -> newest), used
   *  by the Order Flow Imbalance calculator. See refreshOrderBooks(). */
  getOrderBookSnapshots(symbol) {
    return this.orderBookSnapshots[symbol] || [];
  }

  /**
   * Poll Coinbase's public L2 (aggregated) order book on a slow cadence —
   * NOT a continuous WebSocket depth feed (that's real infrastructure this
   * app doesn't run; see src/signals/orderFlow.js header for why this
   * snapshot-based approach is an honest, clearly-labeled substitute for
   * the "continuous multi-level OFI tensor" a true L2 WS feed would give
   * you). Keeps only the last 2 snapshots per symbol — enough to compute
   * one Order-Flow-Imbalance delta per poll.
   */
  async refreshOrderBooks(levels = 10) {
    for (const symbol of this.universe) {
      try {
        const data = await httpJson(
          `https://api.exchange.coinbase.com/products/${symbol}/book?level=2`,
          { timeout: 7000, headers: { "User-Agent": "saint-dashboard/2.0" } }
        );
        const bids = (data?.bids || []).slice(0, levels).map((b) => [Number(b[0]), Number(b[1])]);
        const asks = (data?.asks || []).slice(0, levels).map((a) => [Number(a[0]), Number(a[1])]);
        if (!bids.length || !asks.length) throw new Error("empty book");
        const snap = { ts: Date.now(), bids, asks, source: "LIVE" };
        const arr = this.orderBookSnapshots[symbol] || [];
        arr.push(snap);
        this.orderBookSnapshots[symbol] = arr.slice(-2);
      } catch (e) {
        // No synthetic order-book fallback — OFI on fabricated depth would
        // be actively misleading (unlike the price/bar fallbacks elsewhere,
        // which are clearly labeled SIM). Just skip this symbol this round.
        continue;
      }
    }
    return this.orderBookSnapshots;
  }

  /**
   * Refresh real OHLCV candles from Coinbase's public candles endpoint
   * (no key needed). Runs on its own slow cadence (minutes), separate from
   * the fast per-tick price loop used for execution decisions — candles
   * don't need to update every 5s. Falls back to synthesizing bars from the
   * tick-price history when candles are unreachable, clearly tagged "SIM".
   */
  async refreshBars(granularity = 300, count = 200) {
    for (const symbol of this.universe) {
      try {
        const data = await httpJson(
          `https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=${granularity}`,
          { timeout: 7000, headers: { "User-Agent": "saint-dashboard/2.0" } }
        );
        // Coinbase returns [time, low, high, open, close, volume], newest first
        const candles = (data || []).slice(0, count).reverse();
        if (!candles.length) throw new Error("no candles");
        this.bars[symbol] = candles.map((c) => ({
          ts: c[0] * 1000,
          low: c[1],
          high: c[2],
          open: c[3],
          close: c[4],
          volume: c[5],
          source: "LIVE",
        }));
      } catch (e) {
        // Synthetic fallback: derive a single coarse bar per recent tick-
        // history window so bar-dependent strategies still have *something*
        // to work with offline — always tagged "SIM", never passed off as real.
        const ticks = this.history[symbol] || [];
        if (ticks.length < 5) continue;
        const bucket = Math.max(1, Math.floor(granularity / 5)); // ~5s ticks per bucket
        const synthBars = [];
        for (let i = 0; i < ticks.length; i += bucket) {
          const slice = ticks.slice(i, i + bucket);
          if (!slice.length) continue;
          const closes = slice.map((t) => t.price);
          synthBars.push({
            ts: slice[slice.length - 1].ts,
            open: closes[0],
            high: Math.max(...closes),
            low: Math.min(...closes),
            close: closes[closes.length - 1],
            volume: null,
            source: "SIM",
          });
        }
        if (synthBars.length) this.bars[symbol] = synthBars.slice(-count);
      }
    }
    return this.bars;
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
