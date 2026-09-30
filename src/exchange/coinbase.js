/* Coinbase Exchange connector — real HMAC signed REST (key/secret/passphrase). */

const crypto = require("crypto");
const BaseExchange = require("./base");
const { httpRequest, httpJson } = require("../util/http");

class Coinbase extends BaseExchange {
  constructor(creds, opts = {}) {
    super("coinbase", creds);
    this.base = opts.useTestnet
      ? "https://api-public.sandbox.exchange.coinbase.com"
      : "https://api.exchange.coinbase.com";
  }

  hasCredentials() {
    return Boolean(this.creds.key && this.creds.secret && this.creds.passphrase);
  }

  _headers(method, path, body = "") {
    const timestamp = Date.now() / 1000;
    const prehash = timestamp + method + path + body;
    const key = Buffer.from(this.creds.secret, "base64");
    const signature = crypto.createHmac("sha256", key).update(prehash).digest("base64");
    return {
      "CB-ACCESS-KEY": this.creds.key,
      "CB-ACCESS-SIGN": signature,
      "CB-ACCESS-TIMESTAMP": timestamp,
      "CB-ACCESS-PASSPHRASE": this.creds.passphrase,
      "Content-Type": "application/json",
      "User-Agent": "saint-dashboard/2.0",
    };
  }

  async testConnection() {
    await httpJson(`${this.base}/time`, { timeout: 6000 });
    this.connected = true;
    return { ok: true };
  }

  async getBalances() {
    if (!this.hasCredentials()) throw new Error("no credentials (need key/secret/passphrase)");
    const path = "/accounts";
    const res = await httpRequest(`${this.base}${path}`, {
      method: "GET",
      headers: this._headers("GET", path),
      timeout: 7000,
    });
    if (!res.ok) throw new Error(`balances HTTP ${res.status}: ${res.text?.slice(0, 120)}`);
    const balances = (res.json || [])
      .map((a) => ({ asset: a.currency, free: Number(a.available), locked: Number(a.hold) }))
      .filter((b) => b.free + b.locked > 0);
    return { venue: this.name, balances };
  }

  async placeOrder(order, armed) {
    if (!armed) throw new Error("BLOCKED: live trading not armed");
    if (!this.hasCredentials()) throw new Error("no credentials");
    const path = "/orders";
    const payload = {
      product_id: order.symbol, // e.g. BTC-USD
      side: order.side.toLowerCase(),
      type: "market",
    };
    if (order.side === "BUY") payload.funds = String(order.quoteOrderQty);
    else payload.size = String(order.quantity);
    const body = JSON.stringify(payload);
    const res = await httpRequest(`${this.base}${path}`, {
      method: "POST",
      headers: this._headers("POST", path, body),
      body,
      timeout: 8000,
    });
    if (!res.ok) throw new Error(`order HTTP ${res.status}: ${res.text?.slice(0, 160)}`);
    return { venue: this.name, raw: res.json, status: res.json.status };
  }
}

module.exports = Coinbase;
