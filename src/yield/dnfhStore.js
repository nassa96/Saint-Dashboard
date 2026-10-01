/* ============================================================
   DNFH STATE STORE
   Persists two things to data/dnfh_state.json so they survive a
   restart (the process can otherwise run for days between dashboard
   visits):
     - fundingHistory: a rolling per-symbol window of funding-rate
       "epoch" samples, used to detect "negative funding N epochs in a
       row" (a rebalance trigger).
     - openPositions: the DNFH module's own best-effort record of a
       position it opened via execute() — entry notionals/prices, used
       to estimate delta drift later. This is NOT a source of truth for
       your actual exchange balances; always verify against the real
       account. It exists only so this module can flag "you should
       probably rebalance" without requiring you to re-enter the
       original sizing by hand.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const log = require("../util/logger");

const STORE_PATH = path.join(__dirname, "../../data/dnfh_state.json");
const MAX_EPOCHS = 72; // 72 hourly epochs = 3 days of history, plenty for a "3 in a row" check

function load() {
  try {
    if (!fs.existsSync(STORE_PATH)) return { fundingHistory: {}, openPositions: {} };
    const data = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return {
      fundingHistory: (data && data.fundingHistory) || {},
      openPositions: (data && data.openPositions) || {},
    };
  } catch (e) {
    log.warn("DNFH", `state load skipped: ${e.message}`);
    return { fundingHistory: {}, openPositions: {} };
  }
}

function save(state) {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2));
    return true;
  } catch (e) {
    log.warn("DNFH", `state save failed: ${e.message}`);
    return false;
  }
}

function recordFundingEpoch(symbol, fundingHourlyPct) {
  const state = load();
  const hist = state.fundingHistory[symbol] || [];
  hist.push({ ts: Date.now(), fundingHourlyPct });
  state.fundingHistory[symbol] = hist.slice(-MAX_EPOCHS);
  save(state);
  return state.fundingHistory[symbol];
}

function getFundingHistory(symbol) {
  return load().fundingHistory[symbol] || [];
}

function setOpenPosition(symbol, position) {
  const state = load();
  state.openPositions[symbol] = { ...position, updatedAt: Date.now() };
  save(state);
  return state.openPositions[symbol];
}

function getOpenPosition(symbol) {
  return load().openPositions[symbol] || null;
}

function clearOpenPosition(symbol) {
  const state = load();
  delete state.openPositions[symbol];
  save(state);
}

module.exports = {
  recordFundingEpoch,
  getFundingHistory,
  setOpenPosition,
  getOpenPosition,
  clearOpenPosition,
  STORE_PATH,
};
