// Browser wallets for watch-only connections: the wallet's own permission popup hands over an
// address, nothing else. CIP-30 (Cardano: Lace, Eternl, …) and EIP-1193 (MetaMask, Rabby, …).
import { cardanoAddressFromHex } from "../shared/bech32.js";

interface Cip30Api {
  getNetworkId(): Promise<number>;
  getChangeAddress(): Promise<string>;
  getUsedAddresses(): Promise<string[]>;
  signTx(txCbor: string, partialSign: boolean): Promise<string>;
}
interface Cip30Wallet {
  name?: unknown;
  icon?: unknown;
  enable?: () => Promise<Cip30Api>;
}
interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface BrowserWallet {
  id: string;
  name: string;
  /** Data or https URI from the wallet itself; only ever used as an <img src>. */
  icon?: string;
}

const injected = () => window as unknown as { cardano?: Record<string, Cip30Wallet>; ethereum?: Eip1193 };

/** CIP-30 wallets installed in this browser, one entry per wallet name. */
export function cardanoWallets(): BrowserWallet[] {
  const all = injected().cardano;
  if (!all || typeof all !== "object") return [];
  const seen = new Set<string>();
  const out: BrowserWallet[] = [];
  for (const [id, w] of Object.entries(all)) {
    if (!w || typeof w.enable !== "function" || typeof w.name !== "string" || seen.has(w.name)) continue;
    seen.add(w.name);
    const icon = typeof w.icon === "string" && /^(data:image\/|https:)/.test(w.icon) ? w.icon : undefined;
    out.push({ id, name: w.name, ...(icon ? { icon } : {}) });
  }
  return out;
}

export const hasEvmWallet = (): boolean => typeof injected().ethereum?.request === "function";

/** The wallet's permission popup; refuses a wallet on mainnet (PayLorya AI pays on Cardano Preprod). */
async function enableCardano(id: string): Promise<Cip30Api> {
  const wallet = injected().cardano?.[id];
  if (!wallet?.enable) throw new Error("That wallet is no longer available in this browser.");
  let api: Cip30Api;
  try {
    api = await wallet.enable();
  } catch {
    throw new Error("The wallet did not allow the connection.");
  }
  if ((await api.getNetworkId()) !== 0) throw new Error("The wallet is on mainnet. Switch it to Preprod (testnet) and try again.");
  return api;
}

/** Opens the wallet's popup and returns its Preprod receive address (addr_test1…). */
export async function connectCardano(id: string): Promise<string> {
  const api = await enableCardano(id);
  const used = await api.getUsedAddresses().catch(() => [] as string[]);
  const address = cardanoAddressFromHex(used[0] ?? (await api.getChangeAddress()));
  if (!address.startsWith("addr_test1")) throw new Error("The wallet returned no payment address.");
  return address;
}

/**
 * Signs a payout transaction the server built from `address`: the wallet shows it (payee, amount,
 * fee) before its owner confirms. Returns the witness set (CIP-30 signTx, partial). Refuses a wallet
 * that does not hold the address, so the owner is not asked to sign with the wrong one.
 */
export async function signCardano(id: string, req: { txCbor: string; address: string }): Promise<string> {
  const api = await enableCardano(id);
  const hex = [...(await api.getUsedAddresses().catch(() => [] as string[])), await api.getChangeAddress().catch(() => "")];
  const held = hex.map(h => {
    try {
      return cardanoAddressFromHex(h);
    } catch {
      return "";
    }
  });
  if (!held.includes(req.address)) throw new Error(`This wallet does not hold ${req.address.slice(0, 18)}…. Open the wallet you connected.`);
  try {
    return await api.signTx(req.txCbor, true);
  } catch {
    throw new Error("Not signed in the wallet. Sign again before the request expires, or cancel the payment.");
  }
}

/** Opens the wallet's popup and returns the selected account (0x…). */
export async function connectEvm(): Promise<string> {
  const eth = injected().ethereum;
  if (!eth) throw new Error("No browser wallet found.");
  let accounts: unknown;
  try {
    accounts = await eth.request({ method: "eth_requestAccounts" });
  } catch {
    throw new Error("The wallet did not allow the connection.");
  }
  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof first !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(first)) throw new Error("The wallet returned no account.");
  return first;
}
