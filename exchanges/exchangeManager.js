/**
 * OMNIVEX EXCHANGE MANAGER
 * Unified market ingestion layer
 */

const Coinbase = require("./coinbase");
const BinanceUS = require("./binanceus");
const Kraken = require("./kraken");

class ExchangeManager {
  constructor(streamCore) {
    this.streamCore = streamCore;

    this.exchanges = [
      new Coinbase(),
      new BinanceUS(),
      new Kraken()
    ];
  }

  start() {
    console.log("[EXCHANGE MANAGER] Starting all feeds...");

    this.exchanges.forEach((ex) => {
      ex.connect((tick) => {
        this.streamCore.bus.emit("market.raw", {
          exchange: ex.name,
          ...tick
        });
      });
    });

    console.log("[EXCHANGE MANAGER] All feeds active");
  }

  stop() {
    this.exchanges.forEach(ex => ex.disconnect?.());
  }
}

module.exports = ExchangeManager;
EOF
