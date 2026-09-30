/* ============================================================
   SAINT / OMNIVEX DASHBOARD SERVER  (v2)
   Real market data + signals + risk + paper execution + memecoin
   radar, with a hard-gated live-trading path. Serves the dashboard
   and streams live state over WebSocket.
   ============================================================ */

const path = require("path");
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const config = require("./config");
const Engine = require("./src/engine/engine");
const Backtester = require("./src/backtest/backtester");
const Optimizer = require("./src/backtest/optimizer");
const { buildSeries } = require("./src/backtest/history");
const analytics = require("./src/analytics/analytics");
const strategyFacade = require("./src/signals/strategy");
const Auth = require("./src/auth/auth");
const log = require("./src/util/logger");

const app = express();
app.use(express.json());

const auth = new Auth(config);
const engine = new Engine(config);

// ---------------- Auth (login is public) ----------------
app.post("/api/login", (req, res) => {
  if (!auth.enabled) return res.json({ token: null, note: "auth disabled" });
  const { user, password } = req.body || {};
  if (!auth.checkCredentials(user, password)) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  const token = auth.issueToken(user);
  res.setHeader(
    "Set-Cookie",
    `saint_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200`
  );
  res.json({ token });
});

app.get("/api/auth/status", (req, res) =>
  res.json({ authEnabled: auth.enabled, authed: auth.isAuthed(req) })
);

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", "saint_session=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

// Protect everything except health, login, and the login page itself.
app.use(auth.middleware(["/api/health", "/api/login", "/api/auth/status", "/login.html", "/favicon.ico"]));

// Static assets (served only after the auth gate)
app.use(express.static(path.join(__dirname, "public")));

