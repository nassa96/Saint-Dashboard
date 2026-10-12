# SAFETY & LIVE-READINESS CHECKLIST

This repository contains code paths capable of sending **real orders**. Treat
it accordingly. No strategy can promise profit; crypto can lose the full amount
committed.

## Current release verdict: NO-GO for live funds

The supported rollout is **PAPER only**. The dashboard's `/api/live/arm`
endpoint intentionally refuses to arm because this build does not yet reconcile
exchange balances/positions, consistently confirm final/partial fills and
recover ambiguous order timeouts, or protect live positions with exchange-native
stops. A local paper ledger is not a live account ledger. Aegis's drawdown
calculation therefore is not a broker-side live-funds kill switch.

A Kraken key showing reachable or returning balances confirms only a read-only
API call. It does **not** verify order permissions, market-order semantics,
withdrawal restrictions, symbol filters, fills, or production readiness. The
new **Live funds readiness audit** (`GET /api/live/readiness`) lists these
blockers explicitly; do not bypass it or test with money.

## Defense-in-depth arm gates

If/when the remaining execution controls are implemented and independently
validated, a live session will require all of the following:

1. `TRADING_MODE=LIVE`
2. `LIVE_TRADING_ENABLED=true` (master deployment kill switch)
3. `LIVE_TRADING_CONFIRM=I ACCEPT THE RISK` (exact string)
4. A fresh in-process confirmation from the authenticated dashboard
5. Every blocking item in `/api/live/readiness` passing

The deployment locks are necessary but not sufficient. A runtime arm cannot
bypass them, a disabled master switch blocks an already-armed session, and an
arm is never restored after a process restart. `POST /api/engine/stop` also
closes the runtime arm. The current readiness report still has hard blockers,
so the API must refuse live arming.

`USE_TESTNET=true` is **not** a universal safety guarantee. This code's Kraken
spot and Binance.US connectors still target production endpoints; Coinbase
sandbox execution is not validated and its price feed remains production data.
The readiness audit calls out venue/mode mismatches.

## Supported rollout path

1. Keep all live locks OFF. Run PAPER on a host with internet and confirm every
   tracked price reads `LIVE` (never assume sandbox `SIM` prices are real).
2. Use the dashboard with password authentication, HTTPS, and restricted
   access. For a small tester group, use a private, isolated PAPER instance;
   the product currently has no per-user accounts or tenant isolation.
3. Review paper fills, fees, drawdown, logs, and validation results for multiple
   weeks. Do not infer an edge from a synthetic run or a short profitable streak.
4. Connect read-only keys only when needed to verify balances. Do not enable
   trading permissions for this release. Never paste secrets into chat.
5. Revisit live deployment only after the readiness report can pass and the
   remaining controls below are implemented and tested with venue sandboxes or
   a vendor-approved non-production environment.

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
  software cannot move funds off the exchange. Verify this setting directly
  at the venue; Saint cannot inspect key scopes from a balance response.
- Exchange keys entered through `/connect.html` are stored as plaintext in
  `data/credentials.json` on the server (git-ignored; file mode is restricted
  where the host supports it). `.env` is also supported. Treat the host and
  backups as secret-bearing systems; prefer a secrets manager for production.
- Wallet private keys are **never accepted through any web form** — only
  `.env` file entries you control, on your own machine/server. The
  Connections page (`/connect.html`) only ever asks a browser-injected
  wallet (MetaMask/Coinbase Wallet/Trust Wallet/Phantom) for a **public
  address**, never a key or signature.
- On-chain swaps (Solana via Jupiter, EVM via 0x) have real broadcast code
  gated behind the deployment locks **plus** runtime arm,
  `ONCHAIN_TRADING_ENABLED=true`, and a `MAX_SWAP_USD` cap. They are not part
  of the supported PAPER tester rollout and have not been certified here.
  Tron swaps are intentionally disabled (see `docs/TRON_SWAP.md`).

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
Nothing in this app ever needs you to do that — any eventual real-money action
must use **your own** wallet/exchange keys held on your server, and every write
path must remain behind the live-arm locks. If a plan can't be executed with
your own keys through the app's documented endpoints, be suspicious of why it
is asking for funds up front instead.

## Known limitations (be honest with yourself)

- Signals are **technical heuristics**, not forecasts. They can and will be wrong.
- Backtesting, optimization, and validation tools exist, but a backtest is not
  evidence of future returns. The app does not record an independently audited
  multi-week paper-forward approval.
- The live account is not reconciled to the local ledger; final/partial fills,
  open orders, ambiguous timeouts, exchange-specific filters, and broker-side
  protective stops are not production-certified. That is why live arming is
  currently blocked.
- `PER_TRADE_RISK_PCT` is a **per-entry notional cap**, not loss-at-risk.
  There is no exchange-native stop-loss attached to spot orders.
- The `MarketData` service reads Coinbase public spot prices. Other execution
  venues may diverge in price, liquidity, or product rules.
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

## PAPER-mode risk controls (not live-account protection)

The engine includes per-entry notional caps, volatility-regime sizing, a
market-wide stress pause, and local-ledger drawdown halts. These can reduce
PAPER exposure, but they are **not** exchange-side protection. A process stop,
network outage, stale account ledger, or unconfirmed fill can leave a real
venue position untouched. Do not infer live-funds protection from the Aegis UI.

Before any fill, the engine requires a fresh per-symbol LIVE public quote.
PAPER mode skips SIM/unknown/stale quotes without creating a fill; an armed
live request latches a safety fault, disarms, and stops on the same condition.
An ambiguous live-order error also fails closed; inspect and reconcile the
exchange manually before any restart. This local behavior still does not
replace venue-native stops.

## Kill switch

`POST /api/engine/stop` stops scheduled ticks **and disarms the runtime live
arm**. It does not cancel an order already accepted by an exchange, close an
exchange position, or guarantee an in-flight request has been canceled. To
change the deployment kill switch, set `LIVE_TRADING_ENABLED=false` and restart
the process. If the venue shows an open/unknown order, manage it directly at
the venue; do not assume the local paper book is authoritative.
