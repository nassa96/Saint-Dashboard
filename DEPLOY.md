# DEPLOY — running SAINT CORE 24/7 with real feeds

The sandbox this was built in has no outbound internet, so feeds show
**`SIM`** data there. Deploy on any host **with internet** (your PC, a VPS,
or a container platform) and it automatically switches to **`LIVE`** Coinbase
prices, real historical backtests, and the DexScreener memecoin radar.

Before anything live, read **`SAFETY.md`**. The app boots in **PAPER mode with
all live gates disarmed** — safe by default.

---

## Option 1 — Docker Compose (recommended)

```bash
git clone https://github.com/nassa96/Saint-Dashboard.git
cd Saint-Dashboard
cp .env.example .env          # edit as needed
docker compose up -d --build  # builds + runs detached, restarts on reboot
docker compose logs -f        # watch logs
```

Dashboard: `http://YOUR_HOST:3000`. The `./data` folder is mounted so the
chronicle/history survive restarts. Health is checked automatically
(`/api/health`); `docker compose ps` shows `healthy` once up.

Update & restart:
```bash
git pull && docker compose up -d --build
```

Stop:
```bash
docker compose down
```

## Option 2 — Plain Docker

```bash
docker build -t saint-core .
docker run -d --name saint-core --restart unless-stopped \
  --env-file .env -p 3000:3000 -v "$PWD/data:/app/data" saint-core
```

## Option 3 — VPS with systemd (no Docker)

```bash
# on the server (Node 18+ installed)
sudo useradd -r -m -d /opt/saint-dashboard saint || true
sudo git clone https://github.com/nassa96/Saint-Dashboard.git /opt/saint-dashboard
cd /opt/saint-dashboard
sudo -u saint npm install --omit=dev
sudo -u saint cp .env.example .env && sudo -u saint nano .env
sudo cp deploy/saint-core.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now saint-core
sudo journalctl -u saint-core -f
```

---

## Put it behind HTTPS (recommended for anything but localhost)

Use a reverse proxy (Caddy is the least effort). Example `Caddyfile`:

```
trade.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy auto-provisions TLS. The dashboard's WebSocket (`/ws`) works through
`reverse_proxy` unchanged. Nginx works too — just enable `Upgrade`/`Connection`
headers for `/ws`.

> ⚠️ This dashboard has **no authentication**. Do not expose it to the public
> internet without a proxy that adds auth (Caddy `basic_auth`, Cloudflare
> Access, a VPN, or an IP allowlist) — especially once live trading is armed.

---

## Post-deploy checklist

1. `curl http://YOUR_HOST:3000/api/health` → `"dataSource":"LIVE"`.
2. Watch PAPER performance and run `/api/backtest` on real candles.
3. Add exchange API keys (read-only first) → check `/api/exchanges/balances`.
4. Only then consider arming live trading per `SAFETY.md`.
5. Keep `.env` off version control (already gitignored) and back it up securely.
