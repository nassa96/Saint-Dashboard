/* ============================================================
   PLACEHOLDER STRATEGY SLOTS — awaiting your spec.
   You referenced three proprietary strategies I don't have rules for:
   "DNFH", "overlord strategy", and "autonomous wealth protocol" (low
   capital allocation). Rather than guess at logic that manages real
   money, each is wired into the registry as a clearly-labeled,
   inert slot: it shows up in /api/strategies so you can select it,
   but always returns FLAT with a reason pointing at the spec template
   in docs/strategies/ until you fill in the actual entry/exit rules.

   To activate one: fill out its template in docs/strategies/<NAME>.md
   (indicators used, entry/exit conditions, position sizing, timeframe,
   max capital at risk) and ask me to implement it — I'll wire real
   logic into the matching function below and flip `status` to "active".
   ============================================================ */

function inertStrategy(name, label, docFile, reason) {
  const defaultParams = {};
  function evaluate() {
    return {
      signal: "FLAT",
      confidence: 0,
      score: 0,
      reasons: [reason || `"${label}" has no trading logic yet — fill out docs/strategies/${docFile} and ask to implement it`],
      indicators: {},
    };
  }
  return { name, label, defaultParams, paramSpace: {}, evaluate, status: "awaiting_spec" };
}

const STRATEGIES = {
  // DNFH itself is implemented for real — just not here. It's a two-leg,
  // cross-venue position (Base spot + HyperLiquid perp short), not a
  // single-symbol directional signal, so it doesn't fit this registry's
  // evaluate(series) interface. See src/yield/dnfh.js, GET/POST /api/dnfh/*,
  // and docs/strategies/DNFH.md for the real, working, fully-gated version.
  dnfh: inertStrategy(
    "dnfh",
    "DNFH (implemented separately — see docs/strategies/DNFH.md)",
    "DNFH.md",
    "DNFH is implemented as a real cross-venue strategy, not a per-symbol signal — see src/yield/dnfh.js and /api/dnfh/scan|plan|execute"
  ),
  // Market Overlord spec: implemented, but spread across several existing
  // modules rather than one per-symbol signal — see docs/strategies/OVERLORD.md
  // for the map (marketMaking.js gamma scaling, dnfh.js entry/net-edge/
  // rebalance rules, mevDefense.js). This slot stays inert for the same
  // reason the dnfh slot does: it isn't a single-symbol directional signal.
  overlord: inertStrategy(
    "overlord",
    "Market Overlord (implemented across modules — see docs/strategies/OVERLORD.md)",
    "OVERLORD.md",
    "Market Overlord is implemented as refinements to several existing modules, not a per-symbol signal — see docs/strategies/OVERLORD.md for the full map"
  ),
  // AWP: implemented across the fibonacci strategy (spear-pool entries),
  // sortino.js (Kelly-Sortino sizing), capitalRing.js (Shield/Spear
  // allocation), and riskManager.js (cold-start mode) — see
  // docs/strategies/AUTONOMOUS_WEALTH_PROTOCOL.md. This slot stays inert
  // because the real spear-pool signal lives in the "fibonacci" slot above;
  // there's nothing left for this slot itself to compute.
  autonomouswealth: inertStrategy(
    "autonomouswealth",
    "Autonomous Wealth Protocol (implemented across modules — see docs/strategies/AUTONOMOUS_WEALTH_PROTOCOL.md)",
    "AUTONOMOUS_WEALTH_PROTOCOL.md",
    "AWP is implemented across fibonacci.js, sortino.js, capitalRing.js and riskManager.js — see docs/strategies/AUTONOMOUS_WEALTH_PROTOCOL.md for the full map; this slot itself has nothing to compute"
  ),
};

module.exports = { STRATEGIES };
