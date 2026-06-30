class SophiaPopulation {
  constructor() {
    this.population = this.initPopulation();
  }

  initPopulation() {
    return [
      { id: "A", bias: 1.0, fitness: 0 },
      { id: "B", bias: 0.8, fitness: 0 },
      { id: "C", bias: 0.6, fitness: 0 }
    ];
  }

  generateSignals(state) {
    const price = state.market?.price || 60000;

    return this.population.map(p => {
      const direction = Math.random() > 0.5 ? "LONG" : "SHORT";

      return {
        agent: "SOPHIA",
        genomeId: p.id,
        signal: direction,
        confidence: Math.min(1, Math.random() * p.bias),
        price,
        cycle: state.cycle
      };
    });
  }

  selectBest(signals) {
    if (!signals || signals.length === 0) {
      return {
        agent: "SOPHIA",
        signal: "HOLD",
        confidence: 0.5,
        genomeId: "A"
      };
    }

    return signals.reduce((best, cur) =>
      cur.confidence > best.confidence ? cur : best
    );
  }

  score(genomeId, fitness) {
    const g = this.population.find(p => p.id === genomeId);
    if (!g) return;

    g.fitness = (g.fitness + fitness) / 2;
    g.bias = Math.min(1.5, Math.max(0.1, g.bias + fitness * 0.01));
  }
}

module.exports = SophiaPopulation;
