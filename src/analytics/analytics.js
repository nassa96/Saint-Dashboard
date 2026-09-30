/* ============================================================
   TRADE ANALYTICS
   Turns the closed-trade journal + equity curve into the stats a
   trader actually cares about: win rate, profit factor, expectancy,
   avg win/loss, drawdown, exposure, and a PnL distribution.
   ============================================================ */

function compute(trades = [], equityCurve = [], startingEquity = 0) {
  const closed = trades.filter((t) => Number.isFinite(t.pnl));
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);

  const sum = (arr, f) => arr.reduce((a, b) => a + f(b), 0);
  const grossProfit = sum(wins, (t) => t.pnl);
  const grossLoss = Math.abs(sum(losses, (t) => t.pnl));
  const netPnl = sum(closed, (t) => t.pnl);

  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const winRate = closed.length ? wins.length / closed.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const expectancy = closed.length ? netPnl / closed.length : 0;
  const avgHoldMs = closed.length ? sum(closed, (t) => t.holdMs || 0) / closed.length : 0;

  // Max drawdown from equity curve
  let peak = -Infinity;
  let maxDD = 0;
  const eqVals = equityCurve.map((p) => (typeof p === "number" ? p : p.equity));
  for (const v of eqVals) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  // Best/worst
  const best = closed.reduce((a, b) => (b.pnl > (a?.pnl ?? -Infinity) ? b : a), null);
  const worst = closed.reduce((a, b) => (b.pnl < (a?.pnl ?? Infinity) ? b : a), null);

  // Per-symbol breakdown
  const bySymbol = {};
  for (const t of closed) {
    const s = (bySymbol[t.symbol] = bySymbol[t.symbol] || { trades: 0, pnl: 0, wins: 0 });
    s.trades++;
    s.pnl += t.pnl;
    if (t.pnl > 0) s.wins++;
  }
  const symbolStats = Object.entries(bySymbol)
    .map(([symbol, s]) => ({
      symbol,
      trades: s.trades,
      pnl: Number(s.pnl.toFixed(2)),
      winRatePct: Number(((s.wins / s.trades) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.pnl - a.pnl);

  // PnL % distribution buckets
  const buckets = [
    { label: "< -10%", min: -Infinity, max: -10 },
    { label: "-10..-5%", min: -10, max: -5 },
    { label: "-5..-2%", min: -5, max: -2 },
    { label: "-2..0%", min: -2, max: 0 },
    { label: "0..2%", min: 0, max: 2 },
    { label: "2..5%", min: 2, max: 5 },
    { label: "5..10%", min: 5, max: 10 },
    { label: "> 10%", min: 10, max: Infinity },
  ].map((b) => ({ ...b, count: closed.filter((t) => t.pnlPct > b.min && t.pnlPct <= b.max).length }));

  // Cumulative realized PnL curve (per closed trade)
  let cum = 0;
  const cumulative = closed.map((t) => {
    cum += t.pnl;
    return Number(cum.toFixed(2));
  });

  return {
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: Number((winRate * 100).toFixed(1)),
    netPnl: Number(netPnl.toFixed(2)),
    grossProfit: Number(grossProfit.toFixed(2)),
    grossLoss: Number(grossLoss.toFixed(2)),
    profitFactor: profitFactor === Infinity ? null : Number(profitFactor.toFixed(2)),
    expectancy: Number(expectancy.toFixed(2)),
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    avgHoldMinutes: Number((avgHoldMs / 60000).toFixed(1)),
    maxDrawdownPct: Number((maxDD * 100).toFixed(2)),
    bestTrade: best ? { symbol: best.symbol, pnl: best.pnl, pnlPct: best.pnlPct } : null,
    worstTrade: worst ? { symbol: worst.symbol, pnl: worst.pnl, pnlPct: worst.pnlPct } : null,
    symbolStats,
    distribution: buckets,
    cumulative,
    recentTrades: closed.slice(-30).reverse(),
  };
}

module.exports = { compute };
