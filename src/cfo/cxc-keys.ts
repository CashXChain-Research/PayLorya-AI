import { CxcApiError, CxcNetworkError, type CashXChainClient } from "../cashxchain.js";
import type { ConnectionRow, Store } from "./store.js";
import { connectionContext, keyHint, Vault } from "./vault.js";

export const KEY_UNREADABLE =
  "The stored CashXChain API key cannot be read anymore (the server secret changed). Remove this connection and connect the key again.";

/**
 * A workspace's own CashXChain account, connected with its API key: sealed at rest (vault.ts),
 * opened only to call CashXChain for that workspace. The key never leaves the server again; the
 * dashboard sees its hint (prefix and last four characters).
 */
export class CxcKeys {
  private readonly vault?: Vault;

  constructor(
    private readonly store: Store,
    secret: string | undefined,
    readonly clientFor: (apiKey: string) => CashXChainClient,
  ) {
    // Without a fixed secret Better Auth runs on a random one, and a key sealed with it would be
    // lost on restart: own keys are then refused instead.
    if (secret) this.vault = new Vault(secret);
  }

  get ready(): boolean {
    return Boolean(this.vault);
  }

  /** Checks the key against CashXChain (it must read accounts), then seals it for this workspace. */
  async admit(ws: string, apiKey: string): Promise<{ sealed: string; hint: string }> {
    if (!this.vault) throw new KeyRefused("This server cannot store API keys (BETTER_AUTH_SECRET is not set)");
    try {
      await this.clientFor(apiKey).listAccounts();
    } catch (error) {
      throw keyRefusal(error);
    }
    return { sealed: this.vault.seal(apiKey, connectionContext(ws)), hint: keyHint(apiKey) };
  }

  /** Seals any connection secret for this workspace (an agent wallet's recovery phrase). */
  seal(ws: string, plaintext: string): string {
    if (!this.vault) throw new KeyRefused("This server cannot store secrets (BETTER_AUTH_SECRET is not set)");
    return this.vault.seal(plaintext, connectionContext(ws));
  }

  /** A connection's own secret; undefined when it has none. Throws `unreadable` when it cannot be opened. */
  async open(ws: string, c: Pick<ConnectionRow, "id" | "credentialHint">, unreadable = KEY_UNREADABLE): Promise<string | undefined> {
    if (!c.credentialHint) return undefined;
    const sealed = await this.store.connectionSecret(ws, c.id);
    if (!sealed || !this.vault) throw new Error(unreadable);
    try {
      return this.vault.open(sealed, connectionContext(ws));
    } catch {
      throw new Error(unreadable);
    }
  }

  /** The client for a connection's own key; undefined when it has none. Throws KEY_UNREADABLE. */
  async client(ws: string, c: Pick<ConnectionRow, "id" | "credentialHint">): Promise<CashXChainClient | undefined> {
    const apiKey = await this.open(ws, c);
    return apiKey ? this.clientFor(apiKey) : undefined;
  }
}

/** A key CashXChain did not accept, or could not check: shown to the user, the key is not stored. */
export class KeyRefused extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function keyRefusal(error: unknown): KeyRefused {
  if (error instanceof CxcApiError) {
    if (error.status === 401) return new KeyRefused("CashXChain did not accept this API key. Check that it is a sandbox key and not revoked.");
    if (error.code === "insufficient_scope") return new KeyRefused("This key cannot read accounts. Use a secret key, or a restricted key with accounts:read.");
    if (error.status === 403) return new KeyRefused(`CashXChain refused this key: ${error.message}`);
    return new KeyRefused(`CashXChain answered ${error.status}: ${error.message}`, 502);
  }
  if (error instanceof CxcNetworkError) return new KeyRefused("CashXChain could not be reached to check the key. Try again in a moment.", 502);
  return new KeyRefused(error instanceof Error ? error.message : String(error), 502);
}
