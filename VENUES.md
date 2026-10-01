# 🌐 Multi-Venue Guide — spreading SAINT CORE across exchanges

The engine is built to run across **every** venue, not just one. This explains
what's wired up, the real fee/capital math, and how to add more venues.

---

## What's already built

| Capability | Status |
|---|---|
| Adapters for **Coinbase**, **Binance.US**, **Kraken** | ✅ `src/exchange/*.js` |
| **HyperLiquid** (perps DEX) | ✅ monitor-only — `src/exchange/hyperliquid.js` |
| **On-chain**: Solana (Jupiter), EVM/Ethereum+Base+BNB Chain (0x), Tron (reads only) | ✅ `src/wallet/*.js` |
| Health-check all venues at once | ✅ `GET /api/exchanges/health` |
| Read-only balances, per venue | ✅ `GET /api/exchanges/balances?venue=kraken` |
| **Aggregated balances across ALL venues** | ✅ `GET /api/exchanges/balances/all` |
| Route a live order to any named venue | ✅ `manager.routeLiveOrder(order, venue)` |
| **Fee-aware sizing** (knows each venue's fees) | ✅ `config.venueFees`, `config.roundTripFeePct()` |
| Single kill-switch gating every venue | ✅ `config.canTradeLive()` |

Pick your active venue with `PRIMARY_EXCHANGE=coinbase|binanceus|kraken`.

### HyperLiquid — monitor-only, by design
HyperLiquid is a **leveraged perpetuals** DEX, not spot — a fundamentally
different risk model than "buy/sell a % of equity in an asset you fully
own," which is what the automatic rotation engine assumes everywhere else.
So it's wired for:
- **Reads**: set `HYPERLIQUID_WALLET_ADDRESS` (just the public address — no
  key of any kind) and the dashboard shows your perp equity, margin used,
  and open positions via HyperLiquid's public `/info` endpoint.
- **Manual orders only**: `POST /api/hyperliquid/order` places a real
  leveraged order, gated behind the full live-arm lock, but it is **never**
  called automatically by the rotation loop. If you generate a dedicated
  trade-only "API wallet" key in HyperLiquid's UI (never your main wallet's
  key) and set `HYPERLIQUID_API_PRIVATE_KEY`, you can use this endpoint
  yourself — deliberately, one order at a time.

### Tron — reads work, swaps intentionally disabled
Set `TRON_ADDRESS` (a public address — no key needed) and balance reads work
immediately via TronGrid's public API. Swaps are refused with a clear error:
no officially-documented, no-middleman-commission Tron DEX aggregator API
was available to wire up responsibly at build time. See `docs/TRON_SWAP.md`
for exactly what's needed to turn them on once you've picked a provider you trust.

### DNFH — Delta-Neutral Funding Harvest (manual, cross-venue, hard-capped)
A real strategy, not an auto-traded one: hold **spot LONG on Base** and an
equal-notional **perp SHORT on HyperLiquid** at the same time, so net price
exposure is ~0 — you collect the funding payment perp longs pay shorts
whenever funding is positive, independent of which way price moves.
- `GET /api/dnfh/scan` — read-only, ranks live HyperLiquid funding rates by
  annualized yield. Only positive-funding symbols are "harvestable"; this
  module does not support short-spot, so negative-funding symbols are
  filtered out rather than guessed at.
