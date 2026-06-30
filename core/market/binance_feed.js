const WebSocket = require("ws");

class BinanceFeed {
  constructor(stream) {
    this.stream = stream;
    this.ws = null;
  }

  connect() {
    const url = "wss://stream.binance.us:9443/ws/btcusdt@trade";

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log("[BINANCE_US] Connected");
    });

    this.ws.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);

        if (data.p) {
          this.stream.update(
            parseFloat(data.p),
            "BINANCE_US"
          );
        }
      } catch (e) {}
    });

    this.ws.on("error", () => {
      console.log("[BINANCE_US] Feed error");
    });
  }
}

module.exports = BinanceFeed;
