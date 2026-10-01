/* ============================================================
   HYPERLIQUID CONNECTOR — perpetuals DEX on its own L1.
   Fundamentally different trust/risk model from the CEX venues:
     - Reads (balances/positions) need ONLY a public wallet address.
       No key of any kind touches this server for monitoring —
       Hyperliquid's /info endpoint is public and unauthenticated.
     - Orders are LEVERAGED PERPETUALS, not spot. That doesn't fit the
       notional spot-rotation model the engine's auto-loop assumes
       (buy/sell a % of equity in an asset you fully own). So this
       venue is wired for READ-ONLY monitoring in the dashboard, and
       order placement is exposed as a separate, manually-invoked,
       fully-gated endpoint — it is deliberately NOT included in the
       automatic rotation loop. Leverage changes the risk profile
       (liquidation risk) enough that it shouldn't happen silently.
   ============================================================ */

const BaseExchange = require("./base");
const { httpRequest } = require("../util/http");

class HyperLiquid extends BaseExchange {
  constructor(creds, opts = {}) {
    super("hyperliquid", creds);
    this.testnet = Boolean(opts.useTestnet);
    this.api = this.testnet ? "https://api.hyperliquid-testnet.xyz" : "https://api.hyperliquid.xyz";
  }

  // Reads only need a public address — NOT a secret. Overridden because the
  // base class assumes key+secret credentials.
  hasCredentials() {
    return Boolean(this.creds.walletAddress);
  }

  async _info(body) {
    const res = await httpRequest(`${this.api}/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeout: 8000,
    });
    if (!res.ok) throw new Error(`hyperliquid info HTTP ${res.status}: ${(res.text || "").slice(0, 160)}`);
    return res.json;
  }

  // Public, unauthenticated reachability check — no credentials needed.
  async testConnection() {
    await this._info({ type: "meta" });
    this.connected = true;
    return { ok: true };
  }

  /**
   * Read-only balances: perp account equity (margin summary) + spot token
   * balances, for the configured public wallet address only.
   */
  async getBalances() {
    if (!this.hasCredentials()) throw new Error("no wallet address configured (HYPERLIQUID_WALLET_ADDRESS)");
    const user = this.creds.walletAddress;
    const [perp, spot] = await Promise.all([
      this._info({ type: "clearinghouseState", user }),
      this._info({ type: "spotClearinghouseState", user }).catch(() => null),
    ]);

    const balances = [];
    if (perp?.marginSummary) {
      balances.push({
        asset: "USDC (perp equity)",
        free: Number(perp.marginSummary.accountValue || 0),
        locked: Number(perp.marginSummary.totalMarginUsed || 0),
      });
    }
    for (const b of spot?.balances || []) {
      balances.push({ asset: b.coin, free: Number(b.total || 0), locked: 0 });
    }

    return {
      venue: this.name,
      balances: balances.filter((b) => b.free + b.locked > 0),
      positions: (perp?.assetPositions || []).map((p) => ({
        coin: p.position?.coin,
        size: Number(p.position?.szi || 0),
        entryPx: Number(p.position?.entryPx || 0),
        unrealizedPnl: Number(p.position?.unrealizedPnl || 0),
        leverage: p.position?.leverage?.value || null,
      })),
      readOnly: true,
      note: "Monitoring only — no key required. Leveraged perp order placement is a separate, manually-gated action (not part of the auto-rotation loop).",
    };
  }

  /**
   * Manual, explicitly-invoked leveraged order placement. Deliberately NOT
   * called by the engine's automatic rotation loop (see file header).
   * Requires a dedicated HyperLiquid API-wallet private key — NEVER the
   * same key as your main EVM wallet, use Hyperliquid's own "API wallet"
   * feature so this key can only trade, never withdraw.
   */
  async placeOrder(order, armed) {
    if (!armed) throw new Error("BLOCKED: live trading not armed");
    if (!this.creds.privateKey) {
      throw new Error("no HYPERLIQUID_API_PRIVATE_KEY configured — generate a trade-only API wallet in Hyperliquid's UI");
    }
    // Lazy-loaded so the app boots without this optional dependency installed.
    const { Hyperliquid } = require("hyperliquid");
    const sdk = new Hyperliquid({
      privateKey: this.creds.privateKey,
      walletAddress: this.creds.walletAddress || undefined,
      testnet: this.testnet,
    });
    const result = await sdk.exchange.placeOrder({
      coin: order.symbol,
      is_buy: order.side === "BUY",
      sz: Number(order.quantity),
      limit_px: Number(order.limitPrice),
      order_type: order.orderType || { limit: { tif: "Ioc" } }, // Ioc ~= aggressive/market-like fill
      reduce_only: Boolean(order.reduceOnly),
    });
    return { venue: this.name, raw: result, status: "submitted", leveraged: true };
  }
}

module.exports = HyperLiquid;
