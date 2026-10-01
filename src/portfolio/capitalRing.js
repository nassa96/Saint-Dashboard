/* ============================================================
   AWP CAPITAL RING — Shield (80%) / Spear (20%) two-pool allocator
   ------------------------------------------------------------
   Implements the Autonomous Wealth Protocol's two-tier capital
   structure on top of the EXISTING per-symbol strategy-routing +
   allocator architecture, rather than bolting on a second parallel
   evaluation loop:
     - Shield pool: every symbol routed to a non-spear strategy
       (momentum, meanreversion, marketmaking, ensemble, ...).
       Capped at `shieldPct` (default 80%) of the configured
       maxPortfolioRiskPct risk budget.
     - Spear pool: every symbol routed to a configured "spear"
       strategy (default: fibonacci — the AWP high-conviction
       momentum/golden-pocket tactic). Capped at `spearPct` (default
       20%) of the same risk budget, and gated by its OWN scoped daily
       loss ceiling — a breach halts NEW spear entries only, never the
       whole engine (shield rotation + all exits keep running).

   HONEST SCOPE NOTE: this reuses the single existing per-symbol
   strategy router (config.strategyRoutes) as the pool assignment
   mechanism — whichever strategy a symbol is routed to decides its
   pool for that tick. It does not run two independent signals on the
   same symbol simultaneously (e.g. "shield AND spear both watching
   BTC"); that would need a second universe-evaluation pass, which
   isn't implemented. Route your few high-conviction spear candidates
   to the "fibonacci" strategy via config.strategyRoutes to put them in
   the spear pool.
   ============================================================ */

const Allocator = require("./allocator");
const log = require("../util/logger");

class CapitalRing {
  constructor(config) {
    this.config = config;
    const cr = config.capital.capitalRing || {};
    this.enabled = !!cr.enabled;
    this.shieldPct = Number(cr.shieldPct ?? 0.8);
    this.spearPct = Number(cr.spearPct ?? 0.2);
    this.spearStrategies = (cr.spearStrategies || ["fibonacci"]).map((s) => s.toLowerCase());
    this.spearDailyLossCeilingPct = Number(cr.spearDailyLossCeilingPct ?? 0.05); // 5% of the spear sleeve's own allocation
    this.spearHaltCooldownHours = Number(cr.spearHaltCooldownHours ?? 24);

    this.shieldAllocator = new Allocator({ capital: { ...config.capital, maxPortfolioRiskPct: config.capital.maxPortfolioRiskPct * this.shieldPct } });
    this.spearAllocator = new Allocator({ capital: { ...config.capital, maxPortfolioRiskPct: config.capital.maxPortfolioRiskPct * this.spearPct } });

    this.spearHalted = false;
    this.spearHaltUntil = null;
    this.spearDayKey = new Date().toISOString().slice(0, 10);
    this.spearDayStartRealizedPnl = 0; // realizedPnl() baseline at the start of the tracking window
  }

  isSpear(strategyName) {
    return this.spearStrategies.includes((strategyName || "").toLowerCase());
  }

  _rollSpearDay() {
    const key = new Date().toISOString().slice(0, 10);
    if (key !== this.spearDayKey) {
      this.spearDayKey = key;
      // NOTE: like the main risk manager, a calendar-day rollover resets the
      // measurement baseline but does NOT itself clear an active halt — only
      // the rolling cooldown does (see _checkSpearCooldown).
    }
    if (this.spearHalted && this.spearHaltUntil && Date.now() >= this.spearHaltUntil) {
      this.spearHalted = false;
      this.spearHaltUntil = null;
    }
  }

  /**
   * Update the spear sleeve's own scoped daily-loss tracker and halt NEW
   * spear entries (not the whole engine) if its own ceiling is breached.
   * @param {object} paper PaperBroker instance (reads trades/positions only)
   * @param {number} equity total portfolio equity right now
   * @param {Record<string,{price:number}>} prices current prices
   */
  updateSpearRisk(paper, equity, prices) {
    this._rollSpearDay();
    const spearAllocatedEquity = Math.max(1, equity * this.spearPct);

    // Realized PnL today from trades whose entry symbol was last tagged spear
    // (tag set by the engine at fill-time — see engine.js wiring).
    const todayStart = new Date().setUTCHours(0, 0, 0, 0);
    const realizedToday = (paper.trades || []).filter((t) => t.tag === "spear" && t.ts >= todayStart).reduce((a, t) => a + t.pnl, 0);

    // Unrealized PnL on currently-open spear-tagged positions.
    let unrealized = 0;
    for (const [symbol, pos] of Object.entries(paper.positions || {})) {
      if (pos.tag !== "spear") continue;
      const px = prices[symbol]?.price;
      if (!px) continue;
      unrealized += (px - pos.avgPrice) * pos.qty;
    }

    const spearPnlPct = ((realizedToday + unrealized) / spearAllocatedEquity) * 100;

    if (spearPnlPct <= -this.spearDailyLossCeilingPct * 100 && !this.spearHalted) {
      this.spearHalted = true;
      this.spearHaltUntil = Date.now() + this.spearHaltCooldownHours * 60 * 60 * 1000;
      log.warn(
        "CAPITAL_RING",
        `Spear pool daily loss ${spearPnlPct.toFixed(2)}% breached its own ${(this.spearDailyLossCeilingPct * 100).toFixed(1)}% ceiling — ` +
          `halting NEW spear entries for a rolling ${this.spearHaltCooldownHours}h (shield pool + all exits keep running).`
      );
    }

    return { spearPnlPct, spearAllocatedEquity, realizedToday, unrealized, halted: this.spearHalted, haltUntil: this.spearHaltUntil };
  }

  /**
   * Split evaluations into shield/spear pools by routed strategy, run each
   * through its own capped Allocator, and merge the resulting target-weight
   * maps. If the spear pool is halted, its evaluations are excluded from
   * new-entry targeting entirely (existing spear positions still naturally
   * unwind if their own strategy flips to FLAT/SHORT — this only blocks NEW
   * capital going into the spear pool).
   */
  computeTargets(evaluations, context = {}) {
    if (!this.enabled) {
      // Ring disabled — behave exactly like a single unified allocator
      // (shieldAllocator was constructed with the FULL risk budget as a
      // fallback only when disabled; see start()).
      return new Allocator(this.config).computeTargets(evaluations, context);
    }

    const shieldEvals = evaluations.filter((e) => !this.isSpear(e.strategy));
    const spearEvals = this.spearHalted ? [] : evaluations.filter((e) => this.isSpear(e.strategy));

    const { targets: shieldTargets, ranked: shieldRanked } = this.shieldAllocator.computeTargets(shieldEvals, context);
    const { targets: spearTargets, ranked: spearRanked } = this.spearAllocator.computeTargets(spearEvals, context);

    return {
      targets: { ...shieldTargets, ...spearTargets },
      ranked: [...shieldRanked, ...spearRanked],
      pools: { shieldPct: this.shieldPct, spearPct: this.spearPct, spearHalted: this.spearHalted },
    };
  }
}

module.exports = CapitalRing;
