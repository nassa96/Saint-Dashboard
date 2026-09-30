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

module.exports = { sma, ema, rsi, momentum, volatility, macd };
