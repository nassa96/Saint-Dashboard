#!/usr/bin/env node
/* CLI backtest runner.  Usage: node scripts/backtest.js [bars] [granularitySec] */

const config = require("../config");
const { buildSeries } = require("../src/backtest/history");
const Backtester = require("../src/backtest/backtester");

(async () => {
  const bars = Number(process.argv[2] || 500);
  const gran = Number(process.argv[3] || 3600);
  console.log(`\nSAINT CORE — Backtest`);
  console.log(`Universe: ${config.universe.join(", ")}`);
  console.log(`Fetching ${bars} bars @ ${gran}s ...\n`);

  const { series, source, bars: n } = await buildSeries(config.universe, bars, gran);
  const bt = new Backtester(config);
  const r = bt.run(series, { rebalanceEvery: 1 });

  const line = (k, v) => console.log("  " + k.padEnd(22) + v);
  console.log(`Data source: ${source}  (${n} bars)`);
  console.log(`\n──── RESULTS ────`);
  line("Starting equity", "$" + r.startingEquity.toLocaleString());
  line("Final equity", "$" + r.finalEquity.toLocaleString());
  line("Total return", r.totalReturnPct + "%");
  line("Buy & hold (eq-wt)", r.buyHoldPct + "%");
  line("Alpha vs B&H", r.alphaPct + "%");
  line("Max drawdown", r.maxDrawdownPct + "%");
  line("Sharpe (annualized)", r.sharpe);
  line("Trades", r.trades);
  line("Realized PnL", "$" + r.realizedPnl.toLocaleString());
  console.log("");
  if (source !== "LIVE") {
    console.log("⚠ Ran on synthetic data (host offline). Re-run where the server has");
    console.log("  internet for a REAL historical backtest.\n");
  }
  process.exit(0);
})().catch((e) => {
  console.error("Backtest failed:", e.message);
  process.exit(1);
});
