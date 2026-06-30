class MutationEngine {
  constructor() {
    this.strategies = [
      { name: "LONG_BIAS", weight: 0.4 },
      { name: "SHORT_BIAS", weight: 0.3 },
      { name: "MEAN_REVERT", weight: 0.3 }
    ];
  }

  select() {
    const r = Math.random();
    let sum = 0;

    for (const s of this.strategies) {
      sum += s.weight;
      if (r <= sum) return s.name;
    }

    return "MEAN_REVERT";
  }

  mutate(reward) {
    const lr = 0.02;

    this.strategies.forEach(s => {
      if (reward > 0 && s.name === "LONG_BIAS") s.weight += lr;
      if (reward < 0 && s.name === "SHORT_BIAS") s.weight += lr;
    });

    // normalize
    const total = this.strategies.reduce((a, b) => a + b.weight, 0);
    this.strategies.forEach(s => (s.weight /= total));
  }
}

module.exports = MutationEngine;
