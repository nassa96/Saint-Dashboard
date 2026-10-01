/* ============================================================
   GENERALIZED MULTI-CHAIN NET OPPORTUNITY FORMULA
   ------------------------------------------------------------
   Net Opportunity = Gross Dislocation - (gas + taker fee + target
   slippage + bridge cost + settlement-latency penalty + MEV risk
   discount). Trade only if Net Opportunity clears a minimum edge
   threshold — the same philosophy already enforced by DNFH's
   computeNetEdge() (funding yield minus every modeled cost), but
   generalized to any cross-venue/cross-chain dislocation, not just a
   funding-rate carry.

   Pure math — no network calls, no order placement. Every cost
   component is accepted as an explicit input (in bps-of-notional or
   flat USD) rather than guessed, so the caller stays accountable for
   its own cost assumptions.
   ============================================================ */

function bpsToUsd(bps, notionalUsd) {
  return ((Number(bps) || 0) / 10000) * notionalUsd;
}

/**
 * @param {object} p
 * @param {number} p.notionalUsd trade size the dislocation would be captured on
 * @param {number} p.grossDislocationBps the raw price gap between venues, in bps
 * @param {number} [p.gasCostUsd] flat on-chain gas cost (0 for CEX-to-CEX)
 * @param {number} [p.takerFeeBps] taker/maker fee, in bps of notional
 * @param {number} [p.targetSlippageBps] expected slippage eating into the fill, in bps
 * @param {number} [p.bridgeCostUsd] flat cross-chain bridge cost (0 for same-chain)
 * @param {number} [p.settlementLatencyPenaltyBps] expected value lost to settlement delay / price drift, in bps
 * @param {number} [p.mevRiskDiscountBps] haircut applied for expected MEV/sandwich leakage, in bps
 * @param {number} [p.minEdgeBps] minimum net edge required to approve, in bps (default 0 — any positive edge)
 */
function computeNetOpportunity({
  notionalUsd,
  grossDislocationBps,
  gasCostUsd = 0,
  takerFeeBps = 0,
  targetSlippageBps = 0,
  bridgeCostUsd = 0,
  settlementLatencyPenaltyBps = 0,
  mevRiskDiscountBps = 0,
  minEdgeBps = 0,
}) {
  if (!(Number(notionalUsd) > 0)) throw new Error("notionalUsd must be > 0");

  const grossUsd = bpsToUsd(grossDislocationBps, notionalUsd);
  const costBreakdown = {
    gasCostUsd: Number(gasCostUsd) || 0,
    takerFeeUsd: bpsToUsd(takerFeeBps, notionalUsd),
    targetSlippageUsd: bpsToUsd(targetSlippageBps, notionalUsd),
    bridgeCostUsd: Number(bridgeCostUsd) || 0,
    settlementLatencyPenaltyUsd: bpsToUsd(settlementLatencyPenaltyBps, notionalUsd),
    mevRiskDiscountUsd: bpsToUsd(mevRiskDiscountBps, notionalUsd),
  };
  const totalCostUsd = Object.values(costBreakdown).reduce((a, b) => a + b, 0);
  const netUsd = grossUsd - totalCostUsd;
  const netBps = (netUsd / notionalUsd) * 10000;

  return {
    notionalUsd,
    grossDislocationBps,
    grossUsd: Number(grossUsd.toFixed(4)),
    costBreakdown: Object.fromEntries(Object.entries(costBreakdown).map(([k, v]) => [k, Number(v.toFixed(4))])),
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    netUsd: Number(netUsd.toFixed(4)),
    netBps: Number(netBps.toFixed(2)),
    minEdgeBps,
    approved: netBps >= minEdgeBps,
  };
}

module.exports = { computeNetOpportunity, bpsToUsd };
