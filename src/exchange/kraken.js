/* Kraken connector — real signed private REST (API-Sign). */

const crypto = require("crypto");
const BaseExchange = require("./base");
const { httpRequest, httpJson } = require("../util/http");

class Kraken extends BaseExchange {
  constructor(creds) {
    super("kraken", creds);
    this.base = "https://api.kraken.com";
  }

  _sign(path, nonce, postData) {
    const secret = Buffer.from(this.creds.secret, "base64");
    const sha256 = crypto.createHash("sha256").update(nonce + postData).digest();
    const hmac = crypto.createHmac("sha512", secret);
    hmac.update(path);
    hmac.update(sha256);
    return hmac.digest("base64");
  }

  async testConnection() {
    await httpJson(`${this.base}/0/public/Time`, { timeout: 6000 });
    this.connected = true;
    return { ok: true };
  }

  async _private(endpoint, params = {}) {
    const path = `/0/private/${endpoint}`;
    const nonce = Date.now() * 1000;
    const body = new URLSearchParams({ nonce: String(nonce), ...params }).toString();
    const sig = this._sign(path, nonce, body);
    const res = await httpRequest(`${this.base}${path}`, {
      method: "POST",
      headers: {
        "API-Key": this.creds.key,
        "API-Sign": sig,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "saint-dashboard/2.0",
      },
      body,
      timeout: 8000,
    });
    if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}`);
    if (res.json && res.json.error && res.json.error.length)
      throw new Error(res.json.error.join("; "));
    return res.json.result;
  }

  async getBalances() {
    if (!this.hasCredentials()) throw new Error("no credentials");
    const result = await this._private("Balance");
    const balances = Object.entries(result || {})
      .map(([asset, amt]) => ({ asset, free: Number(amt), locked: 0 }))
      .filter((b) => b.free > 0);
    return { venue: this.name, balances };
  }

  async placeOrder(order, armed) {
    if (!armed) throw new Error("BLOCKED: live trading not armed");
    if (!this.hasCredentials()) throw new Error("no credentials");
    const params = {
      pair: order.symbol, // e.g. XBTUSD
      type: order.side.toLowerCase(),
      ordertype: "market",
      volume: String(order.quantity),
    };
    const result = await this._private("AddOrder", params);
    return { venue: this.name, raw: result, status: "submitted" };
  }
}

module.exports = Kraken;
