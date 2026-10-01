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
 * Raw downside deviation (not a ratio) over a price series — the
 * denominator of the Sortino ratio on its own, needed for the
 * AWP Kelly-Sortino position-sizing formula.
 * @param {number[]} prices oldest -> newest closes
 * @param {object} opts { period?, targetReturn? }
 * @returns {number|null} downside deviation (per-bar log-return units), or null if not computable
 */
function downsideDeviation(prices, opts = {}) {
  const period = opts.period || 30;
  const targetReturn = opts.targetReturn || 0;
  if (!Array.isArray(prices) || prices.length < period + 1) return null;

  const rets = logReturns(prices.slice(-(period + 1)));
  if (!rets.length) return null;

  const downside = rets.filter((r) => r < targetReturn).map((r) => (r - targetReturn) ** 2);
  if (!downside.length) return 0; // no downside observations at all
  return Math.sqrt(downside.reduce((a, b) => a + b, 0) / rets.length);
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
  const dd = downsideDeviation(prices, opts);
  if (dd == null || dd === 0) {
    // No downside observations (or not enough data) — cap at a
    // high-but-bounded ratio rather than returning Infinity (which would
    // break any downstream math).
    return mean > targetReturn ? 5 : 0;
  }

  const ratio = (mean - targetReturn) / dd;
  // Bound to keep any one symbol from dominating an allocation blend.
  return Math.max(-5, Math.min(5, ratio));
}

/**
 * sortino_scalar = clamp(targetDownsideVol / realizedDownsideDeviation, min, max)
 * Part of the AWP Kelly-Sortino sizing formula: when realized downside
 * volatility is running HOT relative to the target, the scalar shrinks
 * (less size); when it's calmer than target, the scalar grows (more size),
 * but never beyond the configured ceiling.
 */
function sortinoScalar(targetDownsideVol, realizedDownsideDeviation, { min = 0.1, max = 0.35 } = {}) {
  if (!(Number(targetDownsideVol) > 0) || !(Number(realizedDownsideDeviation) > 0)) return min;
  const raw = Number(targetDownsideVol) / Number(realizedDownsideDeviation);
  return Math.max(min, Math.min(max, raw));
}

/**
 * Plain (Reed/Kelly) fractional-bet formula: f = (p*b - q) / b
 * where p = win probability, q = 1-p, b = win/loss payoff ratio
 * (avg win size / avg loss size). Negative-edge bets clamp to 0 — this
 * is a position-SIZING formula, not a signal; it never recommends betting
 * against your own edge.
 */
function kellyFraction(winProb, winLossRatio) {
  const p = Math.max(0, Math.min(1, Number(winProb) || 0));
  const b = Number(winLossRatio);
  if (!(b > 0)) return 0;
  const q = 1 - p;
  const f = (p * b - q) / b;
  return Math.max(0, f);
}

/**
 * AWP position sizing: f* = (p*b - q)/b * sortino_scalar
 * Combines the classic Kelly edge-sizing fraction with a Sortino-based
 * risk throttle so size shrinks automatically when realized downside
 * volatility is running hot relative to target, independent of the
 * edge estimate itself.
 *
 * @param {object} p
 * @param {number} p.winProb estimated probability of a winning trade (0-1)
 * @param {number} p.winLossRatio avg win size / avg loss size (b in Kelly notation)
 * @param {number} p.targetDownsideVol target per-bar downside deviation
 * @param {number} p.realizedDownsideDeviation measured per-bar downside deviation (e.g. from downsideDeviation())
 * @param {object} [p.scalarBounds] { min=0.1, max=0.35 }
 * @param {number} [p.kellyFractionCap=1] extra safety cap on the raw Kelly fraction before scaling (full/unfractional Kelly is already aggressive)
 */
function kellySortinoFraction({ winProb, winLossRatio, targetDownsideVol, realizedDownsideDeviation, scalarBounds, kellyFractionCap = 1 }) {
  const rawKelly = Math.min(kellyFractionCap, kellyFraction(winProb, winLossRatio));
  const scalar = sortinoScalar(targetDownsideVol, realizedDownsideDeviation, scalarBounds);
  const sizedFraction = rawKelly * scalar;
  return { kellyFraction: rawKelly, sortinoScalar: scalar, sizedFraction };
}

module.exports = { sortinoRatio, logReturns, downsideDeviation, sortinoScalar, kellyFraction, kellySortinoFraction };
