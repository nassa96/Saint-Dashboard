/* ============================================================
   STRATEGY PARAM STORE
   Persists optimizer-selected best params per strategy to
   data/strategy_params.json so the live engine can auto-load
   them on boot (and immediately after an optimization run).
   ============================================================ */

const fs = require("fs");
const path = require("path");
const log = require("../util/logger");

const STORE_PATH = path.join(__dirname, "../../data/strategy_params.json");

function load() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    const data = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch (e) {
    log.warn("PARAMS", `load skipped: ${e.message}`);
    return {};
  }
}

function save(all) {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(all, null, 2));
    return true;
  } catch (e) {
    log.warn("PARAMS", `save failed: ${e.message}`);
    return false;
  }
}

/** Record best params for a strategy (with provenance metadata). */
function setBest(strategy, params, meta = {}) {
  const all = load();
  all[strategy] = { params, meta: { ...meta, savedAt: Date.now() } };
  save(all);
  log.info("PARAMS", `Saved best params for ${strategy}: ${JSON.stringify(params)}`);
  return all[strategy];
}

function getBest(strategy) {
  const all = load();
  return all[strategy] || null;
}

module.exports = { load, save, setBest, getBest, STORE_PATH };
