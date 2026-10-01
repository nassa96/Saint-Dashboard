/* ============================================================
   SAINT ENGINE — the live organism loop
   market data -> signals -> risk -> allocation/rotation ->
   execution (paper by default, gated live) -> chronicle
   ============================================================ */

const fs = require("fs");
const path = require("path");

const MarketData = require("../market/marketData");
const strategy = require("../signals/strategy");
const volatilityRadar = require("../volatility/predictor");
const RiskManager = require("../risk/riskManager");
const Allocator = require("../portfolio/allocator");
const CapitalRing = require("../portfolio/capitalRing");
const PaperBroker = require("../paper/broker");
const MemecoinScanner = require("../memecoin/scanner");
const ExchangeManager = require("../exchange/manager");
const WalletManager = require("../wallet/manager");
const DnfhEngine = require("../yield/dnfh");
const macroFlow = require("../intelligence/flow");
const Notifier = require("../alerts/notifier");
const log = require("../util/logger");

const CHRONICLE_PATH = path.join(__dirname, "../../data/chronicle.json");

class Engine {
  constructor(config) {
    this.config = config;
    this.market = new MarketData(config.universe);
    this.risk = new RiskManager(config);
    this.allocator = new Allocator(config);
    // AWP Capital Ring (Shield/Spear two-pool allocation) — disabled by
    // default; when disabled, computeTargets() below behaves exactly like
    // the plain allocator it wraps.
    this.capitalRing = new CapitalRing(config);
    this.paper = new PaperBroker(config);
    this.scanner = new MemecoinScanner(config);
    this.exchanges = new ExchangeManager(config);
    this.wallet = new WalletManager(config);
    // Delta-neutral funding harvest: manual, cross-venue (Base spot +
    // HyperLiquid perp short), never called by the auto-rotation loop.
    this.dnfh = new DnfhEngine({ exchanges: this.exchanges, wallet: this.wallet, config });
    this.notifier = new Notifier(config);

    // Activate the configured signal strategy (momentum | meanreversion | ensemble)
    strategy.configure({ strategy: config.strategy, ensembleMembers: config.ensembleMembers });
    // Auto-load optimizer-saved best params so the live engine uses tuned settings
    const savedParams = strategy.loadSavedParams();
    if (Object.keys(savedParams).length) {
      log.info("ENGINE", `Loaded tuned params for: ${Object.keys(savedParams).join(", ")}`);
    }

    this.cycle = 0;
    this.running = false;
    this.lastTick = null;
    this.lastEvaluations = [];
    this.lastTargets = {};
    this.lastVolatility = {};
    // Macro risk-appetite overlay — refreshed on its own slow cadence (see
    // start()), read synchronously each tick. Starts neutral/no-effect
    // until the first background refresh completes.
    this.lastMacroFlow = { ready: false, regime: "UNKNOWN", deployMultiplier: 1 };
    this.chronicle = [];
    this.listeners = [];

    this._loadChronicle();
  }

  onUpdate(fn) {
    this.listeners.push(fn);
  }

  _emit(state) {
    for (const fn of this.listeners) {
      try {
        fn(state);
      } catch (_) {}
    }
  }

  _loadChronicle() {
    try {
      if (fs.existsSync(CHRONICLE_PATH)) {
        const raw = JSON.parse(fs.readFileSync(CHRONICLE_PATH, "utf8"));
        if (Array.isArray(raw)) this.chronicle = raw.slice(-200);
      }
    } catch (_) {}
  }

  _appendChronicle(entry) {
    this.chronicle.push(entry);
    if (this.chronicle.length > 200) this.chronicle.shift();
    try {
      fs.mkdirSync(path.dirname(CHRONICLE_PATH), { recursive: true });
      fs.writeFileSync(CHRONICLE_PATH, JSON.stringify(this.chronicle.slice(-100), null, 2));
    } catch (_) {}
  }

  prices() {
    const out = {};
    for (const s of this.config.universe) out[s] = this.market.latest[s] || {};
    return out;
  }

