/* ============================================================
   REAL TECHNICAL INDICATORS
   Pure functions over an array of numeric closing prices
   (oldest -> newest). No randomness.
   ============================================================ */

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  // seed with SMA of first `period`
  let emaVal = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Simple percentage return over `lookback` bars. */
function momentum(values, lookback = 10) {
  if (values.length < lookback + 1) return null;
  const past = values[values.length - 1 - lookback];
  const now = values[values.length - 1];
  if (!past) return null;
  return (now - past) / past;
}

/** Annualization-free volatility: stddev of period-over-period returns. */
function volatility(values, period = 20) {
  if (values.length < period + 1) return null;
  const rets = [];
  for (let i = values.length - period; i < values.length; i++) {
    const r = (values[i] - values[i - 1]) / values[i - 1];
    rets.push(r);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  if (values.length < slow + signalPeriod) return null;
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  if (emaFast == null || emaSlow == null) return null;
  const macdLine = emaFast - emaSlow;
  // approximate signal line from recent macd values
  const macdSeries = [];
  for (let i = slow; i <= values.length; i++) {
    const sub = values.slice(0, i);
    const f = ema(sub, fast);
    const s = ema(sub, slow);
    if (f != null && s != null) macdSeries.push(f - s);
  }
  const signalLine = ema(macdSeries, signalPeriod);
  return {
    macd: macdLine,
    signal: signalLine,
    histogram: signalLine != null ? macdLine - signalLine : null,
  };
}

/**
 * Average True Range (Wilder's smoothing), the standard 14-period ATR used
 * for stop-loss/trailing-stop sizing. Operates on OHLC bars, not closes.
 * @param {Array<{high:number, low:number, close:number}>} bars oldest->newest
 */
function atr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 1) return null;
  const trueRanges = [];
  for (let i = 1; i < bars.length; i++) {
    const { high, low } = bars[i];
    const prevClose = bars[i - 1].close;
    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trueRanges.length < period) return null;
  // Wilder's smoothing: seed with a simple average of the first `period`
  // true ranges, then smooth the remainder.
  let avg = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    avg = (avg * (period - 1) + trueRanges[i]) / period;
  }
  return avg;
}

/**
 * Stochastic oscillator (%K, %D) over OHLC bars.
 * %K = (close - lowestLow) / (highestHigh - lowestLow) * 100
 * %D = SMA(%K, dPeriod)
 */
function stochastic(bars, kPeriod = 14, dPeriod = 3) {
  if (!Array.isArray(bars) || bars.length < kPeriod + dPeriod) return null;
  const kValues = [];
  for (let i = kPeriod - 1; i < bars.length; i++) {
    const window = bars.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...window.map((b) => b.high));
    const lowestLow = Math.min(...window.map((b) => b.low));
    const close = bars[i].close;
    const k = highestHigh > lowestLow ? ((close - lowestLow) / (highestHigh - lowestLow)) * 100 : 50;
    kValues.push(k);
  }
  if (kValues.length < dPeriod) return null;
  const recentK = kValues.slice(-dPeriod);
  const d = recentK.reduce((a, b) => a + b, 0) / recentK.length;
  return { k: kValues[kValues.length - 1], d, series: kValues };
}

/**
 * Swing high/low over a lookback window of OHLC bars — the simplest honest
 * definition (highest high / lowest low in the window), used as the leg for
 * Fibonacci retracement/extension levels. Not a full pivot/zigzag detector.
 */
function swingRange(bars, lookback = 40) {
  if (!Array.isArray(bars) || bars.length < lookback) return null;
  const window = bars.slice(-lookback);
  let highBar = window[0];
  let lowBar = window[0];
  for (const b of window) {
    if (b.high > highBar.high) highBar = b;
    if (b.low < lowBar.low) lowBar = b;
  }
  return { high: highBar.high, low: lowBar.low, highTs: highBar.ts, lowTs: lowBar.ts };
}

/**
 * Fibonacci retracement + extension levels for a given swing leg and trend
 * direction. "up" = measuring a pullback within an uptrend (retracements
 * below the swing high; extensions above it, i.e. continuation targets).
 * "down" mirrors it for a downtrend.
 */
function fibLevels(swingLow, swingHigh, direction = "up") {
  if (!(swingHigh > swingLow)) return null;
  const range = swingHigh - swingLow;
  const retracementRatios = { r382: 0.382, r500: 0.5, r618: 0.618, r650: 0.65 };
  const extensionRatios = { e1272: 1.272, e1618: 1.618, e2618: 2.618 };

  const retracements = {};
  const extensions = {};
  if (direction === "up") {
    for (const [k, r] of Object.entries(retracementRatios)) retracements[k] = swingHigh - range * r;
    for (const [k, r] of Object.entries(extensionRatios)) extensions[k] = swingLow + range * r;
  } else {
    for (const [k, r] of Object.entries(retracementRatios)) retracements[k] = swingLow + range * r;
    for (const [k, r] of Object.entries(extensionRatios)) extensions[k] = swingHigh - range * r;
  }
  return { direction, range, retracements, extensions };
}

module.exports = { sma, ema, rsi, momentum, volatility, macd, atr, stochastic, swingRange, fibLevels };
