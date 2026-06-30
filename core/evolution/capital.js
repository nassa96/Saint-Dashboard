class CapitalEvolution {
  constructor(initial = 100) {
    this.equity = initial;
    this.peak = initial;

    this.alloc = {
      SOPHIA: 0.4,
      AEGIS: 0.3,
      SAINT: 0.3
    };
  }

  updateFromResult(result) {
    if (!result.execution) return;

    const pnl = result.execution.pnl || 0;
    this.equity += pnl;
    this.peak = Math.max(this.peak, this.equity);

    // adapt allocation
    if (pnl > 0) {
      this.alloc[result.signal.agent] =
        Math.min(0.7, (this.alloc[result.signal.agent] || 0.3) + 0.02);
    } else {
      this.alloc[result.signal.agent] =
        Math.max(0.1, (this.alloc[result.signal.agent] || 0.3) - 0.03);
    }

    this.normalize();
  }

  normalize() {
    const sum = Object.values(this.alloc).reduce((a, b) => a + b, 0);
    for (const k in this.alloc) {
      this.alloc[k] /= sum;
    }
  }

  getState() {
    return {
      equity: this.equity,
      peak: this.peak,
      drawdown: (this.peak - this.equity) / this.peak,
      alloc: this.alloc
    };
  }
}

module.exports = CapitalEvolution;
