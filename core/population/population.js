const Genome = require("../genome/genome");

class Population {
  constructor(size = 5) {
    this.genomes = [];

    for (let i = 0; i < size; i++) {
      this.genomes.push(new Genome(`G${i}`));
    }
  }

  select() {
    return this.genomes
      .sort((a, b) => b.fitness - a.fitness)
      .slice(0, Math.ceil(this.genomes.length / 2));
  }

  reproduce(selected) {
    const children = [];

    selected.forEach(parent => {
      const child = new Genome(
        parent.id + "_c",
        { ...parent.genes }
      );

      child.mutate(0.2);
      children.push(child);
    });

    this.genomes = [...selected, ...children];
  }

  best() {
    return this.genomes.sort((a, b) => b.fitness - a.fitness)[0];
  }
}

module.exports = Population;
