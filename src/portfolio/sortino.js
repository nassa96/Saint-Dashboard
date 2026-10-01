/* ============================================================
   SORTINO RATIO — risk-adjusted return using only DOWNSIDE deviation
   (unlike Sharpe, it doesn't penalize upside volatility, which is
   the correct lens for "how risky was the pain, not the excitement").

   sortino = (meanReturn - targetReturn) / downsideDeviation

   Pure function over a price series. No randomness, no network calls.
   ============================================================ */

function logReturns(values) {
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1];
    const b = values[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

/**
 * @param {number[]} prices oldest -> newest closes
 * @param {object} opts { period?, targetReturn? }
 * @returns {number|null} Sortino ratio (per-bar units), or null if not computable
 */
function sortinoRatio(prices, opts = {}) {
  const period = opts.period || 30;
  const targetReturn = opts.targetReturn || 0;
  if (!Array.isArray(prices) || prices.length < period + 1) return null;

  const rets = logReturns(prices.slice(-(period + 1)));
  if (!rets.length) return null;

  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const downside = rets.filter((r) => r < targetReturn).map((r) => (r - targetReturn) ** 2);
  if (!downside.length) {
    // No downside observations at all — cap at a high-but-bounded ratio
    // rather than returning Infinity (which would break any downstream math).
    return mean > targetReturn ? 5 : 0;
  }
  const downsideDeviation = Math.sqrt(downside.reduce((a, b) => a + b, 0) / rets.length);
  if (downsideDeviation === 0) return mean > targetReturn ? 5 : 0;

  const ratio = (mean - targetReturn) / downsideDeviation;
  // Bound to keep any one symbol from dominating an allocation blend.
  return Math.max(-5, Math.min(5, ratio));
}

module.exports = { sortinoRatio, logReturns };
