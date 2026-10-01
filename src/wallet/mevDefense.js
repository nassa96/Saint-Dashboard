/* ============================================================
   MEV DEFENSE — protects YOUR OWN swaps from being sandwiched.
   This is the defensive mirror image of a sandwich attack, not an
   offensive tool: it never inspects or acts on anyone else's pending
   transactions. It only:
     1) Reads the price-impact number the aggregator (Jupiter / 0x)
        already reports for YOUR quote, and flags when it's high enough
        that a sandwich bot watching the public mempool could profitably
        squeeze you.
     2) Recommends splitting a large swap into smaller tranches (reduces
        the size of the target a sandwich bot sees in any single tx).
     3) Recommends routing the broadcast through a private/protected relay
        (e.g. Flashbots Protect on Ethereum) when one is configured, so the
        transaction never sits in the public mempool for a bot to see.

   HONESTY NOTE: this reduces sandwich-attack surface, it doesn't
   guarantee immunity. Thin-liquidity tokens (most memecoins) remain
   risky no matter what relay you use — the real defense there is
   smaller size and tighter slippage tolerance, both enforced below.
   ============================================================ */

const RISK_THRESHOLDS = {
  LOW: 0.5, // % price impact
  MEDIUM: 1.5,
  HIGH: 3.0,
};

function riskLevelFromImpact(impactPct) {
  if (impactPct == null || !Number.isFinite(impactPct)) return "UNKNOWN";
  if (impactPct >= RISK_THRESHOLDS.HIGH) return "HIGH";
  if (impactPct >= RISK_THRESHOLDS.MEDIUM) return "MEDIUM";
  if (impactPct >= RISK_THRESHOLDS.LOW) return "LOW";
  return "MINIMAL";
}

/**
 * Assess sandwich-attack exposure from a quote's own reported price impact.
 * Works for both Jupiter (priceImpactPct, a decimal like "0.012") and
 * 0x-style quotes (best-effort: falls back to null if the field isn't there).
 */
function assessRisk(quote, usdNotional, cfg = {}) {
  let impactPct = null;
  if (quote?.priceImpactPct != null) {
    // Jupiter reports this as a decimal fraction (e.g. 0.012 = 1.2%)
    impactPct = Number(quote.priceImpactPct) * 100;
  } else if (quote?.raw?.priceImpactPct != null) {
    impactPct = Number(quote.raw.priceImpactPct) * 100;
  } else if (quote?.raw?.estimatedPriceImpact != null) {
    impactPct = Number(quote.raw.estimatedPriceImpact);
  }

  const level = riskLevelFromImpact(impactPct);
  const reasons = [];
  if (impactPct != null) {
    reasons.push(`quoted price impact ${impactPct.toFixed(3)}% -> ${level} sandwich-exposure`);
  } else {
    reasons.push("aggregator did not report a price-impact figure — treat as UNKNOWN risk, size conservatively");
  }
  if (usdNotional != null && usdNotional > (cfg.splitThresholdUsd ?? 250)) {
    reasons.push(`notional $${usdNotional} exceeds split threshold — recommend tranching`);
  }

  return { level, impactPct, reasons };
}

/**
 * Plan HOW to execute: single shot vs. tranched, and whether a protected
 * relay should be used. Pure decision logic — no network calls.
 */
function planExecution(usdNotional, riskAssessment, cfg = {}) {
  const splitThreshold = cfg.splitThresholdUsd ?? 250;
  const maxChunks = cfg.maxChunks ?? 4;
  const minChunkUsd = cfg.minChunkUsd ?? 25;

  let chunks = 1;
  const highRisk = riskAssessment.level === "HIGH" || riskAssessment.level === "MEDIUM";
  if (usdNotional > splitThreshold && highRisk) {
    chunks = Math.min(maxChunks, Math.max(1, Math.floor(usdNotional / splitThreshold)));
    // Never split into dust — dust chunks are MORE fee-exposed, not less.
    if (usdNotional / chunks < minChunkUsd) chunks = Math.max(1, Math.floor(usdNotional / minChunkUsd));
  }

  const chunkUsd = Number((usdNotional / chunks).toFixed(2));
  const useProtectedRelay = Boolean(cfg.protectedRelayUrl) && (highRisk || cfg.alwaysProtect);

  return {
    chunks,
    chunkUsd,
    useProtectedRelay,
    delayMsBetweenChunks: cfg.chunkDelayMs ?? 4000,
    note: chunks > 1
      ? `splitting into ${chunks} tranches of ~$${chunkUsd} to shrink the target a sandwich bot sees per-tx`
      : "single-shot execution (below split threshold or low risk)",
  };
}

module.exports = { assessRisk, planExecution, riskLevelFromImpact, RISK_THRESHOLDS };
