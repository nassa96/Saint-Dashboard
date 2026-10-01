/* ============================================================
   DELTA-NEUTRAL FUNDING HARVEST (DNFH)
   ------------------------------------------------------------
   A real, well-known strategy used by real funds: hold spot LONG
   on one venue and an equal-notional perp SHORT on another, so net
   price exposure is ~0. On HyperLiquid (like most perp DEXs/CEXs),
   when funding is positive, perp longs pay perp shorts every funding
   interval — being short the perp collects that payment regardless
   of which way the price moves, as long as the two legs stay matched.

   This module is DELIBERATELY NOT automatic and NOT part of the
   rotation engine:
     - It never guesses a token's contract address for you. You pass
       the exact spot token address you have personally verified
       (official docs / a verified contract on a block explorer) —
       same pattern the existing on-chain swap endpoints already use.
       Getting a contract address wrong on-chain means buying the
       wrong asset with real money; this module will not take that
       risk on your behalf.
     - Leverage is hard-capped (config HYPERLIQUID_MAX_LEVERAGE,
       default 2x) — this is a yield-harvest tool, not a place to
       stack directional risk.
     - Only symbols with POSITIVE funding right now are "harvestable"
       by this module's long-spot/short-perp shape. Negative-funding
       symbols are filtered out rather than silently flipped to
       short-spot/long-perp (retail spot-shorting isn't a safe
       default to automate).
     - Execution composes two ALREADY-gated choke points
       (WalletManager.swap + ExchangeManager.placeManualLeveragedOrder).
       Both independently require the full live-arm phrase before any
       real funds move. If one leg fails after the other succeeded,
       this module does NOT silently auto-unwind (that's itself a real
       trade) — it returns a loud, explicit partial-fill warning so a
       human decides the next move instead of the bot guessing.

   ENTRY / EXIT / REBALANCE RULES (per the Market Overlord spec):
     - Entry threshold: only PLAN a harvest when the live annualized
       funding yield clears `config.dnfh.entryThresholdAnnualPct`
       (default 22%). Below that, two-leg execution risk + rebalance
       overhead isn't worth the carry — stay in USDC.
     - Net-edge gate: projected 7-day ROI = funding yield over 7 days
       MINUS (open fee + close fee + basis slippage + borrow cost).
       Must clear `config.dnfh.minNetEdge7dPct` (default 0.75%) or the
       plan is refused.
     - Rebalance triggers (checkRebalanceTriggers): delta drift beyond
       `rebalanceDeltaDriftPct` (default 1.5%) between the two legs, OR
       funding negative for `rebalanceNegativeEpochs` (default 3)
       consecutive ~1h samples. This module reports the trigger; it
       does NOT auto-rebalance (same "human decides" philosophy as the
       partial-fill handling above).
     - Funding-epoch history + "open position" bookkeeping persist to
       data/dnfh_state.json (src/yield/dnfhStore.js) so the rebalance
       check works across restarts. The "open position" record is this
       module's own best-effort bookkeeping from planPosition()/
       execute() calls — NOT a replacement for checking your real
       exchange balances.
   ============================================================ */

const log = require("../util/logger");
const store = require("./dnfhStore");

const HOURS_PER_YEAR = 24 * 365;

class DnfhEngine {
  constructor({ exchanges, wallet, config, risk = null }) {
    this.exchanges = exchanges;
    this.wallet = wallet;
    this.config = config;
    // Optional: the shared RiskManager instance (Aegis Guardian). When
    // wired in, planPosition() respects its live leverage ceiling (1x
    // while soft-braked or hard-halted) on top of the exchange's own
    // configured maxLeverage. DNFH remains usable standalone/offline
    // without a risk instance (defaults to unconstrained == no extra cap).
    this.risk = risk;
  }

  get dnfhConfig() {
    return this.config.dnfh || {};
  }

  /** Internal: fetch EVERY hyperliquid perp's current funding, unfiltered
   *  (including negative) — used both by scan() and by epoch recording. */
  async _fetchAllFundingRows() {
    const hl = this.exchanges.venues.hyperliquid;
    if (!hl) throw new Error("hyperliquid venue not configured");
    const [meta, ctxs] = await hl._info({ type: "metaAndAssetCtxs" });

    return (meta.universe || []).map((u, i) => {
      const ctx = ctxs[i] || {};
      const fundingHourly = Number(ctx.funding || 0);
      const markPx = Number(ctx.markPx || 0);
      return {
        symbol: u.name,
        fundingHourlyPct: fundingHourly * 100,
        annualizedFundingPct: fundingHourly * HOURS_PER_YEAR * 100,
        markPx,
        openInterestUsd: Number(ctx.openInterest || 0) * markPx,
        dayVolumeUsd: Number(ctx.dayNtlVlm || 0),
        // Positive funding -> perp longs pay shorts -> this module
        // harvests it via LONG spot + SHORT perp. Negative funding is
        // filtered out of scan() results (would require short-spot, not
        // supported here), but still recorded for epoch/rebalance tracking.
        harvestable: fundingHourly > 0,
      };
    });
  }

