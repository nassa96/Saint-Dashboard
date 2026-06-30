const EventEmitter = require("events");

class MarketStream extends EventEmitter {
  constructor() {
    super();

    this.price = null;
    this.source = "INIT";

    this.listeners = [];
  }

  async connect() {
    console.log("[MARKET] Stream initialized (simulation fallback)");

    // fallback simulation loop (used only if no live feed)
    setInterval(() => {
      const fakePrice = 60000 + (Math.random() - 0.5) * 200;

      this.price = fakePrice;
      this.source = "SIM";

      this.emit("tick", {
        price: fakePrice,
        source: this.source,
        ts: Date.now()
      });
    }, 2000);
  }

  update(price, source) {
    this.price = price;
    this.source = source;

    this.emit("tick", {
      price,
      source,
      ts: Date.now()
    });
  }

  getPrice() {
    return {
      price: this.price || 60000,
      source: this.source
    };
  }
}

module.exports = MarketStream;
