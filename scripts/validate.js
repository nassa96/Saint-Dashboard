#!/usr/bin/env node
/* ============================================================
   STRATEGY VALIDATION — the "should I trust this?" tool.

   Runs walk-forward validation on every strategy over the SAME
   data and prints a ranked verdict table. Walk-forward optimizes
   on an in-sample window then tests on the NEXT, unseen window —
   the honest test of whether an edge is real or just curve-fit.

   Usage:
     node scripts/validate.js [bars] [folds]
     npm run validate

   IMPORTANT: On a host without internet this runs on clearly-
   labeled SYNTHETIC data, which is trend-heavy and will flatter
   momentum. Re-run on your VPS (real history) before trusting the
   verdict with real money.
   ============================================================ */

const config = require("../config");
const Optimizer = require("../src/backtest/optimizer");
const { buildSeries } = require("../src/backtest/history");

const STRATEGIES = ["momentum", "meanreversion", "ensemble"];

function bar(pct, width = 18) {
  const n = Math.max(0, Math.min(width, Math.round((pct + 10) / 20 * width)));
  return "█".repeat(n) + "·".repeat(width - n);
}

(async () => {
  const bars = Number(process.argv[2] || 800);
  const folds = Number(process.argv[3] || 4);

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   SAINT CORE — STRATEGY VALIDATION (walk-forward)            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const { series, source, bars: n } = await buildSeries(config.universe, bars, 3600);
  console.log(`Data source: ${source}   Bars: ${n}   Folds: ${folds}   Universe: ${config.universe.join(", ")}\n`);
  if (source === "SIM") {
    console.log("⚠  SYNTHETIC data (host offline). Verdicts are illustrative only —");
    console.log("   re-run on a machine with internet before trusting with real money.\n");
  }

  const opt = new Optimizer(config);
  const rows = [];
  for (const s of STRATEGIES) {
    try {
      const wf = opt.walkForward(series, s, { folds });
      rows.push({ s, ...wf.summary });
    } catch (e) {
      rows.push({ s, error: e.message });
    }
  }

  rows.sort((a, b) => (b.compoundedOOSReturnPct || -999) - (a.compoundedOOSReturnPct || -999));

  console.log("Strategy        Compounded OOS   OOS win%   Robust   " );
  console.log("──────────────  ──────────────   ────────   ──────");
  for (const r of rows) {
    if (r.error) { console.log(`${r.s.padEnd(14)}  ERROR: ${r.error}`); continue; }
    const ret = `${r.compoundedOOSReturnPct >= 0 ? "+" : ""}${r.compoundedOOSReturnPct}%`;
    console.log(
      `${r.s.padEnd(14)}  ${ret.padStart(8)} ${bar(r.compoundedOOSReturnPct)}  ${String(r.oosWinRatePct).padStart(6)}%   ${r.robust ? "YES ✅" : "NO  ⚠"}`
    );
  }

  const winner = rows.find((r) => r.robust && r.compoundedOOSReturnPct > 0);
  console.log("\n──────────────────────────────────────────────────────────────");
  if (winner) {
    console.log(`RECOMMENDATION: trade with STRATEGY=${winner.s}`);
    console.log(`  Set it in .env, then run:  node scripts/optimize.js ${winner.s} ${bars}`);
    console.log(`  (that persists the best params so the engine auto-loads them).`);
  } else {
    console.log("RECOMMENDATION: NO strategy passed walk-forward on this data.");
    console.log("  Do NOT go live. Try a different universe, more bars, or wait for");
    console.log("  a market regime where an edge appears. Staying flat IS a position.");
  }
  console.log("──────────────────────────────────────────────────────────────\n");
  process.exit(0);
})().catch((e) => {
  console.error("Validation failed:", e.message);
  process.exit(1);
});
