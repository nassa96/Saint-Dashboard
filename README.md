# SAINT CORE — Omnivex Trading Intelligence (v2)

A real-time crypto **trading intelligence dashboard**: live market data, a
transparent multi-indicator signal engine, capital-allocation / rotation logic,
a memecoin detection radar, and **hard-gated** live execution across centralized
exchanges — with a realistic paper-trading engine running safely by default.

> ⚠️ **Read `SAFETY.md` before enabling live trading.** This software can place
> real orders with real money once armed. It is provided as-is, is **not
> financial advice**, and you are solely responsible for any funds you connect.

---

## What changed in v2 (honest status)

The original repo was a **simulation scaffold** — every "AI" decision was a
`Math.random()` call and every exchange method returned `"SIMULATED_FILL"`.
v2 replaces that core with real, working machinery:

| Area | v1 (before) | v2 (now) |
|---|---|---|
| Signals | `Math.random()` LONG/SHORT | Real EMA / RSI / MACD / momentum / volatility (`src/signals`) |
| Risk | `Math.random() > 0.3` | Deterministic caps, exposure limits, daily-drawdown circuit breaker (`src/risk`) |
| Allocation | none | Conviction-weighted rotation across the universe (`src/portfolio`) |
| Execution | random pnl | Paper broker with real prices, fees & slippage (`src/paper`) + gated live routing (`src/exchange`) |
| Market data | random walk only | Real Coinbase REST + historical candle warm-up, with labeled SIM fallback (`src/market`) |
| Memecoins | none | DexScreener scanner with transparent scoring + risk flags (`src/memecoin`) |
| Exchanges | stub `placeOrder` | Real signed connectors: Binance.US, Coinbase, Kraken (read-only balances + gated orders) |
| Dashboard | single health card | Full live WebSocket dashboard (`public/index.html`) |
| On-chain | none | Self-custody swaps: Solana/Jupiter + EVM/0x, hard-gated (`src/wallet`) |
| Backtesting | none | Historical backtester with metrics + benchmark (`src/backtest`) |
| Deploy | `node server.js` | Docker, docker-compose, systemd unit, deploy guide (`DEPLOY.md`) |
| Auth | none | Session-token login protecting REST + WebSocket (`src/auth`) |
| Persistence | in-memory only | Paper portfolio saved to `data/portfolio.json`, restored on restart |
| Alerts | none | Telegram + Discord alerts on fills & high-score memecoins (`src/alerts`) |
| Strategies | 1 fixed | Pluggable registry: momentum, mean-reversion, ensemble (`src/signals/strategies`) |
| Optimization | none | Grid search + walk-forward validation, results persisted & auto-applied (`src/backtest/optimizer.js`, `src/signals/paramStore.js`) |
| Strategy routing | 1 global | Per-symbol / per-strategy routing — momentum on majors, mean-reversion on alts, simultaneously (`config.resolveStrategy`) |
| Journal & analytics | none | Closed-trade journal + analytics page: win rate, profit factor, expectancy, drawdown, PnL distribution (`src/analytics`, `/analytics.html`) |
| CI | none | GitHub Actions: self-test on Node 18/20/22 + boot smoke test (`ci/`, see `ci/README.md`) |
| Volatility forecasting | none | **Extreme Volatility Radar** — real EWMA/realized-vol regime detection, Bollinger-squeeze compression flags, and an empirical (percentile-based) "extreme-move likelihood" score per symbol (`src/volatility/predictor.js`, `/api/volatility`, dashboard panel) |

### Extreme Volatility Radar (honest read)
No system — ours included — can predict volatility with certainty; markets are
fat-tailed and regimes can break without warning. What this module *does* do,
with real math and no randomness:

- **EWMA volatility** (RiskMetrics λ=0.94) — reacts fast to fresh shocks.
- **Multi-window realized vol** (10/20/60-bar stdev of log returns).
- **Vol-of-vol** — is volatility itself accelerating (regime destabilizing)?
- **Bollinger-width squeeze** — historically, tight compression often precedes
  expansion (a documented pattern, not a promise).
- **Empirical percentile rank** — where current vol sits vs. its own trailing
  history, turned into a bounded 0–100 "extreme-move likelihood" score and a
  CALM / NORMAL / ELEVATED / EXTREME regime label.
- **Plain-English expected range** — 1σ/2σ move size in % and $ from the
  current EWMA vol.

Every response carries a `disclaimer` field and the same honesty rule as the
rest of this repo: it's a statistical estimate from real price history, never
a guarantee, and never financial advice. See `SAFETY.md`.

