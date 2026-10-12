# Saint Dashboard — release and live-funds readiness review

**Review date:** 2026-10-12

**Scope:** checked-out source, local configuration defaults, and offline test suite.

**Not in scope:** the user's Kraken account, its permissions/balances, deployed host, or any live order. No exchange credentials were available to this review, no remote account was queried, and no funds were touched.

## Verdict

| Use | Verdict | Conditions |
|---|---|---|
| Private PAPER trial with a few testers | **Conditional GO** | Keep all live/on-chain switches off; use real market data only when the host confirms `DATA: LIVE`; put the instance behind authentication, HTTPS, and an access restriction. This is a single shared instance, not a multi-user product. |
| Unattended automated live trading | **NO-GO** | The readiness API and dashboard intentionally block live arming until exchange state reconciliation, order/fill recovery, and live-position protection are implemented and independently tested. |
| Kraken real-money execution | **NO-GO** | A successful balance read proves only authenticated read access. Kraken market-order filters, production fills, status polling, and reconciliation have not been verified. The buy-notional payload defect found in this review is corrected, but that alone is not exchange certification. |

A strategy or interface cannot guarantee a profitable session. The application must not be treated as financial advice or as a source of guaranteed returns.

## Autonomy audit

- The rotation engine evaluates strategies and rebalances a **local PAPER ledger**. Its configured starting equity is not synced to exchange equity, free balance, locked balance, or open positions.
- `PER_TRADE_RISK_PCT` now limits entry **notional**; it is not loss-at-risk. The spot orders do not have exchange-native stop-loss/bracket orders.
- Signals and volatility readings are heuristics. Backtesting, optimization, and validation tools exist, but the application does not store a signed, independently reviewed record of multi-week real-data paper performance.
- Memecoin scanning and AVSS are detection/reporting features, not autonomous trading. DNFH is an advanced manual plan/execute flow, and its two legs can be out of sync. `overlord`, `autonomouswealth`, and `dnfh` strategy slots remain FLAT placeholders.
- The price service is Coinbase public spot data even if a different venue is selected for execution. Cross-venue spread, precision, minimum size, liquidity, and fees can make a signal's sizing/price invalid at the chosen venue.
- A paper-book drawdown breaker is not a live-account breaker. If a server, feed, or exchange connection fails, an unprotected real position can remain open at the venue.

## Findings and changes in this pass

### Corrected

1. **Dashboard arm bypassed deployment locks.** Previously, a runtime UI arm could make `canTradeLive()` true even with `TRADING_MODE=PAPER` or `LIVE_TRADING_ENABLED=false`. Live permission now requires all deployment locks **and** a fresh runtime confirmation; disabling the master switch always blocks it.
2. **Runtime live arm survived process restarts.** A saved arm is no longer restored. Restarting returns to disarmed/PAPER and requires a fresh operator action.
3. **Engine stop was not a live disarm.** `POST /api/engine/stop` now stops scheduled work and closes the runtime arm. It cannot cancel an exchange order already accepted or flatten a venue position.
4. **Unsafe prices could be mistaken for fills.** PAPER now skips fills on SIM, missing, or stale quotes; live execution fails closed and latches a halt on the same quote failures or ambiguous order errors. Only an explicitly confirmed venue fill can be mirrored locally.
5. **Async ticks could overlap.** Tick calls now serialize; an overlapping call is skipped rather than sizing against a stale exposure snapshot.
6. **Kraken BUY orders did not map USD notional to Kraken's API shape.** BUYs now use quote volume with Kraken's `viqc` flag, and the nonce is monotonic within a process. Kraken `AddOrder` is still reported as `submitted`, not as a confirmed fill.
7. **Public venue reachability could look like key verification.** Authenticated balance-read verification is tracked separately from public health checks and mere key presence.
8. **The configured per-entry percentage was not enforced.** It now caps each entry's notional, with docs corrected so it is not confused with a true stop-based risk measure.
9. **The dashboard did not expose a useful go/no-go audit.** It now shows `/api/live/readiness`, including data freshness, credentials/balance verification, auth/session setup, risk caps, venue-mode mismatch, and structural execution blockers. `/api/live/arm` refuses while any blocking check remains.
10. **`MODE=PAPER` in presets did not affect the `TRADING_MODE` config setting.** The loader accepts the legacy alias, and bundled presets now use `TRADING_MODE`.
11. **Inline comments in `.env` presets could turn numeric safety limits into `NaN`.** The dotenv loader now strips unquoted trailing comments without corrupting quoted values; a regression test covers position limits, dollar caps, mode, and a quoted `#` in a password.
12. **Synthetic fallback prices could generate apparent PAPER performance.** Both modes now require a fresh `LIVE` public quote for execution; PAPER skips unsafe quotes, while a live attempt fails closed and latches a halt.

