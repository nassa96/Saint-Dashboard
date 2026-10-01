/* ============================================================
   TRON WALLET — honest, read-only-first connector.
   - address()/quote-balance reads use TronGrid's PUBLIC API (no key
     required for basic account queries). Totally safe: just looking
     at a public address's public on-chain balances.
   - swap(): intentionally NOT wired to a DEX aggregator yet. The only
     public TRC-20 swap-aggregator endpoints findable at build time were
     either (a) an official SunSwap API that requires registering for
     developer-portal credentials we don't have, or (b) an unofficial
     third-party relay charging a 10% commission with no track record —
     not something to silently route your funds through. Rather than
     fake a swap path or trust an unverified relay with real money, this
     throws a clear, honest error until you've chosen and configured a
     vetted aggregator (see docs/TRON_SWAP.md).
   ============================================================ */

const { httpJson } = require("../util/http");

class TronWallet {
  constructor(cfg) {
    this.cfg = cfg; // config.wallet.tron
    this.base = cfg.tron.apiBase || "https://api.trongrid.io";
  }

  hasKey() {
    return Boolean(this.cfg.tron.privateKey);
  }

  // Derive the public address from a configured private key, or fall back
  // to an explicitly configured public address (for read-only monitoring
  // without ever supplying a key at all).
  address() {
    if (this.cfg.tron.address) return this.cfg.tron.address;
    if (!this.hasKey()) return null;
    try {
      const TronWeb = require("tronweb");
      const tw = new (TronWeb.TronWeb || TronWeb)({ fullHost: this.base, privateKey: this.cfg.tron.privateKey });
      return tw.defaultAddress?.base58 || null;
    } catch (e) {
      return null;
    }
  }

  _headers() {
    const h = { "Content-Type": "application/json" };
    if (this.cfg.tron.apiKey) h["TRON-PRO-API-KEY"] = this.cfg.tron.apiKey;
    return h;
  }

  /** Read-only: native TRX + TRC-20 balances for a public address. */
  async getBalances(address) {
    const addr = address || this.address();
    if (!addr) throw new Error("no Tron address configured (TRON_ADDRESS or TRON_PRIVATE_KEY)");
    const data = await httpJson(`${this.base}/v1/accounts/${addr}`, { headers: this._headers(), timeout: 8000 });
    const acct = data?.data?.[0] || {};
    const balances = [{ asset: "TRX", free: (acct.balance || 0) / 1e6, locked: 0 }];
    for (const t of acct.trc20 || []) {
      for (const [contract, raw] of Object.entries(t)) {
        balances.push({ asset: contract, free: Number(raw) / 1e6, locked: 0, raw: true });
      }
    }
    return { chain: "tron", address: addr, balances };
  }

  /** Read-only quote — refuses until a vetted aggregator is configured. */
  async quote() {
    throw new Error(
      "TRON swaps have no vetted aggregator configured yet — see docs/TRON_SWAP.md to wire up an official SunSwap API key " +
        "(or another aggregator you trust) before quoting/swapping. Balance reads work without this."
    );
  }

  async swap() {
    throw new Error(
      "BLOCKED: no vetted Tron swap aggregator configured — refusing to route funds through an unverified relay. See docs/TRON_SWAP.md."
    );
  }
}

module.exports = { TronWallet };
