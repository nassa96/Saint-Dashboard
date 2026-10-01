/* ============================================================
   EXTREME VOLATILITY RADAR
   A real, deterministic volatility-regime & tail-risk estimator.
   No randomness, no "impossible" claims — this is applied statistics:

     • EWMA volatility        (RiskMetrics λ=0.94, reacts fast to shocks)
     • Multi-window realized vol (short/medium/long stdev of log returns)
     • Vol-of-vol             (is volatility itself accelerating?)
     • Bollinger band-width squeeze (low-vol compression that historically
       precedes expansion — a well-documented pattern, not a guarantee)
     • Empirical percentile rank of current vol vs its own trailing history
     • A bounded 0-100 "extreme move likelihood" score built from the above,
       explicitly labeled as a statistical estimate

   HONESTY NOTE: no model can predict volatility with certainty — markets
   are fat-tailed and regimes can break without warning (see SAFETY.md).
   This module estimates *probability of an unusually large move*, it does
   not and cannot promise one. Treat "EXTREME" as "pay attention / size
   down", never as a guaranteed event.
   ============================================================ */

const EWMA_LAMBDA = 0.94; // RiskMetrics standard decay factor
const SQUEEZE_WINDOW = 20;
const PERCENTILE_LOOKBACK = 120; // bars of rolling-vol history to rank against

