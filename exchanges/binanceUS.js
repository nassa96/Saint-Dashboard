const BaseExchange = require("./baseExchange");
const axios = require("axios");

class BinanceUS extends BaseExchange {
  constructor() {
    super("BINANCE_US");
    this.baseUrl = "https://api.binance.us/api/v3";
  }

  async connect() {
    try {
      const res = await axios.get(`${this.baseUrl}/ping`);
      this.connected = true;
      return { status: "connected", data: res.data };
    } catch (err) {
      return { status: "failed", error: err.message };
    }
  }

  async getPrice(symbol = "BTCUSDT") {
    const res = await axios.get(`${this.baseUrl}/ticker/price?symbol=${symbol}`);
    return parseFloat(res.data.price);
  }
}

module.exports = BinanceUS;
