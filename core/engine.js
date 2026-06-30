class Engine {
  generateSignal(agent, state) {
    const r = Math.random() * agent.genes.signalBias;

    if (r > 0.66) return "LONG";
    if (r < 0.33) return "SHORT";
    return "HOLD";
  }

  evaluateRisk(agent, signal, state) {
    const risk = Math.random() * (1 - agent.genes.riskTolerance);

    return {
      approved: risk < 0.6,
      riskScore: risk,
      risk: risk < 0.5 ? "LOW" : "HIGH"
    };
  }

  execute(agent, signal) {
    const base = (Math.random() - 0.45) * 0.02;
    const adjusted = base * agent.genes.executionAggression;

    return {
      pnl: adjusted,
      status: "FILLED"
    };
  }
}

module.exports = Engine;
