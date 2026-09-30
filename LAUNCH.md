# 🚀 SAINT CORE — Launch Runbook (Paper → Live → Scale)

**Goal:** give you the best realistic shot at coming out ahead, and make it
*impossible* to blow up your account on a single bad day.

Read the honesty section first. It's the most valuable part.

---

## 0. The honest truth (read this)

- **No system can guarantee profit.** Not this one, not a hedge fund's. Crypto is
  volatile, partly random, and adversarial. Anyone promising guaranteed returns is
  lying.
- **What actually decides winners vs. blow-ups** is not the strategy — it's:
  1. Proving an edge exists *before* risking money (walk-forward validation).
  2. Risk control small enough that no single day can wreck you.
  3. Starting tiny with real money and scaling only on proven results.
  4. Discipline — letting the rules and kill-switch do their job.
- **This dashboard runs on `SIM` data in an offline sandbox.** Real prices only
  flow when you run it on a machine with internet (your PC or a VPS). Validate
  and paper-trade *there*, not in the sandbox.
- **Only trade money you can afford to lose entirely.** Treat Phase 2 tuition, not
  income.

If you internalize only one thing: **survival > returns.** You can't compound if
you're wiped out.

---

## Phase 0 — Validate the edge (before anything else)

On a machine with internet:

```bash
git clone <your-repo> && cd Saint-Dashboard
npm install
npm run validate            # walk-forward on every strategy over REAL history
```

You'll get a ranked table with a **Robust YES/✅ or NO/⚠** verdict per strategy.

- ✅ **A strategy passes** (robust + positive out-of-sample) → note its name.
- ⚠ **Nothing passes** → **do not go live.** Staying flat is a valid position.
  Try a different `TRADE_UNIVERSE`, more bars, or wait for a friendlier regime.

Then lock in and persist the best parameters for the winner:

```bash
node scripts/optimize.js momentum 800     # saves best params -> data/strategy_params.json
```

The engine **auto-loads** those tuned params on every boot
(`[ENGINE] Loaded tuned params for: momentum`).

> On synthetic sandbox data, momentum passes and mean-reversion/ensemble don't —
> because synthetic data trends. **Real data will differ**; that's exactly why you
> re-run `npm run validate` on the VPS.

---

## Phase 1 — Paper trade on REAL data (1–3 weeks)

Prove the *live* system behaves like the backtest before risking a cent.

1. Pick a risk profile and copy it into `.env`:
   ```bash
   cp presets/conservative.env .env        # recommended starting point
   # edit STARTING_EQUITY to your intended real deposit
   ```
2. Deploy somewhere with internet + uptime (see `DEPLOY.md` — Docker or systemd).
   ```bash
   npm run docker:up        # or: node server.js
   ```
3. Open the dashboard. Confirm the top badge reads **LIVE data** (not SIM) — that
   proves real prices are flowing.
4. Let it run in **PAPER** mode. Check the **📊 Analytics** page regularly:
   - Is the win rate / profit factor holding up like the backtest?
   - Is max drawdown within what you can stomach?
   - Do the closed trades make sense?

**Gate to Phase 2:** several weeks of paper results that broadly match your
walk-forward numbers, and drawdown you're emotionally OK with. If paper loses
money, **do not go live** — fix or stop.

---

## Phase 2 — Go live with a TINY stake (the careful part)

Only after Phase 1 passes. Start with an amount whose total loss wouldn't hurt
(e.g. **$100–300**), regardless of how much you eventually plan to trade.

### 2a. Exchange setup (read-only first)
1. Create API keys on your exchange (**Coinbase**, **Kraken**, or **Binance.US**).
2. **Disable withdrawals** on the key. Enable only *view* + *trade*. Never a key
   that can move funds off the exchange.
3. IP-allowlist the key to your VPS IP if the exchange supports it.
4. Put the keys in `.env` and first verify **read-only**:
   ```bash
   curl "http://localhost:3000/api/exchanges/balances?venue=coinbase"
   ```
   You should see your real balances. No orders are placed by this.

### 2b. Arm live trading (triple-gated on purpose)
Live orders are refused unless **all three** are true (`config.canTradeLive()`):

```env
MODE=LIVE
LIVE_TRADING_ENABLED=true
LIVE_TRADING_CONFIRM=I ACCEPT THE RISK
```

Keep the **conservative** risk caps. Deposit only your tiny stake. Restart.

### 2c. Watch it like a hawk for the first days
- Confirm the first few live fills match intended size and price.
- Confirm the **daily-drawdown halt** works (it auto-stops trading at your
  `MAX_DAILY_DRAWDOWN_PCT`).
- Keep the **kill-switch** handy (below).

**Gate to Phase 3:** 2–4 weeks of live results that match paper. Real slippage and
fees always make live slightly worse than paper — make sure it's still positive
after that friction.

---

## Phase 3 — Scale deliberately

- Increase capital in **steps** (e.g. 2×), never all at once.
- Re-run `npm run validate` periodically — edges decay as regimes change.
- Consider loosening from `conservative.env` → `balanced.env` only once live
  results justify it. **Aggressive is for later, if ever.**
- Add more capital *after* a step proves out, not before.

---

## 🔴 Kill switch — stop everything, instantly

Any one of these halts live trading:

```bash
# Fastest: flip the flag and restart
#   set LIVE_TRADING_ENABLED=false in .env, then:
npm run docker:down        # or Ctrl-C / stop the process

# Or via the running engine:
curl -X POST http://localhost:3000/api/engine/stop
```

The system **also halts itself automatically** when the daily drawdown limit is
hit. To flatten to cash and reset the paper book: `POST /api/portfolio/reset`.

---

## Risk profiles at a glance (`presets/`)

| Setting | twenty-usdc | conservative | balanced | aggressive |
|---|---|---|---|---|
| Max per coin | 100% | 10% | 20% | 30% |
| Max deployed | 100% | 40% | 60% | 80% |
| Daily halt at | −10% | −5% | −10% | −15% |
| Risk / trade | 5% | 1% | 2% | 3% |
| Min confidence | 0.72 | 0.65 | 0.55 | 0.50 |
| Min trade | $5 | $10 | $10 | $10 |

**`twenty-usdc`** is tuned for a ~$20 account: it *concentrates* into the single best
coin (you can't diversify $20 without fees eating you), trades only on strong signals,
and uses a 3-coin liquid universe. Start conservative once you scale up; earn the right
to loosen.

---

## Pre-flight checklist (before real money)

- [ ] `npm run validate` shows a **robust ✅** strategy on **real** data
- [ ] Best params persisted (`data/strategy_params.json` exists)
- [ ] Weeks of **paper** on real data ≈ backtest, drawdown tolerable
- [ ] Dashboard badge shows **LIVE data**
- [ ] API key is **trade-only, withdrawals disabled**, IP-allowlisted
- [ ] Read-only `/api/exchanges/balances` returns your real balances
- [ ] `.env` uses **conservative** caps; deposit is a **tiny** stake
- [ ] `DASHBOARD_PASSWORD` set (dashboard is exposed to the internet)
- [ ] You know the kill switch and have tested the daily-drawdown halt
- [ ] You've decided, in advance, the loss level at which you stop entirely

---

## Common commands

```bash
npm run validate                 # which strategy is actually robust?
node scripts/optimize.js momentum 800   # tune + persist best params
npm test                         # 20-check self-test
npm run docker:up                # deploy (Docker)
npm run docker:logs              # tail logs
curl -X POST localhost:3000/api/engine/stop     # pause trading
```

**Trade safe. Survive first. Compound second.**
