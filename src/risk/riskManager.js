/* ============================================================
   RISK MANAGER  (replaces the old random AEGIS)
   Real, deterministic pre-trade risk checks + circuit breakers.

   Two independent breakers, by design:
     - Daily drawdown halt: a LOSS actually happened -> sticky for the
       rest of the day (reassess tomorrow with a clear head).
     - Market-wide volatility stress halt: no loss has necessarily
       happened yet, it's precautionary -> auto-clears the moment
       conditions calm back down, same day.
   Both only ever block NEW entries (BUYs). The engine's rotation-out
   (SELL) path never calls assess() — de-risking is always allowed.
   ============================================================ */

// Vol-regime -> position-size multiplier. A real, bounded form of
// "volatility targeting": the choppier a symbol's own regime is right
// now, the smaller a NEW position in it gets, win or lose. This is what
// makes the Extreme Volatility Radar (src/volatility/predictor.js)
// actually change behavior instead of just producing a dashboard badge.
const REGIME_SIZE_FACTOR = {
  CALM: 1,
  NORMAL: 1,
  ELEVATED: 0.6,
  EXTREME: 0.3,
  UNKNOWN: 1,
};

// Extra confidence required to open NEW risk in a choppier regime.
const REGIME_CONFIDENCE_BUMP = {
  CALM: 0,
  NORMAL: 0,
  ELEVATED: 0.05,
  EXTREME: 0.15,
  UNKNOWN: 0,
};

class RiskManager {
  constructor(config) {
    this.cfg = config.capital;
    this.halted = false;
    this.haltReason = null;
    this.stressHalted = false;
    this.stressReason = null;
    this.stressInfo = { fraction: 0, extremeCount: 0, total: 0 };
    this.dayStartEquity = config.capital.startingEquity;
    this.dayKey = new Date().toISOString().slice(0, 10);
    this.haltUntil = null; // rolling cooldown timestamp (ms) — set when a drawdown halt triggers
  }

