/* ============================================================
   FIBONACCI CONFLUENCE MOMENTUM STRATEGY
   ("spear pool" tactic for the Autonomous Wealth Protocol / Market
   Overlord spec you provided — asymmetric, convex entries.)

   Thesis: identify a higher-timeframe trend, wait for price to pull back
   into the "golden pocket" (0.618-0.65 retracement) of the most recent
   swing leg, and require a confirming momentum signal before entering —
   rather than buying every retracement blind.

   HONEST ADAPTATION NOTES (read before trusting this in size):
     - Swing detection is the simplest honest definition — highest-high /
       lowest-low over a lookback window (src/signals/indicators.js
       swingRange). It is NOT a full zigzag/pivot detector, so on a choppy
       (non-trending) tape the "swing" it finds may not be a clean impulse
       leg. Works best when the higher-timeframe trend filter agrees.
     - "Confirming stochastic divergence" in the spec is implemented here
       as a SIMPLER proxy: %K crossing above %D from oversold territory
       ("momentum turning up"), not true multi-pivot price/oscillator
       divergence (price makes a lower low while the oscillator makes a
       higher low). Real divergence detection is a meaningfully bigger
       feature — flagged as a possible future enhancement, not silently
       skipped.
     - "Volume exhaustion" only runs when real volume data is available
       (live Coinbase candles via context.bars). In SIM/backtest mode
       (closes-only, synthesized degenerate bars with open=high=low=close)
       there's no real volume, so that check is skipped rather than faked.
     - This module emits the ENTRY signal (LONG/FLAT) on the standard
       registry interface, same as momentum.js/meanReversion.js, so it
       plugs into the existing rotation engine. The tiered take-profit
       ladder (1.272 / 1.618 / 2.618 extensions + ATR trailing stop) is
       computed and returned under `indicators.tpPlan` for display/manual
       use — the engine's continuous target-weight rotation model doesn't
       natively support "close 35% at TP1, move stop to breakeven, trail
       the rest" as a scripted multi-leg exit. Wiring that up for real
       would need a dedicated per-position exit manager running alongside
       the rotation loop; this does not silently claim to do that yet.
   ============================================================ */

const { ema, atr, stochastic, swingRange, fibLevels } = require("../indicators");

const defaultParams = {
  trendEmaPeriod: 50,
  swingLookback: 40,
  goldenPocketTolerance: 0.002, // 0.2% padding around the 0.618-0.65 band
  stochPeriod: 14,
  minBars: 60,
  atrMultiplier: 2.5,
};

const paramSpace = {
  trendEmaPeriod: [30, 50, 80],
  swingLookback: [25, 40, 60],
  stochPeriod: [10, 14, 21],
};

/** Build degenerate OHLC bars from a close-only series (backtest/optimizer
 *  path, where only `prices` is available, not real context.bars). */
function barsFromCloses(prices) {
  return prices.map((p, i) => ({ ts: i, open: p, high: p, low: p, close: p, volume: null }));
}

