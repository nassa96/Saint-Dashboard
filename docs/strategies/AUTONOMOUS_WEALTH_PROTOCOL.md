# Strategy spec: Autonomous Wealth Protocol (low-capital)

Status: **awaiting spec** — registered as an inert placeholder in
`src/signals/strategies/placeholders.js`. It will always return `FLAT`
until this file is filled in and implemented.

You described this as designed for "extremely low capital allocation."
Please answer:

1. **What's the starting capital range** this is meant to run on (e.g.
   $20–$200)? Low capital changes everything — fee drag, minimum order
   sizes, and slippage dominate at small size, so the strategy needs to be
   fee-aware and probably trade less often / target high-conviction setups
   on low-fee venues or on-chain DEX aggregators.
2. **What's the compounding rule?** Does it reinvest 100% of gains, or peel
   off a %? Any withdrawal rule?
3. **What markets** — majors only (cheaper, more liquid, tighter spreads —
   usually better for tiny accounts) or does it need memecoin/alt exposure
   for bigger % moves?
4. **Entry/exit logic** — same questions as the other templates: what
   triggers in, what triggers out?
5. **Max simultaneous positions** — with low capital, concentration risk
   matters a lot; is this meant to be one position at a time, or split?
6. **Survival rule** — you said "survival before profitability." What's the
   hard floor (e.g. "never let equity drop below $X" / "stop trading after
   N consecutive losses")?

Once I have this, I'll implement it as a real, testable strategy module,
wire it into the risk manager's existing circuit breaker, and flip its
`status` to `"active"`.
