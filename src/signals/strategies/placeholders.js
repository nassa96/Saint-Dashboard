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
  overlord: inertStrategy("overlord", "Overlord Strategy (spec pending)", "OVERLORD.md"),
  autonomouswealth: inertStrategy(
    "autonomouswealth",
    "Autonomous Wealth Protocol — low-capital (spec pending)",
    "AUTONOMOUS_WEALTH_PROTOCOL.md"
  ),
};

module.exports = { STRATEGIES };
