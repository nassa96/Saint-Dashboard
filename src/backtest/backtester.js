/* ============================================================
   BACKTESTER
   Replays historical price series through the SAME strategy +
   allocator + fill model used live, so you can validate the
   rotation logic before risking capital. Reports return, max
   drawdown, Sharpe, win rate, trade count and an equity curve.
   ============================================================ */

const strategy = require("../signals/strategy");
const Allocator = require("../portfolio/allocator");

class Backtester {
  constructor(config) {
    this.config = config;
    this.allocator = new Allocator(config);
    this.feeRate = 0.001;
    this.slippageRate = 0.0005;
    this.warmup = 30;
  }

  /**
   * @param {Object} series  { "BTC-USD": number[], ... } equal-length closes
   * @param {Object} opts    { startingEquity, rebalanceEvery }
   */
  run(series, opts = {}) {
    const symbols = Object.keys(series);
    if (!symbols.length) throw new Error("no series provided");
    const len = Math.min(...symbols.map((s) => series[s].length));
    if (len < this.warmup + 5) throw new Error(`need >= ${this.warmup + 5} bars`);

    const startingEquity = opts.startingEquity || this.config.capital.startingEquity;
    const rebalanceEvery = Math.max(1, opts.rebalanceEvery || 1);
    const minConf = opts.minConfidence != null ? opts.minConfidence : this.config.capital.minSignalConfidence;
    const evalOpts = { strategy: opts.strategy, params: opts.params, members: opts.members };

    let cash = startingEquity;
    const positions = {}; // symbol -> qty
    const equityCurve = [];
    let trades = 0;
    let wins = 0;
    let realized = 0;
    const avgCost = {}; // symbol -> avg price
    let peak = startingEquity;
    let maxDD = 0;

    const priceAt = (sym, i) => series[sym][i];
    const equityAt = (i) => {
      let v = cash;
      for (const s of symbols) if (positions[s]) v += positions[s] * priceAt(s, i);
      return v;
    };

    for (let i = this.warmup; i < len; i++) {
      if ((i - this.warmup) % rebalanceEvery === 0) {
        // Evaluate every symbol on history up to bar i
        const evals = symbols.map((sym) => {
          const hist = series[sym].slice(0, i + 1);
          const r = strategy.evaluate(hist, evalOpts);
          return { symbol: sym, price: priceAt(sym, i), ...r };
        });
        const { targets } = this.allocator.computeTargets(evals);
        const equity = equityAt(i);

        for (const ev of evals) {
          const price = ev.price;
          const targetWeight = ev.confidence >= minConf ? targets[ev.symbol] || 0 : 0;
          const targetNotional = equity * targetWeight;
          const curQty = positions[ev.symbol] || 0;
          const curNotional = curQty * price;
          const diff = targetNotional - curNotional;
          if (Math.abs(diff) < equity * 0.01) continue;

          if (diff > 0) {
            const notional = Math.min(diff, cash);
            if (notional < 1) continue;
            const fill = price * (1 + this.slippageRate);
            const qty = (notional * (1 - this.feeRate)) / fill;
            const newQty = curQty + qty;
            avgCost[ev.symbol] = newQty > 0 ? ((avgCost[ev.symbol] || 0) * curQty + fill * qty) / newQty : fill;
            positions[ev.symbol] = newQty;
            cash -= notional;
            trades++;
          } else {
            const sellNotional = Math.min(-diff, curNotional);
            const fill = price * (1 - this.slippageRate);
            const qty = Math.min(curQty, sellNotional / fill);
            if (qty <= 0) continue;
            const pnl = qty * (fill - (avgCost[ev.symbol] || fill));
            realized += pnl;
            if (pnl > 0) wins++;
            cash += qty * fill * (1 - this.feeRate);
            positions[ev.symbol] = curQty - qty;
            if (positions[ev.symbol] <= 1e-10) delete positions[ev.symbol];
            trades++;
          }
        }
      }

      const eq = equityAt(i);
      equityCurve.push(Number(eq.toFixed(2)));
      if (eq > peak) peak = eq;
      const dd = (peak - eq) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    // Metrics
    const finalEquity = equityCurve[equityCurve.length - 1];
    const totalReturn = (finalEquity - startingEquity) / startingEquity;
    const rets = [];
    for (let i = 1; i < equityCurve.length; i++) {
      rets.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
    }
    const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1);
    const std = Math.sqrt(variance) || 1e-9;
    const sharpe = (mean / std) * Math.sqrt(252); // per-bar annualized proxy

    // Buy & hold benchmark (equal weight)
    let bh = 0;
    for (const s of symbols) bh += priceAt(s, len - 1) / priceAt(s, this.warmup);
    bh = bh / symbols.length - 1;

    const totalReturnPct = Number((totalReturn * 100).toFixed(2));
    const maxDrawdownPct = Number((maxDD * 100).toFixed(2));
    // Fitness = return penalized by drawdown (used by the optimizer).
    const fitness = Number((totalReturnPct - maxDrawdownPct * 1.5).toFixed(2));

    return {
      strategy: opts.strategy || this.config.strategy || "momentum",
      startingEquity,
      finalEquity: Number(finalEquity.toFixed(2)),
      totalReturnPct,
      buyHoldPct: Number((bh * 100).toFixed(2)),
      alphaPct: Number((totalReturn * 100 - bh * 100).toFixed(2)),
      maxDrawdownPct,
      sharpe: Number(sharpe.toFixed(2)),
      fitness,
      trades,
      winRatePct: trades ? Number(((wins / Math.max(1, Math.floor(trades / 2))) * 100).toFixed(1)) : 0,
      realizedPnl: Number(realized.toFixed(2)),
      bars: equityCurve.length,
      symbols,
      equityCurve,
    };
  }
}

module.exports = Backtester;
