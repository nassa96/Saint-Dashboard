# Wiring up real Tron swaps

Balance reads (`src/wallet/tron.js`) work today via TronGrid's public API —
no key, no risk, just reading a public address.

**Swaps are intentionally disabled.** At build time there was no Tron
DEX-aggregator API that met the same bar as the Solana (Jupiter) and
EVM (0x) integrations already in this repo — a clean, public, officially
documented quote+swap endpoint with no middleman commission. The two
options found were:

1. **SunSwap's official API** — real and TRON-Foundation-affiliated, but
   requires registering for developer-portal credentials (an account only
   you can create, since it ties to your identity/project).
2. **An unofficial third-party relay** advertising itself for AI agents,
   charging a flat 10% commission on every swap, with no meaningful track
   record. Routing your funds through it without your explicit, informed
   sign-off would be irresponsible — a 10% commission alone is close to a
   rug, before even considering counterparty risk.

To enable real Tron swaps:

1. Register at SunSwap's developer portal and get an API key, **or** tell
   me a different Tron aggregator you've vetted and trust.
2. Drop the key into `.env` as `SUNSWAP_API_KEY` (or whatever the chosen
   provider needs).
3. Ask me to wire `TronWallet.quote()` / `.swap()` to that provider's real
   endpoints — same pattern as `src/wallet/evm.js` (0x) and
   `src/wallet/solana.js` (Jupiter): a `quote()` that's always safe to
   call, and a `swap()` gated behind the existing three-lock live-arm +
   `ONCHAIN_TRADING_ENABLED=true` + `MAX_SWAP_USD` cap.
