class Population {
  constructor(size = 6) {
    this.generation = 0;

    this.agents = Array.from({ length: size }).map((_, i) => ({
      id: `agent_${i}`,
      genes: {
        signalBias: Math.random(),
        riskTolerance: Math.random(),
        executionAggression: Math.random()
      },
      fitness: 0,
      trades: 0,
      wins: 0,
      pnl: 0
    }));
  }

  evaluateFitness(agent) {
    if (agent.trades === 0) return 0;

    const winRate = agent.wins / agent.trades;
    const profitScore = agent.pnl;

    // reward consistency + profitability
    return (winRate * 0.6) + (profitScore * 0.4);
  }

  mutate(genes) {
    const mutationRate = 0.15;

    const mutateValue = (v) => {
      if (Math.random() < mutationRate) {
        v += (Math.random() - 0.5) * 0.2;
      }
      return Math.max(0, Math.min(1, v));
    };

    return {
      signalBias: mutateValue(genes.signalBias),
      riskTolerance: mutateValue(genes.riskTolerance),
      executionAggression: mutateValue(genes.executionAggression)
    };
  }

  breed(parentA, parentB) {
    return {
      id: `agent_${Date.now()}_${Math.floor(Math.random() * 999)}`,
      genes: {
        signalBias: Math.random() < 0.5 ? parentA.genes.signalBias : parentB.genes.signalBias,
        riskTolerance: Math.random() < 0.5 ? parentA.genes.riskTolerance : parentB.genes.riskTolerance,
        executionAggression: Math.random() < 0.5 ? parentA.genes.executionAggression : parentB.genes.executionAggression
      },
      fitness: 0,
      trades: 0,
      wins: 0,
      pnl: 0
    };
  }

  evolve() {
    this.agents.forEach(a => {
      a.fitness = this.evaluateFitness(a);
    });

    this.agents.sort((a, b) => b.fitness - a.fitness);

    const survivors = this.agents.slice(0, Math.ceil(this.agents.length / 2));

    const children = [];

    while (children.length + survivors.length < this.agents.length) {
      const p1 = survivors[Math.floor(Math.random() * survivors.length)];
      const p2 = survivors[Math.floor(Math.random() * survivors.length)];

      const child = this.breed(p1, p2);
      child.genes = this.mutate(child.genes);

      children.push(child);
    }

    this.agents = [...survivors, ...children];
    this.generation++;
  }

  getBest() {
    return [...this.agents].sort((a, b) => b.fitness - a.fitness)[0];
  }
}

module.exports = Population;
