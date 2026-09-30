/* ============================================================
   CAPITAL ALLOCATION + ROTATION ENGINE
   Ranks the tradable universe by signal strength and computes
   target weights (rotation into strongest, out of weakest).
   ============================================================ */

class Allocator {
  constructor(config) {
    this.cfg = config.capital;
  }

  /**
   * @param {Array<{symbol, signal, confidence, score}>} evaluations
   * @returns {{targets: Object, ranked: Array}}
   */
  computeTargets(evaluations) {
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

    // Weight by conviction (score), capped per-position, summed to deployable budget.
    const totalScore = longs.reduce((a, b) => a + Math.max(0.001, b.score), 0);
    let deployed = 0;
    const maxDeploy = this.cfg.maxPortfolioRiskPct;

    for (const c of longs) {
      let w = (Math.max(0.001, c.score) / totalScore) * maxDeploy;
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