### LIVE vs SIM labeling
Every price, signal, and candidate is tagged **`LIVE`** or **`SIM`**. If the host
running the server cannot reach the exchange/DEX APIs (e.g. a locked-down cloud
sandbox), the system transparently falls back to **clearly-labeled simulated
data** so the dashboard stays functional — and automatically switches to real
**LIVE** data the moment it runs somewhere with outbound internet (your PC/VPS).

---

## Quick start

```bash
npm install
cp .env.example .env      # edit as needed (safe defaults are fine to start)
npm start                 # http://localhost:3000
npm test                  # offline self-test of the full pipeline (20 checks)
npm run validate          # walk-forward every strategy → robust YES/NO verdict
npm run backtest          # backtest the strategy (real candles when online)
```

> 💰 **Going live with real money? Start with [`LAUNCH.md`](LAUNCH.md)** — a staged
> runbook (validate → paper → tiny live → scale) with risk presets in `presets/`
> and a pre-flight checklist. It's built to keep you from blowing up.
>
> 🌐 **Running across multiple exchanges?** See [`VENUES.md`](VENUES.md) — venue
> fees, aggregated balances, fee-aware sizing, and how to add new venues.

For 24/7 hosting (Docker / VPS / systemd) see **`DEPLOY.md`**:
```bash
docker compose up -d --build
```

Open `http://localhost:3000`. It boots in **PAPER mode** with live trading
**disarmed**. Let it run — it warms up indicator history, generates signals,
rotates a simulated $10,000 book, and scans for memecoins.

---

## Architecture

```
server.js ──► src/engine/engine.js  (the loop)
                 ├─ src/market/marketData.js   real prices + candle warm-up (LIVE/SIM)
                 ├─ src/signals/strategy.js     facade -> strategies/ registry
                 │     └─ strategies/ momentum · meanReversion · ensemble
                 │     └─ paramStore.js         persists tuned params (auto-applied)
                 ├─ src/volatility/predictor.js Extreme Volatility Radar (EWMA/realized vol, squeeze, regime)
                 ├─ src/risk/riskManager.js     caps, exposure, drawdown breaker
                 ├─ src/portfolio/allocator.js  conviction-weighted rotation targets
                 ├─ src/paper/broker.js         simulated fills @ real prices (default)
                 ├─ src/exchange/manager.js     ONLY choke-point for CEX live orders
                 │     ├─ binanceus.js  coinbase.js  kraken.js  (signed REST)
                 ├─ src/wallet/manager.js       ONLY choke-point for on-chain swaps
                 │     ├─ solana.js (Jupiter)   evm.js (0x: eth/base/bsc)
                 ├─ src/backtest/backtester.js  replay strategy over history
                 ├─ src/backtest/optimizer.js   grid search + walk-forward
                 ├─ src/analytics/analytics.js  journal stats: win rate, PF, expectancy
                 └─ src/memecoin/scanner.js     DexScreener detection + scoring
public/index.html ──── live dashboard over /ws (WebSocket)
public/analytics.html ─ trade journal & performance analytics
public/connect.html ─── connect exchanges + view wallet status (Connections hub)
```

### REST API
- `GET  /api/health` — status, mode, data source
- `GET  /api/state` — full snapshot (also streamed over `/ws`)
- `GET  /api/signals` `/api/portfolio` `/api/memecoins` `/api/chronicle`
- `GET  /api/exchanges/health` — venue reachability + whether keys are present
- `GET  /api/exchanges/balances?venue=coinbase` — **read-only** balances
- `GET  /api/exchanges/balances/all` — aggregated balances across every venue + fees
- `POST /api/exchanges/connect` — save + verify venue keys `{venue,key,secret,passphrase?}` (read-only test)
- `POST /api/exchanges/disconnect` — remove saved venue keys `{venue}`
- `GET  /api/live/status` — live-arming status (armed?, testnet?, auth?, connected?)
- `POST /api/live/arm` — arm live trading `{confirm:"I ACCEPT THE RISK"}` (refused unless primary venue connected)
- `POST /api/live/disarm` — instant kill switch back to PAPER
- `GET  /api/wallet/status` — on-chain wallet status (armed?, addresses)
- `POST /api/wallet/quote` — read-only swap quote `{chain, tokenAddress, usd}`
- `POST /api/wallet/swap` — **gated** real swap (refused unless armed)
- `POST /api/backtest` — backtest the strategy `{bars, granularity}`
- `GET  /api/strategies` — list available strategies + active one
- `POST /api/optimize` — grid-search a strategy's params `{strategy, bars, apply?}` (best params are persisted + applied live unless `apply:false`)
- `POST /api/walkforward` — walk-forward validation `{strategy, bars, folds}`
- `GET  /api/journal?limit=100` — closed round-trip trade journal
- `GET  /api/analytics` — performance analytics (win rate, profit factor, expectancy, distribution)
- `GET  /api/params` — active tuned params + persisted param store
- `POST /api/login` `/api/logout` · `GET /api/auth/status` — dashboard auth
- `GET  /api/alerts/status` · `POST /api/alerts/test` — notification channels
- `POST /api/portfolio/reset` — reset paper book (clears persisted state)
- `POST /api/tick` `/api/engine/start` `/api/engine/stop`