// ---------------- REST API ----------------
app.get("/api/health", (req, res) => {
  res.json({
    system: "OMNIVEX / SAINT CORE",
    version: "2.0.0",
    status: "ONLINE",
    mode: config.mode,
    liveArmed: config.canTradeLive(),
    dataSource: engine.market.source,
    cycle: engine.cycle,
    running: engine.running,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/state", (req, res) => res.json(engine.snapshot()));

app.post("/api/tick", async (req, res) => {
  try {
    res.json(await engine.tick());
  } catch (e) {
    res.status(500).json({ error: "TICK_FAILED", message: e.message });
  }
});

app.get("/api/signals", (req, res) => res.json(engine.snapshot().signals));
app.get("/api/portfolio", (req, res) => res.json(engine.paper.snapshot(engine.prices())));
app.get("/api/memecoins", (req, res) => res.json(engine.scanner.snapshot()));
app.get("/api/chronicle", (req, res) => res.json(engine.chronicle.slice(-50).reverse()));

// Exchange connectivity (read-only)
app.get("/api/exchanges/health", async (req, res) => {
  try {
    res.json(await engine.exchanges.healthCheck());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/exchanges/balances", async (req, res) => {
  try {
    res.json(await engine.exchanges.getBalances(req.query.venue));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Backtest the live strategy over historical data
let _btCache = null;
app.post("/api/backtest", async (req, res) => {
  try {
    const bars = Math.min(1000, Math.max(80, Number(req.body?.bars || 400)));
    const gran = Number(req.body?.granularity || 3600);
    const { series, source, bars: n } = await buildSeries(config.universe, bars, gran);
    const bt = new Backtester(config);
    const result = bt.run(series, { rebalanceEvery: Number(req.body?.rebalanceEvery || 1) });
    _btCache = { ...result, source, requestedBars: bars, granularity: gran, ranAt: Date.now() };
    res.json(_btCache);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.get("/api/backtest/last", (req, res) => res.json(_btCache || { note: "no backtest run yet" }));

// List available strategies
app.get("/api/strategies", (req, res) => {
  const { registry } = require("./src/signals/strategy");
  res.json({ active: config.strategy, ensembleMembers: config.ensembleMembers, available: registry.list() });
});

// Optimize a strategy's parameters (grid search). Persists + applies best
// params to the live engine unless {apply:false}.
app.post("/api/optimize", async (req, res) => {
  try {
    const strategy = (req.body?.strategy || config.strategy || "momentum").toLowerCase();
    const bars = Math.min(1000, Math.max(120, Number(req.body?.bars || 500)));
    const { series, source, bars: n } = await buildSeries(config.universe, bars, Number(req.body?.granularity || 3600));
    const opt = new Optimizer(config);
    const result = opt.gridSearch(series, strategy, {});
    let applied = false;
    if (result.best && req.body?.apply !== false) {
      strategyFacade.paramStore.setBest(strategy, result.best.params, {
        source, bars: n, fitness: result.best.fitness, method: "gridSearch",
      });
      strategyFacade.setParams(strategy, result.best.params);
      applied = true;
    }
    res.json({ ...result, source, bars: n, applied });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Trade journal (closed round-trip trades)
app.get("/api/journal", (req, res) => {
  const n = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  res.json({ count: engine.paper.trades.length, trades: engine.paper.trades.slice(-n).reverse() });
});

// Analytics computed from the journal + equity curve
app.get("/api/analytics", (req, res) => {
  res.json(analytics.compute(engine.paper.trades, engine.paper.equityCurve, engine.paper.startingEquity));
});

// Currently-active tuned params + saved param store
app.get("/api/params", (req, res) => {
  res.json({ active: strategyFacade.activeParams(), stored: strategyFacade.paramStore.load() });
});

// Walk-forward validation (guards against curve-fitting)
app.post("/api/walkforward", async (req, res) => {
  try {
    const strategy = (req.body?.strategy || config.strategy || "momentum").toLowerCase();
    const bars = Math.min(1500, Math.max(240, Number(req.body?.bars || 800)));
    const { series, source, bars: n } = await buildSeries(config.universe, bars, Number(req.body?.granularity || 3600));
    const opt = new Optimizer(config);
    const result = opt.walkForward(series, strategy, { folds: Number(req.body?.folds || 4) });
    res.json({ ...result, source, bars: n });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// On-chain wallet: status, read-only quote, and gated swap
app.get("/api/wallet/status", (req, res) => res.json(engine.wallet.status()));

app.post("/api/wallet/quote", async (req, res) => {
  try {
    const { chain, tokenAddress, sellToken } = req.body || {};
    const usd = Number(req.body?.usd || config.wallet.maxSwapUsd);
    const amountRaw = String(Math.floor(usd * 1e6)); // USDC has 6 decimals
    const q = await engine.wallet.quote({ chain, tokenAddress, amountRaw, sellToken });
    res.json({ usd, ...q });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/wallet/swap", async (req, res) => {
  try {
    const { chain, tokenAddress, sellToken } = req.body || {};
    const usd = Number(req.body?.usd || config.wallet.maxSwapUsd);
    const amountRaw = String(Math.floor(usd * 1e6));
    const result = await engine.wallet.swap({
      chain,
      tokenAddress,
      amountRaw,
      sellToken,
      usdNotional: usd,
    });
    res.json({ ok: true, usd, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Alerts: status + send a test message through configured channels
app.get("/api/alerts/status", (req, res) => res.json(engine.notifier.status()));
app.post("/api/alerts/test", async (req, res) => {
  try {
    const r = await engine.notifier.send(
      "✅ *SAINT CORE test alert* — your notification channel is working."
    );
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Reset the paper portfolio to starting equity (clears persisted state)
app.post("/api/portfolio/reset", (req, res) => {
  engine.paper.reset();
  res.json({ ok: true, ...engine.paper.snapshot(engine.prices()) });
});

// Engine control
app.post("/api/engine/start", (req, res) => {
  engine.start();
  res.json({ ok: true, running: engine.running });
});
app.post("/api/engine/stop", (req, res) => {
  engine.stop();
  res.json({ ok: true, running: engine.running });
});

// ---------------- WebSocket live stream ----------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  if (!auth.verifyWs(req)) {
    ws.send(JSON.stringify({ type: "error", error: "unauthorized" }));
    ws.close();
    return;
  }
  ws.send(JSON.stringify({ type: "state", data: engine.snapshot() }));
});

engine.onUpdate((state) => {
  const payload = JSON.stringify({ type: "state", data: state });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
});

// ---------------- Boot ----------------
server.listen(config.port, "0.0.0.0", () => {
  log.info("SERVER", `SAINT CORE online on 0.0.0.0:${config.port}`);
  log.info("SERVER", `Mode=${config.mode}  LiveArmed=${config.canTradeLive()}  Testnet=${config.useTestnet}`);
  if (config.canTradeLive()) {
    log.warn("SERVER", "!!! LIVE TRADING IS ARMED — real orders can be placed !!!");
  } else {
    log.info("SERVER", "Live trading DISARMED — running safe PAPER mode.");
  }
  log.info("SERVER", auth.enabled ? "Dashboard auth ENABLED (login required)." : "Dashboard auth DISABLED — set DASHBOARD_PASSWORD before exposing to a network.");
  log.info("SERVER", engine.notifier.enabled ? `Alerts active via: ${engine.notifier.channels.join(", ")}` : "Alerts inactive (no Telegram/Discord configured).");
  engine.start(5000);
});
