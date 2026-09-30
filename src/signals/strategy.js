/* ============================================================
   STRATEGY FACADE
   Backward-compatible entry point used by the engine, backtester,
   and optimizer. Delegates to the selected strategy (or ensemble)
   from the registry. Defaults to the configured strategy.
   ============================================================ */

const registry = require("./strategies/registry");

let _defaultStrategy = "momentum";
let _ensembleMembers = ["momentum", "meanreversion"];

function configure({ strategy, ensembleMembers } = {}) {
  if (strategy) _defaultStrategy = strategy;
  if (ensembleMembers) _ensembleMembers = ensembleMembers;
}

/**
 * Evaluate a price series.
 * @param {number[]} prices oldest -> newest closes
 * @param {object} opts { strategy?, params?, members? }
 */
function evaluate(prices, opts = {}) {
  const name = (opts.strategy || _defaultStrategy || "momentum").toLowerCase();
  if (name === "ensemble") {
    return registry.ensemble(prices, {
      members: opts.members || _ensembleMembers,
      params: opts.paramsByStrategy,
    });
  }
  const strat = registry.get(name);
  if (!strat) return { signal: "FLAT", confidence: 0, score: 0, reasons: [`unknown strategy ${name}`], indicators: {} };
  return strat.evaluate(prices, opts.params);
}

module.exports = { evaluate, configure, registry };