  async tick() {
    this.cycle++;
    await this.market.refresh();
    const prices = this.prices();

    // Pre-compute equity/exposure BEFORE evaluating signals so inventory-aware
    // strategies (e.g. Avellaneda-Stoikov market making) can see "how much of
    // this symbol am I already holding" and skew their reservation price
    // accordingly, instead of blindly chasing the raw signal score.
    const preEquity = this.paper.equity(prices) || this.config.capital.startingEquity;

    // 1) Evaluate every symbol with its ROUTED strategy (per-symbol/per-strategy)
    const evaluations = this.config.universe.map((symbol) => {
      const series = this.market.getPrices(symbol);
      const stratName = this.config.resolveStrategy(symbol);
      const price = prices[symbol]?.price || null;
      const currentNotional = price ? this.paper.symbolExposure(symbol, price) : 0;
      const maxNotional = preEquity * this.config.capital.maxPositionPct;
      const inventoryRatio = maxNotional > 0 ? Math.max(0, Math.min(1, currentNotional / maxNotional)) : 0;
      const bars = this.market.getBars(symbol);
      const evalResult = strategy.evaluate(series, { strategy: stratName, context: { inventoryRatio, equity: preEquity, bars } });
      const pool = this.capitalRing.isSpear(stratName) ? "spear" : "shield";
      return { symbol, price, strategy: stratName, pool, ...evalResult };
    });
    this.lastEvaluations = evaluations;

    // 1b) Extreme Volatility Radar — real EWMA/realized-vol regime read per symbol
    const seriesBySymbol = {};
    for (const symbol of this.config.universe) seriesBySymbol[symbol] = this.market.getPrices(symbol);
    this.lastVolatility = volatilityRadar.analyzeUniverse(seriesBySymbol);
    for (const [symbol, v] of Object.entries(this.lastVolatility)) {
      if (v.ready && v.regime === "EXTREME" && !this._extremeVolAlerted?.[symbol]) {
        this._extremeVolAlerted = this._extremeVolAlerted || {};
        this._extremeVolAlerted[symbol] = true;
        this.notifier.notifyVolatility?.(symbol, v);
      } else if (v.ready && v.regime !== "EXTREME" && this._extremeVolAlerted?.[symbol]) {
        this._extremeVolAlerted[symbol] = false;
      }
    }

    // 2) Portfolio rotation targets (Sortino mode reuses the same
    // per-symbol series the volatility radar just computed; the macro
    // overlay can only ever shrink total deployment, never grow it).
    const { targets, ranked, pools } = this.capitalRing.computeTargets(evaluations, {
      seriesBySymbol,
      macro: this.lastMacroFlow,
    });
    this.lastTargets = targets;
    this.lastPools = pools || null;

    // 3) Risk + rebalance toward targets
    const equity = this.paper.equity(prices);
    this.risk.updateEquity(equity);
    this.risk.updateMarketStress(this.lastVolatility);
    this.lastSpearRisk = this.capitalRing.enabled ? this.capitalRing.updateSpearRisk(this.paper, equity, prices) : null;
    const minTradeUsd = this.config.capital.minTradeUsd || 1;
    const actions = [];

    for (const ev of evaluations) {
      const price = prices[ev.symbol]?.price;
      if (!price) continue;
      const targetWeight = targets[ev.symbol] || 0;
      const targetNotional = equity * targetWeight;
      const currentNotional = this.paper.symbolExposure(ev.symbol, price);
      const diff = targetNotional - currentNotional;

      // Only act on meaningful deltas (>0.5% of equity)
      if (Math.abs(diff) < equity * 0.005) continue;

      if (diff > 0) {
        // Want more -> BUY, but check risk gate
        const assessment = this.risk.assess({
          signal: ev.signal,
          confidence: ev.confidence,
          equity,
          currentExposure: this.paper.exposure(prices),
          symbolExposure: currentNotional,
          price,
          volatility: this.lastVolatility[ev.symbol],
        });

        if (!assessment.approved) {
          actions.push({ symbol: ev.symbol, intent: "BUY", skipped: assessment.reason });
          continue;
        }
        const notional = Math.min(diff, assessment.maxNotional, this.paper.cash);
        // Fee-aware floor: skip trades too small to survive fees + minimums.
        if (notional >= minTradeUsd) {
          const fill = await this._execute({ symbol: ev.symbol, side: "BUY", notional, price, tag: ev.pool });
          if (fill) actions.push({ symbol: ev.symbol, intent: "BUY", fill });
        } else if (notional > 0) {
          actions.push({ symbol: ev.symbol, intent: "BUY", skipped: `below min trade $${minTradeUsd}` });
        }
      } else {
        // Want less -> SELL (rotation out)
        const notional = Math.min(-diff, currentNotional);
        // Allow small SELLs only if they close the position (avoid fee-dust dust).
        if (notional >= minTradeUsd || notional >= currentNotional - 1e-9) {
          const fill = await this._execute({ symbol: ev.symbol, side: "SELL", notional, price, tag: ev.pool });
          if (fill) actions.push({ symbol: ev.symbol, intent: "SELL", fill });
        }
      }
    }

    const finalEquity = this.paper.recordEquity(prices);
    this.risk.updateEquity(finalEquity);

    this.lastTick = {
      cycle: this.cycle,
      ts: Date.now(),
      dataSource: this.market.source,
      equity: Number(finalEquity.toFixed(2)),
      actions,
      ranked: ranked.slice(0, 10),
      targets,
    };

    this._appendChronicle({
      cycle: this.cycle,
      ts: Date.now(),
      dataSource: this.market.source,
      equity: Number(finalEquity.toFixed(2)),
      actionCount: actions.length,
      topSignal: ranked[0]
        ? { symbol: ranked[0].symbol, signal: ranked[0].signal, score: Number(ranked[0].score.toFixed(3)) }
        : null,
    });

    const state = this.snapshot();
    this._emit(state);
    return state;
  }

