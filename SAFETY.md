# SAFETY & LIVE-LAUNCH CHECKLIST

This system can place **real orders with real money**. Treat it accordingly.
Read this whole file before you set `TRADING_MODE=LIVE`.

---

## The three-lock live gate (defense in depth)

A live order can only ever be sent when **all three** are true at once:

1. `TRADING_MODE=LIVE`
2. `LIVE_TRADING_ENABLED=true`
3. `LIVE_TRADING_CONFIRM=I ACCEPT THE RISK` (exact string)

This is enforced in one place — `config.canTradeLive()` — and checked again in
`ExchangeManager.routeLiveOrder()`. If any lock is missing, every order is
refused before it can reach an exchange and the engine falls back to the paper
ledger. **Do not weaken this gate.**

The dashboard shows a red **`⚠ LIVE ARMED`** badge whenever the gate is open.

---

## Recommended path to going live

1. **Run PAPER for a meaningful period.** Watch the equity curve, fills, and
   drawdown behaviour on real LIVE market data (deploy where the server has
   internet so the feed reads `DATA: LIVE`, not `SIM`).
2. **Create API keys with least privilege.**
   - Start with **read-only** keys to confirm balances load
     (`/api/exchanges/balances`). No trade permission yet.
   - When ready, issue **trade-enabled but withdrawal-DISABLED** keys.
   - **IP-allowlist** the keys to your server's IP.
3. **Fund small.** Start with an amount you are fully prepared to lose.
4. **Tighten risk in `.env`** before arming:
   - `MAX_POSITION_PCT`, `MAX_PORTFOLIO_RISK_PCT`
   - `MAX_DAILY_DRAWDOWN_PCT` (the circuit breaker halts trading for the day)
   - `MIN_SIGNAL_CONFIDENCE` (higher = fewer, higher-conviction trades)
5. **Arm the three locks**, restart, and confirm the `⚠ LIVE ARMED` badge.
6. **Watch it.** Do not leave an armed system unattended until you trust it.

---

## Secrets handling

- API keys live **only** in `.env`, which is `.gitignore`d. Never commit it.
- Never paste keys into chat, screenshots, or issues.
- Prefer environment variables / a secrets manager in production over a file.
- Rotate keys immediately if you suspect exposure.

## Wallets / custody

This build trades via **centralized-exchange API keys** (Binance.US, Coinbase,
Kraken). It does **not** hold your private keys or seed phrase, and API keys
should be created **without withdrawal permission**, so the software cannot move
funds off the exchange. On-chain (self-custody wallet) execution is intentionally
**not** enabled in this build.

## Known limitations (be honest with yourself)

- Signals are **technical heuristics**, not forecasts. They can and will be wrong.
- Backtesting/optimization is not included — validate live-forward in PAPER.
- Exchange connectors implement market orders + balances; extend/validate order
  types, symbol mapping, and rounding for your venue before trusting size.
- The memecoin radar is a **discovery/scoring** tool, not a buy signal, and does
  not auto-trade. Memecoins are extremely high-risk (rugs, honeypots, thin
  liquidity). The radar flags common risks but cannot guarantee safety.

## Dashboard access control

The dashboard has **no auth until you set `DASHBOARD_PASSWORD`**. Before exposing
it to anything beyond `localhost`:

1. Set `DASHBOARD_USER` + `DASHBOARD_PASSWORD` (use a strong, unique password).
2. Set a long random `SESSION_SECRET` (so tokens survive restarts and can't be
   forged). Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Serve over HTTPS (see `DEPLOY.md`) so credentials/cookies aren't sent in clear.
4. Consider an extra layer (Cloudflare Access, VPN, IP allowlist) — especially
   once live trading or on-chain swaps are armed.

Auth protects both the REST API and the live WebSocket stream.

## Kill switch

To stop everything instantly: set `LIVE_TRADING_ENABLED=false` and restart, or
`POST /api/engine/stop`, or just stop the process. The daily-drawdown breaker
also auto-halts new trades if losses exceed `MAX_DAILY_DRAWDOWN_PCT`.
