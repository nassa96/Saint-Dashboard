const GenomeRegistry = require("./registry");
const FitnessEngine = require("./fitness");

class PopulationEngine {
  constructor() {
    this.registry = new GenomeRegistry();
    this.fitness = new FitnessEngine();

    this.population = this.registry.list();

    this.scores = {};
  }

  evaluate(replay) {
    const scores = {};

    for (const g of this.population) {
      const filtered = replay.filter(t => t.signal?.genomeId === g.id);
      scores[g.id] = this.fitness.calculate(filtered);
    }

    this.scores = scores;
    return scores;
  }

  selectTop() {
    const sorted = Object.entries(this.scores)
      .sort((a, b) => b[1] - a[1]);

    return sorted.slice(0, 2).map(x => x[0]);
  }

  evolve() {
    const top = this.selectTop();

    const newPop = [];

    for (const id of top) {
      const base = this.population.find(p => p.id === id);
      newPop.push(base);
      newPop.push(this.registry.mutate(base));
    }

    this.population = newPop;
    return this.population;
  }

  get() {
    return this.population;
  }
}

module.exports = PopulationEngine;
