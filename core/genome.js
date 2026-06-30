class Genome {
  constructor() {
    this.population = this.seed();
  }

  seed() {
    return [
      { id: "A", bias: "trend", risk: 0.3, fitness: 1, history: [] },
      { id: "B", bias: "mean", risk: 0.5, fitness: 1, history: [] },
      { id: "C", bias: "momentum", risk: 0.7, fitness: 1, history: [] }
    ];
  }

  select() {
    const total = this.population.reduce((a, b) => a + b.fitness, 0);
    let r = Math.random() * total;

    for (const g of this.population) {
      r -= g.fitness;
      if (r <= 0) return g;
    }

    return this.population[0];
  }

  update(result) {
    const g = this.population.find(p => p.id === result.id);
    if (!g) return;

    // 🧠 time-decayed learning (recent matters more)
    g.history.push({
      pnl: result.pnl,
      win: result.win
    });

    if (g.history.length > 20) g.history.shift();

    const recentWeight = g.history.slice(-5);

    const recentPnL = recentWeight.reduce((a, t) => a + (t.pnl || 0), 0);
    const winRate = recentWeight.filter(t => t.win).length / (recentWeight.length || 1);

    const reward =
      recentPnL * 10 +
      winRate * 2 -
      (result.drawdown || 0) * 3;

    g.fitness += reward * 0.01;

    g.fitness = Math.max(0.05, Math.min(10, g.fitness));
  }

  decay() {
    // slow entropy pressure
    this.population.forEach(g => {
      g.fitness *= 0.999;
    });
  }

  mutate() {
    this.population.forEach(g => {
      g.risk += (Math.random() - 0.5) * 0.02;
      g.risk = Math.max(0.1, Math.min(1, g.risk));
    });
  }

  getAll() {
    return this.population;
  }
}

module.exports = Genome;
