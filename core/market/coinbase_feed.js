const WebSocket = require("ws");

class CoinbaseFeed {
  constructor(stream) {
    this.stream = stream;
    this.ws = null;
  }

  connect() {
    const url = "wss://ws-feed.exchange.coinbase.com";

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log("[COINBASE] Connected");

      this.ws.send(JSON.stringify({
        type: "subscribe",
        product_ids: ["BTC-USD"],
        channels: ["ticker"]
      }));
    });

    this.ws.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);

        if (data.type === "ticker" && data.price) {
          this.stream.update(
            parseFloat(data.price),
            "COINBASE"
          );
        }
      } catch (e) {}
    });

    this.ws.on("error", () => {
      console.log("[COINBASE] Feed error — fallback active");
    });
  }
}

module.exports = CoinbaseFeed;
