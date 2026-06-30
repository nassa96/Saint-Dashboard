class Evolver {
  constructor(population) {
    this.population = population;
    this.generation = 0;
  }

  evolve() {
    const selected = this.population.select();

    this.population.reproduce(selected);

    this.generation++;

    console.log(`[EVOLUTION] Generation ${this.generation} complete`);
    console.log(`[EVOLUTION] Best fitness: ${this.population.best().fitness.toFixed(4)}`);
  }
}

module.exports = Evolver;
