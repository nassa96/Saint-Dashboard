class Replacer {
  constructor(genomeSystem) {
    this.genomeSystem = genomeSystem;
  }

  respawn(deadGenomeId) {
    const newId = String.fromCharCode(
      65 + Math.floor(Math.random() * 26)
    );

    const newGenome = {
      id: newId,
      bias: 0.7 + Math.random() * 0.6,
      fitness: 0
    };

    const idx = this.genomeSystem.genomes.findIndex(
      g => g.id === deadGenomeId
    );

    if (idx !== -1) {
      this.genomeSystem.genomes[idx] = newGenome;
    }

    return newGenome;
  }
}

module.exports = Replacer;
