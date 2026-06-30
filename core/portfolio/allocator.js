class PortfolioAllocator {
  constructor() {
    this.assets = {
      BTC: 0.5,
      ETH: 0.3,
      SOL: 0.2
    };
  }

  rebalance(signals = []) {
    for (const s of signals) {
      if (!s || !s.signal || !s.asset) continue;

      if (!this.assets[s.asset]) continue;

      if (s.signal === "LONG") {
        this.assets[s.asset] += 0.01;
      }

      if (s.signal === "SHORT") {
        this.assets[s.asset] -= 0.01;
      }
    }

    this.normalize();
  }

  normalize() {
    const sum = Object.values(this.assets).reduce((a, b) => a + b, 0);

    if (sum === 0) return;

    for (const k in this.assets) {
      this.assets[k] = this.assets[k] / sum;
    }
  }

  getAllocation() {
    return this.assets;
  }
}

module.exports = PortfolioAllocator;
