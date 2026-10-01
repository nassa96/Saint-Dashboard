/* ============================================================
   SAINT / OMNIVEX — CENTRAL CONFIG
   Loads from environment with safe, conservative defaults.
   ============================================================ */

// Minimal .env loader (no external dependency).
const fs = require("fs");
const path = require("path");

(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) {
    console.warn("[CONFIG] .env load skipped:", e.message);
  }
})();

const bool = (v, d = false) =>
  v === undefined ? d : String(v).toLowerCase() === "true";
const num = (v, d) => (v === undefined || v === "" ? d : Number(v));
const list = (v, d = []) =>
  v === undefined || v === ""
    ? d
    : String(v)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

const config = {
  port: num(process.env.PORT, 3000),

  auth: {
    user: process.env.DASHBOARD_USER || "admin",
    password: process.env.DASHBOARD_PASSWORD || "",
    sessionSecret: process.env.SESSION_SECRET || "",
    get enabled() {
      return Boolean(process.env.DASHBOARD_PASSWORD);
    },
  },

  alerts: {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
    discordWebhook: process.env.DISCORD_WEBHOOK_URL || "",
    memecoinMinScore: num(process.env.ALERT_MEMECOIN_MIN_SCORE, 70),
    onFills: bool(process.env.ALERT_ON_FILLS, true),
  },

  mode: (process.env.TRADING_MODE || "PAPER").toUpperCase(),
  liveTradingEnabled: bool(process.env.LIVE_TRADING_ENABLED, false),
  liveTradingConfirm: process.env.LIVE_TRADING_CONFIRM || "",
  useTestnet: bool(process.env.USE_TESTNET, true),

  capital: {
    startingEquity: num(process.env.STARTING_EQUITY, 10000),
    maxPositionPct: num(process.env.MAX_POSITION_PCT, 0.2),
    maxPortfolioRiskPct: num(process.env.MAX_PORTFOLIO_RISK_PCT, 0.6),
    maxDailyDrawdownPct: num(process.env.MAX_DAILY_DRAWDOWN_PCT, 0.1),
    perTradeRiskPct: num(process.env.PER_TRADE_RISK_PCT, 0.02),
    minSignalConfidence: num(process.env.MIN_SIGNAL_CONFIDENCE, 0.55),
    // Fee-aware floor: never place a trade smaller than this many USD.
    // Tiny trades get devoured by fees + exchange minimums. Default $10.
    minTradeUsd: num(process.env.MIN_TRADE_USD, 10),
    // "score" (default, conviction-weighted rotation) | "sortino" (blends
    // conviction with each candidate's trailing Sortino ratio, so a long
    // that's had a smoother, less-painful ride gets sized up relative to
    // one with the same score but nastier downside history).
    allocationMethod: (process.env.ALLOCATION_METHOD || "score").toLowerCase(),
    // Survivability: if this fraction (or more) of the tracked universe is
    // simultaneously reading "EXTREME" on the volatility radar, treat it as
    // a market-wide stress event and pause NEW entries (exits still run)
    // until conditions calm back down. Independent of the daily-drawdown
    // breaker, and auto-clears when the stress passes (no loss has
    // necessarily happened yet — this is precautionary, not punitive).
    maxExtremeFractionForHalt: num(process.env.MAX_EXTREME_FRACTION_FOR_HALT, 0.5),
    // Macro risk-appetite overlay (Fear & Greed + global market-cap trend)
    // nudges deployable capital down a bit in a RISK_OFF macro backdrop and
    // up a bit in RISK_ON — bounded, never more than a modest tilt. Set to
    // false to disable and always deploy at the raw allocator target.
    macroOverlayEnabled: bool(process.env.MACRO_OVERLAY_ENABLED, true),
  },

  universe: list(process.env.TRADE_UNIVERSE, [
    "BTC-USD",
    "ETH-USD",
    "SOL-USD",
    "AVAX-USD",
    "LINK-USD",
    "DOGE-USD",
  ]),

  // Active signal strategy: momentum | meanreversion | ensemble
  strategy: (process.env.STRATEGY || "momentum").toLowerCase(),
  ensembleMembers: list(process.env.ENSEMBLE_MEMBERS, ["momentum", "meanreversion"]),

  // Per-symbol strategy routing. Explicit map wins; otherwise majors vs alts.
  // SYMBOL_STRATEGIES="BTC-USD:momentum,SOL-USD:meanreversion"
  strategyRoutes: (function () {
    const raw = process.env.SYMBOL_STRATEGIES || "";
    const out = {};
    for (const pair of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [sym, strat] = pair.split(":").map((s) => s.trim());
      if (sym && strat) out[sym.toUpperCase()] = strat.toLowerCase();
    }
    return out;
  })(),
  majors: list(process.env.MAJORS, ["BTC-USD", "ETH-USD"]),
  majorsStrategy: (process.env.STRATEGY_MAJORS || "").toLowerCase(),
  altsStrategy: (process.env.STRATEGY_ALTS || "").toLowerCase(),

  // Published entry-tier spot fees (maker/taker %, base-tier, 2025-2026).
  // Used for fee-aware sizing + the venue comparison in the dashboard.
  venueFees: {
    coinbase: { maker: 0.40, taker: 0.60, label: "Coinbase Advanced" },
    binanceus: { maker: 0.10, taker: 0.10, label: "Binance.US" },
    kraken: { maker: 0.40, taker: 0.80, label: "Kraken Pro" },
  },

  exchanges: {
    primary: (process.env.PRIMARY_EXCHANGE || "coinbase").toLowerCase(),
    binanceus: {
      key: process.env.BINANCEUS_API_KEY || "",
      secret: process.env.BINANCEUS_API_SECRET || "",
    },
    coinbase: {
      key: process.env.COINBASE_API_KEY || "",
      secret: process.env.COINBASE_API_SECRET || "",
      passphrase: process.env.COINBASE_API_PASSPHRASE || "",
    },
    kraken: {
      key: process.env.KRAKEN_API_KEY || "",
      secret: process.env.KRAKEN_API_SECRET || "",
    },
    // Perps DEX — monitor-only by default. Reads need ONLY a public wallet
    // address (no key of any kind). privateKey (optional) should be a
    // dedicated Hyperliquid "API wallet" key that can only trade, never
    // withdraw — never your main wallet's key. See docs/VENUES.md.
    hyperliquid: {
      walletAddress: process.env.HYPERLIQUID_WALLET_ADDRESS || "",
      privateKey: process.env.HYPERLIQUID_API_PRIVATE_KEY || "",
      // DNFH (delta-neutral funding harvest) is a yield strategy, not a
      // directional leverage play — hard-capped low on purpose.
      maxLeverage: num(process.env.HYPERLIQUID_MAX_LEVERAGE, 2),
    },
  },

  memecoin: {
    chains: list(process.env.MEMECOIN_CHAINS, ["solana", "base", "ethereum"]),
    minLiquidityUsd: num(process.env.MEMECOIN_MIN_LIQUIDITY_USD, 15000),
    minVolumeUsd: num(process.env.MEMECOIN_MIN_VOLUME_USD, 50000),
  },

  wallet: {
    onchainEnabled: bool(process.env.ONCHAIN_TRADING_ENABLED, false),
    maxSwapUsd: num(process.env.MAX_SWAP_USD, 25),
    slippageBps: num(process.env.SWAP_SLIPPAGE_BPS, 100),
    solana: {
      privateKey: process.env.SOLANA_PRIVATE_KEY || "",
      rpc: process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com",
    },
    evm: {
      privateKey: process.env.EVM_PRIVATE_KEY || "",
      chain: (process.env.EVM_CHAIN || "base").toLowerCase(),
      rpc: process.env.EVM_RPC || "",
      zeroxApiKey: process.env.ZEROX_API_KEY || "",
    },
    // Tron — read-only balance monitoring works out of the box (public
    // TronGrid API). Swaps are intentionally disabled until a vetted
    // aggregator is configured; see docs/TRON_SWAP.md.
    tron: {
      address: process.env.TRON_ADDRESS || "", // for read-only monitoring w/ no key at all
      privateKey: process.env.TRON_PRIVATE_KEY || "",
      apiBase: process.env.TRON_API_BASE || "https://api.trongrid.io",
      apiKey: process.env.TRONGRID_API_KEY || "",
      sunswapApiKey: process.env.SUNSWAP_API_KEY || "",
    },
    // MEV defense (protects YOUR swaps from being sandwiched — see
    // src/wallet/mevDefense.js). All optional; safe no-op defaults.
    mev: {
      splitThresholdUsd: num(process.env.MEV_SPLIT_THRESHOLD_USD, 250),
      maxChunks: num(process.env.MEV_MAX_CHUNKS, 4),
      minChunkUsd: num(process.env.MEV_MIN_CHUNK_USD, 25),
      chunkDelayMs: num(process.env.MEV_CHUNK_DELAY_MS, 4000),
      alwaysProtect: bool(process.env.MEV_ALWAYS_PROTECT, false),
      // Flashbots Protect RPC — Ethereum mainnet only today. Routing a tx
      // here keeps it out of the public mempool (no free lunch: only
      // meaningful on chains with a real protect-relay ecosystem).
      protectedRelayUrl: process.env.EVM_PROTECT_RPC || "",
    },
  },
};

