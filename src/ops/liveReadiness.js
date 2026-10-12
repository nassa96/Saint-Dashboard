/*
 * Honest go/no-go assessment for unattended live funds.
 * This is deliberately separate from the trading strategy: a green signal is
 * never sufficient to make an exchange connection production-ready.
 */

const SUPPORTED_SPOT_VENUES = new Set(["binanceus", "coinbase", "kraken"]);
const MAX_PRICE_AGE_MS = 30_000;
const MAX_BALANCE_VERIFICATION_AGE_MS = 5 * 60 * 1000;

function assessLiveReadiness(config, engine, auth) {
  const checks = [];
  const add = (id, label, status, detail, blocking = true) => {
    checks.push({ id, label, status, detail, blocking });
  };

  const liveGateConfigured = Boolean(config.liveGateConfigured?.());
  add(
    "deployment-locks",
    "Deployment live locks",
    liveGateConfigured ? "pass" : "blocked",
    liveGateConfigured
      ? "TRADING_MODE, LIVE_TRADING_ENABLED, and LIVE_TRADING_CONFIRM are all set."
      : "Keep PAPER defaults for rollout. Live requires TRADING_MODE=LIVE, LIVE_TRADING_ENABLED=true, and the exact LIVE_TRADING_CONFIRM phrase.",
  );

  const authEnabled = Boolean(auth?.enabled);
  add(
    "dashboard-auth",
    "Dashboard authentication",
    authEnabled ? "pass" : "blocked",
    authEnabled
      ? "Password protection is enabled. Do not expose this service without HTTPS and restricted access."
      : "DASHBOARD_PASSWORD is not set; anyone who can reach the dashboard can control it.",
  );

  const password = String(config.auth?.password || "");
  add(
    "dashboard-password-strength",
    "Dashboard password strength",
    password.length >= 16 ? "pass" : "blocked",
    password.length >= 16
      ? "Password length is at least 16 characters; keep it unique and private."
      : "Use a strong, unique DASHBOARD_PASSWORD of at least 16 characters before sharing or arming.",
  );

  const secret = String(config.auth?.sessionSecret || "");
  const stableSecret = secret.length >= 32;
  add(
    "session-secret",
    "Stable session signing secret",
    stableSecret ? "pass" : "blocked",
    stableSecret
      ? "A persistent session secret is configured."
      : "Set SESSION_SECRET to a stable random value of at least 32 characters; auto-generated secrets invalidate sessions after restart.",
  );

  const primary = String(engine?.exchanges?.primary || config.exchanges?.primary || "").toLowerCase();
  const knownPrimary = SUPPORTED_SPOT_VENUES.has(primary);
  add(
    "primary-venue",
    "Primary execution venue",
    knownPrimary ? "pass" : "blocked",
    knownPrimary
      ? `${primary} is a configured spot connector (not a leveraged/perpetual venue).`
      : `${primary || "No venue"} is not an enabled spot execution venue.`,
  );

  const venue = engine?.exchanges?.venues?.[primary];
  const hasCredentials = Boolean(venue?.hasCredentials?.());
  add(
    "venue-credentials",
    "Primary venue credentials",
    hasCredentials ? "pass" : "blocked",
    hasCredentials
      ? "Key material is present on the server; this does not prove trade permission or withdrawal restrictions."
      : "No complete API key/secret is configured for the primary venue.",
  );

  const balanceCheck = engine?.exchanges?.getBalanceVerification?.(primary, MAX_BALANCE_VERIFICATION_AGE_MS) || { verified: false, verifiedAt: null };
  add(
    "balance-read",
    "Authenticated balance read",
    balanceCheck.verified ? "pass" : "blocked",
    balanceCheck.verified
      ? `A read-only balance request succeeded ${new Date(balanceCheck.verifiedAt).toLocaleString()}.`
      : "Run Save & verify or Refresh Balances and confirm the authenticated balance call succeeds (public API reachability is not credential verification).",
  );

  const isTestnet = Boolean(config.useTestnet);
  const testnetSafe = !isTestnet || primary === "coinbase";
  add(
    "endpoint-mode",
    "Venue endpoint mode",
    testnetSafe ? (isTestnet ? "required" : "pass") : "blocked",
    !isTestnet
      ? "Production endpoints are selected. Verify the venue and key permissions before any real funds are involved."
      : primary === "coinbase"
        ? "Coinbase sandbox is selected, but it has not been validated for this deployment; market data still comes from Coinbase production public endpoints."
        : `${primary || "Selected venue"} does not provide a supported spot testnet in this connector; USE_TESTNET=true does not protect this route from production orders.`,
  );

  const symbols = engine?.market?.universe || config.universe || [];
  const latest = engine?.market?.latest || {};
  const now = Date.now();
  const staleOrSim = symbols.filter((symbol) => {
    const tick = latest[symbol];
    const ageMs = tick?.ts ? now - tick.ts : Infinity;
    return !tick || tick.source !== "LIVE" || !Number.isFinite(tick.ts) || ageMs < 0 || ageMs > MAX_PRICE_AGE_MS;
  });
  const marketReady = symbols.length > 0 && staleOrSim.length === 0;
  add(
    "market-data",
    "Fresh live prices for the whole universe",
    marketReady ? "pass" : "blocked",
    marketReady
      ? `Every configured symbol has a LIVE quote less than ${Math.round(MAX_PRICE_AGE_MS / 1000)} seconds old.`
      : staleOrSim.length
        ? `SIM, missing, or stale quote for: ${staleOrSim.join(", ")}. No live order may be priced from these values.`
        : "No configured market symbols are available.",
  );

  const feedMatchesVenue = primary === "coinbase" && !isTestnet;
  add(
    "price-venue-parity",
    "Price feed matches execution venue",
    feedMatchesVenue ? "pass" : "blocked",
    feedMatchesVenue
      ? "The current public price source is Coinbase, matching the selected production venue."
      : "MarketData is hard-wired to Coinbase public spot prices. Kraken/Binance.US or Coinbase sandbox execution would use a different venue/market than the signal price.",
  );

  const tickAgeMs = engine?.lastTick?.ts ? now - engine.lastTick.ts : Infinity;
  const tickFresh = tickAgeMs >= 0 && tickAgeMs <= MAX_PRICE_AGE_MS;
  const engineReady = Boolean(engine?.running && tickFresh && !engine?.liveExecutionFault);
  add(
    "engine-health",
    "Engine heartbeat",
    engineReady ? "pass" : "blocked",
    engineReady
      ? "The engine is running and has completed a recent tick."
      : engine?.liveExecutionFault
        ? "A live-execution fault is latched; inspect the exchange and application logs before resuming."
        : "Start the engine and wait for a successful recent tick before assessing a live session.",
  );

  const capital = config.capital || {};
  const safeRiskCaps =
    Number(capital.maxTradeUsd) > 0 &&
    Number(capital.perTradeRiskPct) > 0 && Number(capital.perTradeRiskPct) <= 0.01 &&
    Number(capital.maxPositionPct) > 0 && Number(capital.maxPositionPct) <= 0.1 &&
    Number(capital.maxPortfolioRiskPct) > 0 && Number(capital.maxPortfolioRiskPct) <= 0.4 &&
    Number(capital.maxDailyDrawdownPct) > 0 && Number(capital.maxDailyDrawdownPct) <= 0.05;
  add(
    "risk-limits",
    "Explicit conservative exposure caps",
    safeRiskCaps ? "pass" : "blocked",
    safeRiskCaps
      ? `Per-entry notional cap: $${Number(capital.maxTradeUsd).toFixed(2)}; configured limits are within the conservative ceiling.`
      : "Set MAX_TRADE_USD to a small absolute amount and use <=1% per-entry notional, <=10% per asset, <=40% total deployment, and <=5% daily drawdown. Current caps are not within that live pre-flight profile.",
  );

  add(
    "key-permissions",
    "API key permissions / custody",
    "required",
    "Must be checked manually at the venue: trade-only, withdrawals disabled, IP allowlist enabled where available. The app cannot verify these permissions from a balance read.",
  );

  add(
    "account-reconciliation",
    "Live account balance and position reconciliation",
    "blocked",
    "Not implemented: the engine sizes from a local paper ledger and configured STARTING_EQUITY, not exchange-reported equity, free collateral, or open positions.",
  );

  add(
    "order-lifecycle",
    "Order acknowledgements, fills, and duplicate recovery",
    "blocked",
    "Not production-certified: connectors do not consistently poll/reconcile final fills, partial fills, open orders, or ambiguous timeouts with idempotent recovery. Kraken AddOrder is a submission acknowledgement, not a confirmed fill.",
  );

  add(
    "broker-protection",
    "Broker-side protective orders / process-failure safety",
    "blocked",
    "Not implemented: Aegis drawdown is calculated from the local paper ledger; there are no venue-native stop/bracket orders to protect open live positions if the process or feed stops.",
  );

  add(
    "strategy-evidence",
    "Walk-forward and live-data paper evidence",
    "required",
    "Must be completed and reviewed by the operator: a positive backtest alone is not evidence of an edge. Run validation on real history and paper trade for multiple weeks before considering any live test.",
  );

  add(
    "runtime-confirmation",
    "Fresh runtime operator confirmation",
    config.arming?.armed ? "pass" : "pending",
    config.arming?.armed
      ? `Runtime confirmation recorded ${new Date(config.arming.armedAt).toLocaleString()}.`
      : "A fresh dashboard confirmation is required after all other safety checks; runtime arms are not restored after restart.",
    false,
  );

  const blockers = checks.filter((check) => check.blocking && check.status !== "pass");
  const canArm = blockers.length === 0;
  return {
    asOf: new Date(now).toISOString(),
    ready: canArm,
    canArm,
    canTradeLive: Boolean(config.canTradeLive?.()),
    mode: config.mode,
    primary,
    summary: canArm
      ? "All automated and operator-supplied checks passed. This is not a profitability guarantee."
      : `NOT READY FOR LIVE FUNDS — ${blockers.length} blocking or required check(s) remain. Paper trading is the supported rollout mode.`,
    blockers: blockers.map(({ id, label, status, detail }) => ({ id, label, status, detail })),
    checks,
    limits: {
      maxPriceAgeMs: MAX_PRICE_AGE_MS,
      maxBalanceVerificationAgeMs: MAX_BALANCE_VERIFICATION_AGE_MS,
    },
  };
}

module.exports = { assessLiveReadiness, MAX_PRICE_AGE_MS, MAX_BALANCE_VERIFICATION_AGE_MS };
