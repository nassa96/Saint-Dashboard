/* ============================================================
   MEAN-REVERSION STRATEGY
   Fades stretched moves: buys statistically cheap (low z-score /
   oversold RSI) and sells rich, but only in non-trending regimes
   (avoids fighting strong trends). Complements momentum.
   ============================================================ */

const ind = require("../indicators");

const defaultParams = {
  smaPeriod: 20,
  zPeriod: 20,
  rsiPeriod: 14,
  zEntry: 1.5, // std devs from mean to trigger
  rsiLow: 35,
  rsiHigh: 65,
  trendFilter: 0.03, // skip if |EMA fast/slow spread| exceeds this (strong trend)
  volPeriod: 20,
  entryThreshold: 0.15,
};

const paramSpace = {
  zPeriod: [15, 20, 30],
  zEntry: [1.0, 1.5, 2.0],
  rsiLow: [30, 35],
  rsiHigh: [65, 70],
};

function stdev(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  return { mean, std: Math.sqrt(variance) };
}

function evaluate(prices, params = {}) {
  const p = { ...defaultParams, ...params };
  const reasons = [];
  const price = prices[prices.length - 1];
  const stats = stdev(prices, p.zPeriod);
  const indicators = {
    sma: ind.sma(prices, p.smaPeriod),
    rsi: ind.rsi(prices, p.rsiPeriod),
    vol: ind.volatility(prices, p.volPeriod),
    emaFast: ind.ema(prices, 12),
    emaSlow: ind.ema(prices, 26),
    z: stats && stats.std > 0 ? (price - stats.mean) / stats.std : null,
  };

  const minBars = Math.max(p.zPeriod + 5, 30);
  if (prices.length < minBars || indicators.z == null) {
    return { signal: "FLAT", confidence: 0, score: 0, reasons: ["insufficient history"], indicators };
  }

  // Trend filter — mean reversion is dangerous in strong trends
  if (indicators.emaFast != null && indicators.emaSlow != null) {
    const spread = Math.abs((indicators.emaFast - indicators.emaSlow) / indicators.emaSlow);
    if (spread > p.trendFilter) {
      reasons.push(`strong trend (${(spread * 100).toFixed(1)}%) — stand aside`);
      return { signal: "FLAT", confidence: 0, score: 0, reasons, indicators };
    }
  }

  let score = 0;
  const z = indicators.z;

  // Fade the z-score: negative z (cheap) -> long, positive z (rich) -> short
  const zContrib = Math.max(-0.6, Math.min(0.6, (-z / p.zEntry) * 0.4));
  score += zContrib;
  reasons.push(`z-score ${z.toFixed(2)} -> ${zContrib >= 0 ? "+" : ""}${zContrib.toFixed(2)}`);

  if (indicators.rsi != null) {
    if (indicators.rsi < p.rsiLow) {
      score += 0.25;
      reasons.push(`RSI ${indicators.rsi.toFixed(1)} < ${p.rsiLow} oversold -> +0.25`);
    } else if (indicators.rsi > p.rsiHigh) {
      score -= 0.25;
      reasons.push(`RSI ${indicators.rsi.toFixed(1)} > ${p.rsiHigh} overbought -> -0.25`);
    }
  }

  score = Math.max(-1, Math.min(1, score));

  let signal = "FLAT";
  if (score > p.entryThreshold) signal = "LONG";
  else if (score < -p.entryThreshold) signal = "SHORT";

  const volPenalty = indicators.vol != null ? Math.min(0.25, indicators.vol * 20) : 0;
  const confidence = Math.max(0, Math.min(1, Math.abs(score) * 1.1 + 0.18 - volPenalty * 0.4));

  return { signal, confidence, score, reasons, indicators };
}

module.exports = { name: "meanreversion", label: "Mean Reversion", defaultParams, paramSpace, evaluate };
