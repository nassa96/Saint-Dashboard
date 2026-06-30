class GenomeRegistry {
  constructor() {
    this.genomes = {
      A: { id: "A", bias: 0.2, aggression: 0.2 },
      B: { id: "B", bias: 0.5, aggression: 0.5 },
      C: { id: "C", bias: 0.8, aggression: 0.8 }
    };
  }

  list() {
    return Object.values(this.genomes);
  }

  mutate(base) {
    return {
      id: base.id + "_m",
      bias: Math.min(1, Math.max(0, base.bias + (Math.random() - 0.5) * 0.1)),
      aggression: Math.min(1, Math.max(0, base.aggression + (Math.random() - 0.5) * 0.1))
    };
  }
}

module.exports = GenomeRegistry;
