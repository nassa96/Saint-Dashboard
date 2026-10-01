/* ============================================================
   AVELLANEDA–STOIKOV (spot-adapted) MARKET-MAKING STRATEGY
   Classic inventory-aware market-making model (Avellaneda & Stoikov,
   2008, "High-frequency trading in a limit order book"), adapted from
   a live limit-order-book quoting engine to a spot rotation signal.

   HONEST ADAPTATION NOTE: the original model quotes a bid AND an ask
   around a reservation price using real order-book arrival-rate data
   (kappa) from level-2 depth. We don't have L2 depth here (only trade
   closes), so:
     - `kappa` is a tunable LIQUIDITY PROXY parameter, not fitted to a
       real fill-intensity curve. Treat it as "how thick I assume the
       book is", not a measured constant.
     - We don't post resting quotes; we translate the reservation price
       and optimal half-spread into a directional LONG/SHORT/FLAT signal:
       price below (reservation - spread/2) => statistically cheap => LONG
       price above (reservation + spread/2) => statistically rich  => SHORT
     - Inventory skew (q) comes from the engine's *actual* current spot
       exposure in that symbol (0 = flat, 1 = fully sized per max position),
       passed in via `context.inventoryRatio`. More inventory => the
       reservation price skews down => less eager to buy more, quicker
       to let go of the rest. This is the real economic point of A-S:
       size down / lean against your own inventory, don't just chase score.

   Formulas (standard A-S, discrete adaptation):
     r  = s - q * gamma * sigma^2 * T            (reservation price)
     δ  = gamma * sigma^2 * T + (2/gamma) * ln(1 + gamma/kappa)   (optimal full spread)
   where s = last price, sigma = per-bar EWMA vol (decimal), T = horizonBars
   (a stand-in for "time left in the trading horizon" since spot rotation
   has no fixed expiry), gamma = risk aversion, kappa = liquidity proxy.
   ============================================================ */

const { ewmaVol } = require("../../volatility/predictor");

const defaultParams = {
  gamma: 0.15, // risk aversion — higher = skews harder away from inventory, wants wider edge
  kappa: 1.2, // liquidity proxy — higher = assumes a deeper book = tighter required edge
  horizonBars: 30, // stand-in for "time left" in the A-S formula
  entryThreshold: 0.15,
  minBars: 40,
};

// Small, bounded search space for the optimizer.
const paramSpace = {
  gamma: [0.08, 0.15, 0.25],
  kappa: [0.8, 1.2, 1.8],
  horizonBars: [15, 30, 60],
};

function evaluate(prices, params = {}, context = {}) {
  const p = { ...defaultParams, ...params };
  const reasons = [];
  const indicators = {};

  if (!Array.isArray(prices) || prices.length < p.minBars) {
    return { signal: "FLAT", confidence: 0, score: 0, reasons: ["insufficient history"], indicators };
  }

  const s = prices[prices.length - 1];
  const sigma = ewmaVol(prices); // per-bar decimal vol, real EWMA (RiskMetrics)
  if (sigma == null || !Number.isFinite(sigma)) {
    return { signal: "FLAT", confidence: 0, score: 0, reasons: ["vol unavailable"], indicators };
  }

  // Inventory: 0 = flat, 1 = fully sized long per MAX_POSITION_PCT. Spot-only
  // book, so q is clamped to [0,1] (no real short inventory in this engine).
  const q = Math.max(0, Math.min(1, context.inventoryRatio || 0));

  const variance = sigma * sigma;
  const reservation = s - q * p.gamma * variance * p.horizonBars * s;
  const spread = p.gamma * variance * p.horizonBars * s + (2 / p.gamma) * Math.log(1 + p.gamma / p.kappa) * s * sigma;

  indicators.sigma = sigma;
  indicators.reservationPrice = reservation;
  indicators.optimalSpread = spread;
  indicators.inventoryRatio = q;

  const halfSpread = spread / 2;
  const edge = reservation - s; // positive => model thinks price should be higher than market => cheap
  const normalizedEdge = halfSpread > 0 ? Math.max(-1, Math.min(1, edge / halfSpread)) : 0;

  let signal = "FLAT";
  let score = normalizedEdge;
  if (normalizedEdge > p.entryThreshold) signal = "LONG";
  else if (normalizedEdge < -p.entryThreshold) signal = "SHORT";

  reasons.push(
    `A-S reservation $${reservation.toFixed(4)} vs last $${s.toFixed(4)} (edge ${(edge / s * 100).toFixed(3)}%)`
  );
  reasons.push(`optimal half-spread ${(halfSpread / s * 100).toFixed(3)}% (gamma=${p.gamma}, kappa proxy=${p.kappa})`);
  if (q > 0) reasons.push(`inventory skew q=${q.toFixed(2)} pulling reservation down (lean against existing size)`);

  // Confidence: how far outside the spread band, damped by how thin our
  // liquidity assumption is (never pretend certainty in a proxy model).
  const confidence = Math.max(0, Math.min(1, Math.abs(normalizedEdge) * 0.8));

  return { signal, confidence, score: Math.max(-1, Math.min(1, score)), reasons, indicators };
}

module.exports = {
  name: "marketmaking",
  label: "Avellaneda-Stoikov (spot-adapted)",
  defaultParams,
  paramSpace,
  evaluate,
};