/**
 * The single source of truth for "are we allowed to send a real order?"
 * ALL three conditions must be true. Defense in depth.
 */
/**
 * Worst-case round-trip fee % for a venue (taker in + taker out).
 * A strategy must clear this on every trade just to break even.
 */
config.roundTripFeePct = function roundTripFeePct(venue) {
  const f = config.venueFees[(venue || config.exchanges.primary || "coinbase").toLowerCase()];
  return f ? (f.taker * 2) : 1.2;
};

// ---- Runtime live-arming (the "one-click arm" from the dashboard) ----
// Default OFF. Persisted to data/live_arm.json so a redeploy keeps the
// operator's intent; can be disarmed instantly (kill switch). Requires the
// exact confirmation phrase to arm.
const ARM_PATH = path.join(__dirname, "data", "live_arm.json");
const ARM_PHRASE = "I ACCEPT THE RISK";
config.arming = { armed: false, armedAt: null };
(function loadArm() {
  try {
    const s = JSON.parse(fs.readFileSync(ARM_PATH, "utf8"));
    if (s && s.armed === true) config.arming = s;
  } catch (_) {
    /* no persisted arm state -> stays OFF */
  }
})();

config.armLive = function armLive(confirm) {
  if (confirm !== ARM_PHRASE) {
    throw new Error(`confirmation phrase must be exactly: ${ARM_PHRASE}`);
  }
  config.arming = { armed: true, armedAt: Date.now() };
  try {
    fs.mkdirSync(path.dirname(ARM_PATH), { recursive: true });
    fs.writeFileSync(ARM_PATH, JSON.stringify(config.arming, null, 2), { mode: 0o600 });
  } catch (_) {}
  return config.arming;
};

