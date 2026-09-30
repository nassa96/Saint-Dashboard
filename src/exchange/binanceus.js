/* Binance.US connector — real HMAC-SHA256 signed REST. */

const crypto = require("crypto");
const BaseExchange = require("./base");
const { httpRequest, httpJson } = require("../util/http");

class BinanceUS extends BaseExchange {
  constructor(creds, opts = {}) {
    super("binanceus", creds);
    this.base = opts.useTestnet
      ? "https://api.binance.us" // Binance.US has no public testnet; production used, orders still gated
      : "https://api.binance.us";
  }

  _sign(query) {
    return crypto.createHmac("sha256", this.creds.secret).update(query).digest("hex");
  }

  async testConnection() {
    await httpJson(`${this.base}/api/v3/ping`, { timeout: 6000 });
    this.connected = true;
    return { ok: true };
  }

  async getBalances() {
    if (!this.hasCredentials()) throw new Error("no credentials");
    const ts = Date.now();
    const query = `timestamp=${ts}&recvWindow=5000`;
    const sig = this._sign(query);
    const res = await httpRequest(`${this.base}/api/v3/account?${query}&signature=${sig}`, {
      method: "GET",
      headers: { "X-MBX-APIKEY": this.creds.key },
      timeout: 7000,
    });
    if (!res.ok) throw new Error(`balances HTTP ${res.status}: ${res.text?.slice(0, 120)}`);
    const balances = (res.json.balances || [])
      .map((b) => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) }))
      .filter((b) => b.free + b.locked > 0);
    return { venue: this.name, balances };
  }

  async placeOrder(order, armed) {
    if (!armed) throw new Error("BLOCKED: live trading not armed");
    if (!this.hasCredentials()) throw new Error("no credentials");
    const { symbol, side, quoteOrderQty, quantity } = order; // symbol like BTCUSD
    const ts = Date.now();
    let query = `symbol=${symbol}&side=${side}&type=MARKET&timestamp=${ts}&recvWindow=5000`;
    if (quoteOrderQty) query += `&quoteOrderQty=${quoteOrderQty}`;
    else if (quantity) query += `&quantity=${quantity}`;
    const sig = this._sign(query);
    const res = await httpRequest(`${this.base}/api/v3/order?${query}&signature=${sig}`, {
      method: "POST",
      headers: { "X-MBX-APIKEY": this.creds.key },
      timeout: 8000,
    });
    if (!res.ok) throw new Error(`order HTTP ${res.status}: ${res.text?.slice(0, 160)}`);
    return { venue: this.name, raw: res.json, status: res.json.status };
  }
}

module.exports = BinanceUS;
