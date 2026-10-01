/* ============================================================
   CAPITAL ALLOCATION + ROTATION ENGINE
   Ranks the tradable universe by signal strength and computes
   target weights (rotation into strongest, out of weakest).
   ============================================================ */

const { sortinoRatio } = require("./sortino");

class Allocator {
  constructor(config) {
    this.cfg = config.capital;
    // "score" (default, conviction-weighted) | "sortino" (risk-adjusted —
    // rewards candidates with good historical return per unit of DOWNSIDE
    // risk, not just the loudest signal score).
    this.method = (config.capital.allocationMethod || "score").toLowerCase();
  }

  /**
   * @param {Array<{symbol, signal, confidence, score}>} evaluations
   * @param {object} context { seriesBySymbol?: {symbol: number[]}, macro?: {deployMultiplier} }
   *   seriesBySymbol is required for "sortino" mode. `macro` is the optional
   *   macro risk-appetite overlay (src/intelligence/flow.js) — if present
   *   and enabled, its deployMultiplier (always <= 1.0) shrinks how much of
   *   the configured risk budget gets deployed this cycle; it can never
   *   push deployment above your configured MAX_PORTFOLIO_RISK_PCT.
   * @returns {{targets: Object, ranked: Array}}
   */
  computeTargets(evaluations, context = {}) {
    // Only LONG candidates get positive allocation (spot rotation model).
    const longs = evaluations
      .filter((e) => e.signal === "LONG" && e.confidence >= this.cfg.minSignalConfidence)
      .sort((a, b) => b.score - a.score);

    const ranked = evaluations
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((e, i) => ({ ...e, rank: i + 1 }));

    const targets = {};
    if (longs.length === 0) return { targets, ranked };

    const seriesBySymbol = context.seriesBySymbol || {};
    const useSortino = this.method === "sortino" && Object.keys(seriesBySymbol).length > 0;

    // Weight metric: conviction score (default) or Sortino-blended.
    // Sortino mode still requires the strategy to say LONG (directional
    // gate unchanged) — it only changes HOW MUCH capital a given long gets,
    // rewarding symbols with a smoother, less-painful historical ride.
    const weightOf = (c) => {
      const base = Math.max(0.001, c.score);
      if (!useSortino) return base;
      const series = seriesBySymbol[c.symbol];
      const sortino = series ? sortinoRatio(series) : null;
      if (sortino == null) return base;
      // Shift Sortino into positive territory (it's bounded [-5,5]) so it
      // can multiply, not cancel out, the conviction weight.
      const sortinoFactor = Math.max(0.05, sortino + 5);
      return base * sortinoFactor;
    };

    const weighted = longs.map((c) => ({ c, w: weightOf(c) }));
    const totalWeight = weighted.reduce((a, b) => a + b.w, 0);
    let deployed = 0;
    // Macro overlay can only ever shrink deployment (multiplier <= 1.0),
    // never exceed the configured risk ceiling.
    const macroMultiplier =
      context.macro && this.cfg.macroOverlayEnabled !== false
        ? Math.min(1, Number(context.macro.deployMultiplier) || 1)
        : 1;
    const maxDeploy = this.cfg.maxPortfolioRiskPct * macroMultiplier;

    for (const { c, w: rawW } of weighted) {
      let w = totalWeight > 0 ? (rawW / totalWeight) * maxDeploy : 0;
      w = Math.min(w, this.cfg.maxPositionPct);
      if (deployed + w > maxDeploy) w = Math.max(0, maxDeploy - deployed);
      if (w <= 0) continue;
      targets[c.symbol] = Number(w.toFixed(4));
      deployed += w;
    }

    return { targets, ranked };
  }
}

module.exports = Allocator;

