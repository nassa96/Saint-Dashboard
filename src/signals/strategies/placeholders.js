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

function inertStrategy(name, label, docFile) {
  const defaultParams = {};
  function evaluate() {
    return {
      signal: "FLAT",
      confidence: 0,
      score: 0,
      reasons: [`"${label}" has no trading logic yet — fill out docs/strategies/${docFile} and ask to implement it`],
      indicators: {},
    };
  }
  return { name, label, defaultParams, paramSpace: {}, evaluate, status: "awaiting_spec" };
}

const STRATEGIES = {
  dnfh: inertStrategy("dnfh", "DNFH (spec pending)", "DNFH.md"),
  overlord: inertStrategy("overlord", "Overlord Strategy (spec pending)", "OVERLORD.md"),
  autonomouswealth: inertStrategy(
    "autonomouswealth",
    "Autonomous Wealth Protocol — low-capital (spec pending)",
    "AUTONOMOUS_WEALTH_PROTOCOL.md"
  ),
};

module.exports = { STRATEGIES };