  async _execute({ symbol, side, notional, price, tag }) {
    // PAPER path (default & safe)
    if (!this.config.canTradeLive()) {
      const fill = this.paper.execute({ symbol, side, notional, price, tag });
      if (fill) this.notifier.notifyFill(fill);
      return fill;
    }

    // Survivability gate: NEVER risk real money off a fabricated/stale
    // price. If this symbol's current tick came from the SIM fallback (feed
    // unreachable) rather than a real LIVE quote, refuse the live order and
    // fall back to the paper ledger so the engine keeps running instead of
    // silently trading on made-up numbers.
    const dataSource = this.market.latest[symbol]?.source;
    if (dataSource !== "LIVE") {
      log.error(
        "ENGINE",
        `REFUSED live ${side} ${symbol}: price source is "${dataSource || "UNKNOWN"}", not LIVE — ` +
          "will not place a real order against simulated/stale data. Falling back to paper fill."
      );
      const fill = this.paper.execute({ symbol, side, notional, price, tag });
      if (fill) this.notifier.notifyFill({ ...fill, note: `LIVE blocked: price source was ${dataSource || "UNKNOWN"}, not LIVE` });
      return fill;
    }

    // LIVE path (only reachable when fully armed AND data is confirmed LIVE)
    try {
      const venue = this.exchanges.primary;
      const venueSymbol = this._venueSymbol(symbol, venue);
      const order =
        side === "BUY"
          ? { symbol: venueSymbol, side, quoteOrderQty: notional.toFixed(2) }
          : { symbol: venueSymbol, side, quantity: (notional / price).toFixed(8) };
      const result = await this.exchanges.routeLiveOrder(order, venue);
      log.warn("ENGINE", `LIVE fill ${side} ${symbol}: ${result.status}`);
      // Mirror into paper ledger so equity/positions stay coherent in the UI
      const mirror = this.paper.execute({ symbol, side, notional, price, tag });
      const fill = { ...mirror, mode: "LIVE", venue, raw: result.raw };
      this.notifier.notifyFill(fill);
      return fill;
    } catch (e) {
      log.error("ENGINE", `LIVE order failed, falling back to paper ledger: ${e.message}`);
      const fill = this.paper.execute({ symbol, side, notional, price, tag });
      if (fill) this.notifier.notifyFill(fill);
      return fill;
    }
  }

  _venueSymbol(symbol, venue) {
    // symbol is like BTC-USD
    const [base, quote] = symbol.split("-");
    if (venue === "binanceus") return `${base}${quote === "USD" ? "USD" : quote}`;
    if (venue === "kraken") return `${base === "BTC" ? "XBT" : base}${quote}`;
    return symbol; // coinbase uses BTC-USD
  }

