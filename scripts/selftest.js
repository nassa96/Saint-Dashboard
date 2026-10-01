/* Offline self-test — validates the engine pipeline without network. */

const assert = require("assert");
const config = require("../config");
const ind = require("../src/signals/indicators");
const strategy = require("../src/signals/strategy");
const RiskManager = require("../src/risk/riskManager");
const Allocator = require("../src/portfolio/allocator");
const PaperBroker = require("../src/paper/broker");
const MemecoinScanner = require("../src/memecoin/scanner");
const volatilityRadar = require("../src/volatility/predictor");
const marketMaking = require("../src/signals/strategies/marketMaking");
const { sortinoRatio } = require("../src/portfolio/sortino");
const mevDefense = require("../src/wallet/mevDefense");
const HyperLiquid = require("../src/exchange/hyperliquid");
const ExchangeManager = require("../src/exchange/manager");
const { TronWallet } = require("../src/wallet/tron");
const DnfhEngine = require("../src/yield/dnfh");
const macroFlow = require("../src/intelligence/flow");
const Engine = require("../src/engine/engine");

let passed = 0;
const ok = (name) => { console.log("  ✓", name); passed++; };
async function assertThrowsAsync(fn, expectedSubstring, message) {
  try {
    await fn();
  } catch (e) {
    assert(e.message.includes(expectedSubstring), `${message} (got: ${e.message})`);
    return;
  }
  assert.fail(`${message} — expected a throw containing "${expectedSubstring}"`);
}

