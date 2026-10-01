# Soveriel OS by Nexara AI — naming/branding layer

Status: **naming map over existing subsystems**, not a rewrite. You asked
for three named subsystems; all three already exist under this app's own
branding. This doc is the translation table, nothing more — no code had to
change to "add" Soveriel OS, because the systems it names are real and
already shipped.

| Soveriel name | What it actually is | Where it lives |
|---|---|---|
| **Mercury Omniscope** | Cross-venue market-data aggregation/standardization (price history, OHLCV bars, volatility regime reads) | `src/market/marketData.js` (`getBars()`/`refreshBars()`, tick history, LIVE/SIM honest labeling), `src/volatility/predictor.js` |
| **Aegis Guardian** | Server-side risk ceilings: trade-size caps, max slippage, daily-drawdown halt, zero withdrawal authority (this app never has wallet keys with withdrawal permission — see SAFETY.md) | `src/risk/riskManager.js` — note: this codebase's own prior history literally called an earlier, non-deterministic version of this module "AEGIS" before a from-scratch rewrite (see the comment at the top of `riskManager.js`: "replaces the old random AEGIS"). The Soveriel name is consistent with that history, not a new invention. |
| **SAINT execution engine** | Low-latency, post-only/limit-only order routing + rapid cancellation across exchange connectors | `src/engine/engine.js` + `src/exchange/*` — this is already this dashboard's own name/branding (`Saint-Dashboard`), so this mapping is exact, not aspirational. |

## What's NOT part of this naming pass

You also described two UX/product aspirations that aren't actionable specs
yet — flagged here rather than silently built or silently ignored:

1. **A voice persona for Soveriel** (Jarvis/Cortana-style) — this needs
   real product decisions before any code: which voice engine, push-to-talk
   vs. always-listening, what it's allowed to say/do without confirmation,
   whether it can ever place an order by voice alone (strong "no" by
   default, given everything else in this app's safety posture — any voice
   command touching real money should still go through the exact same
   live-arm + confirmation gates as the dashboard UI, not bypass them).
   Nothing has been built here; happy to scope it once you've got answers
   to those questions.
2. **"Top tier consciousness" / effortless wallet+exchange connection UX**
   — the actual wallet/exchange connection flows already exist
   (`public/connect.html`, `/api/exchanges/*`, `src/wallet/manager.js`) and
   are reasonably simple today (paste a read-only key or connect a public
   wallet address; nothing here ever asks for a seed phrase). "Futuristic
   but simple" is a design/visual-polish direction, not a technical
   requirement — it needs UI/UX direction (what should it actually look
   like?) before there's anything concrete to build. Tracked as an open
   question for whenever you want to get specific about the interface.
