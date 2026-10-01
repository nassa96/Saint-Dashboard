/* ============================================================
   STRATEGY FACADE
   Backward-compatible entry point used by the engine, backtester,
   and optimizer. Delegates to the selected strategy (or ensemble)
   from the registry, and auto-applies optimizer-saved best params.
   ============================================================ */

const registry = require("./strategies/registry");
const paramStore = require("./paramStore");

let _defaultStrategy = "momentum";
let _ensembleMembers = ["momentum", "meanreversion"];
let _paramsByStrategy = {}; // name -> params (from optimizer)

function configure({ strategy, ensembleMembers } = {}) {
  if (strategy) _defaultStrategy = strategy;
  if (ensembleMembers) _ensembleMembers = ensembleMembers;
}

/** Load persisted best params (call once on boot). */
function loadSavedParams() {
  const all = paramStore.load();
  _paramsByStrategy = {};
  for (const [name, entry] of Object.entries(all)) {
    if (entry && entry.params) _paramsByStrategy[name] = entry.params;
  }
  return _paramsByStrategy;
}

/** Set (in-memory) params for a strategy, e.g. right after optimizing. */
function setParams(name, params) {
  _paramsByStrategy[(name || "").toLowerCase()] = params;
}

function getParams(name) {
  return _paramsByStrategy[(name || "").toLowerCase()] || null;
}

function activeParams() {
  return { ..._paramsByStrategy };
}

/**
 * Evaluate a price series.
 * @param {number[]} prices oldest -> newest closes
 * @param {object} opts { strategy?, params?, members?, context? }
 */
function evaluate(prices, opts = {}) {
  const name = (opts.strategy || _defaultStrategy || "momentum").toLowerCase();
  if (name === "ensemble") {
    return registry.ensemble(prices, {
      members: opts.members || _ensembleMembers,
      params: opts.paramsByStrategy || _paramsByStrategy,
      context: opts.context || {},
    });
  }
  const strat = registry.get(name);
  if (!strat) return { signal: "FLAT", confidence: 0, score: 0, reasons: [`unknown strategy ${name}`], indicators: {} };
  // explicit params win, else optimizer-saved params, else strategy defaults
  const params = opts.params || _paramsByStrategy[name] || undefined;
  return strat.evaluate(prices, params, opts.context || {});
}


module.exports = {
  evaluate,
  configure,
  loadSavedParams,
  setParams,
  getParams,
  activeParams,
  registry,
  paramStore,
};