### Strategies & optimization
Set `STRATEGY=momentum|meanreversion|ensemble` in `.env`. Strategies live in
`src/signals/strategies/` and are pluggable — each exports `evaluate(prices,
params)`, `defaultParams`, and a `paramSpace` the optimizer sweeps.

- **Grid search** (`npm run optimize momentum 600`) sweeps the param space and
  ranks by drawdown-penalized fitness.
- **Walk-forward** (`npm run optimize momentum 800 --wf`) optimizes on an
  in-sample window then validates on the *next, unseen* window across folds —
  the honest test of whether an edge is real or just curve-fit. It reports a
  `robust` verdict when the majority of out-of-sample folds are profitable.

Both are also available in the dashboard's **Strategy Optimizer** panel and via
`/api/optimize` + `/api/walkforward`.

**Persisted results** — when you optimize (CLI or dashboard), the best params are
written to `data/strategy_params.json` and applied to the running engine
immediately. On the next boot the engine auto-loads them (see the
`[ENGINE] Loaded tuned params for …` log line), so a tuned edge survives restarts.

### Per-symbol strategy routing
Run different strategies on different assets at the same time. Resolution order
per symbol is **explicit route → majors/alts split → global `STRATEGY`**:

```
SYMBOL_STRATEGIES=BTC-USD:momentum,SOL-USD:meanreversion   # explicit wins
MAJORS=BTC-USD,ETH-USD                                       # who counts as a major
STRATEGY_MAJORS=momentum                                     # applied to majors
STRATEGY_ALTS=meanreversion                                  # applied to everything else
```

The dashboard's Signals table shows the routed strategy per asset, and the
snapshot exposes `strategy.routes` + `strategy.tunedParams`.

### Trade journal & analytics
Every closed round-trip trade is recorded in the broker's ledger (persisted in
`data/portfolio.json`). The **📊 Analytics** page (`/analytics.html`, linked from
the header) shows net PnL, win rate, profit factor, expectancy, avg win/loss,
max drawdown, average hold time, a per-symbol breakdown, a PnL-% distribution and
a cumulative realized-PnL curve — all from `/api/journal` + `/api/analytics`.

### Authentication
Auth turns on automatically once `DASHBOARD_PASSWORD` is set. It protects all
REST routes (except `/api/health` + login) **and** the WebSocket stream via an
HMAC-signed session token (cookie + bearer). Set `SESSION_SECRET` in production
so sessions survive restarts. Always set a password before exposing the
dashboard to any network — see `SAFETY.md`.

### Persistence
The paper portfolio (cash, positions, realized PnL, fills, equity curve) is
written to `data/portfolio.json` (debounced) and restored on boot, so restarts
don't lose your track record. Reset any time via `POST /api/portfolio/reset`
or the dashboard's **Reset Book** button.

### Alerts
Set `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID` and/or `DISCORD_WEBHOOK_URL` to get
pushed a message on every fill and whenever a **non-simulated** memecoin scores
≥ `ALERT_MEMECOIN_MIN_SCORE` (deduped for 6h). Test with the dashboard's
**Test Alert** button or `POST /api/alerts/test`.

---

## Going live (only when you're ready)

See **`SAFETY.md`** for the full checklist. In short, live orders require **all
three** of these to be set — defense in depth:

```env
TRADING_MODE=LIVE
LIVE_TRADING_ENABLED=true
LIVE_TRADING_CONFIRM=I ACCEPT THE RISK
```

Until every one of those is set exactly, `ExchangeManager.routeLiveOrder()`
refuses to send anything and the engine uses the paper ledger.

## Configuration
All tunables live in `.env` (see `.env.example`): capital size, position/
portfolio caps, drawdown breaker, minimum signal confidence, trade universe,
per-venue API keys, and memecoin filters.

## Disclaimer
Trading crypto is high-risk and can result in total loss. Signals here are
technical heuristics, **not** predictions. Nothing in this project is financial
advice. Validate everything in PAPER mode first and never risk more than you can
afford to lose.
