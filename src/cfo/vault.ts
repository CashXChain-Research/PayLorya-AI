import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Seals the credentials a workspace connects (its own CashXChain API key) at rest: AES-256-GCM
 * with a key derived from BETTER_AUTH_SECRET by HKDF, so no second secret is needed. The
 * `context` is authenticated data: a sealed value only opens for the workspace it was sealed for,
 * so copying it into another workspace's row does not hand that workspace the key.
 * Rotating BETTER_AUTH_SECRET makes stored keys unreadable: the owner connects them again.
 */
export class Vault {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync("sha256", secret, "payflow-ai", "connection-credentials v1", 32));
  }

  seal(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
    return `v1.${iv.toString("base64url")}.${data.toString("base64url")}`;
  }

  /** Throws when the value was sealed with another secret, for another context, or altered. */
  open(sealed: string, context: string): string {
    const [version, iv, body] = sealed.split(".");
    if (version !== "v1" || !iv || !body) throw new Error("unknown credential format");
    const data = Buffer.from(body, "base64url");
    if (data.length < 17) throw new Error("credential too short");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString("utf8");
  }
}

/** What a sealed connection credential is bound to. */
export const connectionContext = (ws: string): string => `payflow:connection:${ws}`;

/** "cxc_sk_sandbox_…LzQb": enough to recognise a key, never enough to use it. */
export function keyHint(key: string): string {
  const prefix = /^cxc_[a-z]{2}_[a-z]+_/.exec(key)?.[0] ?? "";
  return `${prefix}…${key.slice(-4)}`;
}
