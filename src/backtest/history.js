/* ============================================================
   HISTORICAL DATA for backtests.
   Tries REAL Coinbase candles (paged); falls back to a
   multi-regime synthetic series (clearly flagged) when offline.
   ============================================================ */

const { httpJson } = require("../util/http");
const log = require("../util/logger");

const ANCHORS = {
  "BTC-USD": 64000, "ETH-USD": 3200, "SOL-USD": 150,
  "AVAX-USD": 35, "LINK-USD": 15, "DOGE-USD": 0.14,
};

/** Fetch up to `bars` recent closes for a symbol from Coinbase. */
async function fetchCoinbaseCloses(symbol, bars = 300, granularity = 3600) {
  // Coinbase returns max 300 candles per request; page backwards for more.
  const closes = [];
  let end = Math.floor(Date.now() / 1000);
  const perReq = 300;
  while (closes.length < bars) {
    const start = end - perReq * granularity;
    const url =
      `https://api.exchange.coinbase.com/products/${symbol}/candles` +
      `?granularity=${granularity}&start=${new Date(start * 1000).toISOString()}` +
      `&end=${new Date(end * 1000).toISOString()}`;
    const data = await httpJson(url, { timeout: 8000, headers: { "User-Agent": "saint-dashboard/2.0" } });
    if (!Array.isArray(data) || !data.length) break;
    // newest first: [time, low, high, open, close, volume]
    const page = data.map((c) => parseFloat(c[4])).reverse();
    closes.unshift(...page);
    end = start;
    if (data.length < perReq) break;
  }
  return closes.slice(-bars);
}

function syntheticCloses(symbol, bars) {
  let px = ANCHORS[symbol] || 10 + Math.random() * 100;
  const out = [];
  let trend = (Math.random() - 0.5) * 0.01;
  for (let i = 0; i < bars; i++) {
    if (Math.random() < 0.03) trend = (Math.random() - 0.5) * 0.012; // regime shift
    px = px * (1 + trend + (Math.random() - 0.5) * 0.02);
    if (px <= 0) px = ANCHORS[symbol] || 1;
    out.push(px);
  }
  return out;
}

/**
 * Build { symbol: closes[] } for the universe, aligned to equal length.
 * @returns {{series:Object, source:string}}
 */
async function buildSeries(universe, bars = 500, granularity = 3600) {
  const series = {};
  let live = 0;
  for (const sym of universe) {
    try {
      const closes = await fetchCoinbaseCloses(sym, bars, granularity);
      if (closes.length >= 60) {
        series[sym] = closes;
        live++;
        continue;
      }
      throw new Error("insufficient candles");
    } catch (e) {
      series[sym] = syntheticCloses(sym, bars);
    }
  }
  // align lengths
  const min = Math.min(...Object.values(series).map((a) => a.length));
  for (const s of Object.keys(series)) series[s] = series[s].slice(-min);
  const source = live === universe.length ? "LIVE" : live > 0 ? "MIXED" : "SIM";
  if (source !== "LIVE") log.warn("BACKTEST", `Historical data source: ${source} (offline hosts use synthetic)`);
  return { series, source, bars: min };
}

module.exports = { buildSeries, fetchCoinbaseCloses, syntheticCloses };