  _rollDay(equity) {
    const key = new Date().toISOString().slice(0, 10);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dayStartEquity = equity;
      // NOTE: the calendar-day rollover resets the drawdown MEASUREMENT
      // baseline (a fresh day's "started at $X" reference) but deliberately
      // does NOT clear an active halt anymore — see _checkHaltCooldown().
      // A halt triggered at 11:58pm used to clear 2 minutes later at
      // midnight; that defeated the point of a drawdown breaker. The halt
      // now only clears once its own rolling cooldown has actually elapsed.
    }
  }

  /** Rolling cooldown clear — independent of calendar-day boundaries. */
  _checkHaltCooldown() {
    if (this.halted && this.haltUntil && Date.now() >= this.haltUntil) {
      this.halted = false;
      this.haltReason = null;
      this.haltUntil = null;
    }
  }

  updateEquity(equity) {
    this._rollDay(equity);
    this._checkHaltCooldown();
    const dd = (this.dayStartEquity - equity) / this.dayStartEquity;
    if (dd >= this.cfg.maxDailyDrawdownPct && !this.halted) {
      this.halted = true;
      const cooldownHours = Number(this.cfg.haltCooldownHours) || 24;
      this.haltUntil = Date.now() + cooldownHours * 60 * 60 * 1000;
      this.haltReason = `Daily drawdown ${(dd * 100).toFixed(1)}% >= limit ${(
        this.cfg.maxDailyDrawdownPct * 100
      ).toFixed(1)}% — halted for a rolling ${cooldownHours}h cooldown (clears ${new Date(this.haltUntil).toISOString()})`;
    }
    return { dd, halted: this.halted };
  }

  /**
   * Feed in this cycle's volatility-radar read for the whole universe.
   * If too many tracked symbols are simultaneously reading EXTREME, that's
   * a market-wide stress/contagion signature (e.g. a flash crash hitting
   * several assets at once) — pause new entries until it passes. Auto-
   * clears the moment the fraction drops back below the threshold, since
   * this is precautionary rather than a response to an actual loss.
   */
  updateMarketStress(volatilityBySymbol = {}) {
    const entries = Object.values(volatilityBySymbol || {}).filter((v) => v && v.ready);
    const extremeCount = entries.filter((v) => v.regime === "EXTREME").length;
    const fraction = entries.length > 0 ? extremeCount / entries.length : 0;
    const threshold = this.cfg.maxExtremeFractionForHalt ?? 0.5;
    // Require at least 3 tracked symbols so a 1-of-1 thin universe doesn't
    // trip a "market-wide" halt off a single noisy symbol.
    const stressed = entries.length >= 3 && fraction >= threshold;

    this.stressInfo = { fraction: Number(fraction.toFixed(3)), extremeCount, total: entries.length };
    if (stressed && !this.stressHalted) {
      this.stressReason = `MARKET-WIDE STRESS: ${extremeCount}/${entries.length} tracked symbols simultaneously in EXTREME volatility regime (>= ${(threshold * 100).toFixed(0)}% threshold)`;
    } else if (!stressed) {
      this.stressReason = null;
    }
    this.stressHalted = stressed;
    return { stressHalted: this.stressHalted, ...this.stressInfo };
  }

  /**
   * Assess a proposed trade.
   * @param {object} opts.volatility optional per-symbol radar read
   *   ({ ready, regime, extremeMoveLikelihood, ... }) from
   *   src/volatility/predictor.js — scales size down and raises the
   *   confidence bar in choppier regimes instead of just alerting.
   * @returns {{approved:boolean, reason:string, risk:string, maxNotional:number}}
   */
  assess({ signal, confidence, equity, currentExposure, symbolExposure, price, volatility }) {
    if (this.halted) {
      return {
        approved: false,
        reason: `HALTED: ${this.haltReason}`,
        risk: "CRITICAL",
        maxNotional: 0,
      };
    }

    if (this.stressHalted) {
      return {
        approved: false,
        reason: `HALTED: ${this.stressReason}`,
        risk: "CRITICAL",
        maxNotional: 0,
      };
    }

    const regime = volatility && volatility.ready ? volatility.regime : "UNKNOWN";
    const sizeFactor = REGIME_SIZE_FACTOR[regime] ?? 1;
    const confidenceBump = REGIME_CONFIDENCE_BUMP[regime] ?? 0;
    const requiredConfidence = this.cfg.minSignalConfidence + confidenceBump;

    if (confidence < requiredConfidence) {
      return {
        approved: false,
        reason:
          confidenceBump > 0
            ? `Confidence ${confidence.toFixed(2)} < min ${requiredConfidence.toFixed(2)} (raised from ${this.cfg.minSignalConfidence} — ${regime} volatility regime)`
            : `Confidence ${confidence.toFixed(2)} < min ${requiredConfidence.toFixed(2)}`,
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

    // Per-symbol cap, scaled down in choppier regimes (volatility targeting).
    const maxSymbol = equity * this.cfg.maxPositionPct * sizeFactor;
    const roomSymbol = Math.max(0, maxSymbol - symbolExposure);
    const roomPortfolio = Math.max(0, maxPortfolio - currentExposure);
    let maxNotional = Math.min(roomSymbol, roomPortfolio);

    // Micro-capital cold-start mode: absolute dollar ceiling, independent of
    // (and tighter than, when configured) the percentage-based caps above.
    if (Number(this.cfg.maxTradeUsd) > 0) {
      maxNotional = Math.min(maxNotional, Number(this.cfg.maxTradeUsd));
    }

    if (maxNotional < price * 0.0001) {
      return {
        approved: false,
        reason: "Position size cap reached for symbol",
        risk: "MEDIUM",
        maxNotional: 0,
      };
    }

    const risk = regime === "EXTREME" ? "HIGH" : regime === "ELEVATED" || confidence > 0.75 ? "MEDIUM" : "LOW";
    return {
      approved: true,
      reason: sizeFactor < 1 ? `PASS (sized ${(sizeFactor * 100).toFixed(0)}% for ${regime} volatility)` : "PASS",
      risk,
      maxNotional,
      sizeFactor,
    };
  }

  snapshot() {
    return {
      halted: this.halted,
      haltReason: this.haltReason,
      haltUntil: this.haltUntil ? new Date(this.haltUntil).toISOString() : null,
      stressHalted: this.stressHalted,
      stressReason: this.stressReason,
      stress: this.stressInfo,
      dayStartEquity: this.dayStartEquity,
      limits: this.cfg,
    };
  }
}

module.exports = RiskManager;
