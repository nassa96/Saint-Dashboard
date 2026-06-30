/* =========================================================
   META-GENOME CONTROLLER (EVOLUTION RULE ENGINE)
========================================================= */

class MetaGenomeController {
  constructor() {
    this.state = {
      mutationRate: 0.1,
      flowPressure: 0.05,
      survivalThreshold: 95
    };
  }

  adjust(context) {
    const { avgEquity = 100, volatility = 0.5 } = context;

    if (avgEquity < 95) {
      this.state.mutationRate *= 0.9;
    }

    if (volatility > 0.7) {
      this.state.mutationRate *= 0.8;
    }

    if (avgEquity > 105) {
      this.state.survivalThreshold = 97;
    }

    return this.state;
  }

  mutateGenome(g) {
    return {
      bias: g.bias + (Math.random() - 0.5) * this.state.mutationRate,
      aggression: g.aggression + (Math.random() - 0.5) * this.state.mutationRate,
      stability: g.stability + (Math.random() - 0.5) * this.state.mutationRate
    };
  }

  shouldSurvive(equity) {
    return equity >= this.state.survivalThreshold;
  }
}

module.exports = MetaGenomeController;
