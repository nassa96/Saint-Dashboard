# ☁️ Deploy SAINT CORE to Render

> **Status: not deployed yet.** This repo now ships a Render blueprint
> (`render.yaml`). Follow the steps below and you'll have a live URL. Nothing is
> running on Render until you do this — the preview you've seen so far is the dev
> sandbox, which has no internet and stays on simulated data.

Render is a good fit: it runs your Node server 24/7, gives you an HTTPS URL, and
reads `render.yaml` automatically.

---

## Before you start
- A **Render account** (render.com) — free to create.
- This repo on **GitHub** (it already is: `nassa96/Saint-Dashboard`).
- Your **Coinbase Advanced Trade / CDP Secret API Key**: ECDSA key with View + Trade, withdrawals/transfers disabled, plus the exact portfolio UUID. The Connections page accepts these directly.

---

## Step 1 — Create the service from the blueprint
1. In Render: **New +** → **Blueprint**.
2. Connect your GitHub and pick **`nassa96/Saint-Dashboard`**.
3. Render detects `render.yaml` and shows a service called **saint-core**.
4. Click **Apply**. Render starts the first build (`npm install` → `node server.js`).

> ⚠ **Plan note:** the blueprint uses the **Starter** plan so the bot runs 24/7.
> The **Free** plan *sleeps after ~15 min idle* — a sleeping bot places no trades
> and misses signals. If you deploy on Free to test, expect that. The persistent
> **disk** (for `data/`) also requires a paid instance; on Free, remove the `disk:`
> block from `render.yaml` (your portfolio/keys then reset on each redeploy).

---

## Step 2 — Set your secrets (the `sync: false` vars)
In the service's **Environment** tab, fill the values Render left blank:

| Variable | What to set |
|---|---|
| `DASHBOARD_PASSWORD` | **Required.** A strong password — this protects your whole dashboard, including the live-trading arm button. |
| `COINBASE_API_KEY_NAME` / `COINBASE_API_KEY_SECRET` / `COINBASE_PORTFOLIO_UUID` | Coinbase CDP Advanced Trade credentials: key name, ECDSA private-key PEM, and exact portfolio UUID. Keep withdrawals/transfers disabled. |

`SESSION_SECRET` is auto-generated. Click **Save, rebuild** if prompted.

---

## Step 3 — Open your live dashboard
Render gives you a URL like `https://saint-core.onrender.com`.

1. Open it → log in with `DASHBOARD_PASSWORD`.
2. Confirm the market badge shows **LIVE data** (Render has internet, so real
   prices flow — unlike the dev sandbox).
3. Go to **🔌 Connect** → connect Coinbase (if you didn't set keys in Step 2) →
   **Save & verify**. You should see *reachable* + *balancesOk*.

---

## Step 4 — Paper first, then arm (do NOT skip)
1. Leave it in **PAPER** mode (the default) for a couple of weeks. Watch the
   **📊 Analytics** page — make sure live behavior matches your backtest.
2. When you're ready for real money:
   - In Render env, set **`USE_TESTNET=false`** (real markets) and redeploy.
   - Fund your Coinbase account (your $20 USDC).
   - On **🔌 Connect → ⚡ Live trading**, type `I ACCEPT THE RISK` and **Arm**.
3. The **Disarm** button (or the daily-drawdown halt) stops live trading instantly.

---

## How the pieces map to Render
| Concern | Handled by |
|---|---|
| Port | Server honors `process.env.PORT`, binds `0.0.0.0` ✅ |
| Health check | `GET /api/health` (set in `render.yaml`) |
| Persistence | Disk mounted at `.../project/src/data` keeps `portfolio.json`, `credentials.json`, `live_arm.json` |
| Secrets | `sync: false` vars set in the Render UI, never in git |
| Auto-deploy | On by default — pushes to your branch redeploy automatically |

---

## Troubleshooting
- **Build fails:** check the Node version (blueprint pins `NODE_VERSION=20`).
- **App sleeps / stops trading:** you're on the Free plan — upgrade to Starter.
- **Dashboard loads but "SIM" data:** exchange host unreachable from your region,
  or keys missing — check the Connections page status.
- **Lost portfolio after redeploy:** you're missing the persistent disk (Free plan).
- **Can't arm live:** connect your primary exchange keys first; the arm endpoint
  refuses until the primary venue has credentials.

See **`LAUNCH.md`** for the full paper → live → scale runbook and **`VENUES.md`**
for multi-venue + fee details.