function evaluate(prices, params = {}, context = {}) {
  const p = { ...defaultParams, ...params };
  const reasons = [];
  const indicators = {};

  if (!Array.isArray(prices) || prices.length < p.minBars) {
    return { signal: "FLAT", confidence: 0, score: 0, reasons: ["insufficient history"], indicators };
  }

  const bars = Array.isArray(context.bars) && context.bars.length >= p.minBars ? context.bars : barsFromCloses(prices);
  const usingRealBars = bars !== undefined && Array.isArray(context.bars) && context.bars.length >= p.minBars;
  const last = bars[bars.length - 1];
  const price = last.close;

  // 1) Higher-timeframe trend filter
  const emaFast = ema(prices, Math.round(p.trendEmaPeriod / 2));
  const emaSlow = ema(prices, p.trendEmaPeriod);
  if (emaFast == null || emaSlow == null) {
    return { signal: "FLAT", confidence: 0, score: 0, reasons: ["trend EMA unavailable"], indicators };
  }
  const trend = emaFast > emaSlow ? "up" : "down";
  indicators.trend = trend;
  indicators.emaFast = emaFast;
  indicators.emaSlow = emaSlow;

  // Spot-only engine: only act on uptrend pullbacks (no short inventory).
  if (trend !== "up") {
    return { signal: "FLAT", confidence: 0, score: 0, reasons: [`downtrend (ema${Math.round(p.trendEmaPeriod / 2)} < ema${p.trendEmaPeriod}) — spot-only, no short leg`], indicators };
  }

  // 2) Swing leg + Fibonacci levels
  const swing = swingRange(bars, p.swingLookback);
  if (!swing) {
    return { signal: "FLAT", confidence: 0, score: 0, reasons: ["insufficient bars for swing detection"], indicators };
  }
  const fib = fibLevels(swing.low, swing.high, "up");
  if (!fib) {
    return { signal: "FLAT", confidence: 0, score: 0, reasons: ["no valid swing range (high <= low)"], indicators };
  }
  indicators.swing = swing;
  indicators.fib = fib;

  // 3) Golden pocket test (0.618-0.65 retracement band, with small tolerance)
  const bandLow = fib.retracements.r650 * (1 - p.goldenPocketTolerance);
  const bandHigh = fib.retracements.r618 * (1 + p.goldenPocketTolerance);
  const inGoldenPocket = price >= bandLow && price <= bandHigh;
  indicators.goldenPocket = { low: bandLow, high: bandHigh, inside: inGoldenPocket };

  if (!inGoldenPocket) {
    return {
      signal: "FLAT",
      confidence: 0,
      score: 0,
      reasons: [`uptrend confirmed but price $${price.toFixed(4)} is outside the golden pocket ($${bandLow.toFixed(4)}-$${bandHigh.toFixed(4)})`],
      indicators,
    };
  }
  reasons.push(`price $${price.toFixed(4)} is inside the golden pocket ($${bandLow.toFixed(4)}-$${bandHigh.toFixed(4)}) of swing $${swing.low.toFixed(4)}-$${swing.high.toFixed(4)}`);

  // 4) Confirming momentum signal: stochastic turning up from oversold
  // (simplified proxy for "momentum divergence" — see header note).
  const stoch = stochastic(bars, p.stochPeriod, 3);
  let momentumConfirmed = false;
  if (stoch) {
    indicators.stochastic = stoch;
    momentumConfirmed = stoch.k > stoch.d && stoch.k < 50;
    reasons.push(
      momentumConfirmed
        ? `stochastic %K ${stoch.k.toFixed(1)} crossing above %D ${stoch.d.toFixed(1)} from the lower half — momentum turning up`
        : `stochastic %K ${stoch.k.toFixed(1)} / %D ${stoch.d.toFixed(1)} not yet confirming a momentum turn`
    );
  } else {
    reasons.push("insufficient bars for stochastic confirmation");
  }

  // 5) Volume exhaustion (only meaningful with real volume data)
  let volumeConfirmed = true; // neutral/non-blocking when we don't have real volume
  if (usingRealBars && bars.some((b) => Number.isFinite(b.volume))) {
    const recentVols = bars.slice(-6).map((b) => b.volume).filter(Number.isFinite);
    if (recentVols.length >= 4) {
      const firstHalf = recentVols.slice(0, Math.floor(recentVols.length / 2));
      const secondHalf = recentVols.slice(Math.floor(recentVols.length / 2));
      const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
      volumeConfirmed = avg(secondHalf) < avg(firstHalf); // declining volume into the pullback = exhaustion
      indicators.volumeExhaustion = volumeConfirmed;
      reasons.push(volumeConfirmed ? "declining volume into the pullback (selling exhaustion)" : "volume not yet declining — pullback may still have pressure behind it");
    }
  }

  const confirmed = momentumConfirmed && volumeConfirmed;

  // 6) Tiered take-profit / trailing-stop plan (informational — see header note)
  const atrValue = atr(bars, 14);
  const tpPlan = {
    tp1: { price: fib.extensions.e1272, closePct: 35, note: "move stop to breakeven+fees after this" },
    tp2: { price: fib.extensions.e1618, closePct: 40 },
    tp3: { price: fib.extensions.e2618, closePct: 25, trailingStop: atrValue != null ? atrValue * p.atrMultiplier : null },
  };
  indicators.tpPlan = tpPlan;
  indicators.atr = atrValue;

  const confidence = confirmed ? 0.65 : 0.3;
  const score = confirmed ? 0.7 : 0.1;

  return {
    signal: confirmed ? "LONG" : "FLAT",
    confidence,
    score,
    reasons: confirmed ? reasons : [...reasons, "golden pocket reached but confirmation incomplete — waiting"],
    indicators,
  };
}

module.exports = {
  name: "fibonacci",
  label: "Fibonacci Confluence (AWP spear-pool tactic)",
  defaultParams,
  paramSpace,
  evaluate,
};
