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
  },
};

/**
 * The single source of truth for "are we allowed to send a real order?"
 * ALL three conditions must be true. Defense in depth.
 */
config.canTradeLive = function canTradeLive() {
  return (
    config.mode === "LIVE" &&
    config.liveTradingEnabled === true &&
    config.liveTradingConfirm === "I ACCEPT THE RISK"
  );
};

/**
 * Whether a REAL on-chain swap may be broadcast. Requires the full live
 * gate PLUS a dedicated on-chain arm flag. Anything less = quote-only.
 */
config.canSwapOnchain = function canSwapOnchain() {
  return config.canTradeLive() && config.wallet.onchainEnabled === true;
};

module.exports = config;
