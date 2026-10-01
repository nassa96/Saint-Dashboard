/* ============================================================
   ADDRESS LOOKUP — fully read-only balance check for ANY public
   address on ANY supported chain. No private key, no seed phrase,
   no signature, no approval of any kind is ever requested here —
   this is the safest possible "connect" flow: paste/scan a PUBLIC
   address, see its public on-chain balance. Pairs with the browser
   injected-wallet connect button in public/connect.html, which asks
   MetaMask/Coinbase Wallet/Trust Wallet/Phantom for the account's
   PUBLIC address only (eth_accounts / solana.connect()) — never a
   signature, never a transaction, until the user explicitly swaps.
   ============================================================ */

const { httpJson } = require("../util/http");

const EVM_RPCS = {
  ethereum: "https://eth.llamarpc.com",
  base: "https://mainnet.base.org",
  bsc: "https://bsc-dataseed.binance.org",
};

async function evmBalance(chain, address) {
  const rpc = EVM_RPCS[chain];
  if (!rpc) throw new Error(`unsupported EVM chain: ${chain}`);
  const body = { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] };
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "RPC error");
  const wei = BigInt(json.result);
  const native = Number(wei) / 1e18;
  return { chain, address, native, balances: [{ asset: chain === "bsc" ? "BNB" : "ETH", free: native, locked: 0 }] };
}

async function solanaBalance(address, rpc = "https://api.mainnet-beta.solana.com") {
  const body = { jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] };
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "RPC error");
  const sol = (json.result?.value || 0) / 1e9;
  return { chain: "solana", address, native: sol, balances: [{ asset: "SOL", free: sol, locked: 0 }] };
}

/**
 * @param {"ethereum"|"base"|"bsc"|"solana"|"tron"} chain
 * @param {string} address public address only
 */
async function lookup(chain, address, deps = {}) {
  if (!address) throw new Error("address is required");
  if (chain === "solana") return solanaBalance(address);
  if (chain === "tron") {
    const { TronWallet } = require("./tron");
    const tw = new TronWallet(deps.config?.wallet || { tron: {} });
    return tw.getBalances(address);
  }
  if (EVM_RPCS[chain]) return evmBalance(chain, address);
  throw new Error(`unsupported chain: ${chain}`);
}

module.exports = { lookup, EVM_RPCS };
