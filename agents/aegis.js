class AEGIS {
  constructor() {
    this.name = "AEGIS";
  }

  evaluate(signal, state) {
    const riskScore = Math.random();

    const approved = riskScore < 0.7;

    return {
      agent: this.name,
      approved,
      risk: approved ? "LOW" : "BLOCK",
      riskScore,
      regime: state.mode,
      cycle: state.cycle
    };
  }
}

module.exports = AEGIS;
