class AEGIS {
  evaluate(signal, state) {
    const riskScore =
      Math.random() * 0.5 +
      (signal?.confidence ? 1 - signal.confidence : 0.5);

    const approved = riskScore < 0.7;

    return {
      agent: "AEGIS",
      approved,
      risk: approved ? "LOW" : "BLOCK",
      riskScore,
      regime: state.mode
    };
  }
}

module.exports = AEGIS;
