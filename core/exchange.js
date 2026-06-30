class Exchange {
  constructor() {
    this.connected = false;
    this.paper = true;
  }

  connect() {
    this.connected = true;
    return { status: "CONNECTED", paper: this.paper };
  }

  setLiveMode(flag) {
    this.paper = !flag;
  }

  async placeOrder({ side, size, symbol }) {
    if (!this.connected) {
      throw new Error("Exchange not connected");
    }

    if (this.paper) {
      return {
        status: "SIM_FILLED",
        side,
        size,
        symbol,
        pnl: (Math.random() - 0.5) * 0.02
      };
    }

    // LIVE EXECUTION PLACEHOLDER
    return {
      status: "LIVE_ORDER_SENT",
      side,
      size,
      symbol
    };
  }
}

module.exports = Exchange;
