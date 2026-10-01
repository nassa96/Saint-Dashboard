/* ============================================================
   STAGE 2 SYNTHETIC VALIDATOR
   ------------------------------------------------------------
   Cold-start bootstrap roadmap, Stage 2: before letting a strategy run
   autonomously, stress-test it across thousands of SYNTHETIC price
   paths (not just the one historical path it already backtested well
   on) and require it to hold up across the large majority of them.

   Method: block bootstrap resampling. Convert each symbol's recent
   price history to log returns, then build each synthetic path by
   concatenating randomly-chosen overlapping BLOCKS of consecutive
   returns (not single random returns — that would destroy the
   autocorrelation/momentum structure real markets have). The same
   randomly-chosen block start indices are reused across every symbol
   within one synthetic run, which preserves cross-symbol co-movement
   on that path (when BTC's block was a selloff block, ETH's
   same-dated block was too) — a real, if simplified, approximation of
   the joint distribution, not independent-per-symbol noise.

   HONEST SUBSTITUTION NOTE: the spec said "resample recent order-book
   snapshots." This app does not store order-book snapshots anywhere —
   there's no L2 depth history to resample. What's implemented instead
   resamples the recent CLOSE-PRICE history this app already keeps
   (src/market/marketData.js), which is a real and useful stress test
   for "does this strategy only work on the one exact path that already
   happened", just not literally order-book-level resampling.

   Gate: "autonomous eligibility" requires the Sortino ratio (computed
   on each synthetic path's resulting equity curve, via the SAME
   backtester + allocator + strategy used live) to clear
   `sortinoThreshold` (default 1.8) on at least `passRateThreshold`
   (default 95%) of the resampled runs.
   ============================================================ */

const Backtester = require("./backtester");
const { sortinoRatio } = require("../portfolio/sortino");

/** Log returns of a price series (oldest -> newest). */
function toLogReturns(prices) {
  const out = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) out.push(Math.log(prices[i] / prices[i - 1]));
  }
  return out;
}

/** Rebuild a price path from a starting price + a sequence of log returns. */
function fromLogReturns(startPrice, returns) {
  const out = [startPrice];
  let px = startPrice;
  for (const r of returns) {
    px = px * Math.exp(r);
    out.push(px);
  }
  return out;
}

/**
 * Build ONE synthetic set of per-symbol resampled returns, reusing the same
 * randomly-chosen block start indices across every symbol so cross-symbol
 * co-movement on that synthetic path is preserved (not independent noise
 * per symbol).
 */
function sampleBlockStarts(returnsLength, blockSize, targetLength, rng) {
  const starts = [];
  let covered = 0;
  while (covered < targetLength) {
    const maxStart = Math.max(0, returnsLength - blockSize);
    starts.push(Math.floor(rng() * (maxStart + 1)));
    covered += blockSize;
  }
  return starts;
}

function buildResampledReturns(returns, blockSize, targetLength, starts) {
  const out = [];
  for (const start of starts) {
    for (let j = 0; j < blockSize && out.length < targetLength; j++) {
      out.push(returns[Math.min(returns.length - 1, start + j)]);
    }
    if (out.length >= targetLength) break;
  }
  return out.slice(0, targetLength);
}

/** Deterministic, seedable PRNG (mulberry32) — lets a given seed reproduce
 *  the exact same synthetic run set, useful for tests and audit trails. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class SyntheticValidator {
  constructor(config) {
    this.config = config;
    this.backtester = new Backtester(config);
  }

  /**
   * @param {Object} seriesBySymbol { "BTC-USD": number[], ... } real recent close-price history
   * @param {Object} opts { runs=10000, blockSize=10, sortinoThreshold=1.8, passRateThreshold=0.95, seed, strategy, params }
   */
  validate(seriesBySymbol, opts = {}) {
    const runs = Math.max(10, Number(opts.runs) || 10000);
    const blockSize = Math.max(2, Number(opts.blockSize) || 10);
    const sortinoThreshold = Number(opts.sortinoThreshold ?? 1.8);
    const passRateThreshold = Number(opts.passRateThreshold ?? 0.95);
    const rng = mulberry32(Number.isFinite(opts.seed) ? opts.seed : 42);

    const symbols = Object.keys(seriesBySymbol);
    if (!symbols.length) throw new Error("no series provided");

    const returnsBySymbol = {};
    const startPriceBySymbol = {};
    let minReturnsLen = Infinity;
    for (const s of symbols) {
      const prices = seriesBySymbol[s];
      const rets = toLogReturns(prices);
      returnsBySymbol[s] = rets;
      startPriceBySymbol[s] = prices[0];
      minReturnsLen = Math.min(minReturnsLen, rets.length);
    }
    if (!Number.isFinite(minReturnsLen) || minReturnsLen < this.backtester.warmup + 10) {
      throw new Error(`need at least ${this.backtester.warmup + 10} return observations per symbol for synthetic validation`);
    }

    const sortinos = [];
    let passCount = 0;
    let errors = 0;

    for (let run = 0; run < runs; run++) {
      const starts = sampleBlockStarts(minReturnsLen, blockSize, minReturnsLen, rng);
      const resampledSeries = {};
      for (const s of symbols) {
        const rets = buildResampledReturns(returnsBySymbol[s], blockSize, minReturnsLen, starts);
        resampledSeries[s] = fromLogReturns(startPriceBySymbol[s], rets);
      }

      try {
        const result = this.backtester.run(resampledSeries, { strategy: opts.strategy, params: opts.params });
        const sortino = sortinoRatio(result.equityCurve, { period: Math.min(30, Math.floor(result.equityCurve.length / 2)) });
        if (sortino != null) {
          sortinos.push(sortino);
          if (sortino >= sortinoThreshold) passCount++;
        } else {
          errors++;
        }
      } catch (e) {
        errors++;
      }
    }

    const validRuns = sortinos.length;
    const passRate = validRuns ? passCount / validRuns : 0;
    sortinos.sort((a, b) => a - b);
    const mean = validRuns ? sortinos.reduce((a, b) => a + b, 0) / validRuns : null;
    const median = validRuns ? sortinos[Math.floor(validRuns / 2)] : null;

    return {
      generatedAt: new Date().toISOString(),
      method: "block-bootstrap resampling of recent CLOSE-PRICE history (NOT raw order-book snapshots — those aren't stored anywhere in this app)",
      runsRequested: runs,
      validRuns,
      errors,
      blockSize,
      sortinoThreshold,
      passRateThreshold,
      passRate: Number((passRate * 100).toFixed(2)),
      autonomousEligible: passRate >= passRateThreshold,
      sortinoDistribution: { min: sortinos[0] ?? null, max: sortinos[validRuns - 1] ?? null, mean: mean != null ? Number(mean.toFixed(3)) : null, median: median != null ? Number(median.toFixed(3)) : null },
      note: passRate >= passRateThreshold
        ? `Cleared the Stage 2 gate: Sortino >= ${sortinoThreshold} on ${(passRate * 100).toFixed(1)}% of ${validRuns} synthetic paths (>= ${(passRateThreshold * 100).toFixed(0)}% required).`
        : `Did NOT clear the Stage 2 gate: Sortino >= ${sortinoThreshold} on only ${(passRate * 100).toFixed(1)}% of ${validRuns} synthetic paths (need >= ${(passRateThreshold * 100).toFixed(0)}%) — stay in Stage 1 sandbox sizing.`,
    };
  }
}

module.exports = SyntheticValidator;
