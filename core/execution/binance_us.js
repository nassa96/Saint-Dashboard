class BinanceUS {
  constructor() {
    this.name = "BINANCE_US";
    this.connected = false;
  }

  connect() {
    this.connected = true;
    return true;
  }

  async placeOrder({ side, size, symbol }) {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    return {
      id: "binance_" + Date.now(),
      side,
      size,
      symbol,
      status: "SIMULATED_FILL"
    };
  }
}

module.exports = BinanceUS;
