/* ============================================================
   EVM WALLET — swaps via the 0x Swap API (ethereum / base / bsc).
   - quote(): read-only pricing (0x API key recommended)
   - swap():  signs + broadcasts a REAL tx; refuses unless armed
   ethers is lazy-loaded so the app boots without it.
   ============================================================ */

const { httpGet } = require("../util/http");
const log = require("../util/logger");

const CHAINS = {
  ethereum: { id: 1, api: "https://api.0x.org", rpc: "https://eth.llamarpc.com", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", native: "ETH" },
  base: { id: 8453, api: "https://base.api.0x.org", rpc: "https://mainnet.base.org", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", native: "ETH" },
  bsc: { id: 56, api: "https://bsc.api.0x.org", rpc: "https://bsc-dataseed.binance.org", usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", native: "BNB" },
};

class EvmWallet {
  constructor(cfg) {
    this.cfg = cfg; // config.wallet
    this.chainKey = cfg.evm.chain in CHAINS ? cfg.evm.chain : "base";
    this.chain = CHAINS[this.chainKey];
    this.rpc = cfg.evm.rpc || this.chain.rpc;
    this._wallet = null;
  }

  hasKey() {
    return Boolean(this.cfg.evm.privateKey);
  }

  _signer() {
    if (this._wallet) return this._wallet;
    const { ethers } = require("ethers");
    const provider = new ethers.JsonRpcProvider(this.rpc);
    this._wallet = new ethers.Wallet(this.cfg.evm.privateKey, provider);
    return this._wallet;
  }

  address() {
    if (!this.hasKey()) return null;
    try {
      return this._signer().address;
    } catch (e) {
      return null;
    }
  }

  _headers() {
    const h = { "0x-version": "v2" };
    if (this.cfg.evm.zeroxApiKey) h["0x-api-key"] = this.cfg.evm.zeroxApiKey;
    return h;
  }

  /** sellToken defaults to USDC; buyToken is the target token address. */
  async quote({ sellToken, buyToken, sellAmount, taker }) {
    const sell = sellToken || this.chain.usdc;
    const url =
      `${this.chain.api}/swap/permit2/price?chainId=${this.chain.id}` +
      `&sellToken=${sell}&buyToken=${buyToken}&sellAmount=${sellAmount}` +
      `&slippageBps=${this.cfg.slippageBps}` +
      (taker ? `&taker=${taker}` : "");
    const r = await httpGet(url, { headers: this._headers(), timeout: 9000 });
    if (!r.ok) throw new Error(`0x price HTTP ${r.status}: ${(r.text || "").slice(0, 140)}`);
    const d = r.json;
    return {
      chain: this.chainKey,
      sellToken: sell,
      buyToken,
      sellAmount,
      buyAmount: d.buyAmount,
      price: d.price,
      raw: d,
    };
  }

  async swap({ sellToken, buyToken, sellAmount }, armed) {
    if (!armed) throw new Error("BLOCKED: on-chain swap not armed");
    if (!this.hasKey()) throw new Error("no EVM_PRIVATE_KEY configured");
    const signer = this._signer();
    const sell = sellToken || this.chain.usdc;

    const url =
      `${this.chain.api}/swap/permit2/quote?chainId=${this.chain.id}` +
      `&sellToken=${sell}&buyToken=${buyToken}&sellAmount=${sellAmount}` +
      `&slippageBps=${this.cfg.slippageBps}&taker=${signer.address}`;
    const r = await httpGet(url, { headers: this._headers(), timeout: 10000 });
    if (!r.ok || !r.json?.transaction)
      throw new Error(`0x quote HTTP ${r.status}: ${(r.text || "").slice(0, 140)}`);
    const q = r.json;

    const tx = await signer.sendTransaction({
      to: q.transaction.to,
      data: q.transaction.data,
      value: q.transaction.value ? BigInt(q.transaction.value) : 0n,
      gasLimit: q.transaction.gas ? BigInt(q.transaction.gas) : undefined,
    });
    log.warn("WALLET", `EVM(${this.chainKey}) swap broadcast hash=${tx.hash}`);
    return {
      chain: this.chainKey,
      hash: tx.hash,
      buyAmount: q.buyAmount,
      explorer:
        this.chainKey === "base"
          ? `https://basescan.org/tx/${tx.hash}`
          : this.chainKey === "bsc"
          ? `https://bscscan.com/tx/${tx.hash}`
          : `https://etherscan.io/tx/${tx.hash}`,
    };
  }
}

module.exports = { EvmWallet, CHAINS };
