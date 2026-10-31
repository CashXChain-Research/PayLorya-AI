import { CXC_SANDBOX_KEY, type CashXChainClient } from "../cashxchain.js";
import { majorToMinor, toUsdMinor } from "./fx.js";
import type { Access, Balance, ConnectionKind, ConnectionRow } from "./store.js";

export interface CatalogEntry {
  kind: ConnectionKind;
  name: string;
  description: string;
  supports: { read: boolean; write: boolean };
  available: boolean;
  needsAddress: boolean;
  /** CashXChain: the workspace may connect its own account with an API key. */
  acceptsApiKey?: boolean;
  /** CashXChain: the key may be left out, because the workspace's linked sub-account is read instead. */
  linkedFallback?: boolean;
}

export interface ConnectionEnv {
  blockfrost?: { baseUrl: string; projectId: string };
  /** The platform's Preprod agent wallet, when x402 is configured. */
  agentWalletAddress?: string;
  cashxchain?: CashXChainClient;
  /** `cashxchain` is the workspace's own linked sub-account (CxcLinker), not PayLorya AI's shared one. */
  linkedSubAccount?: boolean;
  /** True when this server can seal a workspace's own CashXChain API key (BETTER_AUTH_SECRET is set). */
  acceptsApiKey?: boolean;
  fetch?: typeof fetch;
}

export function catalog(env: ConnectionEnv): CatalogEntry[] {
  return [
    {
      kind: "cardano_agent_wallet",
      name: "CashXChain agent wallet (Cardano Preprod)",
      description: "The wallet the AI CFO pays from: x402 verification fees and approved tADA payouts. Shared testnet wallet.",
      supports: { read: true, write: true },
      available: Boolean(env.agentWalletAddress && env.blockfrost),
      needsAddress: false,
    },
    {
      kind: "cashxchain",
      name: "CashXChain account (sandbox)",
      description: "Your CashXChain account by API key: fiat balances and payouts over SEPA, ACH and more. Sandbox: test money only.",
      supports: { read: true, write: true },
      // Always the workspace's own account: by its API key, or its linked sub-account. PayLorya AI's
      // shared sandbox account (CASHXCHAIN_API_KEY) serves the public demo only.
      available: Boolean(env.acceptsApiKey || (env.cashxchain && env.linkedSubAccount)),
      needsAddress: false,
      ...(env.acceptsApiKey ? { acceptsApiKey: true } : {}),
      ...(env.cashxchain && env.linkedSubAccount ? { linkedFallback: true } : {}),
    },
    {
      kind: "cardano_wallet",
      name: "Cardano wallet (watch-only)",
      description: "Track any Cardano Preprod address. Read-only: the CFO sees balances, it cannot move funds.",
      supports: { read: true, write: false },
      available: Boolean(env.blockfrost),
      needsAddress: true,
    },
    {
      kind: "evm_wallet",
      name: "EVM wallet (watch-only)",
      description: "Track an Ethereum address on Ethereum, Base and Polygon mainnet. Read-only.",
      supports: { read: true, write: false },
      available: true,
      needsAddress: true,
    },
    {
      kind: "bank",
      name: "Bank account",
      description: "Open banking connections to read balances and transactions. Coming soon.",
      supports: { read: true, write: false },
      available: false,
      needsAddress: false,
    },
  ];
}

export function supportsWrite(kind: ConnectionKind): boolean {
  return kind === "cardano_agent_wallet" || kind === "cashxchain";
}

export function networkOf(kind: ConnectionKind): string {
  switch (kind) {
    case "cardano_agent_wallet":
    case "cardano_wallet":
      return "cardano:preprod";
    case "evm_wallet":
      return "ethereum, base, polygon";
    case "cashxchain":
      return "cashxchain:sandbox";
    case "bank":
      return "bank";
  }
}

