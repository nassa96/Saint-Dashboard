const https = require("https");

class MarketFeed {
  constructor() {
    this.price = 60000;
    this.lastUpdate = Date.now();
    this.source = "init";
  }

  fetchCoinbasePrice() {
    return new Promise((resolve, reject) => {
      const req = https.get(
        "https://api.coinbase.com/v2/prices/BTC-USD/spot",
        (res) => {
          let data = "";

          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              const price = parseFloat(json.data.amount);

              if (!price) throw new Error("Invalid price");

              resolve({
                price,
                source: "coinbase",
                ts: Date.now()
              });
            } catch (e) {
              reject(e);
            }
          });
        }
      );

      req.on("error", reject);
      req.setTimeout(4000, () => req.destroy());
    });
  }

  async getPrice() {
    try {
      const res = await this.fetchCoinbasePrice();
      this.price = res.price;
      this.lastUpdate = res.ts;
      this.source = res.source;
      return res;
    } catch (e) {
      // NEVER return null → always usable price
      return {
        price: this.price || 60000,
        source: "fallback",
        ts: Date.now()
      };
    }
  }
}

module.exports = MarketFeed;
