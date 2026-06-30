const BaseExchange = require("./baseExchange");
const axios = require("axios");

class Coinbase extends BaseExchange {
  constructor() {
    super("COINBASE");
    this.baseUrl = "https://api.exchange.coinbase.com";
  }

  async connect() {
    try {
      const res = await axios.get(`${this.baseUrl}/time`);
      this.connected = true;
      return { status: "connected", data: res.data };
    } catch (err) {
      return { status: "failed", error: err.message };
    }
  }

  async getPrice(symbol = "BTC-USD") {
    const res = await axios.get(`${this.baseUrl}/products/${symbol}/ticker`);
    return parseFloat(res.data.price);
  }
}

module.exports = Coinbase;
