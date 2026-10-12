/* Kraken connector — real signed private REST (API-Sign). */

const crypto = require("crypto");
const BaseExchange = require("./base");
const { httpRequest, httpJson } = require("../util/http");

class Kraken extends BaseExchange {
  constructor(creds) {
    super("kraken", creds);
    this.base = "https://api.kraken.com";
    this.lastNonce = 0;
  }

  _nextNonce() {
    // Kraken requires strictly increasing nonces per API key; concurrent
    // requests can otherwise reuse Date.now() within the same millisecond.
    this.lastNonce = Math.max(Date.now() * 1000, this.lastNonce + 1);
    return this.lastNonce;
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
    const nonce = this._nextNonce();
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
    };
    if (order.side === "BUY" && Number(order.quoteOrderQty) > 0) {
      // Kraken's spot AddOrder uses base volume by default. viqc explicitly
      // interprets volume in quote currency for buys, matching the engine's
      // USD-notional sizing and avoiding an undefined base-quantity order.
      params.volume = String(order.quoteOrderQty);
      params.oflags = "viqc";
    } else if (Number(order.quantity) > 0) {
      params.volume = String(order.quantity);
    } else {
      throw new Error("order quantity (or BUY quoteOrderQty) must be positive");
    }
    const result = await this._private("AddOrder", params);
    // AddOrder returns a submission acknowledgement, not a confirmed fill.
    // Callers must not treat this as a filled position until it is reconciled.
    return { venue: this.name, raw: result, status: "submitted", fillConfirmed: false };
  }
}

module.exports = Kraken;
