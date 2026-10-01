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
   ============================================================ */

const log = require("../util/logger");

const HOURS_PER_YEAR = 24 * 365;

class DnfhEngine {
  constructor({ exchanges, wallet, config }) {
    this.exchanges = exchanges;
    this.wallet = wallet;
    this.config = config;
  }

  /** Read-only: rank HyperLiquid perp funding opportunities by annualized yield. Never moves funds. */
  async scan({ minAnnualPct = 0, limit = 20 } = {}) {
    const hl = this.exchanges.venues.hyperliquid;
    if (!hl) throw new Error("hyperliquid venue not configured");
    const [meta, ctxs] = await hl._info({ type: "metaAndAssetCtxs" });

    const rows = (meta.universe || [])
      .map((u, i) => {
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
          // filtered out (would require short-spot, not supported here).
          harvestable: fundingHourly > 0,
        };
      })
      .filter((r) => r.harvestable && r.annualizedFundingPct >= minAnnualPct)
      .sort((a, b) => b.annualizedFundingPct - a.annualizedFundingPct)
      .slice(0, limit);

    return { generatedAt: new Date().toISOString(), note: "Funding rates move constantly — re-scan before acting on a stale number.", opportunities: rows };
  }

  /**
   * Build an explicit two-leg plan. Pure math — does not move funds.
   * `spotTokenAddress` is REQUIRED and must be an address you have
   * personally verified; this module refuses to guess it for you.
   */
  async planPosition({ symbol, usdNotional, chain = "base", spotTokenAddress, sellToken, leverage = 1 }) {
    if (!spotTokenAddress) {
      throw new Error("spotTokenAddress is required — verify the exact contract address yourself (official docs or a verified block-explorer entry) before planning a trade; this module will not guess it for you");
    }
    if (!(Number(usdNotional) > 0)) throw new Error("usdNotional must be > 0");

    const maxAllowed = Number(this.config.exchanges?.hyperliquid?.maxLeverage ?? 2);
    const lev = Math.min(Number(leverage) || 1, maxAllowed);
    if (Number(leverage) > maxAllowed) {
      log.warn("DNFH", `requested leverage ${leverage}x capped to ${maxAllowed}x — this is a yield-harvest tool, not a leverage play`);
    }

    const scan = await this.scan();
    const opp = scan.opportunities.find((o) => o.symbol === symbol);
    if (!opp) {
      throw new Error(`${symbol} has no positive funding on hyperliquid right now — refusing to plan a harvest that would pay funding instead of collecting it`);
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
  async execute(plan, { spotAmountRaw, perpQuantity, perpLimitPrice }) {
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

    return { ok: true, spotResult, perpResult, note: "Both legs submitted. Monitor funding payments via /api/exchanges/balances (hyperliquid)." };
  }
}

module.exports = DnfhEngine;
