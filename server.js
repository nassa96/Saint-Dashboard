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
const SyntheticValidator = require("./src/backtest/syntheticValidator");
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
app.get("/api/volatility", (req, res) => res.json(engine.lastVolatility || {}));
app.get("/api/portfolio", (req, res) => res.json(engine.paper.snapshot(engine.prices())));
app.get("/api/memecoins", (req, res) => res.json(engine.scanner.snapshot()));
app.get("/api/capital-ring", (req, res) =>
  res.json({
    enabled: engine.capitalRing.enabled,
    shieldPct: engine.capitalRing.shieldPct,
    spearPct: engine.capitalRing.spearPct,
    spearStrategies: engine.capitalRing.spearStrategies,
    spearHalted: engine.capitalRing.spearHalted,
    spearHaltUntil: engine.capitalRing.spearHaltUntil ? new Date(engine.capitalRing.spearHaltUntil).toISOString() : null,
    lastPools: engine.lastPools || null,
    lastSpearRisk: engine.lastSpearRisk || null,
  })
);
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

// Aggregated balances across ALL venues at once (the multi-venue view)
app.get("/api/exchanges/balances/all", async (req, res) => {
  try {
    res.json(await engine.exchanges.getAllBalances());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Connect a venue at runtime (save TRADE-scoped keys + verify). Read-only test;
// never enables live trading. Keys land in data/credentials.json (git-ignored).
app.post("/api/exchanges/connect", async (req, res) => {
  try {
    const { venue, key, secret, passphrase } = req.body || {};
    if (!venue || !key || !secret) return res.status(400).json({ error: "venue, key and secret are required" });
    res.json(await engine.exchanges.connect(venue.toLowerCase(), { key, secret, passphrase: passphrase || "" }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/exchanges/disconnect", (req, res) => {
  try {
    const venue = (req.body?.venue || "").toLowerCase();
    if (!venue) return res.status(400).json({ error: "venue is required" });
    res.json(engine.exchanges.disconnect(venue));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// HyperLiquid — monitor-only by default (reads need just a public address).
// Manual leveraged order placement is a SEPARATE, explicitly-invoked action,
// never called by the automatic rotation loop. Still requires full live-arm.
app.post("/api/hyperliquid/order", async (req, res) => {
  try {
    const { symbol, side, quantity, limitPrice, reduceOnly } = req.body || {};
    if (!symbol || !side || !quantity || !limitPrice) {
      return res.status(400).json({ error: "symbol, side, quantity, limitPrice are required" });
    }
    const result = await engine.exchanges.placeManualLeveragedOrder({
      symbol, side, quantity, limitPrice, reduceOnly,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Live trading arm / disarm (the one-click kill switch) ----
app.get("/api/live/status", (req, res) => {
  const s = config.liveStatus();
  res.json({
    ...s,
    authEnabled: auth.enabled,
    primaryConnected: engine.exchanges.venues[s.primary]?.hasCredentials() || false,
  });
});

app.post("/api/live/arm", (req, res) => {
  try {
    const primary = config.exchanges.primary;
    const connected = engine.exchanges.venues[primary]?.hasCredentials();
    if (!connected) {
      return res.status(400).json({ error: `Connect ${primary} API keys before arming live trading.` });
    }
    config.armLive(req.body?.confirm || "");
    const warnings = [];
    if (config.useTestnet) warnings.push("USE_TESTNET is true — orders go to the TESTNET, not real markets. Set USE_TESTNET=false for real trading.");
    if (!auth.enabled) warnings.push("DASHBOARD_PASSWORD is not set — anyone who can reach this page can control live trading. Set it now.");
    log.warn("SERVER", "LIVE TRADING ARMED via dashboard");
    res.json({ ...config.liveStatus(), warnings });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/live/disarm", (req, res) => {
  config.disarmLive();
  log.warn("SERVER", "LIVE TRADING DISARMED via dashboard");
  res.json(config.liveStatus());
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

// Stage 2 cold-start gate: block-bootstrap synthetic path validation.
// Runs are capped here for HTTP responsiveness — the underlying module
// defaults to the full spec'd 10,000 runs when called directly/offline;
// this endpoint trades that down for a request that actually returns.
app.post("/api/validate/synthetic", async (req, res) => {
  try {
    const bars = Math.min(1000, Math.max(80, Number(req.body?.bars || 400)));
    const gran = Number(req.body?.granularity || 3600);
    const runs = Math.min(2000, Math.max(20, Number(req.body?.runs || 200)));
    const { series } = await buildSeries(config.universe, bars, gran);
    const validator = new SyntheticValidator(config);
    const result = validator.validate(series, {
      runs,
      blockSize: Number(req.body?.blockSize || 10),
      sortinoThreshold: Number(req.body?.sortinoThreshold || 1.8),
      passRateThreshold: Number(req.body?.passRateThreshold || 0.95),
      strategy: req.body?.strategy,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

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

// Fully read-only balance lookup for ANY public address — no key, no
// signature, no approval. Pairs with the browser wallet-connect button
// (MetaMask/Coinbase Wallet/Trust Wallet/Phantom) which only ever asks for
// the public address, never a signature, until an explicit swap happens.
const addressLookup = require("./src/wallet/addressLookup");
app.post("/api/wallet/lookup", async (req, res) => {
  try {
    const { chain, address } = req.body || {};
    res.json(await addressLookup.lookup(chain, address, { config }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

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

// Read-only MEV/sandwich-exposure assessment — safe to call anytime, never moves funds.
app.post("/api/wallet/assess", async (req, res) => {
  try {
    const { chain, tokenAddress, sellToken } = req.body || {};
    const usd = Number(req.body?.usd || config.wallet.maxSwapUsd);
    const amountRaw = String(Math.floor(usd * 1e6));
    const result = await engine.wallet.assessSwap({ chain, tokenAddress, amountRaw, sellToken, usdNotional: usd });
    res.json({ usd, ...result });
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

// DNFH (delta-neutral funding harvest): HyperLiquid long-spot/short-perp
// funding capture. Manual/cross-venue by design — never part of the
// auto-rotation loop. scan() is fully read-only; plan() is pure math; only
// execute() moves real funds, and only once both the live-arm AND the
// on-chain-swap arm are active.
app.get("/api/dnfh/scan", async (req, res) => {
  try {
    const minAnnualPct = Number(req.query?.minAnnualPct || 0);
    res.json(await engine.dnfh.scan({ minAnnualPct }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/avss/scan", async (req, res) => {
  try {
    res.json(await engine.avss.scan());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/dnfh/rebalance-check", async (req, res) => {
  try {
    const { symbol, spotPx, perpPx } = req.query || {};
    if (!symbol) throw new Error("symbol is required");
    res.json(engine.dnfh.checkRebalanceTriggers(symbol, { spotPx: Number(spotPx), perpPx: Number(perpPx) }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/dnfh/plan", async (req, res) => {
  try {
    const { symbol, usdNotional, chain, spotTokenAddress, sellToken, leverage } = req.body || {};
    const plan = await engine.dnfh.planPosition({ symbol, usdNotional, chain, spotTokenAddress, sellToken, leverage });
    res.json(plan);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/dnfh/execute", async (req, res) => {
  try {
    const { plan, spotAmountRaw, perpQuantity, perpLimitPrice } = req.body || {};
    const result = await engine.dnfh.execute(plan, { spotAmountRaw, perpQuantity, perpLimitPrice });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Macro risk-appetite overlay (Fear & Greed + global market-cap trend) —
// fully read-only, cached. Used internally to throttle (never boost)
// deployed capital; exposed here too so the dashboard can show it.
const macroFlow = require("./src/intelligence/flow");
app.get("/api/intelligence/flow", async (req, res) => {
  try {
    res.json(await macroFlow.getFlow({ forceRefresh: req.query?.refresh === "1" }));
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
