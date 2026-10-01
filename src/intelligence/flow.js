/* ============================================================
   MACRO FLOW / RISK-APPETITE OVERLAY
   ------------------------------------------------------------
   Real, free, public data — not a crystal ball:
     - Fear & Greed Index (alternative.me) — a well-known composite of
       volatility, momentum, social volume, surveys, dominance, and search
       trends. A sentiment PROXY, not a forecast.
     - Global crypto market-cap 24h change (CoinGecko) — a breadth proxy:
       is the whole asset class expanding or contracting right now.

   HONESTY NOTE: this is a macro backdrop read, not a trading signal on its
   own. It is deliberately wired so it can only ever SHRINK how much of the
   configured risk budget gets deployed in a risk-off backdrop (multiplier
   <= 1.0) — never used to push exposure above whatever MAX_PORTFOLIO_RISK_PCT
   you already set. If the data is unreachable or stale, this fails OPEN
   (multiplier 1.0, i.e. no effect) rather than guessing — exactly the same
   philosophy as the rest of this app: don't fabricate a read you don't have.
   ============================================================ */

const { httpJson } = require("../util/http");
const log = require("../util/logger");

const TTL_MS = 5 * 60 * 1000; // 5 minutes — these are slow-moving macro reads, not tick data
const MULTIPLIER = { RISK_OFF: 0.65, NEUTRAL: 0.9, RISK_ON: 1.0, UNKNOWN: 1.0 };

let cache = { at: 0, value: null };

function classify(fearGreedValue, mcapChangePct) {
  if (fearGreedValue == null && mcapChangePct == null) return "UNKNOWN";
  const fg = fearGreedValue ?? 50;
  const mc = mcapChangePct ?? 0;
  if (fg <= 25 || mc <= -5) return "RISK_OFF";
  if (fg >= 70 && mc >= 0) return "RISK_ON";
  return "NEUTRAL";
}

async function fetchFearGreed() {
  const data = await httpJson("https://api.alternative.me/fng/?limit=1", { timeout: 7000 });
  const row = data?.data?.[0];
  if (!row) throw new Error("no fear & greed data returned");
  return { value: Number(row.value), classification: row.value_classification, ts: Number(row.timestamp) * 1000 };
}

async function fetchGlobalMarket() {
  const data = await httpJson("https://api.coingecko.com/api/v3/global", { timeout: 7000 });
  const d = data?.data;
  if (!d) throw new Error("no global market data returned");
  return {
    mcapChangePct24h: Number(d.market_cap_change_percentage_24h_usd),
    btcDominancePct: Number(d.market_cap_percentage?.btc),
  };
}

/**
 * Read-only, cached macro overlay. Never throws — degrades to an honest
 * "UNKNOWN / no effect" read instead of guessing when data is unreachable.
 */
async function getFlow({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cache.value && now - cache.at < TTL_MS) {
    return cache.value;
  }

  const [fgResult, mkResult] = await Promise.allSettled([fetchFearGreed(), fetchGlobalMarket()]);
  const fearGreed = fgResult.status === "fulfilled" ? fgResult.value : null;
  const market = mkResult.status === "fulfilled" ? mkResult.value : null;
  const ready = Boolean(fearGreed || market);

  if (!ready) {
    log.warn("INTELLIGENCE", `Macro flow overlay unreachable (${fgResult.reason?.message || mkResult.reason?.message}) — defaulting to UNKNOWN/no-effect`);
  }

  const regime = ready ? classify(fearGreed?.value, market?.mcapChangePct24h) : "UNKNOWN";
  const value = {
    ready,
    fetchedAt: new Date(now).toISOString(),
    fearGreed,
    market,
    regime,
    deployMultiplier: MULTIPLIER[regime] ?? 1,
    disclaimer:
      "Macro backdrop only, built from public sentiment/breadth proxies (Fear & Greed Index, global market-cap trend) — " +
      "not a trading signal by itself and not predictive. Can only ever REDUCE deployed capital below your configured " +
      "risk limits in a risk-off backdrop, never increase it above them.",
  };
  cache = { at: now, value };
  return value;
}

module.exports = { getFlow, classify, MULTIPLIER };
