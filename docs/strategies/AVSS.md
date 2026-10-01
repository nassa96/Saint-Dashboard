# Strategy spec: Asymmetric Volatility Skew Scalper (AVSS)

Status: **implemented as a scan/report-only detector** — `src/signals/avss.js`,
`GET /api/avss/scan`. No execution path exists for this one yet, on purpose
(see below).

## What you asked for

CVD (cumulative volume delta) spike on HyperLiquid perps (>3σ in a 60s
window) confirmed against a Base DEX spot price lag (>18bps) → fire a limit
order on the lagging venue; exit in 30-120s or at a 12bps trailing stop;
~45s average hold; 15-40bps edge per trade.

## What's actually implemented, and two honest gaps

1. **"CVD spike" needs trade-by-trade buy/sell-tagged volume.** Nothing in
   this app streams a trade tape — HyperLiquid reads here use the
   `metaAndAssetCtxs` snapshot (price + open interest + day volume, no
   buy/sell split), and Coinbase integration is REST candles/ticks, not a
   trade feed. What's implemented instead is a **price-based proxy**: a
   z-scored 60-second return relative to the symbol's own recent realized
   volatility (`AvssScanner._priceFlowZ()`, reusing the same EWMA machinery
   as the Extreme Volatility Radar). This is a real, computable "something
   aggressive just happened" signal — explicitly **not** a measurement of
   actual order-flow imbalance. Every scan result says so in its `note` field.
2. **"Base DEX spot" isn't wired up.** There's no live on-chain Base DEX
   price feed in this app. The lag calculation compares **Coinbase CEX
   spot vs HyperLiquid perp mark** instead — a real, honest substitution for
   "two venues that should track each other but sometimes briefly don't,"
   just not literally the Base DEX leg you named. A real Base DEX price
   source (e.g. querying an on-chain aggregator quote per symbol) is a
   concrete follow-up, not implemented here.

## Why this ships scan-only, not auto-executing

The spec's ~45s average hold / 30-120s exit window needs infrastructure
faster than this app's current 5-second HTTP-poll tick loop — real
sub-minute execution wants WebSocket-speed streaming, which isn't built.
Rather than claim full autonomous HFT execution on an architecture that
can't actually hit those latencies, AVSS ships as a **detector you can
read and act on manually** — the same "validate before autonomous"
posture you set for the Stage 2 cold-start gate. `GET /api/avss/scan`
returns ranked candidates (symbol, lag in bps, flow-z-proxy, trigger
flags, direction) with no order-placement side effects.

## Config

`config.avss` (all optional, defaults shown):

```js
{
  cvdZThreshold: 3,        // z-score bar on the price-flow proxy
  lagBpsThreshold: 18,     // spot/perp lag bar, in basis points
  lookbackSec: 60,         // the "60s window" from the spec
  targetTrailingStopBps: 12,
  minHoldSec: 30,
  maxHoldSec: 120,
}
```

`minHoldSec`/`maxHoldSec`/`targetTrailingStopBps` are carried through to
every scan result as a record of the spec's intended exit rule — they are
not enforced by any running order, since there is no execution path yet.
