const WebSocket = require("ws");

const market = require("../data/market");

class Binance {

  connect() {

    const ws = new WebSocket(

      "wss://stream.binance.com:9443/ws/btcusdt@bookTicker"

    );

    ws.on("open", () => {

      console.log("[BINANCE] Connected");

    });

    ws.on("message", raw => {

      const msg = JSON.parse(raw);

      market.update({

        exchange: "BINANCE",

        price:
          (Number(msg.b) + Number(msg.a)) / 2,

        bid: Number(msg.b),

        ask: Number(msg.a),

        volume: 0

      });

    });

    ws.on("close", () => {

      console.log("[BINANCE] Reconnecting...");

      setTimeout(() => {

        this.connect();

      },3000);

    });

  }

}

module.exports = Binance;
