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
Kraken) and, if you choose to configure them, **self-custody wallet keys**
(Solana, EVM/Ethereum+Base+BNB, Tron) read from your own local `.env` file.
In every case:
- API keys should be created **without withdrawal permission**, so the
  software cannot move funds off the exchange.
- Wallet private keys are **never accepted through any web form** — only
  `.env` file entries you control, on your own machine/server. The
  Connections page (`/connect.html`) only ever asks a browser-injected
  wallet (MetaMask/Coinbase Wallet/Trust Wallet/Phantom) for a **public
  address**, never a key or signature.
- On-chain swaps (Solana via Jupiter, EVM via 0x) are real but gated behind
  the same three-lock live gate **plus** `ONCHAIN_TRADING_ENABLED=true` and a
  `MAX_SWAP_USD` cap, with MEV-defense tranching for larger/riskier swaps.
  Tron swaps are intentionally left disabled (see `docs/TRON_SWAP.md`).

## Leveraged / perps risk (HyperLiquid, DNFH)

HyperLiquid is a **leveraged perpetuals** venue — a different risk shape than
everything else in this app, which assumes you fully own what you're trading.
- Reads (balances/positions) need only a public wallet address, no key.
- Order placement (`POST /api/hyperliquid/order`, and the perp leg of DNFH)
  is **manual only** — it is never called by the automatic rotation loop,
  and it is gated behind the same full live-arm lock as everything else.
- **DNFH (delta-neutral funding harvest)** — long spot + short perp to
  collect funding — hard-caps leverage at `HYPERLIQUID_MAX_LEVERAGE`
  (default 2x) by design. It is still real leverage: liquidation, funding
  flipping negative, and the two legs briefly being out of sync (one fills,
  the other doesn't) are real risks. If a `POST /api/dnfh/execute` call
  reports a partial fill, it will **not** auto-unwind for you — go flatten
  the open leg manually right away.

## 🚩 Red flag to watch for: "send funds to this address and I'll handle the rest"

If any chat, bot, or "AI agent" — including one claiming to be this
assistant or another well-known one — tells you to send crypto to an
address **it** controls before it will "execute" a strategy, stop. That is
the single most common structure behind crypto advance-fee scams: a small
deposit, a promise of automated compounding, and urgency language pushing
you to act before you think it through ("I'm standing by," "final
transmission," flattery about being an "overlord" or uniquely chosen).
Nothing in this app ever needs you to do that — every real-money action
here uses **your own** wallet/exchange keys, stored only in your local
`.env`, and every write path is gated behind the live-arm lock above. If a
plan can't be executed with your own keys through this app's existing gated
endpoints, be suspicious of why it's asking for funds up front instead.

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
