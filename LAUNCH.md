# SAINT CORE — Controlled Test Rollout Runbook (PAPER only)

**Current release gate: NO-GO for live funds.** This build supports a private
PAPER rollout while live arming remains intentionally blocked. See
[`LIVE_READINESS.md`](LIVE_READINESS.md) for the code audit and remaining
engineering work. No controls can make a bad market or strategy risk-free.

Read the honesty section first. It's the most valuable part.

---

## 0. The honest truth (read this)

- **No system can guarantee profit.** Not this one, not a hedge fund's. Crypto is
  volatile, partly random, and adversarial. Anyone promising guaranteed returns is
  lying.
- **What actually decides winners vs. blow-ups** is not the strategy — it's:
  1. Proving an edge exists *before* risking money (walk-forward validation).
  2. Risk control small enough that no single day can wreck you.
  3. Staying in PAPER until an independently reviewed edge and execution path exist.
  4. Using operational controls honestly; a local drawdown guard is not an exchange-side kill switch.
- **This dashboard runs on `SIM` data in an offline sandbox.** Real prices only
  flow when you run it on a machine with internet (your PC or a VPS). Validate
  and paper-trade *there*, not in the sandbox.
- **Do not trade live funds from this release.** A small deposit is still real money and the current order lifecycle is not certified.

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
   cp presets/conservative.env .env        # conservative PAPER profile
   # choose a hypothetical PAPER starting equity; this is not synced to an exchange
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

**Gate to future live-readiness work:** multi-week PAPER results on real data,
reviewed alongside walk-forward results and costs. Passing that gate does not
change this release's NO-GO; the engineering blockers in `LIVE_READINESS.md`
must also be resolved.

---

## Phase 2 — Live funds are currently blocked

Do not add trade-enabled keys, deposit a test stake, or try to bypass the
readiness gate. `POST /api/live/arm` will refuse until the blockers in
[`LIVE_READINESS.md`](LIVE_READINESS.md) are resolved. A verified Kraken
balance read is not a verified order/fill path. In particular, the local PAPER
ledger is not reconciled with exchange equity/positions and there are no
exchange-native stops.

Future production work must first add and test account reconciliation,
venue-specific order filters, final/partial fill handling, duplicate/timeout
recovery, broker-side protection, a supported sandbox path, and sustained
real-data PAPER evidence. Only after that should a separate staged live pilot
be designed and reviewed.

## Phase 3 — Not applicable to this release

Capital scaling is out of scope until the live readiness report can pass and
real execution has been independently validated. A favorable backtest or a few
profitable paper trades is not authorization to scale.

## ⏸ Stop / disarm

The dashboard stop action clears scheduled engine work and closes the
in-process arm, but it cannot cancel an exchange-accepted order or flatten a
venue position. Live funds remain NO-GO in this release.

```bash
# Stop the running engine; also disarms its runtime arm
curl -X POST http://localhost:3000/api/engine/stop

# Set LIVE_TRADING_ENABLED=false in .env before any future restart.
# This is a PAPER rollout: reset only the local paper ledger if required.
curl -X POST http://localhost:3000/api/portfolio/reset
```

---

## Risk profiles at a glance (`presets/`)

| Setting | twenty-usdc | conservative | balanced | aggressive |
|---|---|---|---|---|
| Max per coin | 100% | 10% | 20% | 30% |
| Max deployed | 100% | 40% | 60% | 80% |
| Daily halt at | −10% | −5% | −10% | −15% |
| Per-entry notional cap | 5% | 1% | 2% | 3% |
| Min confidence | 0.72 | 0.65 | 0.55 | 0.50 |
| Min trade | $5 | $10 | $10 | $10 |

**`twenty-usdc` is a legacy experimental profile, not a live recommendation.**
With the current 5% per-entry notional cap, a $20 paper book caps an entry at
$1, below its $5 minimum; it will normally stay flat. Do not raise the cap just
to force fills. The Render example uses a separate hypothetical $1,000
conservative PAPER book.

---

## Private PAPER rollout checklist

- [ ] `npm test` passes (offline code checks; it is not an exchange certification)
- [ ] `DASHBOARD_PASSWORD` and a stable random `SESSION_SECRET` are configured
- [ ] HTTPS and an access restriction (VPN/IP allowlist/private network) are in place
- [ ] `TRADING_MODE=PAPER`, `LIVE_TRADING_ENABLED=false`, and on-chain swaps remain off
- [ ] No trade-enabled API keys are shared with testers; read-only keys only if necessary
- [ ] The dashboard shows fresh `DATA: LIVE` for every tracked symbol before evaluating results
- [ ] `GET /api/live/readiness` is visible and its live blockers are not bypassed
- [ ] Testers understand all users of one instance share the same book, keys, controls, and logs
- [ ] Paper fills, costs, drawdown, restarts, and feed failures are monitored

This checklist is for a controlled PAPER trial only. It is not a pre-flight for real money.

---

## Common commands

```bash
npm run validate                 # which strategy is actually robust?
node scripts/optimize.js momentum 800   # tune + persist best params
npm test                         # offline self-test
npm run docker:up                # deploy (Docker)
npm run docker:logs              # tail logs
curl -X POST localhost:3000/api/engine/stop     # pause trading
```

**Trade safe. Survive first. Compound second.**
