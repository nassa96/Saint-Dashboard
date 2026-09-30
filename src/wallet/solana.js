/* ============================================================
   SOLANA WALLET — swaps via the Jupiter aggregator.
   - quote(): public, no key required (safe, read-only pricing)
   - swap():  broadcasts a REAL transaction; refuses unless armed
   Heavy deps (@solana/web3.js, bs58) are lazy-loaded so the app
   still boots if they are not installed.
   ============================================================ */

const { httpJson, httpRequest } = require("../util/http");
const log = require("../util/logger");

const JUP_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUP_SWAP = "https://quote-api.jup.ag/v6/swap";
const SOL_MINT = "So11111111111111111111111111111111111111112"; // wrapped SOL
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

class SolanaWallet {
  constructor(cfg) {
    this.cfg = cfg; // config.wallet.solana + shared
    this._kp = null;
    this._conn = null;
  }

  hasKey() {
    return Boolean(this.cfg.solana.privateKey);
  }

  _keypair() {
    if (this._kp) return this._kp;
    const { Keypair } = require("@solana/web3.js");
    const bs58lib = require("bs58");
    const decode = bs58lib.decode || (bs58lib.default && bs58lib.default.decode);
    const secret = decode(this.cfg.solana.privateKey);
    this._kp = Keypair.fromSecretKey(secret);
    return this._kp;
  }

  address() {
    if (!this.hasKey()) return null;
    try {
      return this._keypair().publicKey.toBase58();
    } catch (e) {
      return null;
    }
  }

  _connection() {
    if (this._conn) return this._conn;
    const { Connection } = require("@solana/web3.js");
    this._conn = new Connection(this.cfg.solana.rpc, "confirmed");
    return this._conn;
  }

  /** Quote outputMint per `amount` (in smallest unit of inputMint). */
  async quote({ inputMint = USDC_MINT, outputMint, amount, slippageBps }) {
    if (!outputMint) throw new Error("outputMint required");
    const url =
      `${JUP_QUOTE}?inputMint=${inputMint}&outputMint=${outputMint}` +
      `&amount=${amount}&slippageBps=${slippageBps || this.cfg.slippageBps}&swapMode=ExactIn`;
    const data = await httpJson(url, { timeout: 8000 });
    return {
      inputMint,
      outputMint,
      inAmount: data.inAmount,
      outAmount: data.outAmount,
      priceImpactPct: Number(data.priceImpactPct),
      routePlan: (data.routePlan || []).map((r) => r.swapInfo?.label).filter(Boolean),
      raw: data,
    };
  }

  /** Broadcast a real swap. Refuses unless armed=true. */
  async swap({ inputMint = USDC_MINT, outputMint, amount, slippageBps }, armed) {
    if (!armed) throw new Error("BLOCKED: on-chain swap not armed");
    if (!this.hasKey()) throw new Error("no SOLANA_PRIVATE_KEY configured");

    const { VersionedTransaction } = require("@solana/web3.js");
    const kp = this._keypair();
    const conn = this._connection();

    const q = await this.quote({ inputMint, outputMint, amount, slippageBps });

    const res = await httpRequest(JUP_SWAP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: q.raw,
        userPublicKey: kp.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
      timeout: 10000,
    });
    if (!res.ok || !res.json?.swapTransaction)
      throw new Error(`swap build failed HTTP ${res.status}`);

    const tx = VersionedTransaction.deserialize(
      Buffer.from(res.json.swapTransaction, "base64")
    );
    tx.sign([kp]);
    const sig = await conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    log.warn("WALLET", `SOLANA swap broadcast sig=${sig}`);
    return { chain: "solana", signature: sig, quote: q, explorer: `https://solscan.io/tx/${sig}` };
  }
}

module.exports = { SolanaWallet, SOL_MINT, USDC_MINT };
