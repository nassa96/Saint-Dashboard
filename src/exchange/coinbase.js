/* Coinbase Advanced Trade connector — CDP Secret API Key / ECDSA JWT auth. */
const crypto = require("crypto");
const BaseExchange = require("./base");
const { httpRequest } = require("../util/http");

function b64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

class Coinbase extends BaseExchange {
  constructor(creds, opts = {}) {
    super("coinbase", creds);
    this.base = opts.useTestnet ? "https://api-sandbox.coinbase.com" : "https://api.coinbase.com";
  }

  hasCredentials() {
    return Boolean(this.creds.key && this.creds.secret && this.creds.portfolioUuid);
  }

  _jwt(method, path) {
    if (!this.creds.key || !this.creds.secret) throw new Error("Coinbase CDP credentials are not configured");
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "ES256", kid: this.creds.key, nonce: crypto.randomBytes(16).toString("hex") };
    const payload = {
      iss: "cdp",
      sub: this.creds.key,
      nbf: now,
      exp: now + 120,
      aud: ["retail_rest_api"],
      uri: `${method.toUpperCase()} api.coinbase.com${path}`,
    };
    const encoded = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
    const privateKey = crypto.createPrivateKey(String(this.creds.secret).replace(/\\n/g, "\n"));
    const signature = crypto.createSign("SHA256").update(encoded).sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
    return encoded + "." + b64url(signature);
  }

  _headers(method, path, body = "") {
    return {
      Authorization: `Bearer ${this._jwt(method, path)}`,
      "Content-Type": "application/json",
      "User-Agent": "saint-dashboard/2.0",
    };
  }

  async _request(method, path, payload) {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const res = await httpRequest(`${this.base}${path}`, {
      method,
      headers: this._headers(method, path, body),
      ...(body ? { body } : {}),
      timeout: 8000,
    });
    if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}: ${res.text?.slice(0, 240)}`);
    return res.json || {};
  }

  async testConnection() {
    // Public reachability first; authenticated verification happens in getBalances().
    const res = await httpRequest(`${this.base}/api/v3/brokerage/time`, { timeout: 6000 });
    if (!res.ok) throw new Error(`reachability HTTP ${res.status}`);
    this.connected = true;
    return { ok: true };
  }

  async getBalances() {
    if (!this.hasCredentials()) throw new Error("no Coinbase CDP credentials (key name/private key/portfolio UUID)");
    const data = await this._request("GET", "/api/v3/brokerage/accounts");
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const balances = accounts.map((a) => ({
      asset: a.currency,
      free: Number(a.available_balance?.value || 0),
      locked: Number(a.hold?.value || 0),
    })).filter((b) => b.free + b.locked > 0);

    // Verify the operator supplied the intended portfolio, not merely a valid key.
    const portfolio = await this._request("GET", `/api/v3/brokerage/portfolios/${encodeURIComponent(this.creds.portfolioUuid)}`);
    return { venue: this.name, balances, portfolioUuid: this.creds.portfolioUuid, portfolio };
  }

  async placeOrder(order, armed) {
    if (!armed) throw new Error("BLOCKED: live trading not armed");
    if (!this.hasCredentials()) throw new Error("no Coinbase CDP credentials");
    const clientOrderId = crypto.randomUUID();
    const config = order.side === "BUY"
      ? { market_market_ioc: { quote_size: String(order.quoteOrderQty) } }
      : { market_market_ioc: { base_size: String(order.quantity) } };
    const payload = {
      client_order_id: clientOrderId,
      product_id: order.symbol,
      side: order.side,
      order_configuration: config,
    };
    const data = await this._request("POST", "/api/v3/brokerage/orders", payload);
    return { venue: this.name, clientOrderId, raw: data, orderId: data.order_id, success: data.success };
  }
}

module.exports = Coinbase;
