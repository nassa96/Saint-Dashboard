# Strategy spec: Overlord Strategy

Status: **awaiting spec** — registered as an inert placeholder in
`src/signals/strategies/placeholders.js`. It will always return `FLAT`
until this file is filled in and implemented.

Please describe your "overlord strategy" so I can build it for real:

1. **Core idea in one paragraph** — what edge is it trying to capture?
2. **Entry conditions** — indicators, price action, cross-asset signals,
   on-chain signals, news/sentiment triggers?
3. **Exit conditions** — profit target, stop, trailing stop, time limit,
   signal reversal?
4. **Does it use leverage or derivatives**, or spot only?
5. **Does it coordinate across multiple symbols/venues at once** (e.g.
   rotate the whole book based on one master signal), or is it per-symbol?
6. **Risk limits** — max drawdown you'd tolerate, max position size, how it
   should behave in a crash.
7. **Anything it should explicitly avoid** (e.g. never short, never touch
   memecoins, never hold overnight, etc.)

Once I have this, I'll implement it as a real, testable strategy module
with unit tests and a backtest, and flip its `status` to `"active"`.
