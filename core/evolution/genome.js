class Genome {
  constructor() {
    this.population = [
      { id: "A", bias: 1.0, equity: 100 },
      { id: "B", bias: 0.8, equity: 100 },
      { id: "C", bias: 0.6, equity: 100 }
    ];
  }

  select() {
    const total = this.population.reduce((a, g) => a + g.bias, 0);

    let r = Math.random() * total;

    for (const g of this.population) {
      r -= g.bias;
      if (r <= 0) return g;
    }

    return this.population[0];
  }

  updateEquity(id, pnl) {
    const g = this.population.find(x => x.id === id);
    if (!g) return;

    g.equity += pnl;
  }

  mutateFitness(id, fitness) {
    const g = this.population.find(x => x.id === id);
    if (!g) return;

    if (fitness > 0) {
      g.bias *= 1.05;
    } else {
      g.bias *= 0.95;
    }

    g.bias = Math.max(0.1, Math.min(3, g.bias));
  }

  snapshot() {
    return this.population;
  }
}

module.exports = Genome;
