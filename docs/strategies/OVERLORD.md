# Strategy spec: Market Overlord DNFH

Status: **implemented — spread across several existing modules**, same
pattern as `DNFH.md`: this per-symbol registry slot (`overlord`) stays an
inert `FLAT` placeholder, because the real spec isn't a single-symbol
directional signal — it's a set of refinements to the market-making and
funding-harvest engines, plus an execution-safety extension.

## What you asked for, and where it actually lives

| Spec item | Formula / rule | Implementation |
|---|---|---|
| Micro-capital gamma scaling | `γ_t = γ_base · clamp(targetCapital/equity, 1, maxGammaMultiplier)` | `src/signals/strategies/marketMaking.js` (`defaultParams.targetCapital`/`maxGammaMultiplier`, computed every `evaluate()` call from `context.equity`, wired from the engine's live per-tick equity) |
| Reservation price / optimal spread | `r = s - q·γ·σ²·(T-t)`; `δ = γσ²(T-t) + (2/γ)ln(1+γ/κ)` | Same file — these formulas were already correct before this round; gamma scaling was added on top |
| 22% annualized funding-yield entry threshold | refuse to plan below the bar | `src/yield/dnfh.js` `planPosition()` + `config.dnfh.entryThresholdAnnualPct` (default 22, env `DNFH_ENTRY_THRESHOLD_ANNUAL_PCT`) |
| Rebalance triggers (delta drift >1.5% OR funding negative 3 consecutive 1h epochs) | report-only trigger | `src/yield/dnfh.js` `checkRebalanceTriggers()` + `src/yield/dnfhStore.js` (persisted funding-epoch history, hourly recording loop in `engine.js`) |
| Net edge = funding yield − (open fee + close fee + basis slippage + borrow cost), gate at 0.75%/7d | refuse to plan below the gate | `src/yield/dnfh.js` `computeNetEdge()` + `config.dnfh.minNetEdge7dPct` (default 0.75%) |
| Post-only-only execution | n/a — HyperLiquid venue connector already routes limit orders only; this app never places market orders anywhere (search the codebase: there is no market-order code path) | `src/exchange/hyperliquid.js`, `src/exchange/manager.js` |
| Anti-sandwich/MEV routing: private RPC + priority-fee ceiling + toxic-flow detection | pre-trade risk assessment + tranching + protected-relay routing + priority-fee ceiling | `src/wallet/mevDefense.js` (`assessRisk`, `planExecution`, `preBroadcastAbort`, `maxPriorityFeeGwei`) |

## Honest limitation: "real-time mempool monitoring + pre-inclusion cancellation"

This was in the original ask and is **not generally achievable** by any
tool, not just this one: once a transaction is broadcast to a public
mempool, other nodes already have a copy of it — there is no network-level
"cancel" message. The only real lever is broadcasting a replacement
transaction with the same nonce and higher gas, and hoping a
miner/validator prefers it over the original; that's unreliable, costs
extra gas either way, and isn't something a bot can guarantee.

What's actually implemented instead — and what the industry actually does
for this problem — is **pre-broadcast** defense:

1. `mevDefense.assessRisk()` reads the aggregator's own quoted price impact
   and flags high-sandwich-exposure swaps *before* anything is signed.
2. `mevDefense.preBroadcastAbort()` refuses to proceed (or signals "route
   through a protected relay instead") when price impact is HIGH or the
   current network priority fee exceeds a configured ceiling — a congested,
   fee-spiking mempool is exactly when sandwich bots are most active.
3. `mevDefense.planExecution()` recommends tranching large swaps and, when a
   protected relay is configured (e.g. Flashbots Protect-style), routes the
   transaction so it **never enters the public mempool in the first place**
   — which is the actual way to avoid a sandwich, rather than trying to
   detect and cancel one after the fact.

This slot stays inert for the same reason `dnfh` does: the real logic is a
cross-cutting set of refinements to multiple existing modules, not a
`evaluate(series) -> {signal}` function this registry calls per-symbol.
