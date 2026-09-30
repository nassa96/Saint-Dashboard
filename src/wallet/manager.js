/* ============================================================
   WALLET MANAGER — unified on-chain swap gateway.
   Mirrors ExchangeManager: quotes are always allowed (read-only),
   but a REAL swap only broadcasts when config.canSwapOnchain() is
   true AND the notional is within MAX_SWAP_USD. Single choke point.
   ============================================================ */

const { SolanaWallet, USDC_MINT } = require("./solana");
const { EvmWallet } = require("./evm");
const log = require("../util/logger");

class WalletManager {
  constructor(config) {
    this.config = config;
    this.cfg = config.wallet;
    this.solana = new SolanaWallet(this.cfg);
    this.evm = new EvmWallet(this.cfg);
  }

  _forChain(chain) {
    if (chain === "solana") return { kind: "solana", w: this.solana };
    if (["ethereum", "base", "bsc"].includes(chain)) return { kind: "evm", w: this.evm };
    throw new Error(`unsupported chain: ${chain}`);
  }

  status() {
    return {
      onchainArmed: this.config.canSwapOnchain(),
      maxSwapUsd: this.cfg.maxSwapUsd,
      slippageBps: this.cfg.slippageBps,
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
    };
  }

  /** Read-only price quote. Never moves funds. */
  async quote({ chain, tokenAddress, amountRaw, sellToken }) {
    const { kind, w } = this._forChain(chain);
    if (kind === "solana") {
      return w.quote({ inputMint: sellToken || USDC_MINT, outputMint: tokenAddress, amount: amountRaw });
    }
    return w.quote({ sellToken, buyToken: tokenAddress, sellAmount: amountRaw, taker: w.address() });
  }

  /**
   * Execute a REAL swap. Guarded by the on-chain arm gate + spend cap.
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
    log.warn("WALLET", `ARMED on-chain swap -> ${chain} buy ${tokenAddress}`);
    if (kind === "solana") {
      return w.swap({ inputMint: sellToken || USDC_MINT, outputMint: tokenAddress, amount: amountRaw }, true);
    }
    return w.swap({ sellToken, buyToken: tokenAddress, sellAmount: amountRaw }, true);
  }
}

module.exports = WalletManager;