### Remaining live-funds blockers

These are intentional blockers, not merely warnings:

- Exchange balance, position, and open-order reconciliation against a live equity source.
- A normalized order lifecycle with final/partial-fill polling, client-order idempotency, and safe recovery after a network timeout where order state is unknown.
- Venue-specific product discovery and enforcement of symbol aliases, quantity/price precision, minimum notional, available balance, and fee/slippage limits.
- Exchange-native protective orders and a tested emergency process for feed loss, process termination, or drawdown.
- Execution-price/feed parity for Kraken and Binance.US; the present market data service reads Coinbase.
- A validated sandbox or non-production execution path for each connector. `USE_TESTNET=true` does not make Kraken spot or Binance.US use a testnet.
- A multi-week live-data PAPER record plus independent review of out-of-sample validation, fees, slippage, and drawdown behavior.
- Manual confirmation at the exchange that API keys are trade-only, withdrawals are disabled, and IP allowlisting is configured. Saint cannot inspect those permissions.

The `/api/live/arm` endpoint currently returns a locked response while these conditions remain unmet. Do not remove this gate to force a live session.

### Dependency security note

A compatible dependency refresh removed the reported critical/high advisories and
updated the Express/proxy dependencies; `axios` is pinned to the patched 1.20.0
for TronWeb. `npm audit` still reports **4 moderate advisories** through
`@solana/web3.js@1.99.0` → `jayson` → `stream-json` / `uuid`. npm's suggested
fix is a major `@solana/web3.js@3.0.2` upgrade. That breaking API change was not
applied without Solana wallet integration tests; resolve and retest before
on-chain functionality is enabled or exposed.

## Safe tester rollout checklist

1. Use a private, isolated PAPER deployment per testing group. There is no per-user login/authorization model, tenant isolation, or independent portfolio ledger; testers on one instance share state and controls.
2. Set a strong `DASHBOARD_PASSWORD`, a stable random `SESSION_SECRET` (at least 32 characters), HTTPS, and a VPN/IP allowlist or equivalent access restriction.
3. Keep `TRADING_MODE=PAPER`, `LIVE_TRADING_ENABLED=false`, leave `LIVE_TRADING_CONFIRM` blank, and keep `ONCHAIN_TRADING_ENABLED=false`.
4. Do not give testers trade-enabled API keys. If balance display is needed, use read-only keys and verify that the host's `data/credentials.json` and backups are protected.
5. Confirm the dashboard reports fresh `DATA: LIVE` for every configured symbol before judging signals. `SIM`/`MIXED` sessions are not market-performance evidence.
6. Run `npm test` before deployment and monitor logs, quote freshness, paper fills, and the safety audit. A green PAPER run is not approval for live funds.

## Verification performed

- `npm ci` completed successfully; `npm test` — **61 offline checks passed**. Tests do not exercise a real Kraken/Coinbase/Binance account or prove a strategy edge.
- `node --check` across repository JavaScript files and `git diff --check` — passed.
- `npm audit` after compatible dependency refresh — **0 high/critical, 4 moderate** remaining in the Solana web3.js 1.x dependency chain; see the Dependency security note above.
- No authenticated exchange/account request, live order, wallet broadcast, or external account action was performed in this review.