  /** Read-only: rank HyperLiquid perp funding opportunities by annualized yield. Never moves funds. */
  async scan({ minAnnualPct = 0, limit = 20 } = {}) {
    const all = await this._fetchAllFundingRows();
    const entryThreshold = Number(this.dnfhConfig.entryThresholdAnnualPct ?? 22);

    const rows = all
      .filter((r) => r.harvestable && r.annualizedFundingPct >= minAnnualPct)
      .map((r) => ({ ...r, meetsEntryThreshold: r.annualizedFundingPct >= entryThreshold }))
      .sort((a, b) => b.annualizedFundingPct - a.annualizedFundingPct)
      .slice(0, limit);

    return {
      generatedAt: new Date().toISOString(),
      entryThresholdAnnualPct: entryThreshold,
      note: "Funding rates move constantly — re-scan before acting on a stale number. 'meetsEntryThreshold' reflects the configured entry bar; planPosition() enforces it.",
      opportunities: rows,
    };
  }

  /** Append one funding-rate sample per symbol to the persisted epoch
   *  history (all symbols, including negative funding). Intended to run on
   *  a ~1h cadence from the engine so "3 consecutive negative epochs" is
   *  measured against real elapsed time, not just whenever a human opens
   *  the dashboard. Safe to call more or less often; it just records a
   *  timestamped sample each time. */
  async recordFundingEpoch() {
    const all = await this._fetchAllFundingRows().catch((e) => {
      log.warn("DNFH", `funding epoch snapshot skipped: ${e.message}`);
      return [];
    });
    for (const row of all) {
      store.recordFundingEpoch(row.symbol, row.fundingHourlyPct);
    }
    return all.length;
  }

  /**
   * Net-edge-after-costs projection. Pure math, no network calls.
   * Projects ROI over `holdingDays` from the current annualized funding
   * yield, then subtracts every modeled cost. Gated at config.dnfh.minNetEdge7dPct.
   */
  computeNetEdge({ annualizedFundingPct, holdingDays = 7, overrides = {} }) {
    const cfg = this.dnfhConfig;
    const openFeePct = Number(overrides.openFeePct ?? cfg.openFeePct ?? 0.02);
    const closeFeePct = Number(overrides.closeFeePct ?? cfg.closeFeePct ?? 0.02);
    const basisSlippagePct = Number(overrides.basisSlippagePct ?? cfg.basisSlippagePct ?? 0.05);
    const borrowCostAnnualPct = Number(overrides.borrowCostAnnualPct ?? cfg.borrowCostAnnualPct ?? 0);
    const minNetEdge7dPct = Number(overrides.minNetEdge7dPct ?? cfg.minNetEdge7dPct ?? 0.75);

    const grossYieldPct = (annualizedFundingPct / 365) * holdingDays;
    const borrowCostPct = (borrowCostAnnualPct / 365) * holdingDays;
    const totalCostPct = openFeePct + closeFeePct + basisSlippagePct + borrowCostPct;
    const netEdgePct = grossYieldPct - totalCostPct;

    return {
      holdingDays,
      grossYieldPct,
      costs: { openFeePct, closeFeePct, basisSlippagePct, borrowCostPct, totalCostPct },
      netEdgePct,
      minNetEdge7dPct,
      passesGate: netEdgePct >= minNetEdge7dPct,
    };
  }

