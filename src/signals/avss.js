/* ============================================================
   AVSS — Asymmetric Volatility Skew Scalper
   ------------------------------------------------------------
   Spec: detect a CVD (cumulative volume delta) spike on HyperLiquid
   perps vs a lagging Base DEX spot price, and scalp the convergence
   on the lagging venue. Target: >3σ/60s CVD spike + >18bps spot/perp
   lag -> enter, exit in 30-120s or at a 12bps trailing stop, ~45s avg
   hold, 15-40bps edge/trade.

   HONEST SCOPE NOTE — two real gaps, both documented rather than
   silently papered over or overclaimed:

   1) "CVD spike" needs trade-by-trade buy/sell-tagged volume. The data
      this app actually has (HyperLiquid's metaAndAssetCtxs snapshot,
      Coinbase REST candles/ticks) does NOT include that — no venue
      connector here streams a trade tape. What IS implemented is a
      PRICE-BASED proxy: a z-scored 60s return relative to the symbol's
      own recent realized volatility (same EWMA machinery as the
      Extreme Volatility Radar). This flags "something aggressive just
      happened in the last 60s", which is a real, computable, useful
      signal — it is explicitly NOT a measurement of actual buy/sell
      order-flow imbalance, and every result says so.
   2) "Base DEX spot" is not wired up — there's no live Base on-chain
      DEX price feed in this app (only Coinbase CEX spot via
      src/market/marketData.js and HyperLiquid perp marks via the
      existing connector). The lag calculation below uses Coinbase spot
      vs HyperLiquid perp mark instead, which is a real, honest
      substitution for "two venues that should track each other but
      sometimes briefly don't" — just not literally the Base DEX leg
      the spec named. Wiring a real Base DEX price source (e.g. an
      on-chain quote aggregator call per symbol) is a concrete follow-up,
      not done here.

   SCAN-ONLY BY DESIGN: the spec's ~45s avg hold / 30-120s exit window
   needs infrastructure faster than this app's 5s HTTP-poll tick loop
   (true sub-minute execution wants WebSocket streaming). Rather than
   claim full autonomous HFT execution on a polling architecture that
   can't actually hit those latencies, this ships as a scan/report
   module — consistent with your own "validate before autonomous"
   philosophy. No order-placement path exists here.
   ============================================================ */

const { ewmaVol } = require("../volatility/predictor");
const log = require("../util/logger");

const defaultParams = {
  cvdZThreshold: 3, // "σ" bar from the spec, applied to the price-based proxy (see honest note above)
  lagBpsThreshold: 18,
  lookbackSec: 60,
  targetTrailingStopBps: 12,
  minHoldSec: 30,
  maxHoldSec: 120,
};

function hlBaseSymbol(spotSymbol) {
  // "BTC-USD" -> "BTC" (HyperLiquid perp universe uses the bare base asset)
  return (spotSymbol || "").split("-")[0];
}

class AvssScanner {
  constructor({ exchanges, market, config }) {
    this.exchanges = exchanges;
    this.market = market;
    this.config = config;
  }

  get params() {
    return { ...defaultParams, ...(this.config.avss || {}) };
  }

  /** Price-based proxy for a short-window order-flow spike — NOT real CVD. See header note. */
  _priceFlowZ(symbol, lookbackSec) {
    const history = this.market.history[symbol] || [];
    if (history.length < 20) return null;
    const cutoff = Date.now() - lookbackSec * 1000;
    const recent = history.filter((p) => p.ts >= cutoff);
    if (recent.length < 3) return null;

    const windowReturn = (recent[recent.length - 1].price - recent[0].price) / recent[0].price;
    const closes = history.map((p) => p.price);
    const sigma = ewmaVol(closes); // per-tick EWMA vol, real (RiskMetrics), same machinery as the volatility radar
    if (!sigma || sigma <= 0) return null;

    // Scale the per-tick sigma to the lookback window (sqrt-of-time), then
    // z-score the window's realized return against it.
    const windowSigma = sigma * Math.sqrt(recent.length);
    if (windowSigma <= 0) return null;
    return windowReturn / windowSigma;
  }

  /**
   * Scan the universe for lag/flow-spike confluence. Read-only — no
   * network writes, no order placement. Returns candidates sorted by
   * combined signal strength, each honestly labeled with which parts are
   * real vs. proxied.
   */
  async scan() {
    const p = this.params;
    const hl = this.exchanges?.venues?.hyperliquid;
    if (!hl) throw new Error("hyperliquid venue not configured — AVSS needs a perp mark price to compare against spot");

    const [meta, ctxs] = await hl._info({ type: "metaAndAssetCtxs" });
    const perpBySymbol = {};
    (meta.universe || []).forEach((u, i) => {
      perpBySymbol[u.name] = Number((ctxs[i] || {}).markPx || 0);
    });

    const universe = this.config.universe || [];
    const results = [];
    for (const symbol of universe) {
      const spotPrice = this.market.latest[symbol]?.price;
      const base = hlBaseSymbol(symbol);
      const perpPrice = perpBySymbol[base];
      if (!spotPrice || !perpPrice) continue;

      const lagBps = ((perpPrice - spotPrice) / spotPrice) * 10000;
      const flowZ = this._priceFlowZ(symbol, p.lookbackSec);

      const lagTriggered = Math.abs(lagBps) >= p.lagBpsThreshold;
      const flowTriggered = flowZ != null && Math.abs(flowZ) >= p.cvdZThreshold;

      results.push({
        symbol,
        spotPrice,
        perpSymbol: base,
        perpPrice,
        lagBps: Number(lagBps.toFixed(2)),
        flowZProxy: flowZ != null ? Number(flowZ.toFixed(2)) : null,
        lagTriggered,
        flowTriggered,
        triggered: lagTriggered && flowTriggered,
        direction: lagBps > 0 ? "perp trading rich vs spot" : "perp trading cheap vs spot",
        note:
          "flowZProxy is a price-based 60s-return z-score, NOT real trade-tagged CVD; spot leg is Coinbase CEX, NOT the Base DEX the spec named — see avss.js header for why.",
      });
    }

    results.sort((a, b) => Math.abs(b.lagBps) * Math.abs(b.flowZProxy || 0) - Math.abs(a.lagBps) * Math.abs(a.flowZProxy || 0));

    return {
      generatedAt: new Date().toISOString(),
      params: p,
      candidates: results,
      scanOnly: true,
      note:
        "Scan/report only — no execution path. True ~45s-hold scalping needs WebSocket-speed infra beyond this app's 5s poll loop; shipping the detector first, execution is a follow-up once latency is validated.",
    };
  }
}

module.exports = AvssScanner;
