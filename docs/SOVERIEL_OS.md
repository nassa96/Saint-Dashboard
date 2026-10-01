# Soveriel OS by Nexara AI — naming/branding layer

Status: **naming map over existing subsystems**, not a rewrite. You asked
for three named subsystems; all three already exist under this app's own
branding. This doc is the translation table, nothing more — no code had to
change to "add" Soveriel OS, because the systems it names are real and
already shipped.

| Soveriel name | What it actually is | Where it lives |
|---|---|---|
| **Mercury Omniscope** | Cross-venue market-data aggregation/standardization (price history, OHLCV bars, volatility regime reads) | `src/market/marketData.js` (`getBars()`/`refreshBars()`, tick history, LIVE/SIM honest labeling), `src/volatility/predictor.js` |
| **Aegis Guardian** | Server-side risk ceilings: trade-size caps, max slippage, **two-tier drawdown** (5% soft brake: halve size + cap leverage 1x, re-evaluated live; 10% hard killswitch: halt + flatten all positions + rolling cooldown), zero withdrawal authority (this app never has wallet keys with withdrawal permission — see SAFETY.md) | `src/risk/riskManager.js` — note: this codebase's own prior history literally called an earlier, non-deterministic version of this module "AEGIS" before a from-scratch rewrite (see the comment at the top of `riskManager.js`: "replaces the old random AEGIS"). The Soveriel name is consistent with that history, not a new invention. Two-tier drawdown shipped in Round 2, see below. |
| **SAINT execution engine** | Low-latency, post-only/limit-only order routing + rapid cancellation across exchange connectors | `src/engine/engine.js` + `src/exchange/*` — this is already this dashboard's own name/branding (`Saint-Dashboard`), so this mapping is exact, not aspirational. |

## Round 2 — scoped implementation of Aegis two-tier drawdown, Sophia (OFI + Kalman), and the generalized net-opportunity formula

You then supplied a much larger "Soveriel" master spec (Mercury Omniscope
real-time WS L2 feeds + Hawkes-process microstructure; Sophia's multi-level
OFI tensor + online Kalman cointegration; a from-scratch Rust/Go/TypeScript
rewrite; real private-RPC anti-MEV routing with in-flight mempool
cancellation). You then confirmed, via explicit choice: **extend this
existing Node.js codebase** (no rewrite), **keep REST-poll data proxies**
(no new WebSocket infrastructure), and **build a scoped-down version of
all three** of {Aegis two-tier drawdown, OFI+Kalman, generalized
net-opportunity formula} rather than going deep on just one. Here's what
actually shipped for each:

### Aegis Guardian — two-tier drawdown

`src/risk/riskManager.js` now has two independent thresholds instead of
one:

- **Soft brake** (`softBrakeDrawdownPct`, default 5%, env
  `SOFT_BRAKE_DRAWDOWN_PCT`): re-evaluated live every `updateEquity()` call
  — NOT sticky. While active: new-entry size is halved (`sizeFactor *= 0.5`,
  stacked multiplicatively with the existing volatility-regime sizing) and
  `maxLeverageCap()` returns `1`. Clears the instant drawdown recovers back
  under 5%.
- **Hard killswitch** (`maxDailyDrawdownPct`, unchanged default 10%): same
  sticky rolling-cooldown halt as before, but now also raises a one-shot
  `justTriggeredHardHalt` flag that `src/engine/engine.js` consumes to call
  a new `_flattenAll()` — sells every open paper position to cash through
  the normal SELL execution path, exactly once per hard-halt event.
- `DnfhEngine` (`src/yield/dnfh.js`) now accepts an optional `risk`
  instance and folds `risk.maxLeverageCap()` into its own
  `exchanges.hyperliquid.maxLeverage` cap — whichever is tighter wins.

### Sophia layer — OFI + Kalman pairs (scoped, REST-poll based)

- **`src/market/marketData.js`: `refreshOrderBooks()`** polls Coinbase's
  public L2 book endpoint (`GET /products/<id>/book?level=2`, no auth) on
  demand (intended slow cadence — 30-60s, not a WebSocket stream) and keeps
  the last 2 snapshots per symbol.
- **`src/signals/orderFlow.js`: `computeOFI()`** implements the classic
  Cont/Kukanov/Stoikov (2014) order-flow-imbalance rule, extended to the
  top-N rank-aligned levels between two snapshots, normalized by total
  depth in the window. Exposed at `GET /api/market/orderflow?symbol=...`.
- **`src/signals/kalmanPairs.js`: `kalmanPairSignal()`** is a scalar
  recursive Kalman filter (`y_t = beta_t * x_t + v_t`, `beta_t` a random
  walk) estimating a time-varying hedge ratio between two existing price
  series — pure math, no new data feed. Outputs the converged beta, the
  residual spread, and a z-score-based `FLAT`/`LONG_Y_SHORT_X`/
  `SHORT_Y_LONG_X` rotation-tilt signal. Exposed at
  `GET /api/signals/kalman-pairs?x=...&y=...`.
- **Honest scope note (both modules):** a true "multi-level OFI tensor" or
  "online cointegration engine" per the original spec implies continuous,
  sub-second WebSocket depth updates. What's built here is the same math
  applied to REST snapshots taken seconds-to-minutes apart — a real,
  useful, but much more coarsely discretized version. No synthetic/SIM
  fallback exists for order-book data specifically (unlike price/bar
  fallbacks elsewhere) — fabricated depth would be actively misleading for
  an imbalance calculation, so a failed poll is just skipped.

### Generalized multi-chain net-opportunity formula

`src/portfolio/netOpportunity.js`: `computeNetOpportunity({ notionalUsd,
grossDislocationBps, gasCostUsd, takerFeeBps, targetSlippageBps,
bridgeCostUsd, settlementLatencyPenaltyBps, mevRiskDiscountBps, minEdgeBps
})` → `{ grossUsd, costBreakdown, totalCostUsd, netUsd, netBps, approved }`.
Added as a standalone module (DNFH's existing, separately-tested
`computeNetEdge()` for funding-rate carry was left alone, not refactored).
Wired into AVSS's `scan()` as an additional required gate — see
`docs/strategies/AVSS.md` for the specifics and for why this also serves as
the implementation of the spec's Module C ("Asymmetric Latency
Arbitrageur").

All of the above is covered by `npm test` (`scripts/selftest.js`).

## What's NOT part of this naming pass

You also described two UX/product aspirations that aren't actionable specs
yet — flagged here rather than silently built or silently ignored:

1. **A voice persona for Soveriel** (Jarvis/Cortana-style) — this needs
   real product decisions before any code: which voice engine, push-to-talk
   vs. always-listening, what it's allowed to say/do without confirmation,
   whether it can ever place an order by voice alone (strong "no" by
   default, given everything else in this app's safety posture — any voice
   command touching real money should still go through the exact same
   live-arm + confirmation gates as the dashboard UI, not bypass them).
   Nothing has been built here; happy to scope it once you've got answers
   to those questions.
2. **"Top tier consciousness" / effortless wallet+exchange connection UX**
   — the actual wallet/exchange connection flows already exist
   (`public/connect.html`, `/api/exchanges/*`, `src/wallet/manager.js`) and
   are reasonably simple today (paste a read-only key or connect a public
   wallet address; nothing here ever asks for a seed phrase). "Futuristic
   but simple" is a design/visual-polish direction, not a technical
   requirement — it needs UI/UX direction (what should it actually look
   like?) before there's anything concrete to build. Tracked as an open
   question for whenever you want to get specific about the interface.
