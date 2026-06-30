class Memory {
  constructor() {
    this.dataset = [];
  }

  ingest(event) {
    const {
      signal,
      risk,
      execution,
      capital,
      market
    } = event;

    const pnl = execution?.pnl || 0;

    const record = {
      ts: Date.now(),
      signal,
      risk,
      pnl,
      price: market?.price,
      approved: risk?.approved || false,
      equity: capital?.equity || 100
    };

    this.dataset.push(record);
  }

  label(record) {
    // simple reinforcement labeling
    if (!record.approved) return -1;
    if (record.pnl > 0) return 1;
    if (record.pnl < 0) return -1;
    return 0;
  }

  getTrainingBatch(n = 50) {
    return this.dataset.slice(-n).map(r => ({
      ...r,
      label: this.label(r)
    }));
  }

  stats() {
    const wins = this.dataset.filter(r => r.pnl > 0).length;
    const losses = this.dataset.filter(r => r.pnl < 0).length;

    return {
      total: this.dataset.length,
      wins,
      losses,
      winRate: wins / Math.max(1, wins + losses)
    };
  }
}

module.exports = Memory;