  /**
   * Check whether an open DNFH position (tracked via dnfhStore, best-effort
   * bookkeeping from this module's own plan/execute calls) should be
   * rebalanced right now. Two independent triggers, per spec:
   *   - delta drift between the two legs' current notionals exceeds
   *     config.dnfh.rebalanceDeltaDriftPct
   *   - funding has been negative for the last
   *     config.dnfh.rebalanceNegativeEpochs consecutive recorded samples
   * Pass current mark prices in explicitly — this module does not fetch
   * arbitrary spot prices on your behalf.
   */
  checkRebalanceTriggers(symbol, { spotPx, perpPx } = {}) {
    const cfg = this.dnfhConfig;
    const reasons = [];
    const position = store.getOpenPosition(symbol);

    let deltaDriftPct = null;
    if (position && Number.isFinite(spotPx) && Number.isFinite(perpPx)) {
      const spotNotional = position.spotQty * spotPx;
      const perpNotional = Math.abs(position.perpQty) * perpPx;
      const baseline = (position.spotEntryNotional + position.perpEntryNotional) / 2 || spotNotional || 1;
      deltaDriftPct = (Math.abs(spotNotional - perpNotional) / baseline) * 100;
      if (deltaDriftPct > Number(cfg.rebalanceDeltaDriftPct ?? 1.5)) {
        reasons.push(`delta drift ${deltaDriftPct.toFixed(2)}% exceeds ${cfg.rebalanceDeltaDriftPct ?? 1.5}% threshold`);
      }
    } else if (!position) {
      reasons.push("no tracked open position for this symbol — nothing to drift-check (delta-drift trigger skipped)");
    }

    const history = store.getFundingHistory(symbol);
    const negativeEpochsNeeded = Number(cfg.rebalanceNegativeEpochs ?? 3);
    const recent = history.slice(-negativeEpochsNeeded);
    const consecutiveNegative = recent.length === negativeEpochsNeeded && recent.every((h) => h.fundingHourlyPct < 0);
    if (consecutiveNegative) {
      reasons.push(`funding negative for the last ${negativeEpochsNeeded} recorded epochs`);
    }

    return {
      symbol,
      shouldRebalance: reasons.length > 0,
      reasons,
      deltaDriftPct,
      recentFundingEpochs: recent,
      trackedPosition: position,
    };
  }

  /**
   * Build an explicit two-leg plan. Pure math — does not move funds.
   * `spotTokenAddress` is REQUIRED and must be an address you have
   * personally verified; this module refuses to guess it for you.
   * Enforces the 22% entry threshold and the 0.75%/7d net-edge gate.
   */
  async planPosition({ symbol, usdNotional, chain = "base", spotTokenAddress, sellToken, leverage = 1, holdingDays = 7, costOverrides = {} }) {
    if (!spotTokenAddress) {
      throw new Error("spotTokenAddress is required — verify the exact contract address yourself (official docs or a verified block-explorer entry) before planning a trade; this module will not guess it for you");
    }
    if (!(Number(usdNotional) > 0)) throw new Error("usdNotional must be > 0");

    const exchangeMaxLeverage = Number(this.config.exchanges?.hyperliquid?.maxLeverage ?? 2);
    // Aegis Guardian leverage ceiling: 1x while the account is soft-braked
    // or hard-halted, Infinity (no extra cap) otherwise. Whichever is
    // tighter wins — Aegis can only ever make this MORE conservative.
    const aegisMaxLeverage = this.risk ? this.risk.maxLeverageCap() : Infinity;
    const maxAllowed = Math.min(exchangeMaxLeverage, aegisMaxLeverage);
    const lev = Math.min(Number(leverage) || 1, maxAllowed);
    if (Number(leverage) > maxAllowed) {
      const reason = aegisMaxLeverage < exchangeMaxLeverage ? "Aegis soft brake / hard halt" : "this is a yield-harvest tool, not a leverage play";
      log.warn("DNFH", `requested leverage ${leverage}x capped to ${maxAllowed}x — ${reason}`);
    }

    const entryThreshold = Number(this.dnfhConfig.entryThresholdAnnualPct ?? 22);
    const scan = await this.scan({ minAnnualPct: -1e9 }); // see all positive-funding rows regardless of threshold, to give an honest refusal message
    const opp = scan.opportunities.find((o) => o.symbol === symbol);
    if (!opp) {
      throw new Error(`${symbol} has no positive funding on hyperliquid right now — refusing to plan a harvest that would pay funding instead of collecting it`);
    }
    if (opp.annualizedFundingPct < entryThreshold) {
      throw new Error(
        `${symbol} annualized funding ${opp.annualizedFundingPct.toFixed(2)}% is below the ${entryThreshold}% entry threshold — ` +
          `not worth the two-leg execution + rebalance overhead right now. Staying in USDC.`
      );
    }

    const netEdge = this.computeNetEdge({ annualizedFundingPct: opp.annualizedFundingPct, holdingDays, overrides: costOverrides });
    if (!netEdge.passesGate) {
      throw new Error(
        `${symbol} projected ${holdingDays}-day net edge ${netEdge.netEdgePct.toFixed(3)}% (after ${netEdge.costs.totalCostPct.toFixed(3)}% in modeled costs) ` +
          `is below the ${netEdge.minNetEdge7dPct}% gate — refusing to plan. Staying in USDC.`
      );
    }

    // Confirms a positive-funding opportunity exists; does not move funds.
    // (Spot-side liquidity/price should be checked separately via
    // POST /api/wallet/quote with a real sellAmount before executing.)

    return {
      symbol,
      usdNotional: Number(usdNotional),
      leverage: lev,
      legs: {
        spot: { chain, tokenAddress: spotTokenAddress, sellToken, side: "BUY", usdNotional: Number(usdNotional) },
        perp: { venue: "hyperliquid", symbol, side: "SELL", usdNotional: Number(usdNotional) * lev, reduceOnly: false },
      },
      expectedAnnualizedYieldPct: opp.annualizedFundingPct,
      fundingHourlyPct: opp.fundingHourlyPct,
      netEdge,
      netDeltaTarget: 0,
      generatedAt: new Date().toISOString(),
      note: "Two independent, already-gated legs. Call execute() with real sizes/prices from a fresh quote — it requires full live-arm + on-chain-swap arm, and will NOT auto-unwind a partial fill.",
    };
  }

