class Governor {
  constructor() {
    this.threshold = 0.55;
  }

  rank(population) {
    return population.agents
      .map(a => ({
        ...a,
        fitness: a.trades === 0 ? 0 : a.pnl / a.trades
      }))
      .sort((a, b) => b.fitness - a.fitness);
  }

  prune(population) {
    const ranked = this.rank(population);

    const survivors = ranked.filter(a => a.fitness > this.threshold);

    const weak = ranked.filter(a => a.fitness <= this.threshold);

    return {
      survivors,
      killed: weak
    };
  }
}

module.exports = Governor;