function logReturns(values) {
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1];
    const b = values[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

function stdev(arr) {
  if (!arr.length) return null;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/** Realized volatility (stdev of log returns) over the trailing `period` bars. */
function realizedVol(values, period) {
  if (values.length < period + 1) return null;
  const rets = logReturns(values.slice(-(period + 1)));
  return stdev(rets);
}

/** RiskMetrics-style EWMA volatility — reacts faster to fresh shocks than a flat window. */
function ewmaVol(values, lambda = EWMA_LAMBDA) {
  const rets = logReturns(values);
  if (rets.length < 5) return null;
  let variance = rets[0] * rets[0];
  for (let i = 1; i < rets.length; i++) {
    variance = lambda * variance + (1 - lambda) * rets[i] * rets[i];
  }
  return Math.sqrt(variance);
}

/** Rolling EWMA-vol series, used to rank "now" against its own recent history. */
function ewmaVolSeries(values, lambda = EWMA_LAMBDA, minBars = 10) {
  const rets = logReturns(values);
  const series = [];
  if (rets.length < minBars) return series;
  let variance = rets[0] * rets[0];
  series.push(Math.sqrt(variance));
  for (let i = 1; i < rets.length; i++) {
    variance = lambda * variance + (1 - lambda) * rets[i] * rets[i];
    series.push(Math.sqrt(variance));
  }
  return series;
}

/** Bollinger band width = (upper - lower) / middle. Low width => "squeeze". */
function bollingerWidth(values, period = SQUEEZE_WINDOW, mult = 2) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const sd = stdev(slice);
  if (!mean) return null;
  return (2 * mult * sd) / mean;
}

/** Where does `value` rank inside `series` (0-100 percentile, empirical CDF). */
function percentileRank(series, value) {
  if (!series.length || value == null) return null;
  const below = series.filter((v) => v <= value).length;
  return (below / series.length) * 100;
}

function zScore(series, value) {
  if (series.length < 5 || value == null) return null;
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const sd = stdev(series);
  if (!sd) return 0;
  return (value - mean) / sd;
}

function regimeFromPercentile(pct) {
  if (pct == null) return "UNKNOWN";
  if (pct >= 95) return "EXTREME";
  if (pct >= 80) return "ELEVATED";
  if (pct >= 35) return "NORMAL";
  return "CALM";
}

/** Bound anything into 0-100 with a logistic squash (no fake "99.999% certain" spikes). */
function squash(x) {
  return 100 / (1 + Math.exp(-x));
}

/**
 * Analyze one symbol's price series (oldest -> newest closes).
 * Returns a fully-labeled, bounded, non-random volatility read.
 */
function analyze(values) {
  if (!Array.isArray(values) || values.length < 25) {
    return {
      ready: false,
      reason: "insufficient history (<25 bars)",
    };
  }

  const shortVol = realizedVol(values, 10);
  const mediumVol = realizedVol(values, 20);
  const longVol = realizedVol(values, Math.min(60, values.length - 1));
  const ewma = ewmaVol(values);
  const series = ewmaVolSeries(values).slice(-PERCENTILE_LOOKBACK);

  const pct = percentileRank(series, ewma);
  const z = zScore(series, ewma);
  const volOfVol = stdev(series.slice(-30)); // is vol itself whipping around?

  const width = bollingerWidth(values, SQUEEZE_WINDOW);
  const widthSeries = [];
  for (let i = SQUEEZE_WINDOW; i <= values.length; i++) {
    const w = bollingerWidth(values.slice(0, i), SQUEEZE_WINDOW);
    if (w != null) widthSeries.push(w);
  }
  const widthPct = percentileRank(widthSeries.slice(-PERCENTILE_LOOKBACK), width);
  const squeeze = widthPct != null && widthPct <= 15; // tightest 15% of recent range = compression

  const regime = regimeFromPercentile(pct);

  // Bounded, explainable "extreme move likelihood" — NOT a promise, an estimate.
  // Inputs: how high current vol ranks historically (z), whether vol-of-vol is
  // rising (acceleration = instability), and whether we're coiled in a squeeze
  // (compression that has historically preceded expansion).
  const accel = volOfVol != null && series.length > 5
    ? (volOfVol - stdev(series.slice(0, Math.max(5, series.length - 30)))) || 0
    : 0;
  const rawScore = (z || 0) * 1.1 + (squeeze ? 0.8 : 0) + Math.sign(accel) * Math.min(1, Math.abs(accel) * 40);
  const extremeMoveLikelihood = Math.round(squash(rawScore) * 10) / 10;

  // Translate current vol into a plain-English expected move for the next bar.
  const lastPrice = values[values.length - 1];
  const oneSigmaPct = ewma != null ? ewma * 100 : null;
  const twoSigmaPct = ewma != null ? ewma * 200 : null;

  const reasons = [];
  if (regime === "EXTREME") reasons.push(`realized vol at ${pct.toFixed(0)}th percentile of trailing ${series.length} bars`);
  else if (regime === "ELEVATED") reasons.push(`vol running hot (${pct.toFixed(0)}th percentile)`);
  else if (regime === "CALM") reasons.push(`vol compressed (${pct.toFixed(0)}th percentile)`);
  if (squeeze) reasons.push(`Bollinger-width squeeze (${widthPct.toFixed(0)}th pct width) — compression often precedes expansion`);
  if (accel > 0.0005) reasons.push("volatility-of-volatility rising (regime destabilizing)");
  if (!reasons.length) reasons.push("no unusual volatility signature detected");

  return {
    ready: true,
    regime,
    percentile: pct != null ? Number(pct.toFixed(1)) : null,
    zScore: z != null ? Number(z.toFixed(2)) : null,
    extremeMoveLikelihoodPct: Math.max(0, Math.min(100, extremeMoveLikelihood)),
    squeeze,
    squeezeWidthPercentile: widthPct != null ? Number(widthPct.toFixed(1)) : null,
    volOfVol: volOfVol != null ? Number(volOfVol.toFixed(6)) : null,
    realized: {
      short: shortVol != null ? Number((shortVol * 100).toFixed(3)) : null,
      medium: mediumVol != null ? Number((mediumVol * 100).toFixed(3)) : null,
      long: longVol != null ? Number((longVol * 100).toFixed(3)) : null,
    },
    ewmaVolPct: ewma != null ? Number((ewma * 100).toFixed(3)) : null,
    expectedMove: {
      oneSigmaPct: oneSigmaPct != null ? Number(oneSigmaPct.toFixed(3)) : null,
      twoSigmaPct: twoSigmaPct != null ? Number(twoSigmaPct.toFixed(3)) : null,
      oneSigmaUsd: oneSigmaPct != null ? Number(((oneSigmaPct / 100) * lastPrice).toFixed(4)) : null,
    },
    reasons,
    disclaimer:
      "Statistical estimate from real price history only. Not a guarantee, not financial advice — " +
      "no model can predict volatility with certainty (see SAFETY.md).",
  };
}

/** Analyze every symbol in a {symbol -> priceSeries} map. */
function analyzeUniverse(seriesBySymbol) {
  const out = {};
  for (const [symbol, series] of Object.entries(seriesBySymbol)) {
    out[symbol] = analyze(series);
  }
  return out;
}

module.exports = {
  analyze,
  analyzeUniverse,
  // exported for tests / reuse
  realizedVol,
  ewmaVol,
  ewmaVolSeries,
  bollingerWidth,
  percentileRank,
  zScore,
};
