/* ============================================================
   EXCHANGE MANAGER
   Central gateway for venue connectivity, read-only balances,
   and the SINGLE choke-point for live order routing.

   Live orders can ONLY flow when config.canTradeLive() === true
   (mode LIVE + LIVE_TRADING_ENABLED=true + confirmation phrase).
   Otherwise every order is refused before it can reach a venue.
   ============================================================ */

const BinanceUS = require("./binanceus");
const Coinbase = require("./coinbase");
const Kraken = require("./kraken");
const credStore = require("./credStore");
const log = require("../util/logger");

class ExchangeManager {
  constructor(config) {
    this.config = config;
    const opts = { useTestnet: config.useTestnet };
    this.venues = {
      binanceus: new BinanceUS(config.exchanges.binanceus, opts),
      coinbase: new Coinbase(config.exchanges.coinbase, opts),
      kraken: new Kraken(config.exchanges.kraken, opts),
    };
    this.primary = config.exchanges.primary;
    this.status = {};

    // Apply any credentials saved at runtime via the Connections page.
    // These override blank env vars but don't clobber ones already set.
    const saved = credStore.load();
    for (const [name, creds] of Object.entries(saved)) {
      if (this.venues[name] && creds && creds.key) {
        this.venues[name].setCredentials(creds);
        log.info("EXCHANGE", `Loaded saved credentials for ${name}`);
      }
    }
  }

  /**
   * Connect a venue at runtime: save keys, apply them, and verify with a
   * reachability + read-only balance check. Never enables live trading.
   */
  async connect(venueName, creds = {}) {
    const v = this.venues[venueName];
    if (!v) throw new Error(`unknown venue ${venueName}`);
    v.setCredentials(creds);
    credStore.set(venueName, creds);
    const result = { venue: venueName, saved: true, reachable: false, balancesOk: false, error: null };
    try {
      await v.testConnection();
      result.reachable = true;
    } catch (e) {
      result.error = `reachability: ${e.message}`;
    }
    try {
      if (v.hasCredentials()) {
        const b = await v.getBalances();
        result.balancesOk = Array.isArray(b.balances);
        result.balances = b.balances;
      }
    } catch (e) {
      result.error = `${result.error ? result.error + "; " : ""}balances: ${e.message}`;
    }
    log.info("EXCHANGE", `Connect ${venueName}: reachable=${result.reachable} balancesOk=${result.balancesOk}`);
    return result;
  }

  disconnect(venueName) {
    const v = this.venues[venueName];
    if (!v) throw new Error(`unknown venue ${venueName}`);
    v.setCredentials({ key: "", secret: "", passphrase: "" });
    credStore.remove(venueName);
    return { venue: venueName, disconnected: true };
  }

  getPrimary() {
    return this.venues[this.primary] || this.venues.coinbase;
  }

  async healthCheck() {
    const out = {};
    for (const [name, v] of Object.entries(this.venues)) {
      const entry = { name, hasCredentials: v.hasCredentials(), reachable: false, error: null };
      try {
        await v.testConnection();
        entry.reachable = true;
      } catch (e) {
        entry.error = e.message;
      }
      out[name] = entry;
    }
    this.status = out;
    return out;
  }

  async getBalances(venueName) {
    const v = this.venues[venueName || this.primary];
    if (!v) throw new Error(`unknown venue ${venueName}`);
    if (!v.hasCredentials()) return { venue: v.name, balances: [], note: "no API keys configured" };
    return v.getBalances();
  }

  /**
   * Aggregated balances across EVERY configured venue at once — the
   * multi-venue view. Venues without keys are reported, not failed.
   */
  async getAllBalances() {
    const out = {};
    await Promise.all(
      Object.entries(this.venues).map(async ([name, v]) => {
        if (!v.hasCredentials()) {
          out[name] = { venue: name, balances: [], note: "no API keys configured" };
          return;
        }
        try {
          out[name] = await v.getBalances();
        } catch (e) {
          out[name] = { venue: name, balances: [], error: e.message };
        }
      })
    );
    return { venues: out, fees: this.config.venueFees };
  }

  /**
   * The one and only path to a real order. Refuses unless the
   * global kill-switch is fully disengaged.
   */
  async routeLiveOrder(order, venueName) {
    if (!this.config.canTradeLive()) {
      const reason =
        "LIVE TRADING DISARMED — need TRADING_MODE=LIVE, LIVE_TRADING_ENABLED=true, and LIVE_TRADING_CONFIRM='I ACCEPT THE RISK'";
      log.warn("EXCHANGE", `Refused live order: ${reason}`);
      throw new Error(reason);
    }
    const v = this.venues[venueName || this.primary];
    if (!v) throw new Error(`unknown venue ${venueName}`);
    log.warn("EXCHANGE", `ARMED LIVE ORDER -> ${v.name} ${order.side} ${order.symbol}`);
    return v.placeOrder(order, true);
  }

  snapshot() {
    return {
      primary: this.primary,
      useTestnet: this.config.useTestnet,
      canTradeLive: this.config.canTradeLive(),
      fees: this.config.venueFees,
      venues: Object.fromEntries(
        Object.entries(this.venues).map(([k, v]) => [
          k,
          {
            hasCredentials: v.hasCredentials(),
            fees: this.config.venueFees[k] || null,
            ...(this.status[k] || {}),
          },
        ])
      ),
    };
  }
}

module.exports = ExchangeManager;
