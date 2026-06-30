class SelfPlayEngine {
  constructor(genome) {
    this.genome = genome;
  }

  run(populationSignals) {
    const results = [];

    for (let i = 0; i < populationSignals.length; i++) {
      for (let j = i + 1; j < populationSignals.length; j++) {
        const a = populationSignals[i];
        const b = populationSignals[j];

        const scoreA = this.fight(a, b);
        const scoreB = this.fight(b, a);

        results.push({ winner: scoreA > scoreB ? a : b });
      }
    }

    // reinforce winners
    for (const r of results) {
      this.genome.mutateFitness(r.winner.genomeId, 0.1);
    }

    return results;
  }

  fight(a, b) {
    const ca = a.confidence || 0.5;
    const cb = b.confidence || 0.5;

    return ca - cb + (Math.random() - 0.5) * 0.05;
  }
}

module.exports = SelfPlayEngine;
