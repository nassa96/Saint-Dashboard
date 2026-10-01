# Strategy spec: DNFH

Status: **awaiting spec** — registered as an inert placeholder in
`src/signals/strategies/placeholders.js`. It will always return `FLAT`
until this file is filled in and implemented.

I don't know what "DNFH" stands for or what rules it follows. Please answer
as much of the below as you can (plain language is fine, I'll formalize it):

1. **What does DNFH stand for?**
2. **What triggers an entry?** (e.g. a specific indicator crossing a
   threshold, an order-book/volume pattern, a news event, a divergence
   between two assets...)
3. **What triggers an exit?** (take-profit %, stop-loss %, time-based,
   indicator flip...)
4. **What timeframe?** (seconds/minutes/hours/days per bar)
5. **What markets/symbols is it meant for?** (majors, alts, memecoins...)
6. **Position sizing rule**, if you have one (fixed %, Kelly-style,
   volatility-scaled...)
7. **Any existing reference** (a paper, a Twitter thread, a backtest you've
   already run, pseudocode) — even rough notes help a lot.

Once I have this, I'll implement it as a real, testable strategy module
(same pattern as `momentum.js` / `meanReversion.js`) with unit tests and a
backtest, and flip its `status` to `"active"`.
