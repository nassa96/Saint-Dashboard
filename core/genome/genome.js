class Genome {
  constructor(id, genes = {}) {
    this.id = id;

    // strategy parameters
    this.genes = {
      signalThreshold: genes.signalThreshold ?? Math.random(),
      riskTolerance: genes.riskTolerance ?? Math.random(),
      aggressiveness: genes.aggressiveness ?? Math.random()
    };

    this.fitness = 0;
    this.trades = 0;
    this.pnl = 0;
  }

  mutate(rate = 0.1) {
    Object.keys(this.genes).forEach(k => {
      if (Math.random() < rate) {
        this.genes[k] += (Math.random() - 0.5) * 0.2;
        this.genes[k] = Math.max(0, Math.min(1, this.genes[k]));
      }
    });
  }

  evaluateReward(pnl) {
    this.pnl += pnl;
    this.trades += 1;
    this.fitness = this.pnl / Math.max(1, this.trades);
  }
}

module.exports = Genome;