(async () => {
  // indicators
  const rising = Array.from({ length: 60 }, (_, i) => 100 + i);
  assert(ind.sma(rising, 10) > 0, "sma");
  assert(ind.ema(rising, 12) > 0, "ema");
  assert(ind.rsi(rising, 14) > 60, "rsi rising should be high");
  assert(ind.momentum(rising, 10) > 0, "momentum positive");
  assert(ind.volatility(rising, 20) != null, "volatility");
  ok("indicators compute correctly");

  // extreme volatility radar — real EWMA/realized vol, bounded outputs, no randomness
  const calmSeries = Array.from({ length: 150 }, (_, i) => 100 + Math.sin(i / 40) * 0.5);
  const calmRead = volatilityRadar.analyze(calmSeries);
  assert(calmRead.ready === true, "volatility radar ready with enough bars");
  assert(calmRead.extremeMoveLikelihoodPct >= 0 && calmRead.extremeMoveLikelihoodPct <= 100, "likelihood bounded 0-100");
  assert(["CALM", "NORMAL", "ELEVATED", "EXTREME", "UNKNOWN"].includes(calmRead.regime), "regime enum");

  // a violent shock at the tail should read a much higher vol percentile than a flat series
  const shockSeries = calmSeries.slice();
  for (let i = 0; i < 8; i++) {
    const last = shockSeries[shockSeries.length - 1];
    shockSeries.push(last * (1 + (i % 2 === 0 ? 0.08 : -0.07))); // violent whipsaw
  }
  const shockRead = volatilityRadar.analyze(shockSeries);
  assert(shockRead.ewmaVolPct > calmRead.ewmaVolPct, "shock series reads higher EWMA vol than calm series");
  assert(shockRead.percentile >= calmRead.percentile, "shock reads at/above calm's vol percentile");
  assert(typeof shockRead.disclaimer === "string" && /not.*guarantee/i.test(shockRead.disclaimer), "radar is honestly labeled — never claims certainty");

  const tooShort = volatilityRadar.analyze([1, 2, 3]);
  assert(tooShort.ready === false, "radar refuses to guess on insufficient history");
  ok("extreme volatility radar computes bounded, honestly-labeled regime reads from real price history");

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

  // risk manager — volatility-regime-aware sizing (operationalizes the
  // Extreme Volatility Radar instead of just alerting on it)
  const rmVol = new RiskManager(config);
  const calmAssess = rmVol.assess({ signal: "LONG", confidence: 0.8, equity: 10000, currentExposure: 0, symbolExposure: 0, price: 100, volatility: { ready: true, regime: "CALM" } });
  const extremeAssess = rmVol.assess({ signal: "LONG", confidence: 0.8, equity: 10000, currentExposure: 0, symbolExposure: 0, price: 100, volatility: { ready: true, regime: "EXTREME" } });
  assert(calmAssess.approved === true && extremeAssess.approved === true, "both calm and extreme regimes can still approve a high-conviction trade");
  assert(extremeAssess.maxNotional < calmAssess.maxNotional, "EXTREME volatility regime shrinks the approved position size vs CALM, same signal/confidence");
  const extremeLowConf = rmVol.assess({ signal: "LONG", confidence: 0.6, equity: 10000, currentExposure: 0, symbolExposure: 0, price: 100, volatility: { ready: true, regime: "EXTREME" } });
  assert(extremeLowConf.approved === false, "EXTREME regime raises the confidence bar required for a NEW entry");
  ok("risk manager scales position size + confidence bar down in choppier volatility regimes");

  // risk manager — market-wide stress halt (independent of, and faster to
  // clear than, the daily-drawdown breaker)
  const rmStress = new RiskManager(config);
  const calmUniverse = { A: { ready: true, regime: "CALM" }, B: { ready: true, regime: "NORMAL" }, C: { ready: true, regime: "CALM" } };
  const stressedUniverse = { A: { ready: true, regime: "EXTREME" }, B: { ready: true, regime: "EXTREME" }, C: { ready: true, regime: "NORMAL" } };
  rmStress.updateMarketStress(calmUniverse);
  assert(rmStress.stressHalted === false, "no stress halt when most of the universe is calm");
  rmStress.updateMarketStress(stressedUniverse);
  assert(rmStress.stressHalted === true, "stress halt trips when >= threshold fraction of the universe is simultaneously EXTREME");
  const duringStress = rmStress.assess({ signal: "LONG", confidence: 0.99, equity: 10000, currentExposure: 0, symbolExposure: 0, price: 100 });
  assert(duringStress.approved === false && /MARKET-WIDE STRESS/.test(duringStress.reason), "new entries are refused during a market-wide stress halt, even at max confidence");
  rmStress.updateMarketStress(calmUniverse);
  assert(rmStress.stressHalted === false, "stress halt auto-clears the same day once conditions calm back down (unlike the drawdown breaker)");
  ok("risk manager pauses new entries on market-wide volatility stress and auto-clears when it passes");

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

  // allocator — macro overlay can only ever shrink deployment, never boost it
  const macroEvals = [
    { symbol: "BTC-USD", signal: "LONG", confidence: 0.8, score: 0.6 },
    { symbol: "ETH-USD", signal: "LONG", confidence: 0.7, score: 0.4 },
  ];
  const neutralTargets = alloc.computeTargets(macroEvals, {}).targets;
  const riskOffTargets = alloc.computeTargets(macroEvals, { macro: { deployMultiplier: 0.65 } }).targets;
  const riskOnTargets = alloc.computeTargets(macroEvals, { macro: { deployMultiplier: 1.4 } }).targets; // intentionally > 1
  const sumWeights = (t) => Object.values(t).reduce((a, b) => a + b, 0);
  assert(sumWeights(riskOffTargets) < sumWeights(neutralTargets), "RISK_OFF macro overlay deploys less total capital than no overlay");
  assert(sumWeights(riskOnTargets) <= sumWeights(neutralTargets) + 1e-9, "a >1.0 macro multiplier is clamped — it can never deploy MORE than the configured risk ceiling allows");
  ok("allocator macro overlay only ever throttles deployment, never exceeds the configured risk ceiling");

  // macro flow classification — pure logic, no network
  assert(macroFlow.classify(80, 2) === "RISK_ON", "high fear&greed + positive market-cap trend classifies RISK_ON");
  assert(macroFlow.classify(15, 1) === "RISK_OFF", "very low fear&greed (extreme fear) classifies RISK_OFF regardless of market-cap trend");
  assert(macroFlow.classify(90, -8) === "RISK_OFF", "a sharp market-cap drawdown classifies RISK_OFF even with high fear&greed");
  assert(macroFlow.classify(50, 0) === "NEUTRAL", "middling readings classify NEUTRAL");
  assert(macroFlow.classify(null, null) === "UNKNOWN", "no data classifies UNKNOWN rather than guessing");
  assert(macroFlow.MULTIPLIER.RISK_OFF < macroFlow.MULTIPLIER.NEUTRAL && macroFlow.MULTIPLIER.NEUTRAL <= macroFlow.MULTIPLIER.RISK_ON, "multipliers only ever shrink deployment as the backdrop gets more cautious");
  assert(Object.values(macroFlow.MULTIPLIER).every((m) => m <= 1), "no macro regime is ever allowed to multiply deployment above 1.0 (configured risk ceiling)");
  ok("macro flow overlay classifies honestly and never multiplies deployment above the configured ceiling");

  // Sortino-ratio allocation mode — a smoother (less downside-painful)
  // series should get more weight than a jagged one at equal conviction score.
  const smoothUp = Array.from({ length: 60 }, (_, i) => 100 * Math.pow(1.002, i));
  const jaggedUp = smoothUp.map((v, i) => v * (1 + (i % 2 === 0 ? -0.03 : 0.01)));
  const sortinoSmooth = sortinoRatio(smoothUp);
  const sortinoJagged = sortinoRatio(jaggedUp);
  assert(sortinoSmooth > sortinoJagged, "smoother uptrend scores a higher Sortino ratio than a jagged one");
  // Use a wide per-position cap + tight portfolio budget so the weighting
  // math actually determines the split instead of both hitting the same cap.
  const sortinoConfig = {
    ...config,
    capital: { ...config.capital, allocationMethod: "sortino", maxPositionPct: 1, maxPortfolioRiskPct: 0.1 },
  };
  const allocSortino = new Allocator(sortinoConfig);
  const { targets: sortinoTargets } = allocSortino.computeTargets(
    [
      { symbol: "SMOOTH", signal: "LONG", confidence: 0.8, score: 0.5 },
      { symbol: "JAGGED", signal: "LONG", confidence: 0.8, score: 0.5 },
    ],
    { seriesBySymbol: { SMOOTH: smoothUp, JAGGED: jaggedUp } }
  );
  assert(sortinoTargets["SMOOTH"] > sortinoTargets["JAGGED"], "sortino mode sizes up the smoother ride at equal score");
  ok("Sortino-ratio allocation mode rewards lower downside risk at equal conviction");

  // Avellaneda-Stoikov (spot-adapted) market-making strategy
  const flatSeries = Array.from({ length: 80 }, () => 100 + (Math.random() - 0.5) * 0.01);
  const mmFlat = marketMaking.evaluate(flatSeries, {}, { inventoryRatio: 0 });
  assert(["LONG", "FLAT", "SHORT"].includes(mmFlat.signal), "market-making signal enum");
  assert(mmFlat.indicators.reservationPrice > 0, "reservation price computed");
  const mmNoInv = marketMaking.evaluate(flatSeries, {}, { inventoryRatio: 0 });
  const mmFullInv = marketMaking.evaluate(flatSeries, {}, { inventoryRatio: 1 });
  assert(
    mmFullInv.indicators.reservationPrice <= mmNoInv.indicators.reservationPrice,
    "full inventory skews reservation price down (lean against existing size)"
  );
  ok("Avellaneda-Stoikov market-making strategy computes inventory-aware reservation price + spread");

  // MEV defense — read-only risk assessment + execution planning, no network calls
  const lowImpactQuote = { priceImpactPct: 0.002 };
  const highImpactQuote = { priceImpactPct: 0.045 };
  const lowRisk = mevDefense.assessRisk(lowImpactQuote, 100, {});
  const highRisk = mevDefense.assessRisk(highImpactQuote, 1000, {});
  assert(lowRisk.level === "MINIMAL" || lowRisk.level === "LOW", "low price-impact reads low sandwich risk");
  assert(highRisk.level === "HIGH", "high price-impact reads high sandwich risk");
  const plan = mevDefense.planExecution(1000, highRisk, { splitThresholdUsd: 250, maxChunks: 4 });
  assert(plan.chunks > 1, "large + high-risk swap gets tranched");
  const noSplitPlan = mevDefense.planExecution(50, lowRisk, { splitThresholdUsd: 250, maxChunks: 4 });
  assert(noSplitPlan.chunks === 1, "small + low-risk swap stays single-shot");
  ok("MEV defense assesses sandwich exposure from quote data + plans tranched execution");

  // HyperLiquid — monitor-only safety contract: reads need no secret, perps
  // never enter the auto-rotation engine's venue pool.
  const hl = new HyperLiquid({ walletAddress: "", privateKey: "" });
  assert(hl.hasCredentials() === false, "hyperliquid reports no credentials without a wallet address");
  const hlWithAddr = new HyperLiquid({ walletAddress: "0x0000000000000000000000000000000000000000" });
  assert(hlWithAddr.hasCredentials() === true, "a public wallet address alone is enough for hyperliquid reads");
  await assertThrowsAsync(() => hlWithAddr.placeOrder({ symbol: "BTC-PERP", side: "BUY", quantity: 1, limitPrice: 1 }, true), "no HYPERLIQUID_API_PRIVATE_KEY", "hyperliquid refuses orders without a dedicated API-wallet key");
  const emHL = new ExchangeManager({ ...config, exchanges: { ...config.exchanges, primary: "hyperliquid" } });
  assert(emHL.primary !== "hyperliquid", "engine refuses to auto-select a leveraged/perps venue as the spot rotation primary");
  assert(emHL.spotVenues.includes("coinbase") && !emHL.spotVenues.includes("hyperliquid"), "hyperliquid excluded from spot venue pool");
  await assertThrowsAsync(() => emHL.placeManualLeveragedOrder({ symbol: "BTC-PERP", side: "BUY", quantity: 1, limitPrice: 1 }), "LIVE TRADING DISARMED", "manual leveraged order path still requires the full live-arm gate");
  ok("HyperLiquid wired as monitor-only: no secret needed to read, never auto-selected for spot rotation, orders stay gated");

  // Tron — honest refusal: reads don't need swaps to exist
  const tron = new TronWallet({ tron: { address: "", privateKey: "", apiBase: "https://api.trongrid.io" } });
  assert(tron.hasKey() === false, "tron reports no key when unconfigured");
  await assertThrowsAsync(() => tron.quote(), "no vetted", "tron refuses to quote without a vetted aggregator configured");
  await assertThrowsAsync(() => tron.swap(), "BLOCKED", "tron refuses to swap without a vetted aggregator configured");
  ok("Tron connector refuses swaps honestly instead of routing funds through an unverified relay");

  // DNFH — delta-neutral funding harvest: real cross-venue yield strategy.
  // Isolated fakes so this doesn't touch global live-arm state.
  const fakeHlVenue = {
    _info: async ({ type }) => {
      assert(type === "metaAndAssetCtxs", "DNFH scan requests the right hyperliquid info type");
      return [
        { universe: [{ name: "VIRTUAL" }, { name: "PENGU" }, { name: "BTC" }] },
        [
          { funding: "0.0001", markPx: "2.5" }, // positive, highest -> should rank first
          { funding: "-0.00005", markPx: "0.04" }, // negative -> filtered out (not supported)
          { funding: "0.00002", markPx: "90000" }, // positive, lower -> should rank second
        ],
      ];
    },
  };
  const dnfhConfig = { exchanges: { hyperliquid: { maxLeverage: 2 } }, canTradeLive: () => false, canSwapOnchain: () => false };
  const dnfhExchanges = {
    venues: { hyperliquid: fakeHlVenue },
    placeManualLeveragedOrder: async () => { throw new Error("perp leg should never be called while disarmed"); },
  };
  const dnfhWallet = { swap: async () => { throw new Error("spot leg should never be called while disarmed"); }, quote: async () => ({}) };
  const dnfh = new DnfhEngine({ exchanges: dnfhExchanges, wallet: dnfhWallet, config: dnfhConfig });

  const scanResult = await dnfh.scan();
  assert(scanResult.opportunities.length === 2, "DNFH scan keeps only positive-funding symbols (negative funding isn't supported, not guessed at)");
  assert(scanResult.opportunities[0].symbol === "VIRTUAL", "DNFH scan ranks opportunities by annualized funding, descending");
  assert(Math.abs(scanResult.opportunities[0].annualizedFundingPct - 0.0001 * 24 * 365 * 100) < 1e-6, "DNFH annualizes hourly funding correctly");

  await assertThrowsAsync(() => dnfh.planPosition({ symbol: "VIRTUAL", usdNotional: 100 }), "spotTokenAddress is required", "DNFH refuses to plan without a caller-verified spot token address — it will not guess a contract address");
  await assertThrowsAsync(() => dnfh.planPosition({ symbol: "PENGU", usdNotional: 100, spotTokenAddress: "0xabc" }), "no positive funding", "DNFH refuses to harvest a symbol that isn't paying positive funding right now");

  const dnfhPlan = await dnfh.planPosition({ symbol: "VIRTUAL", usdNotional: 100, spotTokenAddress: "0xabc", leverage: 10 });
  assert(dnfhPlan.leverage === 2, "DNFH hard-caps leverage to config max regardless of what's requested");
  assert(dnfhPlan.legs.spot.usdNotional === 100 && dnfhPlan.legs.perp.usdNotional === 200, "DNFH sizes the perp short to leverage × spot notional, keeping the plan delta-neutral");

  await assertThrowsAsync(() => dnfh.execute(dnfhPlan, {}), "BLOCKED", "DNFH execute refuses to run without the full live-arm AND on-chain-swap gate");
  ok("DNFH: ranks real funding opportunities honestly, refuses to guess token addresses, hard-caps leverage, and stays fully gated");

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
  assert(state.volatility && typeof state.volatility === "object", "volatility radar present in engine snapshot");
  ok("engine full pipeline tick completes end-to-end");

  // Survivability gate: even when LIVE trading is fully armed, the engine
  // must refuse to place a real order against a symbol whose current price
  // came from the SIM fallback (feed unreachable) rather than a real quote.
  const simGateEngine = {
    config: { canTradeLive: () => true },
    market: { latest: { "BTC-USD": { source: "SIM", price: 100 } } },
    paper: { execute: (args) => ({ ...args, status: "FILLED", viaPaperFallback: true }) },
    notifier: { notifyFill: () => {} },
    exchanges: {
      primary: "coinbase",
      routeLiveOrder: async () => { throw new Error("a live order must never be attempted when the price source isn't confirmed LIVE"); },
    },
    _venueSymbol: Engine.prototype._venueSymbol,
  };
  const simGateFill = await Engine.prototype._execute.call(simGateEngine, { symbol: "BTC-USD", side: "BUY", notional: 100, price: 100 });
  assert(simGateFill && simGateFill.viaPaperFallback === true, "live execution is refused and falls back to paper when price data isn't confirmed LIVE");

  const liveGateEngine = {
    config: { canTradeLive: () => true },
    market: { latest: { "BTC-USD": { source: "LIVE", price: 100 } } },
    paper: { execute: (args) => ({ ...args, status: "FILLED" }) },
    notifier: { notifyFill: () => {} },
    exchanges: {
      primary: "coinbase",
      routeLiveOrder: async (order) => { liveGateEngine._called = true; return { status: "FILLED", raw: { order } }; },
    },
    _venueSymbol: Engine.prototype._venueSymbol,
  };
  const liveGateFill = await Engine.prototype._execute.call(liveGateEngine, { symbol: "BTC-USD", side: "BUY", notional: 100, price: 100 });
  assert(liveGateEngine._called === true, "a confirmed-LIVE price source is allowed to reach the exchange routing path");
  assert(liveGateFill && liveGateFill.mode === "LIVE", "a successful live order is reported with mode=LIVE");
  ok("engine refuses to risk real money on non-LIVE (SIM/stale) price data, even when fully armed");

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

  // per-symbol strategy routing
  const routeCfg = require("../config");
  const savedRoutes = routeCfg.strategyRoutes;
  const savedMajors = routeCfg.majors, savedMajStrat = routeCfg.majorsStrategy, savedAltStrat = routeCfg.altsStrategy;
  routeCfg.strategyRoutes = { "BTC-USD": "meanreversion" };
  routeCfg.majors = ["ETH-USD"];
  routeCfg.majorsStrategy = "momentum";
  routeCfg.altsStrategy = "meanreversion";
  assert(routeCfg.resolveStrategy("BTC-USD") === "meanreversion", "explicit route wins over major/alt split");
  assert(routeCfg.resolveStrategy("ETH-USD") === "momentum", "major falls through to majorsStrategy");
  assert(routeCfg.resolveStrategy("SOL-USD") === "meanreversion", "non-major falls through to altsStrategy");
  routeCfg.strategyRoutes = savedRoutes; routeCfg.majors = savedMajors;
  routeCfg.majorsStrategy = savedMajStrat; routeCfg.altsStrategy = savedAltStrat;
  ok("per-symbol strategy routing resolves route→majors/alts→default");

  // param store roundtrip + facade apply
  const paramStore = require("../src/signals/paramStore");
  // (fs2 already required above)
  try { fs2.unlinkSync(paramStore.STORE_PATH); } catch {}
  paramStore.setBest("momentum", { lookback: 42, threshold: 0.9 }, { fitness: 1.23 });
  const reloaded = paramStore.getBest("momentum");
  assert(reloaded && reloaded.params.lookback === 42, "paramStore persists + reloads best params");
  sfacade.loadSavedParams();
  assert(sfacade.getParams("momentum").lookback === 42, "facade loads saved params on boot");
  const applied = sfacade.evaluate(up, { strategy: "momentum" });
  assert(applied && typeof applied.score === "number", "facade evaluates with saved params applied");
  try { fs2.unlinkSync(paramStore.STORE_PATH); } catch {}
  sfacade.setParams("momentum", {}); // clear override
  ok("optimizer param persistence: save → reload → auto-apply");

  // broker trade ledger (journal)
  const Broker = require("../src/paper/broker");
  const jb = new Broker({ capital: { startingEquity: 10000 } }, { persist: false });
  jb.slippageRate = 0; // deterministic fills for the test
  jb.execute({ symbol: "BTC-USD", side: "BUY", notional: 1000, price: 100 });  // open @100
  jb.execute({ symbol: "BTC-USD", side: "SELL", notional: 1100, price: 110 }); // close @110 → profit
  assert(jb.trades.length === 1, "SELL records one closed trade");
  const tr = jb.trades[0];
  assert(tr.symbol === "BTC-USD" && tr.pnl > 0 && tr.pnlPct > 0, "closed trade has positive pnl + pnlPct");
  assert(typeof tr.holdMs === "number" && tr.entryPrice === 100 && tr.exitPrice === 110, "trade captures entry/exit/hold");
  ok("broker trade ledger records round-trip trades");

  // analytics
  const analytics = require("../src/analytics/analytics");
  const stats = analytics.compute(
    [
      { pnl: 50, pnlPct: 5, symbol: "BTC-USD", holdMs: 60000 },
      { pnl: -20, pnlPct: -2, symbol: "ETH-USD", holdMs: 120000 },
      { pnl: 30, pnlPct: 3, symbol: "BTC-USD", holdMs: 90000 },
    ],
    [{ equity: 10000 }, { equity: 10050 }, { equity: 10030 }, { equity: 10060 }],
    10000
  );
  assert(stats.totalTrades === 3 && stats.wins === 2 && stats.losses === 1, "analytics counts wins/losses");
  assert(Math.abs(stats.netPnl - 60) < 1e-6, "analytics net PnL correct");
  assert(Math.abs(stats.profitFactor - 4) < 1e-6, "analytics profit factor = grossWin/grossLoss");
  assert(stats.symbolStats.length === 2 && stats.distribution.length === 8, "analytics symbol breakdown + distribution");
  ok("analytics computes win rate, profit factor, expectancy, distribution");

  // exchange credential store + runtime connect/disconnect
  const credStore = require("../src/exchange/credStore");
  const fs3 = require("fs");
  try { fs3.unlinkSync(credStore.STORE_PATH); } catch {}
  credStore.set("kraken", { key: "abc", secret: "xyz" });
  assert(credStore.load().kraken.key === "abc", "credStore persists venue keys");
  const em = new ExchangeManager(config);
  assert(em.venues.kraken.hasCredentials(), "manager loads saved credentials on boot");
  em.disconnect("kraken");
  assert(!em.venues.kraken.hasCredentials(), "disconnect clears credentials");
  assert(!credStore.load().kraken, "disconnect removes creds from store");
  assert(typeof config.roundTripFeePct("coinbase") === "number" && config.capital.minTradeUsd >= 0, "fee-aware config present");
  try { fs3.unlinkSync(credStore.STORE_PATH); } catch {}
  ok("exchange credential store + runtime connect/disconnect work");

  // runtime live-arming (one-click arm + kill switch)
  const armCfg = require("../config");
  try { fs3.unlinkSync(require("path").join(__dirname, "..", "data", "live_arm.json")); } catch {}
  armCfg.disarmLive();
  assert(armCfg.canTradeLive() === false, "default is PAPER (not armed)");
  let rejected = false;
  try { armCfg.armLive("nope"); } catch { rejected = true; }
  assert(rejected && armCfg.canTradeLive() === false, "arm rejects wrong confirmation phrase");
  armCfg.armLive("I ACCEPT THE RISK");
  assert(armCfg.canTradeLive() === true && armCfg.liveStatus().webArmed === true, "arm with exact phrase enables live");
  armCfg.disarmLive();
  assert(armCfg.canTradeLive() === false, "disarm instantly returns to PAPER");
  try { fs3.unlinkSync(require("path").join(__dirname, "..", "data", "live_arm.json")); } catch {}
  ok("runtime live-arming: default off, phrase-gated arm, instant disarm");

  console.log(`\nALL TESTS PASSED (${passed} checks) ✅`);
  process.exit(0);
})().catch((e) => {
  console.error("\n❌ TEST FAILED:", e.message);
  process.exit(1);
});
