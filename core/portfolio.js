class Portfolio {
  constructor() {
    this.allocations = {
      A: 0.33,
      B: 0.33,
      C: 0.34
    };

    this.equity = {
      A: 100,
      B: 100,
      C: 100
    };
  }

  value() {
    return Object.values(this.equity).reduce((a, b) => a + b, 0);
  }

  allocate(genomes) {
    const totalFitness = genomes.reduce((a, g) => a + g.fitness, 0);

    genomes.forEach(g => {
      this.allocations[g.id] = g.fitness / totalFitness;
    });
  }

  applyResult(id, pnl) {
    if (!this.equity[id]) this.equity[id] = 100;
    this.equity[id] += pnl;
  }

  getCapital(id) {
    const total = this.value();
    return total * (this.allocations[id] || 0);
  }
}

module.exports = Portfolio;
