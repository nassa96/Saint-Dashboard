/* Offline self-test — validates the engine pipeline without network. */

const assert = require("assert");
const config = require("../config");
const ind = require("../src/signals/indicators");
const strategy = require("../src/signals/strategy");
const RiskManager = require("../src/risk/riskManager");
const Allocator = require("../src/portfolio/allocator");
const CapitalRing = require("../src/portfolio/capitalRing");
const PaperBroker = require("../src/paper/broker");
const MemecoinScanner = require("../src/memecoin/scanner");
const volatilityRadar = require("../src/volatility/predictor");
const marketMaking = require("../src/signals/strategies/marketMaking");
const fibonacci = require("../src/signals/strategies/fibonacci");
const { sortinoRatio, downsideDeviation, sortinoScalar, kellyFraction, kellySortinoFraction } = require("../src/portfolio/sortino");
const mevDefense = require("../src/wallet/mevDefense");
const HyperLiquid = require("../src/exchange/hyperliquid");
const ExchangeManager = require("../src/exchange/manager");
const { TronWallet } = require("../src/wallet/tron");
const DnfhEngine = require("../src/yield/dnfh");
const dnfhStore = require("../src/yield/dnfhStore");
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

  // OHLCV-dependent indicators: ATR, stochastic, swing range, Fibonacci levels
  const upBars = Array.from({ length: 60 }, (_, i) => {
    const base = 100 + i * 0.6;
    return { ts: i, open: base - 0.1, high: base + 0.5, low: base - 0.5, close: base, volume: 1000 - i * 5 };
  });
  const atrVal = ind.atr(upBars, 14);
  assert(atrVal != null && atrVal > 0, "atr computes a positive value from real OHLC bars");
  const stoch = ind.stochastic(upBars, 14, 3);
  assert(stoch && stoch.k >= 0 && stoch.k <= 100 && stoch.d >= 0 && stoch.d <= 100, "stochastic %K/%D bounded 0-100");
  const swing = ind.swingRange(upBars, 40);
  assert(swing && swing.high > swing.low, "swing range finds a valid high/low leg");
  const fib = ind.fibLevels(swing.low, swing.high, "up");
  assert(fib.retracements.r618 < fib.retracements.r500 && fib.retracements.r500 < fib.retracements.r382, "retracement levels order correctly (deeper ratio = lower price in an uptrend)");
  assert(fib.extensions.e1618 > fib.extensions.e1272 && fib.extensions.e2618 > fib.extensions.e1618, "extension levels increase with ratio");
  ok("ATR, stochastic oscillator, swing-range and Fibonacci level helpers compute correctly from OHLCV bars");

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

  // micro-capital cold-start: absolute MAX_TRADE_USD ceiling, independent
  // of (and tighter than) the percentage-based caps
  const rmCapped = new RiskManager({ capital: { ...config.capital, maxTradeUsd: 5 } });
  const cappedAssess = rmCapped.assess({ signal: "LONG", confidence: 0.9, equity: 10000, currentExposure: 0, symbolExposure: 0, price: 100 });
  assert(cappedAssess.approved === true && cappedAssess.maxNotional <= 5, "MAX_TRADE_USD caps notional size regardless of how much room the percentage caps would otherwise allow");
  ok("risk manager enforces an absolute MAX_TRADE_USD ceiling for micro-capital cold-start mode");

  // rolling 24h drawdown-halt cooldown — must NOT clear just because
  // midnight passed; only clears once its own cooldown timestamp elapses
  const rm3 = new RiskManager({ capital: { ...config.capital, maxDailyDrawdownPct: 0.03, haltCooldownHours: 24 } });
  rm3.updateEquity(10000);
  rm3.updateEquity(9600); // 4% drawdown >= 3% limit -> halts
  assert(rm3.halted === true && rm3.haltUntil > Date.now(), "drawdown halt sets a rolling cooldown ~24h out, not just a same-day flag");
  rm3.dayKey = "2000-01-01"; // simulate the next tick crossing a calendar-day boundary
  rm3.updateEquity(9600);
  assert(rm3.halted === true, "halt survives a calendar-day rollover — no longer clears just because midnight passed");
  rm3.haltUntil = Date.now() - 1000; // simulate the 24h cooldown having actually elapsed
  rm3.updateEquity(9600);
  assert(rm3.halted === false, "halt clears once its own rolling cooldown has actually elapsed");
  ok("risk manager uses a true rolling cooldown for the daily-drawdown halt instead of clearing at the next calendar day");

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

  // AWP Capital Ring — Shield (80%)/Spear (20%) two-pool allocation on top
  // of the existing per-symbol strategy router
  const ringConfig = { ...config, capital: { ...config.capital, capitalRing: { enabled: true, shieldPct: 0.8, spearPct: 0.2, spearStrategies: ["fibonacci"] } } };
  const ring = new CapitalRing(ringConfig);
  assert(ring.isSpear("fibonacci") === true && ring.isSpear("momentum") === false, "capital ring classifies pools by routed strategy name");
  const ringEvals = [
    { symbol: "BTC-USD", strategy: "momentum", signal: "LONG", confidence: 0.8, score: 0.9 },
    { symbol: "ETH-USD", strategy: "momentum", signal: "LONG", confidence: 0.8, score: 0.9 },
    { symbol: "DOGE-USD", strategy: "fibonacci", signal: "LONG", confidence: 0.8, score: 0.9 },
  ];
  const ringResult = ring.computeTargets(ringEvals, {});
  const shieldSum = (ringResult.targets["BTC-USD"] || 0) + (ringResult.targets["ETH-USD"] || 0);
  const spearSum = ringResult.targets["DOGE-USD"] || 0;
  assert(shieldSum > 0 && spearSum > 0, "both pools receive capital when both have qualifying LONG candidates");
  assert(shieldSum <= config.capital.maxPortfolioRiskPct * 0.8 + 1e-9, "shield pool deployment never exceeds its 80% share of the risk budget");
  assert(spearSum <= config.capital.maxPortfolioRiskPct * 0.2 + 1e-9, "spear pool deployment never exceeds its 20% share of the risk budget");
  ok("Capital Ring splits deployment into an 80% shield / 20% spear pool by routed strategy, each independently capped");

  // Spear pool's own scoped daily-loss ceiling halts NEW spear entries only
  const spearPaper = {
    trades: [{ tag: "spear", ts: Date.now(), pnl: -600 }], // big realized loss today, tagged spear
    positions: {},
  };
  const spearRisk = ring.updateSpearRisk(spearPaper, 10000, {});
  assert(spearRisk.halted === true, "spear pool halts new entries once its own scoped daily-loss ceiling is breached");
  const ringAfterHalt = ring.computeTargets(ringEvals, {});
  assert((ringAfterHalt.targets["DOGE-USD"] || 0) === 0, "halted spear pool receives zero NEW target allocation");
  assert((ringAfterHalt.targets["BTC-USD"] || 0) > 0, "shield pool keeps trading normally while only the spear pool is halted");
  ok("Capital Ring's spear-pool daily-loss ceiling halts spear-only trading without affecting the shield pool or the whole engine");

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

  // AWP Kelly-Sortino position sizing: f* = (p*b - q)/b * sortino_scalar
  assert(Math.abs(downsideDeviation(smoothUp) - 0) < 1e-9 || downsideDeviation(smoothUp) != null, "downsideDeviation computes from a price series");
  assert(kellyFraction(0.6, 2) > 0, "positive-edge bet gets a positive Kelly fraction");
  assert(kellyFraction(0.4, 1) === 0, "negative-edge bet clamps to a zero Kelly fraction (never sizes against your own edge)");
  assert(sortinoScalar(0.01, 0.01) === 0.35, "sortino scalar clamps to the ceiling when target == realized (raw ratio 1.0 is above the 0.35 cap)");
  assert(sortinoScalar(0.005, 0.05) === 0.1, "sortino scalar clamps to the floor when realized downside vol is far hotter than target");
  assert(sortinoScalar(0.05, 0.005) === 0.35, "sortino scalar clamps to the ceiling when realized downside vol is far calmer than target");
  const sized = kellySortinoFraction({ winProb: 0.6, winLossRatio: 2, targetDownsideVol: 0.01, realizedDownsideDeviation: 0.02 });
  assert(sized.sizedFraction > 0 && sized.sizedFraction < sized.kellyFraction, "Kelly-Sortino sized fraction is a damped (smaller) version of the raw Kelly fraction");
  ok("Sortino-Kelly position sizing (AWP spec) computes a bounded, edge-gated, volatility-damped bet fraction");

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

  // micro-capital gamma scaling — tiny equity should widen effective gamma
  // (up to the configured cap) so quotes stay meaningfully wide/defensive
  // relative to a well-capitalized book, per the spec's targetCapital design.
  const mmBigEquity = marketMaking.evaluate(flatSeries, {}, { inventoryRatio: 0, equity: 1000 });
  const mmTinyEquity = marketMaking.evaluate(flatSeries, {}, { inventoryRatio: 0, equity: 50 });
  assert(mmBigEquity.indicators.gammaMultiplier === 1, "gamma multiplier is 1x at/above target capital");
  assert(mmTinyEquity.indicators.gammaMultiplier > 1, "gamma multiplier scales up below target capital");
  assert(mmTinyEquity.indicators.gammaMultiplier <= 6, "gamma multiplier respects the configured cap");
  assert(mmTinyEquity.indicators.gamma > mmBigEquity.indicators.gamma, "scaled gamma is larger for the micro-capital book");
  ok("market-making gamma scales up for micro-capital accounts and caps out per maxGammaMultiplier");

  // Fibonacci confluence strategy — uptrend, pull back into the golden
  // pocket on declining volume, with stochastic momentum turning up
  const fibBars = [];
  for (let i = 0; i < 50; i++) {
    const c = 80 + (100 - 80) * (i / 49);
    fibBars.push({ ts: i, open: c - 0.1, high: c + 0.3, low: c - 0.3, close: c, volume: 500 });
  }
  for (let i = 0; i < 25; i++) {
    const c = 100 + (150 - 100) * (i / 24);
    fibBars.push({ ts: 50 + i, open: c - 0.2, high: c + 0.6, low: c - 0.6, close: c, volume: 800 - i * 10 });
  }
  [148, 145, 140, 135, 130, 126, 123, 121, 119.5, 118.5, 117.8, 117.3, 117.6, 118.3, 118.8].forEach((c, i) => {
    fibBars.push({ ts: 75 + i, open: c + 0.2, high: c + 0.5, low: c - 0.5, close: c, volume: 300 - i * 5 });
  });
  const fibPrices = fibBars.map((b) => b.close);
  const fibResult = fibonacci.evaluate(fibPrices, {}, { bars: fibBars });
  assert(fibResult.signal === "LONG", "fibonacci strategy fires LONG on a golden-pocket pullback with momentum + volume confirmation");
  assert(fibResult.indicators.goldenPocket.inside === true, "golden pocket band correctly contains the pullback price");
  assert(fibResult.indicators.tpPlan.tp2.price > fibResult.indicators.tpPlan.tp1.price, "take-profit ladder levels increase tier over tier");
  const fibNoSignal = fibonacci.evaluate(fibPrices.slice(0, 70), {}, { bars: fibBars.slice(0, 70) });
  assert(fibNoSignal.signal === "FLAT", "fibonacci strategy stays FLAT before price reaches the golden pocket");
  ok("Fibonacci confluence strategy (AWP spear-pool entry) confirms golden-pocket pullbacks with momentum + volume, computes TP ladder");

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

  // MEV defense — pre-broadcast abort (the realistic equivalent of
  // "cancel before inclusion", since a public-mempool tx can't actually be
  // un-sent) + priority-fee ceiling
  const abortOnHighImpact = mevDefense.preBroadcastAbort(highRisk, {});
  assert(abortOnHighImpact.abort === true, "pre-broadcast check aborts on HIGH quoted price impact");
  const okImpactNoCongestion = mevDefense.preBroadcastAbort(lowRisk, { currentPriorityFeeGwei: 20, maxPriorityFeeGwei: 50 });
  assert(okImpactNoCongestion.abort === false, "pre-broadcast check allows low-risk swaps under the priority-fee ceiling");
  const abortOnCongestion = mevDefense.preBroadcastAbort(lowRisk, { currentPriorityFeeGwei: 80, maxPriorityFeeGwei: 50 });
  assert(abortOnCongestion.abort === true, "pre-broadcast check aborts when current priority fee exceeds the configured ceiling, even on an otherwise low-risk swap");
  const planWithCeiling = mevDefense.planExecution(1000, highRisk, { splitThresholdUsd: 250, maxChunks: 4, maxPriorityFeeGwei: 50 });
  assert(planWithCeiling.maxPriorityFeeGwei === 50, "execution plan surfaces the configured priority-fee ceiling");
  ok("MEV defense pre-broadcast abort refuses high-impact/congested swaps instead of claiming unrealistic in-flight mempool cancellation");

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

  // DNFH refinements: 22% entry threshold, net-edge-after-costs gate,
  // persisted funding-epoch + delta-drift rebalance triggers
  const fakeHlVenue2 = {
    _info: async () => [
      { universe: [{ name: "HOTCOIN" }, { name: "MEHCOIN" }] },
      [
        { funding: "0.0001", markPx: "2.5" }, // 87.6%/yr — clears the default 22% entry bar
        { funding: "0.00001", markPx: "1.0" }, // 8.76%/yr — positive, but below the entry bar
      ],
    ],
  };
  const dnfhExchanges2 = { venues: { hyperliquid: fakeHlVenue2 }, placeManualLeveragedOrder: async () => ({}) };
  const dnfhWallet2 = { swap: async () => ({}), quote: async () => ({}) };
  const dnfh2 = new DnfhEngine({ exchanges: dnfhExchanges2, wallet: dnfhWallet2, config: { ...dnfhConfig, dnfh: { entryThresholdAnnualPct: 22, minNetEdge7dPct: 0.75 } } });

  const scan2 = await dnfh2.scan();
  const hot = scan2.opportunities.find((o) => o.symbol === "HOTCOIN");
  const meh = scan2.opportunities.find((o) => o.symbol === "MEHCOIN");
  assert(hot.meetsEntryThreshold === true, "scan flags a symbol clearing the 22% entry threshold");
  assert(meh.meetsEntryThreshold === false, "scan flags a symbol below the 22% entry threshold even though funding is positive");

  await assertThrowsAsync(
    () => dnfh2.planPosition({ symbol: "MEHCOIN", usdNotional: 100, spotTokenAddress: "0xabc" }),
    "below the 22% entry threshold",
    "DNFH refuses to plan a harvest below the configured annualized-funding entry threshold"
  );

  // Net-edge gate: force it to fail with an unrealistically high basis-slippage override
  await assertThrowsAsync(
    () => dnfh2.planPosition({ symbol: "HOTCOIN", usdNotional: 100, spotTokenAddress: "0xabc", costOverrides: { basisSlippagePct: 5 } }),
    "net edge",
    "DNFH refuses to plan when projected net edge after costs falls below the ROI gate"
  );

  const okPlan = await dnfh2.planPosition({ symbol: "HOTCOIN", usdNotional: 100, spotTokenAddress: "0xabc" });
  assert(okPlan.netEdge.passesGate === true && okPlan.netEdge.netEdgePct > 0.75, "DNFH plans a harvest that clears both the entry threshold and the net-edge gate");
  ok("DNFH enforces the 22% annualized-funding entry threshold and the 0.75%/7d net-edge-after-costs gate");

  // Rebalance triggers — delta drift and consecutive-negative-funding epochs
  const rebalSymbol = `TEST-REBAL-${Date.now()}`;
  dnfhStore.setOpenPosition(rebalSymbol, { spotQty: 10, perpQty: -10, spotEntryNotional: 1000, perpEntryNotional: 1000, spotEntryPx: 100, perpEntryPx: 100 });
  const driftCheck = dnfh2.checkRebalanceTriggers(rebalSymbol, { spotPx: 100, perpPx: 103 }); // perp notional drifts 3% away from spot
  assert(driftCheck.shouldRebalance === true && driftCheck.reasons.some((r) => r.includes("delta drift")), "DNFH flags a rebalance when the two legs' notionals drift beyond the configured threshold");
  const noDriftCheck = dnfh2.checkRebalanceTriggers(rebalSymbol, { spotPx: 100, perpPx: 100.2 });
  assert(noDriftCheck.shouldRebalance === false, "DNFH does not flag a rebalance when drift stays within the configured threshold and funding hasn't been negative");

  for (let i = 0; i < 3; i++) dnfhStore.recordFundingEpoch(rebalSymbol, -0.001);
  const negativeEpochCheck = dnfh2.checkRebalanceTriggers(rebalSymbol, { spotPx: 100, perpPx: 100.2 });
  assert(negativeEpochCheck.shouldRebalance === true && negativeEpochCheck.reasons.some((r) => r.includes("negative")), "DNFH flags a rebalance after 3 consecutive negative funding epochs");
  dnfhStore.clearOpenPosition(rebalSymbol);
  ok("DNFH rebalance-trigger check detects both delta-drift and consecutive-negative-funding-epoch conditions");

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
