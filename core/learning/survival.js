class SurvivalSystem {
  constructor() {
    this.maxDrawdown = 0.08;
    this.minEquity = 90;
  }

  evaluate({ capital, genome }) {
    let alive = true;
    let reason = null;

    // HARD FAIL: capital collapse
    if (capital.equity < this.minEquity) {
      alive = false;
      reason = "CAPITAL_COLLAPSE";
    }

    // HARD FAIL: excessive drawdown
    if (capital.drawdown > this.maxDrawdown) {
      alive = false;
      reason = "DRAWDOWN_LIMIT";
    }

    // GENOME WEAKNESS KILL RULE
    if (genome && genome.bias < 0.15) {
      alive = false;
      reason = "GENOME_EXTINCT";
    }

    return {
      alive,
      reason,
      healthScore: this.computeHealth(capital)
    };
  }

  computeHealth(capital) {
    const equityScore = capital.equity / 100;
    const stability = 1 - (capital.drawdown || 0);

    return (equityScore * 0.6 + stability * 0.4);
  }
}

module.exports = SurvivalSystem;
