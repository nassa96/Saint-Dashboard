# Strategy spec: DNFH

Status: **implemented** — but not as a per-symbol signal strategy (this
registry slot stays an inert `FLAT` placeholder, see below for why).

You defined DNFH as **Delta-Neutral Funding Harvest**: long spot / short an
equal-notional perp, collecting the funding rate perp longs pay shorts when
funding is positive, with net price exposure ~0.

That's a real, legitimate, well-known trading technique, and it's built —
just not here. It doesn't fit this file's slot (`src/signals/strategies/`)
because that interface is for single-symbol directional signals (`evaluate(series)
-> {signal: LONG/SHORT/FLAT}`) feeding the spot rotation engine. DNFH is a
**two-leg, cross-venue position** (Base spot + HyperLiquid perp), which needs
its own orchestration. It lives in:

- **`src/yield/dnfh.js`** — the real implementation
- **`src/yield/dnfhStore.js`** — persists funding-epoch history + this
  module's own best-effort "open position" bookkeeping across restarts
- **`GET /api/dnfh/scan`** — read-only, ranks live HyperLiquid funding rates
  by annualized yield; each row is flagged `meetsEntryThreshold`
- **`GET /api/dnfh/rebalance-check?symbol=&spotPx=&perpPx=`** — read-only;
  reports whether a tracked position should be rebalanced right now
- **`POST /api/dnfh/plan`** — pure math; requires you to supply a
  self-verified spot token contract address (never guessed)
- **`POST /api/dnfh/execute`** — moves real funds on both legs; requires the
  full live-arm gate + on-chain-swap arm; leverage hard-capped at
  `HYPERLIQUID_MAX_LEVERAGE` (default 2x); reports a loud warning instead of
  silently leaving you one-sided if one leg fails
- **`VENUES.md`** and **`SAFETY.md`** — usage + risk documentation

## Entry / exit / rebalance rules (Market Overlord refinement)

- **Entry threshold**: `planPosition()` refuses a harvest unless the live
  annualized funding yield clears `DNFH_ENTRY_THRESHOLD_ANNUAL_PCT` (default
  **22%**). Below that bar, the two-leg execution risk and ongoing rebalance
  overhead isn't worth the carry — the module tells you to stay in USDC
  instead of silently planning a thin trade.
- **Net-edge gate**: on top of the entry threshold, `planPosition()` computes
  a projected net ROI over the holding period (`computeNetEdge()`):
  `funding yield over N days − (open fee + close fee + basis slippage +
  borrow cost)`. The default holding period is 7 days and the gate is
  `DNFH_MIN_NET_EDGE_7D_PCT` (default **0.75%**). All four cost components
  are configurable env vars (`DNFH_OPEN_FEE_PCT`, `DNFH_CLOSE_FEE_PCT`,
  `DNFH_BASIS_SLIPPAGE_PCT`, `DNFH_BORROW_COST_ANNUAL_PCT`) — they are
  *estimates*, not guarantees; real fills vary by venue and liquidity.
- **Rebalance triggers**: `checkRebalanceTriggers(symbol, {spotPx, perpPx})`
  flags a rebalance when either:
  1. the two legs' current notionals have drifted apart by more than
     `DNFH_REBALANCE_DELTA_DRIFT_PCT` (default **1.5%**), compared against
     this module's own tracked entry notionals (best-effort bookkeeping from
     `planPosition()`/`execute()` — not a substitute for checking your real
     exchange balances), or
  2. funding has been negative for the last `DNFH_REBALANCE_NEGATIVE_EPOCHS`
     (default **3**) consecutive recorded ~1h samples, persisted via
     `dnfhStore` and sampled on a real hourly cadence from the engine (not
     just whenever the dashboard happens to be open).
  This endpoint/method only *reports* the trigger — it does not
  auto-rebalance. Same "a human decides the next real-money move" philosophy
  as the existing partial-fill handling in `execute()`.

See those files for the real, working version. This per-symbol slot remains
`FLAT`/inert — there's no single-symbol directional signal to implement here.
