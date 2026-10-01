# Strategy spec: DNFH

Status: **implemented** — but not as a per-symbol signal strategy (this
registry slot stays an inert `FLAT` placeholder, see below for why).

You defined DNFH as **Delta-Neutral Funding Harvest**: long spot / short an
equal-notional perp, collecting the funding rate perp longs pay shorts when
funding is positive, with net price exposure ~0.

That's a real, legitimate, well-known trading technique, and it's built —
just not here. It doesn't fit this file's slot (`src/signals/strategies/`)
because that interface is for single-symbol directional signals (`evaluate(series)
-> {signal: LONG/SHORT/FLAT}`) feeding the spot rotation engine. DNFH is a
**two-leg, cross-venue position** (Base spot + HyperLiquid perp), which needs
its own orchestration. It lives in:

- **`src/yield/dnfh.js`** — the real implementation
- **`GET /api/dnfh/scan`** — read-only, ranks live HyperLiquid funding rates
  by annualized yield
- **`POST /api/dnfh/plan`** — pure math; requires you to supply a
  self-verified spot token contract address (never guessed)
- **`POST /api/dnfh/execute`** — moves real funds on both legs; requires the
  full live-arm gate + on-chain-swap arm; leverage hard-capped at
  `HYPERLIQUID_MAX_LEVERAGE` (default 2x); reports a loud warning instead of
  silently leaving you one-sided if one leg fails
- **`VENUES.md`** and **`SAFETY.md`** — usage + risk documentation

See those files for the real, working version. This per-symbol slot remains
`FLAT`/inert — there's no single-symbol directional signal to implement here.
