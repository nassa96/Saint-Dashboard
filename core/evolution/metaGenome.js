class MetaGenome {
  constructor(genome) {
    this.genome = genome;

    this.meta = {
      mutationRate: 0.05,
      selectionPressure: 1.0
    };
  }

  evolve(fitness) {
    if (fitness > 0.5) {
      this.meta.mutationRate *= 0.99;
      this.meta.selectionPressure *= 1.01;
    } else {
      this.meta.mutationRate *= 1.02;
      this.meta.selectionPressure *= 0.98;
    }

    this.meta.mutationRate = this.clamp(this.meta.mutationRate, 0.01, 0.2);
    this.meta.selectionPressure = this.clamp(this.meta.selectionPressure, 0.5, 2.0);

    return this.meta;
  }

  clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
}

module.exports = MetaGenome;
