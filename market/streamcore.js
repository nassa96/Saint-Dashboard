const EventBus = require("../events/bus");
const ExchangeManager = require("../exchanges/exchangeManager");
const Mercury = require("./mercury");

/**
 * STREAMCORE BOOTSTRAP
 * Central market ingestion system
 */

class StreamCore {
  constructor() {
    this.bus = new EventBus();

    this.exchangeManager = new ExchangeManager(this);
    this.mercury = new Mercury(this.bus);
  }

  start() {
    console.log("[STREAMCORE] Booting market pipeline...");

    this.exchangeManager.start();

    console.log("[STREAMCORE] Market pipeline ACTIVE");
  }

  normalize() {
    // reserved for future expansion (already handled upstream)
  }
}

module.exports = StreamCore;
EOF
