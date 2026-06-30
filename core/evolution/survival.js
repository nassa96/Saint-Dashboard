class SurvivalEngine {
  constructor(genome) {
    this.genome = genome;

    this.threshold = -0.02; // survival cutoff
    this.rebirthBias = 1.0;
  }

  evaluate() {
    const pop = this.genome.population;

    const survivors = [];
    const dead = [];

    for (const g of pop) {
      const pnl = g.equity - 100;

      if (pnl >= this.threshold * 100) {
        survivors.push(g);
      } else {
        dead.push(g);
      }
    }

    // REBIRTH LOGIC (keep population stable)
    for (const d of dead) {
      const child = this.revive(d);
      survivors.push(child);
    }

    this.genome.population = survivors;

    return {
      survivors: survivors.map(x => x.id),
      dead: dead.map(x => x.id)
    };
  }

  revive(parent) {
    return {
      id: parent.id + "_r" + Math.floor(Math.random() * 1000),
      bias: this.rebirthBias * Math.random(),
      equity: 100
    };
  }
}

module.exports = SurvivalEngine;
