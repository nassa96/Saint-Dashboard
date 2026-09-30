/* ============================================================
   MOMENTUM / TREND-FOLLOWING STRATEGY
   Parameterized version of the original SAINT strategy: EMA
   crossover + momentum + RSI guard + MACD confirmation.
   ============================================================ */

const ind = require("../indicators");

const defaultParams = {
  emaFast: 12,
  emaSlow: 26,
  rsiPeriod: 14,
  rsiOverbought: 72,
  rsiOversold: 28,
  momLookback: 10,
  volPeriod: 20,
  entryThreshold: 0.15,
};

// Discrete search space for the optimizer (kept small to bound combos).
const paramSpace = {
  emaFast: [8, 12, 16],
  emaSlow: [21, 26, 34],
  momLookback: [5, 10, 14],
  entryThreshold: [0.1, 0.15, 0.2],
};

function evaluate(prices, params = {}) {
  const p = { ...defaultParams, ...params };
  const reasons = [];
  const indicators = {
    emaFast: ind.ema(prices, p.emaFast),
    emaSlow: ind.ema(prices, p.emaSlow),
    rsi: ind.rsi(prices, p.rsiPeriod),
    mom: ind.momentum(prices, p.momLookback),
    vol: ind.volatility(prices, p.volPeriod),
    macd: ind.macd(prices),
  };

  const minBars = Math.max(p.emaSlow + 5, 30);
  if (prices.length < minBars) {
    return { signal: "FLAT", confidence: 0, score: 0, reasons: ["insufficient history"], indicators };
  }

  let score = 0;

  if (indicators.emaFast != null && indicators.emaSlow != null) {
    const spread = (indicators.emaFast - indicators.emaSlow) / indicators.emaSlow;
    const contrib = Math.max(-0.4, Math.min(0.4, spread * 10));
    score += contrib;
    reasons.push(`EMA${p.emaFast}/${p.emaSlow} spread ${(spread * 100).toFixed(2)}% -> ${contrib >= 0 ? "+" : ""}${contrib.toFixed(2)}`);
  }

  if (indicators.mom != null) {
    const contrib = Math.max(-0.3, Math.min(0.3, indicators.mom * 5));
    score += contrib;
    reasons.push(`${p.momLookback}-bar momentum ${(indicators.mom * 100).toFixed(2)}% -> ${contrib >= 0 ? "+" : ""}${contrib.toFixed(2)}`);
  }

  if (indicators.rsi != null) {
    if (indicators.rsi > p.rsiOverbought) {
      score -= 0.2;
      reasons.push(`RSI ${indicators.rsi.toFixed(1)} overbought -> -0.20`);
    } else if (indicators.rsi < p.rsiOversold) {
      score += 0.2;
      reasons.push(`RSI ${indicators.rsi.toFixed(1)} oversold -> +0.20`);
    } else {
      reasons.push(`RSI ${indicators.rsi.toFixed(1)} neutral`);
    }
  }

  if (indicators.macd && indicators.macd.histogram != null) {
    const contrib = indicators.macd.histogram > 0 ? 0.1 : -0.1;
    score += contrib;
    reasons.push(`MACD histogram ${indicators.macd.histogram >= 0 ? "positive" : "negative"} -> ${contrib >= 0 ? "+" : ""}${contrib.toFixed(2)}`);
  }

  score = Math.max(-1, Math.min(1, score));

  let signal = "FLAT";
  if (score > p.entryThreshold) signal = "LONG";
  else if (score < -p.entryThreshold) signal = "SHORT";

  const volPenalty = indicators.vol != null ? Math.min(0.25, indicators.vol * 20) : 0;
  const confidence = Math.max(0, Math.min(1, Math.abs(score) * 1.1 + 0.18 - volPenalty * 0.4));

  return { signal, confidence, score, reasons, indicators };
}

module.exports = { name: "momentum", label: "Momentum / Trend", defaultParams, paramSpace, evaluate };
