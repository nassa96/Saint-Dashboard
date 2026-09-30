/* ============================================================
   PARAMETER OPTIMIZER + WALK-FORWARD VALIDATION
   - gridSearch: sweep a strategy's param space over a data set,
     rank by drawdown-penalized fitness.
   - walkForward: repeatedly optimize on an in-sample window and
     validate on the following out-of-sample window, so reported
     performance isn't just curve-fit to history.
   ============================================================ */

const Backtester = require("./backtester");
const registry = require("../signals/strategies/registry");

const MAX_COMBOS = 240; // safety cap to bound runtime

function cartesian(space) {
  const keys = Object.keys(space);
  if (!keys.length) return [{}];
  let combos = [{}];
  for (const k of keys) {
    const next = [];
    for (const c of combos) for (const v of space[k]) next.push({ ...c, [k]: v });
    combos = next;
  }
  return combos;
}

class Optimizer {
  constructor(config) {
    this.config = config;
    this.bt = new Backtester(config);
  }

  _sliceSeries(series, start, end) {
    const out = {};
    for (const s of Object.keys(series)) out[s] = series[s].slice(start, end);
    return out;
  }

  /**
   * Grid search over a strategy's param space.
   * @returns {{strategy, tested, best, top}}
   */
  gridSearch(series, strategyName = "momentum", opts = {}) {
    const strat = registry.get(strategyName);
    const isEnsemble = strategyName === "ensemble";
    if (!strat && !isEnsemble) throw new Error(`unknown strategy ${strategyName}`);
    const members = opts.members || this.config.ensembleMembers;
    const space = opts.space || (strat && strat.paramSpace) || {};
    let combos = cartesian(space);
    if (combos.length > MAX_COMBOS) combos = combos.slice(0, MAX_COMBOS);

    const results = [];
    for (const params of combos) {
      try {
        const r = this.bt.run(series, { strategy: strategyName, params, members, minConfidence: opts.minConfidence });
        results.push({ params, totalReturnPct: r.totalReturnPct, maxDrawdownPct: r.maxDrawdownPct, sharpe: r.sharpe, trades: r.trades, fitness: r.fitness });
      } catch (_) {
        /* skip invalid combo */
      }
    }
    results.sort((a, b) => b.fitness - a.fitness);
    return {
      strategy: strategyName,
      tested: results.length,
      best: results[0] || null,
      top: results.slice(0, 8),
    };
  }

  /**
   * Walk-forward analysis.
   * @param opts { folds=4, oosRatio=0.3, minConfidence }
   */
  walkForward(series, strategyName = "momentum", opts = {}) {
    const folds = Math.max(2, opts.folds || 4);
    const oosRatio = opts.oosRatio || 0.3;
    const symbols = Object.keys(series);
    const total = Math.min(...symbols.map((s) => series[s].length));
    const foldSize = Math.floor(total / folds);
    if (foldSize < 60) throw new Error("not enough data for walk-forward (need more bars)");

    const oosLen = Math.max(30, Math.floor(foldSize * oosRatio));
    const isLen = foldSize - oosLen;
    const windows = [];
    let combinedOOSReturn = 1;

    for (let f = 0; f < folds; f++) {
      const start = f * foldSize;
      const isEnd = start + isLen;
      const oosEnd = Math.min(isEnd + oosLen, total);
      if (oosEnd - isEnd < 30 || isEnd - start < 40) continue;

      const isSeries = this._sliceSeries(series, start, isEnd);
      const oosSeries = this._sliceSeries(series, isEnd, oosEnd);

      const opt = this.gridSearch(isSeries, strategyName, { minConfidence: opts.minConfidence, members: opts.members });
      const bestParams = opt.best ? opt.best.params : {};
      const oos = this.bt.run(oosSeries, { strategy: strategyName, params: bestParams, members: opts.members, minConfidence: opts.minConfidence });

      combinedOOSReturn *= 1 + oos.totalReturnPct / 100;
      windows.push({
        fold: f + 1,
        isBars: isEnd - start,
        oosBars: oosEnd - isEnd,
        bestParams,
        inSampleFitness: opt.best ? opt.best.fitness : null,
        oosReturnPct: oos.totalReturnPct,
        oosMaxDrawdownPct: oos.maxDrawdownPct,
        oosSharpe: oos.sharpe,
        oosTrades: oos.trades,
      });
    }

    const oosReturns = windows.map((w) => w.oosReturnPct);
    const avgOOS = oosReturns.length ? oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length : 0;
    const positive = oosReturns.filter((r) => r > 0).length;

    return {
      strategy: strategyName,
      folds: windows.length,
      windows,
      summary: {
        compoundedOOSReturnPct: Number(((combinedOOSReturn - 1) * 100).toFixed(2)),
        avgOOSReturnPct: Number(avgOOS.toFixed(2)),
        oosWinRatePct: windows.length ? Number(((positive / windows.length) * 100).toFixed(1)) : 0,
        robust: windows.length >= 2 && positive / windows.length >= 0.5,
      },
    };
  }
}

module.exports = Optimizer;
