/* Offline self-test — validates the engine pipeline without network. */

const assert = require("assert");
const config = require("../config");
const ind = require("../src/signals/indicators");
const strategy = require("../src/signals/strategy");
const RiskManager = require("../src/risk/riskManager");
const Allocator = require("../src/portfolio/allocator");
const PaperBroker = require("../src/paper/broker");
const MemecoinScanner = require("../src/memecoin/scanner");
const Engine = require("../src/engine/engine");

let passed = 0;
const ok = (name) => { console.log("  ✓", name); passed++; };

(async () => {
  // indicators
  const rising = Array.from({ length: 60 }, (_, i) => 100 + i);
  assert(ind.sma(rising, 10) > 0, "sma");
  assert(ind.ema(rising, 12) > 0, "ema");
  assert(ind.rsi(rising, 14) > 60, "rsi rising should be high");
  assert(ind.momentum(rising, 10) > 0, "momentum positive");
  assert(ind.volatility(rising, 20) != null, "volatility");
  ok("indicators compute correctly");

  // strategy detects uptrend
  const s = strategy.evaluate(rising);
  assert(["LONG", "FLAT", "SHORT"].includes(s.signal), "signal enum");
  assert(s.signal === "LONG", "rising series should be LONG, got " + s.signal);
  assert(s.confidence >= 0 && s.confidence <= 1, "confidence bounded");
  ok("strategy generates deterministic LONG on uptrend");

  // risk manager
  const rm = new RiskManager(config);
  const a = rm.assess({ signal: "LONG", confidence: 0.8, equity: 10000, currentExposure: 0, symbolExposure: 0, price: 100 });
  assert(a.approved === true, "high-conf trade approved");
  const b = rm.assess({ signal: "LONG", confidence: 0.1, equity: 10000, currentExposure: 0, symbolExposure: 0, price: 100 });
  assert(b.approved === false, "low-conf trade rejected");
  ok("risk manager gates by confidence + exposure");

  // allocator
  const alloc = new Allocator(config);
  const { targets } = alloc.computeTargets([
    { symbol: "BTC-USD", signal: "LONG", confidence: 0.8, score: 0.6 },
    { symbol: "ETH-USD", signal: "LONG", confidence: 0.7, score: 0.4 },
    { symbol: "SOL-USD", signal: "SHORT", confidence: 0.7, score: -0.5 },
  ]);
  assert(targets["BTC-USD"] > 0, "btc allocated");
  assert(targets["SOL-USD"] === undefined, "short not allocated in spot model");
  ok("allocator rotates capital into strongest longs");

  // paper broker (persistence disabled for isolation)
  const pb = new PaperBroker(config, { persist: false });
  const fill = pb.execute({ symbol: "BTC-USD", side: "BUY", notional: 1000, price: 50000 });
  assert(fill && fill.status === "FILLED", "paper buy filled");
  const snap = pb.snapshot({ "BTC-USD": { price: 55000 } });
  assert(snap.positions.length === 1, "position tracked");
  assert(snap.positions[0].unrealizedPnl > 0, "uPnL reflects price rise");
  ok("paper broker fills + tracks PnL at real prices");

  // memecoin scanner (sim fallback path)
  const scanner = new MemecoinScanner(config);
  const scored = scanner.score({
    liquidity: { usd: 100000 }, volume: { h24: 800000, h1: 90000 },
    priceChange: { h1: 20, h24: 60 }, txns: { h1: { buys: 300, sells: 100 } },
    pairCreatedAt: Date.now() - 5 * 3.6e6,
  });
  assert(scored.score >= 0 && scored.score <= 100, "score bounded");
  assert(["STRONG", "PROMISING", "WATCH", "AVOID"].includes(scored.rating), "rating enum");
  ok("memecoin scoring produces bounded ratings + flags");

  // live gate must be OFF by default
  assert(config.canTradeLive() === false, "live trading must be disarmed by default");
  ok("live trading is DISARMED by default (safety)");

  // engine tick end-to-end (uses SIM market fallback offline)
  const engine = new Engine(config);
  const state = await engine.tick();
  assert(state.cycle === 1, "engine ticked");
  assert(state.portfolio.equity > 0, "equity present");
  assert(Array.isArray(state.signals) && state.signals.length === config.universe.length, "signals per symbol");
  ok("engine full pipeline tick completes end-to-end");

  // backtester over synthetic history
  const { syntheticCloses } = require("../src/backtest/history");
  const Backtester = require("../src/backtest/backtester");
  const series = {};
  for (const s of config.universe) series[s] = syntheticCloses(s, 200);
  const bt = new Backtester(config).run(series);
  assert(bt.bars > 0 && bt.equityCurve.length === bt.bars, "backtest produces curve");
  assert(typeof bt.sharpe === "number" && typeof bt.maxDrawdownPct === "number", "backtest metrics");
  ok("backtester runs strategy over history + reports metrics");

  // wallet gate must be OFF by default
  const WalletManager = require("../src/wallet/manager");
  const wm = new WalletManager(config);
  assert(config.canSwapOnchain() === false, "on-chain swaps disarmed by default");
  let refused = false;
  try { await wm.swap({ chain: "solana", tokenAddress: "X", amountRaw: "1", usdNotional: 5 }); }
  catch (e) { refused = /DISARMED/.test(e.message); }
  assert(refused, "wallet refuses swap when disarmed");
  ok("on-chain swaps DISARMED by default + refused (safety)");

  // auth: token sign/verify + tamper rejection
  const Auth = require("../src/auth/auth");
  const auth = new Auth({ auth: { user: "admin", password: "secret", sessionSecret: "test-secret", enabled: true } });
  const tk = auth.issueToken("admin");
  assert(auth.verify(tk) && auth.verify(tk).u === "admin", "valid token verifies");
  assert(auth.verify(tk + "x") === null, "tampered token rejected");
  assert(auth.checkCredentials("admin", "secret") === true, "correct creds pass");
  assert(auth.checkCredentials("admin", "wrong") === false, "wrong creds fail");
  ok("auth signs/verifies tokens + rejects tampering & bad creds");

  // persistence: broker save + reload
  const fs2 = require("fs");
  const path2 = require("path");
  const store = path2.join(require("os").tmpdir(), "saint_test_portfolio.json");
  try { fs2.existsSync(store) && fs2.unlinkSync(store); } catch (_) {}
  const pb2 = new PaperBroker(config, { storePath: store });
  pb2.execute({ symbol: "ETH-USD", side: "BUY", notional: 500, price: 3000 });
  pb2.recordEquity({ "ETH-USD": { price: 3000 } });
  await new Promise((r) => setTimeout(r, 1800)); // allow debounced write
  assert(fs2.existsSync(store), "portfolio persisted to disk");
  const pb3 = new PaperBroker(config, { storePath: store });
  assert(pb3.fills.length >= 1 && pb3.positions["ETH-USD"], "portfolio restored on reload");
  pb3.reset();
  assert(!fs2.existsSync(store), "reset clears persisted file");
  ok("paper portfolio persists to disk + restores + resets");

  // notifier: disabled by default, dedup + no throw
  const Notifier = require("../src/alerts/notifier");
  const notifier = new Notifier(config);
  assert(notifier.enabled === false, "alerts disabled without channels");
  const r1 = await notifier.send("hi");
  assert(r1.sent === false, "send is no-op when unconfigured");
  notifier.notifyMemecoins([{ score: 95, address: "abc", symbol: "X", source: "SIM" }]);
  assert(notifier._seen.size === 0, "SIM candidates never alerted");
  ok("notifier safe when unconfigured + skips SIM data");

  // multi-strategy registry + ensemble
  const registry = require("../src/signals/strategies/registry");
  assert(registry.get("momentum") && registry.get("meanreversion"), "both strategies registered");
  assert(registry.get("nope") === null, "unknown strategy returns null");
  const up = Array.from({ length: 80 }, (_, i) => 100 + i); // clean uptrend
  const mom = registry.get("momentum").evaluate(up);
  assert(mom.signal === "LONG", "momentum LONG on uptrend");
  const ens = registry.ensemble(up, { members: ["momentum", "meanreversion"] });
  assert(["LONG", "SHORT", "FLAT"].includes(ens.signal) && ens.indicators.ensemble, "ensemble blends members");
  ok("multi-strategy registry + ensemble work");

  // strategy facade selection
  const sfacade = require("../src/signals/strategy");
  sfacade.configure({ strategy: "meanreversion" });
  const viaFacade = sfacade.evaluate(up);
  assert(viaFacade && typeof viaFacade.score === "number", "facade routes to configured strategy");
  sfacade.configure({ strategy: "momentum" });
  ok("strategy facade selects + configures strategies");

  // optimizer grid search + walk-forward
  const Optimizer = require("../src/backtest/optimizer");
  const { syntheticCloses: synth2 } = require("../src/backtest/history");
  const optSeries = {};
  for (const s of config.universe) optSeries[s] = synth2(s, 400);
  const optimizer = new Optimizer(config);
  const gs = optimizer.gridSearch(optSeries, "momentum", {});
  assert(gs.tested > 1 && gs.best && gs.best.params, "grid search tests combos + returns best");
  const wf = optimizer.walkForward(optSeries, "momentum", { folds: 3 });
  assert(wf.folds >= 2 && wf.summary && typeof wf.summary.avgOOSReturnPct === "number", "walk-forward produces OOS summary");
  ok("optimizer grid search + walk-forward validation work");

  console.log(`\nALL TESTS PASSED (${passed} checks) ✅`);
  process.exit(0);
})().catch((e) => {
  console.error("\n❌ TEST FAILED:", e.message);
  process.exit(1);
});