  /**
   * Execute both legs for real. Requires the SAME full live-arm gate as
   * every other real-money action in this app, plus the on-chain-swap arm
   * for the spot leg. Partial fills are reported loudly, never hidden.
   */
  async execute(plan, { spotAmountRaw, perpQuantity, perpLimitPrice, spotEntryPx }) {
    if (!this.config.canTradeLive() || !this.config.canSwapOnchain()) {
      throw new Error(
        "DNFH BLOCKED: requires full live-arm (TRADING_MODE=LIVE, LIVE_TRADING_ENABLED=true, " +
          "LIVE_TRADING_CONFIRM='I ACCEPT THE RISK') AND ONCHAIN_TRADING_ENABLED=true"
      );
    }
    if (!plan?.legs?.spot?.tokenAddress || !plan?.symbol) throw new Error("invalid plan — call planPosition() first");

    log.warn("DNFH", `ARMED: harvesting ${plan.symbol} — spot BUY + perp SHORT, target leverage ${plan.leverage}x`);

    const spotResult = await this.wallet
      .swap({
        chain: plan.legs.spot.chain,
        tokenAddress: plan.legs.spot.tokenAddress,
        sellToken: plan.legs.spot.sellToken,
        amountRaw: spotAmountRaw,
        usdNotional: plan.legs.spot.usdNotional,
      })
      .catch((e) => ({ error: e.message }));

    if (spotResult.error) {
      return { ok: false, stage: "spot_leg_failed", spotResult, perpResult: null, note: "Spot leg failed — no perp leg attempted, nothing is open." };
    }

    const perpResult = await this.exchanges
      .placeManualLeveragedOrder({
        symbol: plan.symbol,
        side: "SELL",
        quantity: perpQuantity,
        limitPrice: perpLimitPrice,
        reduceOnly: false,
      })
      .catch((e) => ({ error: e.message }));

    if (perpResult.error) {
      return {
        ok: false,
        stage: "perp_leg_failed",
        spotResult,
        perpResult,
        note:
          "⚠️ SPOT LEG FILLED BUT THE PERP SHORT FAILED — you are now net LONG and exposed to price risk, " +
          "NOT delta-neutral. This module will not guess how to fix that for you: manually retry the " +
          "hyperliquid short, or sell the spot leg to flatten, right away.",
      };
    }

    // Best-effort bookkeeping for later rebalance-trigger checks — NOT a
    // substitute for checking your real exchange balances.
    try {
      const spotQty = Number(perpQuantity) || 0; // delta-neutral target: equal-notional legs
      store.setOpenPosition(plan.symbol, {
        spotQty,
        perpQty: -Math.abs(Number(perpQuantity) || 0),
        spotEntryPx: Number(spotEntryPx) || Number(perpLimitPrice) || 0,
        perpEntryPx: Number(perpLimitPrice) || 0,
        spotEntryNotional: plan.legs.spot.usdNotional,
        perpEntryNotional: plan.legs.perp.usdNotional,
        openedAt: Date.now(),
      });
    } catch (e) {
      log.warn("DNFH", `position bookkeeping skipped: ${e.message}`);
    }

    return { ok: true, spotResult, perpResult, note: "Both legs submitted. Monitor funding payments via /api/exchanges/balances (hyperliquid)." };
  }
}

module.exports = DnfhEngine;
