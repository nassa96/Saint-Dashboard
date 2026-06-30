/**
 * OMNIVEX MERCURY ENGINE
 * Market intelligence processor
 */

class Mercury {
  constructor(bus) {
    this.bus = bus;
    this.last = null;

    this.state = {
      volatility: 0,
      trend: 0,
      pressure: 0
    };

    this.bus.on("market.tick", (tick) => {
      this.process(tick.data);
    });
  }

  process(tick) {
    const price = tick.last;

    if (!this.last) {
      this.last = price;
      return;
    }

    const change = price - this.last;

    this.state.volatility = Math.abs(change);
    this.state.trend = change;
    this.state.pressure = tick.volume || 0;

    this.last = price;

    this.bus.emit("market.mercury", {
      ...this.state,
      symbol: tick.symbol,
      exchange: tick.exchange
    });
  }
}

module.exports = Mercury;
EOF