  async start(intervalMs = 5000) {
    if (this.running) return;
    this.running = true;
    log.info("ENGINE", `Started — mode=${this.config.mode} liveArmed=${this.config.canTradeLive()} interval=${intervalMs}ms`);
    // Warm up indicator history before the first real tick
    try {
      await this.market.warmup(60, 300);
    } catch (e) {
      log.warn("ENGINE", `warmup skipped: ${e.message}`);
    }
    this._loop = setInterval(() => {
      this.tick().catch((e) => log.error("ENGINE", `tick error: ${e.message}`));
    }, intervalMs);
    // scan memecoins on a slower cadence + fire detection alerts
    const runScan = () =>
      this.scanner
        .scan()
        .then((snap) => this.notifier.notifyMemecoins(snap.candidates || []))
        .catch((e) => log.error("MEMECOIN", e.message));
    runScan();
    this._scanLoop = setInterval(runScan, 30000);
    // macro risk-appetite overlay on its own slow cadence (public APIs,
    // minutes-scale data — no reason to hit them every 5s tick)
    const runMacro = () =>
      macroFlow
        .getFlow()
        .then((flow) => { this.lastMacroFlow = flow; })
        .catch((e) => log.error("INTELLIGENCE", `macro flow refresh failed: ${e.message}`));
    runMacro();
    this._macroLoop = setInterval(runMacro, 5 * 60 * 1000);
    // real OHLCV bars (5-min candles) for bar-dependent strategies (ATR,
    // stochastic, Fibonacci swing detection) — slow cadence, not every tick
    const runBars = () => this.market.refreshBars(300).catch((e) => log.error("MARKET", `bar refresh failed: ${e.message}`));
    runBars();
    this._barsLoop = setInterval(runBars, 5 * 60 * 1000);
    // DNFH funding-rate epoch recording — real ~1h cadence samples so the
    // "3 consecutive negative epochs" rebalance trigger reflects elapsed
    // time, not just whenever someone happens to load the dashboard.
    // Harmless (read-only) even if hyperliquid isn't configured — just skips.
    const runDnfhEpoch = () => this.dnfh.recordFundingEpoch().catch((e) => log.error("DNFH", `epoch recording failed: ${e.message}`));
    runDnfhEpoch();
    this._dnfhEpochLoop = setInterval(runDnfhEpoch, 60 * 60 * 1000);
    // exchange health on startup
    this.exchanges.healthCheck().catch(() => {});
    // kick an immediate tick
    this.tick().catch((e) => log.error("ENGINE", e.message));
  }

  stop() {
    this.running = false;
    clearInterval(this._loop);
    clearInterval(this._scanLoop);
    clearInterval(this._macroLoop);
    clearInterval(this._barsLoop);
    clearInterval(this._dnfhEpochLoop);
    log.info("ENGINE", "Stopped");
  }

  snapshot() {
    return {
      system: "OMNIVEX / SAINT CORE",
      version: "2.0.0",
      ts: Date.now(),
      running: this.running,
      cycle: this.cycle,
      mode: this.config.mode,
      liveArmed: this.config.canTradeLive(),
      dataSource: this.market.source,
      strategy: {
        active: this.config.strategy,
        ensembleMembers: this.config.ensembleMembers,
        available: strategy.registry.list(),
        routes: this.config.universe.reduce((acc, s) => {
          acc[s] = this.config.resolveStrategy(s);
          return acc;
        }, {}),
        tunedParams: strategy.activeParams(),
      },
      market: this.market.snapshot(),
      signals: this.lastEvaluations.map((e) => ({
        symbol: e.symbol,
        price: e.price,
        signal: e.signal,
        strategy: e.strategy,
        confidence: Number((e.confidence || 0).toFixed(3)),
        score: Number((e.score || 0).toFixed(3)),
        rsi: e.indicators?.rsi != null ? Number(e.indicators.rsi.toFixed(1)) : null,
        reasons: e.reasons,
      })),
      targets: this.lastTargets,
      volatility: this.lastVolatility,
      macro: this.lastMacroFlow,
      portfolio: this.paper.snapshot(this.prices()),
      risk: this.risk.snapshot(),
      memecoins: this.scanner.snapshot(),
      exchanges: this.exchanges.snapshot(),
      wallet: this.wallet.status(),
      alerts: this.notifier.status(),
      lastTick: this.lastTick,
      chronicle: this.chronicle.slice(-30).reverse(),
      logs: log.recent(60),
    };
  }
}

module.exports = Engine;
