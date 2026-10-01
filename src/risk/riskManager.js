/* ============================================================
   RISK MANAGER  (replaces the old random AEGIS)
   Real, deterministic pre-trade risk checks + circuit breakers.

   Three independent breakers, by design (the Aegis Guardian two-tier
   drawdown model):
     - SOFT BRAKE (default 5% daily drawdown): not a halt — continuously
       re-evaluated every tick. While active, new-entry size is halved
       and leverage is capped to 1x (see maxLeverageCap()). Auto-clears
       the instant drawdown recovers back under the soft threshold; this
       is a brake, not a breaker, so it responds live rather than being
       sticky for the day.
     - HARD KILLSWITCH (default 10% daily drawdown): a real breaker —
       sticky for a rolling cooldown (default 24h, see haltCooldownHours)
       regardless of same-day recovery. The engine is expected to flatten
       all open positions to cash the moment this fires (see engine.js
       justTriggeredHardHalt / _flattenAll()) — RiskManager only decides
       WHEN, not HOW, since it doesn't own the broker/exchange handles.
     - Market-wide volatility stress halt: no loss has necessarily
       happened yet, it's precautionary -> auto-clears the moment
       conditions calm back down, same day.
   All three only ever block NEW entries (BUYs). The engine's rotation-out
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
    this.softBraked = false; // Aegis soft brake — continuously re-evaluated, not sticky
    this.softBrakeReason = null;
    this.justTriggeredHardHalt = false; // one-shot flag the engine consumes to trigger a flatten-all
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
    this.justTriggeredHardHalt = false; // reset the one-shot flag every tick before re-checking
    const dd = (this.dayStartEquity - equity) / this.dayStartEquity;

    const hardThreshold = this.cfg.maxDailyDrawdownPct;
    const softThreshold = Number(this.cfg.softBrakeDrawdownPct ?? Math.min(0.05, hardThreshold / 2));

    if (dd >= hardThreshold && !this.halted) {
      this.halted = true;
      this.justTriggeredHardHalt = true;
      const cooldownHours = Number(this.cfg.haltCooldownHours) || 24;
      this.haltUntil = Date.now() + cooldownHours * 60 * 60 * 1000;
      this.haltReason = `AEGIS HARD KILLSWITCH: daily drawdown ${(dd * 100).toFixed(1)}% >= limit ${(
        hardThreshold * 100
      ).toFixed(1)}% — flattening all positions, halted for a rolling ${cooldownHours}h cooldown (clears ${new Date(this.haltUntil).toISOString()})`;
    }

    // Soft brake: a live, continuously re-evaluated condition (NOT sticky)
    // — it tracks current drawdown every tick, engaging and clearing as
    // drawdown crosses the threshold in either direction. Only meaningful
    // below the hard threshold (once hard-halted, nothing can buy anyway).
    const softNow = dd >= softThreshold && dd < hardThreshold;
    if (softNow && !this.softBraked) {
      this.softBrakeReason = `AEGIS SOFT BRAKE: daily drawdown ${(dd * 100).toFixed(1)}% >= ${(softThreshold * 100).toFixed(1)}% — new entries halved, leverage capped to 1x`;
    } else if (!softNow) {
      this.softBrakeReason = null;
    }
    this.softBraked = softNow;

    return { dd, halted: this.halted, softBraked: this.softBraked };
  }

  /** Aegis leverage ceiling: 1x while soft-braked or hard-halted, otherwise
   *  unconstrained (the caller — e.g. DNFH — still applies its own configured cap). */
  maxLeverageCap() {
    return this.softBraked || this.halted ? 1 : Infinity;
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
    // Aegis soft brake halves new-entry size on top of whatever the
    // volatility regime already prescribes (the two stack multiplicatively
    // — a soft-braked account in an EXTREME regime gets 0.3 * 0.5 = 0.15x).
    const sizeFactor = (REGIME_SIZE_FACTOR[regime] ?? 1) * (this.softBraked ? 0.5 : 1);
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

    const risk = this.softBraked ? "HIGH" : regime === "EXTREME" ? "HIGH" : regime === "ELEVATED" || confidence > 0.75 ? "MEDIUM" : "LOW";
    const reasonBits = [];
    if (sizeFactor < 1) reasonBits.push(`sized ${(sizeFactor * 100).toFixed(0)}% for ${regime} volatility${this.softBraked ? " + Aegis soft brake" : ""}`);
    return {
      approved: true,
      reason: reasonBits.length ? `PASS (${reasonBits.join(", ")})` : "PASS",
      risk,
      maxNotional,
      sizeFactor,
      softBraked: this.softBraked,
    };
  }

  snapshot() {
    return {
      halted: this.halted,
      haltReason: this.haltReason,
      haltUntil: this.haltUntil ? new Date(this.haltUntil).toISOString() : null,
      softBraked: this.softBraked,
      softBrakeReason: this.softBrakeReason,
      maxLeverageCap: this.maxLeverageCap(),
      stressHalted: this.stressHalted,
      stressReason: this.stressReason,
      stress: this.stressInfo,
      dayStartEquity: this.dayStartEquity,
      limits: this.cfg,
    };
  }
}

module.exports = RiskManager;
