#!/usr/bin/env node
/* CLI optimizer + walk-forward.
   Usage: node scripts/optimize.js [strategy] [bars] [--wf] */

const config = require("../config");
const { buildSeries } = require("../src/backtest/history");
const Optimizer = require("../src/backtest/optimizer");

(async () => {
  const strategy = (process.argv[2] || "momentum").toLowerCase();
  const bars = Number(process.argv[3] || 600);
  const wf = process.argv.includes("--wf");

  console.log(`\nSAINT CORE — Optimizer (${strategy})`);
  console.log(`Fetching ${bars} bars for ${config.universe.length} assets ...\n`);
  const { series, source, bars: n } = await buildSeries(config.universe, bars, 3600);
  console.log(`Data source: ${source} (${n} bars)\n`);

  const opt = new Optimizer(config);

  if (wf) {
    const wfr = opt.walkForward(series, strategy, { folds: 4 });
    console.log(`──── WALK-FORWARD (${wfr.folds} folds) ────`);
    for (const w of wfr.windows) {
      console.log(`  Fold ${w.fold}: OOS return ${w.oosReturnPct}%  DD ${w.oosMaxDrawdownPct}%  Sharpe ${w.oosSharpe}  trades ${w.oosTrades}`);
      console.log(`           best params: ${JSON.stringify(w.bestParams)}`);
    }
    console.log(`\n  Compounded OOS return: ${wfr.summary.compoundedOOSReturnPct}%`);
    console.log(`  Avg OOS / fold:        ${wfr.summary.avgOOSReturnPct}%`);
    console.log(`  OOS win rate:          ${wfr.summary.oosWinRatePct}%`);
    console.log(`  Robust (not overfit):  ${wfr.summary.robust ? "YES ✅" : "NO ⚠"}\n`);
  } else {
    const r = opt.gridSearch(series, strategy, {});
    console.log(`──── GRID SEARCH (${r.tested} combos) ────`);
    r.top.forEach((t, i) => {
      console.log(`  #${i + 1} fitness ${t.fitness}  return ${t.totalReturnPct}%  DD ${t.maxDrawdownPct}%  Sharpe ${t.sharpe}  trades ${t.trades}`);
      console.log(`      params: ${JSON.stringify(t.params)}`);
    });
    console.log(`\n  BEST: ${JSON.stringify(r.best && r.best.params)}  (fitness ${r.best && r.best.fitness})\n`);
  }
  if (source !== "LIVE") console.log("⚠ Ran on synthetic data (host offline). Re-run online for real optimization.\n");
  process.exit(0);
})().catch((e) => {
  console.error("Optimize failed:", e.message);
  process.exit(1);
});
