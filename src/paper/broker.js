/* ============================================================
   PAPER BROKER
   Deterministic simulated execution at REAL market prices with
   modeled slippage + fees. Tracks positions, cash, equity, PnL.
   This is what runs until you explicitly arm live trading.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const log = require("../util/logger");

const DEFAULT_STORE = path.join(__dirname, "../../data/portfolio.json");

class PaperBroker {
  constructor(config, opts = {}) {
    this.startingEquity = config.capital.startingEquity;
    this.cash = config.capital.startingEquity;
    this.positions = {}; // symbol -> { qty, avgPrice }
    this.fills = [];
    this.feeRate = 0.001; // 10 bps
    this.slippageRate = 0.0005; // 5 bps
    this.equityCurve = [{ ts: Date.now(), equity: this.startingEquity }];
    this.realizedPnl = 0;
    this._saveTimer = null;
    this._persistEnabled = opts.persist !== false;
    this._storePath = opts.storePath || DEFAULT_STORE;
    if (this._persistEnabled) this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this._storePath)) return;
      const s = JSON.parse(fs.readFileSync(this._storePath, "utf8"));
      if (s && typeof s.cash === "number") {
        this.cash = s.cash;
        this.positions = s.positions || {};
        this.fills = Array.isArray(s.fills) ? s.fills : [];
        this.equityCurve = Array.isArray(s.equityCurve) && s.equityCurve.length
          ? s.equityCurve
          : this.equityCurve;
        this.realizedPnl = s.realizedPnl || 0;
        // keep the ORIGINAL starting equity so PnL stays consistent across restarts
        if (typeof s.startingEquity === "number") this.startingEquity = s.startingEquity;
        log.info("PAPER", `Restored portfolio: cash $${this.cash.toFixed(2)}, ${Object.keys(this.positions).length} positions, ${this.fills.length} fills`);
      }
    } catch (e) {
      log.warn("PAPER", `portfolio restore skipped: ${e.message}`);
    }
  }

  _persist() {
    if (!this._persistEnabled) return;
    // debounce writes to avoid hammering disk on every tick
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(this._storePath), { recursive: true });
        const data = {
          startingEquity: this.startingEquity,
          cash: this.cash,
          positions: this.positions,
          realizedPnl: this.realizedPnl,
          fills: this.fills.slice(-200),
          equityCurve: this.equityCurve.slice(-500),
          savedAt: Date.now(),
        };
        fs.writeFileSync(this._storePath, JSON.stringify(data));
      } catch (e) {
        log.warn("PAPER", `portfolio save failed: ${e.message}`);
      }
    }, 1500);
  }

  /** Reset the paper book to starting state (also clears persisted file). */
  reset() {
    this.cash = this.startingEquity;
    this.positions = {};
    this.fills = [];
    this.realizedPnl = 0;
    this.equityCurve = [{ ts: Date.now(), equity: this.startingEquity }];
    try { fs.existsSync(this._storePath) && fs.unlinkSync(this._storePath); } catch (_) {}
    log.info("PAPER", "Portfolio reset to starting equity");
  }

  _mark(symbol, price) {
    const pos = this.positions[symbol];
    if (!pos) return 0;
    return pos.qty * price;
  }

  equity(prices) {
    let posValue = 0;
    for (const [sym, pos] of Object.entries(this.positions)) {
      const px = prices[sym]?.price;
      if (px) posValue += pos.qty * px;
    }
    return this.cash + posValue;
  }

  exposure(prices) {
    let e = 0;
    for (const [sym, pos] of Object.entries(this.positions)) {
      const px = prices[sym]?.price;
      if (px) e += Math.abs(pos.qty * px);
    }
    return e;
  }

  symbolExposure(symbol, price) {
    const pos = this.positions[symbol];
    if (!pos || !price) return 0;
    return Math.abs(pos.qty * price);
  }

  /** Execute a market order. side: BUY|SELL, notional in quote currency. */
  execute({ symbol, side, notional, price }) {
    if (!price || notional <= 0) return null;
    const slip = side === "BUY" ? 1 + this.slippageRate : 1 - this.slippageRate;
    const fillPrice = price * slip;
    const qty = notional / fillPrice;
    const fee = notional * this.feeRate;

    const pos = this.positions[symbol] || { qty: 0, avgPrice: 0 };

    if (side === "BUY") {
      if (this.cash < notional + fee) {
        notional = Math.max(0, this.cash - fee);
        if (notional <= 0) return null;
      }
      const newQty = pos.qty + qty;
      pos.avgPrice = newQty > 0 ? (pos.avgPrice * pos.qty + fillPrice * qty) / newQty : fillPrice;
      pos.qty = newQty;
      this.cash -= notional + fee;
    } else {
      const sellQty = Math.min(pos.qty, qty);
      if (sellQty <= 0) return null;
      const proceeds = sellQty * fillPrice - fee;
      this.realizedPnl += sellQty * (fillPrice - pos.avgPrice) - fee;
      pos.qty -= sellQty;
      this.cash += proceeds;
    }

    if (pos.qty <= 1e-10) delete this.positions[symbol];
    else this.positions[symbol] = pos;

    const fill = {
      ts: Date.now(),
      mode: "PAPER",
      symbol,
      side,
      qty: Number(qty.toFixed(8)),
      price: Number(fillPrice.toFixed(6)),
      notional: Number(notional.toFixed(2)),
      fee: Number(fee.toFixed(4)),
      status: "FILLED",
    };
    this.fills.push(fill);
    if (this.fills.length > 500) this.fills.shift();
    log.info("PAPER", `${side} ${symbol} $${notional.toFixed(0)} @ ${fillPrice.toFixed(4)}`);
    this._persist();
    return fill;
  }

  recordEquity(prices) {
    const eq = this.equity(prices);
    this.equityCurve.push({ ts: Date.now(), equity: Number(eq.toFixed(2)) });
    if (this.equityCurve.length > 500) this.equityCurve.shift();
    this._persist();
    return eq;
  }

  snapshot(prices) {
    const eq = this.equity(prices);
    const positions = Object.entries(this.positions).map(([symbol, p]) => {
      const px = prices[symbol]?.price || p.avgPrice;
      const value = p.qty * px;
      const upnl = (px - p.avgPrice) * p.qty;
      return {
        symbol,
        qty: Number(p.qty.toFixed(8)),
        avgPrice: Number(p.avgPrice.toFixed(6)),
        markPrice: Number(px.toFixed(6)),
        value: Number(value.toFixed(2)),
        unrealizedPnl: Number(upnl.toFixed(2)),
        unrealizedPct: Number((((px - p.avgPrice) / p.avgPrice) * 100).toFixed(2)),
      };
    });
    return {
      startingEquity: this.startingEquity,
      cash: Number(this.cash.toFixed(2)),
      equity: Number(eq.toFixed(2)),
      totalPnl: Number((eq - this.startingEquity).toFixed(2)),
      totalPnlPct: Number((((eq - this.startingEquity) / this.startingEquity) * 100).toFixed(2)),
      realizedPnl: Number(this.realizedPnl.toFixed(2)),
      positions,
      recentFills: this.fills.slice(-15).reverse(),
      equityCurve: this.equityCurve.slice(-120),
    };
  }
}

module.exports = PaperBroker;
