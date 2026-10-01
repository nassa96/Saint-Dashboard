# Strategy spec: Autonomous Wealth Protocol (AWP)

Status: **implemented — spread across several existing modules**, same
pattern as `DNFH.md`/`OVERLORD.md`: the `autonomouswealth` registry slot
stays inert, because AWP isn't one per-symbol signal — it's a capital
structure (Shield/Spear) plus a sizing rule plus a real entry strategy
(Fibonacci confluence), each already implemented in its own module.

## What you asked for, and where it actually lives

| Spec item | Formula / rule | Implementation |
|---|---|---|
| Two-tier capital ring: Shield 80% / Spear 20% | Shield = conservative/low-vol strategies; Spear = high-conviction momentum, own loss ceiling | `src/portfolio/capitalRing.js` (disabled by default — `CAPITAL_RING_ENABLED=true`). Maps pool membership onto the *existing* per-symbol strategy router: route your high-conviction symbols to the `fibonacci` strategy to put them in the spear pool. |
| Spear pool's own scoped daily-loss ceiling | breach halts NEW spear entries only, not the whole engine | `capitalRing.updateSpearRisk()` — rolling cooldown halt (`CAPITAL_RING_SPEAR_DAILY_LOSS_CEILING_PCT`, default 5%), shield pool + all exits keep running through a spear halt |
| Kelly-Sortino sizing: `f* = (p·b − q)/b · sortino_scalar` | `sortino_scalar = clamp(target_downside_vol/realized_downside_deviation, 0.1, 0.35)` | `src/portfolio/sortino.js` — `kellyFraction()`, `sortinoScalar()`, `downsideDeviation()`, combined in `kellySortinoFraction()`. Exported for use by a position-sizing caller; negative-edge bets clamp to 0 (never sizes against your own edge). |
| Fibonacci confluence entries (0.382/0.5/0.618-0.65 golden pocket, 5m/15m confirmation) | higher-TF trend + retracement + stochastic/volume confirmation -> LONG | `src/signals/strategies/fibonacci.js` — real registry strategy (`"fibonacci"`), plugs into the standard `evaluate(series) -> {signal, confidence, score, indicators, reasons}` interface like any other strategy. Uses real OHLCV bars (`src/market/marketData.js` `getBars()`/`refreshBars()`) for swing/stochastic/ATR, not just closes. |
| Tiered take-profit ladder (35%@1.272 w/ SL->BE+fees, 40%@1.618, 25% trail@2.618 via 2.5×ATR14) | computed and reported | `fibonacci.js` computes and returns the full ladder under `indicators.tpPlan` — see the limitation note below for what's NOT automated yet. |
| Cold-start sizing guardrails | absolute per-trade $ ceiling + true rolling 24h drawdown-halt cooldown | `src/risk/riskManager.js` — `config.capital.maxTradeUsd` (env `MAX_TRADE_USD`, 0=disabled) and `config.capital.haltCooldownHours` (env `HALT_COOLDOWN_HOURS`, default 24) — see the cold-start bootstrap roadmap below. |

## Honest limitation: the TP ladder is computed, not yet auto-executed

The engine's rotation model is **continuous target-weight rebalancing**:
every tick it computes "what % of equity should symbol X be" and
buys/sells the delta. It has no native concept of "close exactly 35% of
this specific position, then move the stop to breakeven, then trail the
rest" — that's a **discrete, path-dependent, per-position state machine**,
a fundamentally different execution model.

`fibonacci.js` computes the full ladder (TP1/TP2/TP3 prices, the
breakeven-move rule, the ATR trailing-stop distance) and surfaces it in
`indicators.tpPlan` for display and manual execution. Fully automating it
would need a new parallel **position-manager subsystem** that tracks
individual lots and their own exit state outside the target-weight loop —
that's flagged here as a real follow-up, not silently skipped or claimed
as done.

## Cold-start bootstrap roadmap (the three stages you specified)

- **Stage 1 — micro-sandbox**: `MAX_TRADE_USD=2` (or 2-5) caps every trade
  to an absolute dollar ceiling regardless of configured starting equity or
  percentage caps. `MAX_DAILY_DRAWDOWN_PCT=0.03` + `HALT_COOLDOWN_HOURS=24`
  gives a true rolling 24h halt on a 3% daily-drawdown breach (previously
  the halt only cleared at the next calendar-day boundary, which could be
  under an hour away).
- **Stage 2 — synthetic validation (10k block-bootstrap paths, Sortino>1.8
  gate)**: implemented — `src/backtest/syntheticValidator.js` (`POST
  /api/validate/synthetic`). Resamples the recent CLOSE-PRICE history this
  app already keeps into thousands of synthetic paths via block-bootstrap
  (overlapping blocks of real consecutive returns, same block indices
  reused across symbols per run to preserve cross-symbol co-movement), runs
  each through the SAME backtester/allocator/strategy used live, and gates
  `autonomousEligible` on Sortino clearing `sortinoThreshold` (default 1.8)
  across `passRateThreshold` (default 95%) of valid runs. **Honest
  substitution**: the spec said "resample order-book snapshots" — this app
  stores no order-book history anywhere, so it resamples price history
  instead; `syntheticValidator.js`'s header explains why. The module
  defaults to the full spec'd 10,000 runs when called directly; the HTTP
  endpoint caps it lower (default 200, max 2,000) purely so the request
  actually returns in a reasonable time.
- **Stage 3 — execution hygiene**: already the app's default posture —
  there is no market-order code path anywhere in this codebase (HyperLiquid
  and every exchange connector route limit/post-only orders), and
  `riskManager.assess()` already gates every trade on confidence +
  exposure + regime before sizing. The DNFH net-edge gate
  (`computeNetEdge()`) is the "net-edge-positive gate on every tx" for the
  funding-harvest side specifically.

This slot stays inert for the same reason `dnfh`/`overlord` do: the real
logic is a cross-cutting set of modules, not a single `evaluate(series) ->
{signal}` function this registry calls per-symbol. The real per-symbol
signal AWP contributes is the `fibonacci` strategy — select it directly or
route symbols to it via `config.strategyRoutes`.