config.disarmLive = function disarmLive() {
  config.arming = { armed: false, armedAt: null, disarmedAt: Date.now() };
  try {
    fs.writeFileSync(ARM_PATH, JSON.stringify(config.arming, null, 2), { mode: 0o600 });
  } catch (_) {}
  return config.arming;
};

config.canTradeLive = function canTradeLive() {
  // Two independent ways to arm, both requiring the confirmation phrase:
  //  1) Infra opt-in via .env (MODE=LIVE + LIVE_TRADING_ENABLED + confirm)
  //  2) Runtime web arm from the Connections page (config.arming.armed)
  const envArmed =
    config.mode === "LIVE" &&
    config.liveTradingEnabled === true &&
    config.liveTradingConfirm === ARM_PHRASE;
  return envArmed || config.arming.armed === true;
};

config.liveStatus = function liveStatus() {
  return {
    canTradeLive: config.canTradeLive(),
    armPhrase: ARM_PHRASE,
    webArmed: config.arming.armed === true,
    armedAt: config.arming.armedAt || null,
    envArmed:
      config.mode === "LIVE" &&
      config.liveTradingEnabled === true &&
      config.liveTradingConfirm === ARM_PHRASE,
    useTestnet: config.useTestnet,
    primary: config.exchanges.primary,
    mode: config.mode,
  };
};

/**
 * Whether a REAL on-chain swap may be broadcast. Requires the full live
 * gate PLUS a dedicated on-chain arm flag. Anything less = quote-only.
 */
config.canSwapOnchain = function canSwapOnchain() {
  return config.canTradeLive() && config.wallet.onchainEnabled === true;
};

/**
 * Resolve which strategy should evaluate a given symbol.
 * Priority: explicit route -> majors/alts split -> global default.
 */
config.resolveStrategy = function resolveStrategy(symbol) {
  const s = (symbol || "").toUpperCase();
  if (config.strategyRoutes[s]) return config.strategyRoutes[s];
  const isMajor = config.majors.map((m) => m.toUpperCase()).includes(s);
  if (isMajor && config.majorsStrategy) return config.majorsStrategy;
  if (!isMajor && config.altsStrategy) return config.altsStrategy;
  return config.strategy;
};

module.exports = config;