- `POST /api/dnfh/plan` — pure math, no funds move. **You must supply the
  exact spot token contract address yourself** (verified against the
  project's own docs or a verified block-explorer entry) — this module will
  never guess a contract address for you; getting that wrong with real
  money means buying the wrong asset.
- `POST /api/dnfh/execute` — moves real funds on both legs. Requires the
  full live-arm gate **and** `ONCHAIN_TRADING_ENABLED=true`. Leverage is
  hard-capped at `HYPERLIQUID_MAX_LEVERAGE` (default 2x) — this is a yield
  tool, not a place to stack directional risk. If the perp leg fails after
  the spot leg already filled, it does **not** silently auto-unwind (that's
  itself a real trade) — it returns a loud partial-fill warning so a human
  decides the next move.

### Easiest way to connect: the Connections page
Open **`/connect.html`** (🔌 Connect in the dashboard header). For each venue you get
a status badge (keys saved? reachable?), the fee schedule, and a form to paste your
**trade-only** API key/secret (+ passphrase for Coinbase). Hit **Save & verify** and it
saves to `data/credentials.json` (git-ignored) and runs a read-only reachability +
balance check. **Disconnect** wipes them. Live trading stays off regardless — connecting
only enables read-only access until you deliberately arm it.

> Wallet **private keys** are intentionally *not* accepted through the web form (they
> control all your funds). Set `SOLANA_PRIVATE_KEY` / `EVM_PRIVATE_KEY` / `TRON_PRIVATE_KEY`
> / `HYPERLIQUID_API_PRIVATE_KEY` in `.env`; the Connections page shows their status.
>
> The same page also has a **"Connect a wallet from your browser"** section that asks
> MetaMask/Coinbase Wallet/Trust Wallet/Phantom for your **public address only** —
> no signature, no key, no seed phrase, ever — just to look up a balance.

---


## Real fees (entry tier, 2025–2026 published schedules)

| Venue | Maker | Taker | Round-trip (taker×2) | Notes |
|---|---|---|---|---|
| **Binance.US** | 0.10% | 0.10% | **0.20%** | Cheapest by far; limited US-state availability |
| **Coinbase Advanced** | 0.40% | 0.60% | **1.20%** | Use *Advanced*, not the one-tap app |
| **Kraken Pro** | 0.40% | 0.80% | **1.60%** | Repriced July 2025; pricier taker |

> ⚠ The **one-tap Coinbase app** charges a **flat $0.99 on orders under $10**
> (plus a ~0.5% spread) — that's ~50% on a $2 trade. Always use **Coinbase
> Advanced Trade** (same login, free) so you pay 0.60% instead.

Sources: Coinbase/Kraken/Binance.US published fee schedules (see fee research in
project history). The engine stores these in `config.venueFees` and refuses to
place any trade smaller than `MIN_TRADE_USD` (default **$10**) so fees + exchange
minimums can't devour a small account.

---

## 💵 The honest truth about $20 (and multi-venue)

I want you to win, so here's the math straight:

**1. You cannot spread $20 across multiple venues.** Each venue is a *separate
funded account* with its own KYC, minimum deposits, and API keys. Moving money
between them costs withdrawal + network fees (often **$1–$25**), which alone would
eat most of $20. Splitting $20 three ways = ~$6.66 each, below workable size.

**2. $20 on ONE venue still struggles against fees.** A rotating multi-coin bot
does many round trips. Even on Coinbase Advanced (1.2% round trip), the strategy
must clear 1.2% *every trade* just to break even. On the pricier venues it's worse.

**3. So the plan that actually sets you up to win:**

- ✅ **Keep the $20 in Coinbase.** Don't spread it.
- ✅ **Stay in PAPER mode on real prices** (`presets/conservative.env`) and let the
  system prove itself for a few weeks — costs you $0 and teaches you everything.
- ✅ **If you want to feel a real fill:** switch to **Coinbase Advanced Trade** and
  do **one** tiny manual buy/sell to learn the mechanics. Treat it as tuition.
- ✅ **Grow the capital before going automated-live.** A sane threshold for an
  automated rotating bot is roughly **$500–$1,000+**, ideally on **Binance.US**
  (0.20% round trip) where fees barely register.
- ✅ **When you scale, the multi-venue tech is already here** — add keys for each
  venue and set `PRIMARY_EXCHANGE`, or use different venues for different assets.

Bottom line: the *technology* spreads across all venues today. The *$20* should
stay on one venue, in paper mode, until it grows. Survival first.

---

## Add a NEW venue (the "or even possible" part)

Adding Gemini, Bitstamp, OKX, Crypto.com, etc. takes three steps:

1. **Create an adapter** `src/exchange/<venue>.js` matching the shape of the
   existing ones (extend `src/exchange/base.js`). Implement:
   - `hasCredentials()` · `testConnection()` · `getBalances()` · `placeOrder(order, live)`
2. **Register it** in `src/exchange/manager.js`:
   ```js
   const Gemini = require("./gemini");
   // inside constructor:
   this.venues.gemini = new Gemini(config.exchanges.gemini, opts);
   ```
3. **Add config + fees** in `config.js`:
   ```js
   exchanges: { gemini: { key: process.env.GEMINI_API_KEY, secret: process.env.GEMINI_API_SECRET } }
   venueFees: { gemini: { maker: 0.20, taker: 0.40, label: "Gemini ActiveTrader" } }
   ```

That's it — health checks, aggregated balances, fee-aware sizing, and the
kill-switch all pick it up automatically.

---

## Quick commands

```bash
curl localhost:3000/api/exchanges/health          # reachability of every venue
curl localhost:3000/api/exchanges/balances/all    # balances across ALL venues
curl "localhost:3000/api/exchanges/balances?venue=binanceus"   # one venue
```

See **`LAUNCH.md`** for the full paper → live → scale runbook.
