class CapitalAllocator {
  constructor() {
    this.allocations = {
      A: 0.34,
      B: 0.33,
      C: 0.33
    };

    this.min = 0.05;
    this.max = 0.8;
  }

  update(genomeId, pnl) {
    let w = this.allocations[genomeId];

    if (w === undefined) {
      w = 0.33;
    }

    // reward performance
    if (pnl > 0) {
      w *= 1.03;
    } else {
      w *= 0.97;
    }

    this.allocations[genomeId] = Math.max(this.min, Math.min(this.max, w));

    this.normalize();
  }

  normalize() {
    const sum = Object.values(this.allocations).reduce((a, b) => a + b, 0);

    for (const k in this.allocations) {
      this.allocations[k] /= sum;
    }
  }

  get(genomeId) {
    return this.allocations[genomeId] || 0.33;
  }

  snapshot() {
    return this.allocations;
  }
}

module.exports = CapitalAllocator;
