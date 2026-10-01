/* ============================================================
   WALLET MANAGER — unified on-chain swap gateway.
   Mirrors ExchangeManager: quotes are always allowed (read-only),
   but a REAL swap only broadcasts when config.canSwapOnchain() is
   true AND the notional is within MAX_SWAP_USD. Single choke point.
   ============================================================ */

const { SolanaWallet, USDC_MINT } = require("./solana");
const { EvmWallet } = require("./evm");
const { TronWallet } = require("./tron");
const mevDefense = require("./mevDefense");
const log = require("../util/logger");

class WalletManager {
  constructor(config) {
    this.config = config;
    this.cfg = config.wallet;
    this.solana = new SolanaWallet(this.cfg);
    this.evm = new EvmWallet(this.cfg);
    this.tron = new TronWallet(this.cfg);
  }

  _forChain(chain) {
    if (chain === "solana") return { kind: "solana", w: this.solana };
    if (["ethereum", "base", "bsc"].includes(chain)) return { kind: "evm", w: this.evm };
    if (chain === "tron") return { kind: "tron", w: this.tron };
    throw new Error(`unsupported chain: ${chain}`);
  }

  status() {
    return {
      onchainArmed: this.config.canSwapOnchain(),
      maxSwapUsd: this.cfg.maxSwapUsd,
      slippageBps: this.cfg.slippageBps,
      mev: {
        splitThresholdUsd: this.cfg.mev.splitThresholdUsd,
        maxChunks: this.cfg.mev.maxChunks,
        protectedRelayConfigured: Boolean(this.cfg.mev.protectedRelayUrl),
      },
      solana: {
        hasKey: this.solana.hasKey(),
        address: this.solana.address(),
        rpc: this.cfg.solana.rpc,
      },
      evm: {
        hasKey: this.evm.hasKey(),
        address: this.evm.address(),
        chain: this.evm.chainKey,
        rpc: this.evm.rpc,
        quotesReady: Boolean(this.cfg.evm.zeroxApiKey),
      },
      tron: {
        hasKey: this.tron.hasKey(),
        address: this.tron.address(),
        swapsReady: false,
        note: "balance reads work; swaps disabled until a vetted aggregator is configured — see docs/TRON_SWAP.md",
      },
    };
  }

  /** Read-only price quote. Never moves funds. */
  async quote({ chain, tokenAddress, amountRaw, sellToken }) {
    const { kind, w } = this._forChain(chain);
    if (kind === "tron") return w.quote();
    if (kind === "solana") {
      return w.quote({ inputMint: sellToken || USDC_MINT, outputMint: tokenAddress, amount: amountRaw });
    }
    return w.quote({ sellToken, buyToken: tokenAddress, sellAmount: amountRaw, taker: w.address() });
  }

  /**
   * Read-only MEV/sandwich-exposure assessment for a proposed swap.
   * Never moves funds — safe to call from the dashboard before arming.
   */
  async assessSwap({ chain, tokenAddress, amountRaw, sellToken, usdNotional }) {
    const q = await this.quote({ chain, tokenAddress, amountRaw, sellToken });
    const risk = mevDefense.assessRisk(q, usdNotional, this.cfg.mev);
    const plan = mevDefense.planExecution(usdNotional || 0, risk, this.cfg.mev);
    return { quote: q, risk, plan };
  }

  /**
   * Execute a REAL swap. Guarded by the on-chain arm gate + spend cap.
   * Applies MEV defense: assesses sandwich-exposure from the aggregator's
   * own price-impact figure, then tranches large/high-risk swaps into
   * smaller chunks with a delay between them instead of broadcasting one
   * big, easy-to-spot transaction.
   * @param usdNotional estimated USD value (for the MAX_SWAP_USD cap)
   */
  async swap({ chain, tokenAddress, amountRaw, sellToken, usdNotional }) {
    if (!this.config.canSwapOnchain()) {
      const reason =
        "ON-CHAIN SWAP DISARMED — need live gate (TRADING_MODE=LIVE, LIVE_TRADING_ENABLED=true, " +
        "LIVE_TRADING_CONFIRM='I ACCEPT THE RISK') AND ONCHAIN_TRADING_ENABLED=true";
      log.warn("WALLET", `Refused swap: ${reason}`);
      throw new Error(reason);
    }
    if (usdNotional != null && usdNotional > this.cfg.maxSwapUsd) {
      throw new Error(
        `BLOCKED: swap ~$${usdNotional} exceeds MAX_SWAP_USD cap $${this.cfg.maxSwapUsd}`
      );
    }
    const { kind, w } = this._forChain(chain);

    const q = await this.quote({ chain, tokenAddress, amountRaw, sellToken });
    const risk = mevDefense.assessRisk(q, usdNotional, this.cfg.mev);
    const plan = mevDefense.planExecution(usdNotional || 0, risk, this.cfg.mev);
    log.warn(
      "WALLET",
      `ARMED on-chain swap -> ${chain} buy ${tokenAddress} | MEV risk=${risk.level} plan=${plan.note}`
    );

    const doOneSwap = (amt) =>
      kind === "solana"
        ? w.swap({ inputMint: sellToken || USDC_MINT, outputMint: tokenAddress, amount: amt }, true)
        : w.swap({ sellToken, buyToken: tokenAddress, sellAmount: amt }, true);

    if (plan.chunks <= 1) {
      const result = await doOneSwap(amountRaw);
      return { ...result, mev: { risk, plan } };
    }

    // Tranche the notional into N roughly-equal on-chain amounts with a
    // delay between each broadcast (reduces both the per-tx target size and
    // the predictability a sandwich bot relies on).
    const total = BigInt(amountRaw);
    const perChunk = total / BigInt(plan.chunks);
    const results = [];
    for (let i = 0; i < plan.chunks; i++) {
      const amt = i === plan.chunks - 1 ? (total - perChunk * BigInt(plan.chunks - 1)).toString() : perChunk.toString();
      results.push(await doOneSwap(amt));
      if (i < plan.chunks - 1 && plan.delayMsBetweenChunks > 0) {
        await new Promise((r) => setTimeout(r, plan.delayMsBetweenChunks));
      }
    }
    return { chain, tranches: results, mev: { risk, plan } };
  }
}

module.exports = WalletManager;
