class SOPHIA {
  constructor() {
    this.name = "SOPHIA";
  }

  generateSignal(state) {
    const price = state.lastPrice || 50000;

    const noise = Math.random();

    let signal = "HOLD";
    let confidence = 0.5;

    if (noise > 0.66) {
      signal = "LONG";
      confidence = noise;
    } else if (noise < 0.33) {
      signal = "SHORT";
      confidence = 1 - noise;
    }

    return {
      agent: this.name,
      signal,
      confidence,
      price,
      cycle: state.cycle
    };
  }
}

module.exports = SOPHIA;
