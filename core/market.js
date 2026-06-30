const axios = require("axios");

class Market {
  constructor() {
    this.last = null;
  }

  async fetch() {
    try {
      const res = await axios.get(
        "https://api.coinbase.com/v2/prices/BTC-USD/spot"
      );

      const price = parseFloat(res.data.data.amount);

      this.last = {
        price,
        ts: Date.now(),
        source: "coinbase"
      };

      return this.last;
    } catch (e) {
      const fallback = {
        price: 60000 + Math.random() * 5000,
        ts: Date.now(),
        source: "mock"
      };

      this.last = fallback;
      return fallback;
    }
  }
}

module.exports = Market;