/** Validates a new connection request. Returns an error message, or the values to store. */
export function prepareConnection(
  env: ConnectionEnv,
  input: { kind?: unknown; label?: unknown; address?: unknown; access?: unknown; apiKey?: unknown },
): { error: string } | { kind: ConnectionKind; label: string; network: string; address?: string; access: Access; apiKey?: string } {
  const entry = catalog(env).find(c => c.kind === input.kind);
  if (!entry) return { error: "unknown connection kind" };
  if (!entry.available) return { error: `${entry.name} is not available yet` };
  const kind = entry.kind;
  let address: string | undefined;
  if (kind === "cardano_agent_wallet") address = env.agentWalletAddress;
  if (kind === "cardano_wallet") {
    address = typeof input.address === "string" ? input.address.trim() : "";
    if (!/^addr_test1[0-9a-z]{50,}$/.test(address)) return { error: "Enter a Cardano Preprod address (addr_test1…)" };
  }
  if (kind === "evm_wallet") {
    address = typeof input.address === "string" ? input.address.trim() : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { error: "Enter an EVM address (0x followed by 40 hex characters)" };
  }
  let apiKey: string | undefined;
  if (input.apiKey !== undefined && input.apiKey !== null && input.apiKey !== "") {
    if (kind !== "cashxchain") return { error: `${entry.name} does not take an API key` };
    if (!env.acceptsApiKey) return { error: "This server cannot store API keys (BETTER_AUTH_SECRET is not set)" };
    apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    if (!CXC_SANDBOX_KEY.test(apiKey)) return { error: "Paste a CashXChain sandbox API key (cxc_sk_sandbox_… or cxc_rk_sandbox_…). Live keys are not accepted." };
  } else if (kind === "cashxchain" && !(env.cashxchain && env.linkedSubAccount)) {
    return { error: "Paste your CashXChain sandbox API key" };
  }
  const wantsWrite = input.access === "read_write";
  const access: Access = wantsWrite && supportsWrite(kind) ? "read_write" : "read";
  const label = typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 80) : entry.name;
  return { kind, label, network: networkOf(kind), ...(address ? { address } : {}), access, ...(apiKey ? { apiKey } : {}) };
}

const EVM_NETWORKS = [
  { name: "Ethereum", asset: "ETH", rpc: "https://ethereum-rpc.publicnode.com" },
  { name: "Base", asset: "ETH on Base", rpc: "https://base-rpc.publicnode.com" },
  { name: "Polygon", asset: "POL", rpc: "https://polygon-bor-rpc.publicnode.com" },
];

/** 18-decimal wei (hex) to a decimal string with up to 6 decimals. */
export function weiToDecimal(hex: string): string {
  const wei = BigInt(hex);
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function lovelaceToDecimal(lovelace: bigint): string {
  const whole = lovelace / 1_000_000n;
  const frac = (lovelace % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Live balances for one connection. Throws with a user-facing message when the provider fails. */
export async function fetchBalances(env: ConnectionEnv, c: Pick<ConnectionRow, "kind" | "address">): Promise<Balance[]> {
  const f = env.fetch ?? fetch;
  switch (c.kind) {
    case "cardano_agent_wallet":
    case "cardano_wallet": {
      if (!env.blockfrost || !c.address) throw new Error("Cardano data provider not configured");
      const base = env.blockfrost.baseUrl.replace(/\/$/, "");
      const res = await f(`${base}/addresses/${c.address}`, { headers: { project_id: env.blockfrost.projectId }, signal: AbortSignal.timeout(10_000) });
      // Blockfrost answers 404 for an address that never received anything.
      if (res.status === 404) return [{ asset: "tADA", amount: "0", usdMinor: 0 }];
      if (!res.ok) throw new Error(`Cardano provider answered ${res.status}`);
      const body = (await res.json()) as { amount?: Array<{ unit: string; quantity: string }> };
      const lovelace = BigInt(body.amount?.find(a => a.unit === "lovelace")?.quantity ?? "0");
      return [{ asset: "tADA", amount: lovelaceToDecimal(lovelace), usdMinor: toUsdMinor(Number(lovelace), "ADA") }];
    }
    case "evm_wallet": {
      if (!c.address) throw new Error("No address");
      return Promise.all(
        EVM_NETWORKS.map(async n => {
          const res = await f(n.rpc, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [c.address, "latest"] }),
            signal: AbortSignal.timeout(10_000),
          });
          const body = (await res.json()) as { result?: string; error?: { message: string } };
          if (!res.ok || !body.result) throw new Error(`${n.name} RPC: ${body.error?.message ?? res.status}`);
          return { asset: n.asset, amount: weiToDecimal(body.result) };
        }),
      );
    }
    case "cashxchain": {
      if (!env.cashxchain) throw new Error("CashXChain is not configured");
      const { accounts } = await env.cashxchain.listAccounts();
      const balances = (await Promise.all(accounts.map(a => env.cashxchain!.balance(a.id)))).flat();
      return balances.map(b => {
        const amount = Number(b.available);
        return { asset: b.currency, amount: b.available, usdMinor: Number.isFinite(amount) ? toUsdMinor(majorToMinor(amount, b.currency), b.currency) : undefined };
      });
    }
    case "bank":
      return [];
  }
}
