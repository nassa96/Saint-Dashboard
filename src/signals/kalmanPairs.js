/* ============================================================
   KALMAN-FILTER PAIRS COINTEGRATION
   ------------------------------------------------------------
   Online (recursive, one-pass) estimator for a TIME-VARYING hedge
   ratio between two co-moving assets, standard in pairs trading
   (Chan, "Algorithmic Trading", ch. 3):

     state:       beta_t = beta_{t-1} + w_t           (random walk, w ~ N(0, Q))
     observation: y_t    = beta_t * x_t + v_t         (v ~ N(0, R))

   Unlike a static OLS hedge ratio (recomputed from scratch on a fixed
   window), the Kalman filter updates beta with every new price pair in
   O(1) time and adapts as the real relationship between the two assets
   drifts — which is exactly what "dynamic cointegration" means in
   practice: the hedge ratio itself is allowed to be non-stationary.

   The filter's residual (y_t - beta_t * x_t) is the "spread" — when it
   drifts far from its own recent mean (z-score beyond a threshold), that
   is the cross-venue/cross-asset dislocation a mean-reversion pairs trade
   is built to capture.

   HONEST SCOPE NOTE: this is pure math over whatever two price series you
   feed it — it does not pick venue pairs for you, does not place orders,
   and like everything else in this app's spot-only engine, "SHORT" signals
   are informational only (this engine doesn't carry short inventory; a
   SHORT_Y_LONG_X read means "reduce/avoid Y, rotate toward X", not "open a
   short position").
   ============================================================ */

/** One online Kalman-filter instance tracking beta_t for a single pair. */
class KalmanBeta {
  constructor({ processVariance = 1e-5, initialMeasurementVariance = 1e-3, initialBeta = 1, initialP = 1 } = {}) {
    this.Q = processVariance; // how fast we allow beta to drift
    this.R = initialMeasurementVariance; // assumed observation noise
    this.beta = initialBeta;
    this.P = initialP; // estimate variance
  }

  /** Feed one new (x, y) price pair; returns the updated beta + residual spread. */
  update(x, y) {
    // Predict
    const betaPred = this.beta;
    const pPred = this.P + this.Q;

    // Update
    const innovation = y - betaPred * x;
    const s = x * x * pPred + this.R;
    const k = s !== 0 ? (pPred * x) / s : 0;
    this.beta = betaPred + k * innovation;
    this.P = (1 - k * x) * pPred;

    const spread = y - this.beta * x;
    return { beta: this.beta, spread, gain: k, varianceP: this.P };
  }
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
}
function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}

/**
 * Run the Kalman filter over two full price series (oldest -> newest) and
 * read a mean-reversion dislocation signal off the latest spread's z-score
 * against its own trailing window.
 * @param {number[]} xSeries reference asset prices
 * @param {number[]} ySeries paired asset prices (same length, same timestamps)
 * @param {object} opts { zWindow=30, zEntryThreshold=2, ...KalmanBeta opts }
 */
function kalmanPairSignal(xSeries, ySeries, opts = {}) {
  const n = Math.min(xSeries.length, ySeries.length);
  const zWindow = opts.zWindow || 30;
  const zEntryThreshold = opts.zEntryThreshold ?? 2;
  if (n < zWindow + 5) return { ready: false, reason: "insufficient paired history" };

  const kf = new KalmanBeta(opts);
  const spreads = [];
  let lastBeta = null;
  for (let i = 0; i < n; i++) {
    const { beta, spread } = kf.update(xSeries[i], ySeries[i]);
    spreads.push(spread);
    lastBeta = beta;
  }

  const window = spreads.slice(-zWindow);
  const m = mean(window);
  const sd = stdev(window) || 1e-9;
  const latestSpread = spreads[spreads.length - 1];
  const z = (latestSpread - m) / sd;

  let signal = "FLAT";
  if (z >= zEntryThreshold) signal = "SHORT_Y_LONG_X"; // y rich relative to x -> rotate out of y, into x
  else if (z <= -zEntryThreshold) signal = "LONG_Y_SHORT_X"; // y cheap relative to x -> rotate into y, out of x

  return {
    ready: true,
    beta: Number(lastBeta.toFixed(6)),
    spread: Number(latestSpread.toFixed(6)),
    spreadMean: Number(m.toFixed(6)),
    spreadStdev: Number(sd.toFixed(6)),
    zScore: Number(z.toFixed(3)),
    zEntryThreshold,
    signal,
    note: "SHORT_* signals are informational only — this is a spot-only engine with no short inventory; treat as a rotation tilt (reduce the rich leg, prefer the cheap leg), not an instruction to open a short.",
  };
}

module.exports = { KalmanBeta, kalmanPairSignal };
