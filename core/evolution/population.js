class Population {
  constructor() {
    this.genomes = [
      { id: "A", bias: 1.0, fitness: 0 },
      { id: "B", bias: 0.8, fitness: 0 },
      { id: "C", bias: 0.6, fitness: 0 }
    ];
  }

  select() {
    const total = this.genomes.reduce((a, g) => a + g.bias, 0);
    let r = Math.random() * total;

    for (const g of this.genomes) {
      r -= g.bias;
      if (r <= 0) return g;
    }

    return this.genomes[0];
  }

  evolve(reward, genomeId) {
    const g = this.genomes.find(x => x.id === genomeId);
    if (!g) return;

    g.fitness += reward;

    // Mutation pressure
    if (g.fitness < 0) {
      g.bias = Math.max(0.1, g.bias * 0.95);
    } else {
      g.bias += 0.01;
    }
  }

  getState() {
    return this.genomes;
  }
}

module.exports = Population;
