/* ============================================================
   RISK MANAGER  (replaces the old random AEGIS)
   Real, deterministic pre-trade risk checks + circuit breakers.
   ============================================================ */

class RiskManager {
  constructor(config) {
    this.cfg = config.capital;
    this.halted = false;
    this.haltReason = null;
    this.dayStartEquity = config.capital.startingEquity;
    this.dayKey = new Date().toISOString().slice(0, 10);
  }

  _rollDay(equity) {
    const key = new Date().toISOString().slice(0, 10);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dayStartEquity = equity;
      this.halted = false;
      this.haltReason = null;
    }
  }

  updateEquity(equity) {
    this._rollDay(equity);
    const dd = (this.dayStartEquity - equity) / this.dayStartEquity;
    if (dd >= this.cfg.maxDailyDrawdownPct && !this.halted) {
      this.halted = true;
      this.haltReason = `Daily drawdown ${(dd * 100).toFixed(1)}% >= limit ${(
        this.cfg.maxDailyDrawdownPct * 100
      ).toFixed(1)}%`;
    }
    return { dd, halted: this.halted };
  }

  /**
   * Assess a proposed trade.
   * @returns {{approved:boolean, reason:string, risk:string, maxNotional:number}}
   */
  assess({ signal, confidence, equity, currentExposure, symbolExposure, price }) {
    if (this.halted) {
      return {
        approved: false,
        reason: `HALTED: ${this.haltReason}`,
        risk: "CRITICAL",
        maxNotional: 0,
      };
    }

    if (confidence < this.cfg.minSignalConfidence) {
      return {
        approved: false,
        reason: `Confidence ${confidence.toFixed(2)} < min ${this.cfg.minSignalConfidence}`,
        risk: "LOW",
        maxNotional: 0,
      };
    }

    if (signal === "FLAT") {
      return { approved: false, reason: "No directional edge", risk: "LOW", maxNotional: 0 };
    }

    // Portfolio-level exposure cap
    const maxPortfolio = equity * this.cfg.maxPortfolioRiskPct;
    if (currentExposure >= maxPortfolio) {
      return {
        approved: false,
        reason: `Portfolio exposure cap reached (${((currentExposure / equity) * 100).toFixed(0)}%)`,
        risk: "HIGH",
        maxNotional: 0,
      };
    }

    // Per-symbol cap
    const maxSymbol = equity * this.cfg.maxPositionPct;
    const roomSymbol = Math.max(0, maxSymbol - symbolExposure);
    const roomPortfolio = Math.max(0, maxPortfolio - currentExposure);
    const maxNotional = Math.min(roomSymbol, roomPortfolio);

    if (maxNotional < price * 0.0001) {
      return {
        approved: false,
        reason: "Position size cap reached for symbol",
        risk: "MEDIUM",
        maxNotional: 0,
      };
    }

    const risk = confidence > 0.75 ? "MEDIUM" : "LOW";
    return { approved: true, reason: "PASS", risk, maxNotional };
  }

  snapshot() {
    return {
      halted: this.halted,
      haltReason: this.haltReason,
      dayStartEquity: this.dayStartEquity,
      limits: this.cfg,
    };
  }
}

module.exports = RiskManager;
