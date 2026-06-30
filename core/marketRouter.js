const BinanceUS = require("../exchanges/binanceUS");
const Coinbase = require("../exchanges/coinbase");

class MarketRouter {
  constructor() {
    this.exchanges = {
      binance: new BinanceUS(),
      coinbase: new Coinbase()
    };
  }

  async connectAll() {
    const results = {};
    for (const [k, ex] of Object.entries(this.exchanges)) {
      results[k] = await ex.connect();
    }
    return results;
  }

  async getBestPrice(symbol) {
    const prices = [];

    for (const ex of Object.values(this.exchanges)) {
      try {
        const price = await ex.getPrice(symbol);
        prices.push(price);
      } catch (e) {}
    }

    return prices.length
      ? prices.reduce((a, b) => a + b, 0) / prices.length
      : null;
  }
}

module.exports = MarketRouter;
