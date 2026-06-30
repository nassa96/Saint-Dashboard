class SophiaPopulation {
  constructor() {
    this.strategies = [
      { id: "S1", style: "momentum", weight: 1.0, fitness: 0 },
      { id: "S2", style: "mean_reversion", weight: 1.0, fitness: 0 },
      { id: "S3", style: "random_walk", weight: 0.8, fitness: 0 }
    ];
  }

  generateSignals(state) {
    return this.strategies.map(s => {
      const confidence = Math.random();

      let signal = "HOLD";

      if (s.style === "momentum") {
        signal = confidence > 0.6 ? "LONG" : "SHORT";
      }

      if (s.style === "mean_reversion") {
        signal = confidence > 0.5 ? "SHORT" : "LONG";
      }

      return {
        strategyId: s.id,
        signal,
        confidence,
        weight: s.weight
      };
    });
  }

  score(strategyId, reward) {
    const s = this.strategies.find(x => x.id === strategyId);
    if (!s) return;

    s.fitness += reward;

    // reinforcement / decay
    if (reward > 0) {
      s.weight += 0.02;
    } else {
      s.weight *= 0.97;
    }

    s.weight = Math.max(0.1, Math.min(3, s.weight));
  }

  selectBest(signals) {
    let best = signals[0];

    for (const s of signals) {
      if (s.confidence * s.weight > best.confidence * best.weight) {
        best = s;
      }
    }

    return best;
  }

  getState() {
    return this.strategies;
  }
}

module.exports = SophiaPopulation;
