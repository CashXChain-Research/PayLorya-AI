import { CxcApiError, type CashXChainClient } from "../cashxchain.js";
import type { SessionUser } from "./auth.js";
import type { Store, Workspace } from "./store.js";

/** Where a business signs up for the CashXChain sandbox before a platform can attach it (docs: Getting started). */
export const CXC_SANDBOX_SIGNUP = "https://auth.sandbox.cashxchain.com/register";

/**
 * linked: attached, reads work. needs_signup: no CashXChain account with that email. needs_signin:
 * signed up but never signed in. other_platform: attached to another platform. error: anything else.
 */
export type CxcLinkStatus = "linked" | "needs_signup" | "needs_signin" | "other_platform" | "error";

/** A workspace's CashXChain sandbox sub-account: a Platform managed account attached by the owner's email. */
export interface CxcLink {
  status: CxcLinkStatus;
  accountId?: string;
  grantId?: string;
  /** pending | active | suspended, from GET /v1/platform/accounts. */
  kybStatus?: string;
  /** Whether CashXChain lets this platform move the account's money (staff switch; off by default). */
  canMoveMoney?: boolean;
  /** The email the attach used: the business signs up at CashXChain with exactly this one. */
  email: string;
  detail?: string;
  updatedAt: string;
}

/**
 * Gives every AI CFO workspace a CashXChain sub-account. CashXChain cannot create an account for
 * someone (docs: Platforms): the business signs up itself, then the platform attaches it by email
 * with its master key. So a new workspace is attached at once when its owner already has a
 * CashXChain sandbox account with that email; otherwise it waits as `needs_signup` until the owner
 * signs up and presses retry.
 */
export class CxcLinker {
  private readonly inFlight = new Map<string, Promise<CxcLink>>();

  constructor(
    private readonly store: Store,
    private readonly client: CashXChainClient | undefined,
  ) {}

  get ready(): boolean {
    return Boolean(this.client);
  }

  /** On every request: a new workspace gets one automatic attempt; later attempts are the owner's retry. */
  ensure(ws: Workspace, user: SessionUser): void {
    if (!this.client || ws.cashxchain) return;
    void this.link(ws, user).catch(() => undefined);
  }

  /** Attaches the owner's CashXChain account. One attempt per workspace at a time. */
  link(ws: Workspace, user: SessionUser): Promise<CxcLink> {
    const running = this.inFlight.get(ws.id);
    if (running) return running;
    const attempt = this.attach(ws, user).finally(() => this.inFlight.delete(ws.id));
    this.inFlight.set(ws.id, attempt);
    return attempt;
  }

  /** The sub-account's client (`Cxc-Account`), once linked. */
  clientFor(ws: Workspace): CashXChainClient | undefined {
    const id = ws.cashxchain?.status === "linked" ? ws.cashxchain.accountId : undefined;
    return id && this.client ? this.client.forAccount(id) : undefined;
  }

  private async attach(ws: Workspace, user: SessionUser): Promise<CxcLink> {
    if (!this.client) throw new Error("CASHXCHAIN_MASTER_KEY is not configured");
    const base = { email: user.email, updatedAt: new Date().toISOString() };
    let link: CxcLink;
    try {
      // Idempotent on the email at CashXChain; the key only has to be present.
      const body = await this.client.attachAccount(
        { contact_email: user.email, display_name: ws.name, country_code: "DE" },
        `cfo-attach-${ws.id}`,
      );
      const ids = attached(body);
      // The grant id comes only with a 201; the platform list has it, the KYB status and the money switch.
      const listed = await this.client.platformAccounts().then(
        all => all.find(a => a.account_id === ids.accountId),
        () => undefined,
      );
      link = {
        status: "linked",
        accountId: ids.accountId,
        ...(ids.grantId ?? listed?.grant?.id ? { grantId: ids.grantId ?? listed?.grant?.id } : {}),
        ...(listed?.kyb_status ? { kybStatus: listed.kyb_status } : {}),
        ...(listed?.can_move_money !== undefined ? { canMoveMoney: listed.can_move_money } : {}),
        ...base,
      };
    } catch (error) {
      link = classify(error, base);
    }
    await this.store.setCxcLink(ws.id, link);
    const what = link.status === "linked" ? `linked CashXChain sub-account ${link.accountId}` : `CashXChain sub-account: ${link.status}`;
    await this.store.log(ws.id, "system", what, link.detail ?? "", { type: "workspace", id: ws.id });
    return link;
  }
}

/**
 * POST /v1/accounts answers an AccountDto: the managed account is `id`; `platform_permission_id`
 * (the grant) is set on the 201 only, not on the 200 for an account already attached to us.
 */
export function attached(body: unknown): { accountId: string; grantId?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.id !== "string" || !b.id) throw new Error("CashXChain attached the account but returned no account id");
  return { accountId: b.id, ...(typeof b.platform_permission_id === "string" ? { grantId: b.platform_permission_id } : {}) };
}

/**
 * Every 409 is `conflict` without details; the cases differ only in the message, which CashXChain
 * does not promise to keep. Unknown wording falls back to needs_signup, with the message shown.
 */
export function classify(error: unknown, base: { email: string; updatedAt: string }): CxcLink {
  if (error instanceof CxcApiError && error.status === 409) {
    const status: CxcLinkStatus = /different platform/i.test(error.message)
      ? "other_platform"
      : /no signed-up owner|signs in once/i.test(error.message)
        ? "needs_signin"
        : "needs_signup";
    return { status, detail: error.message, ...base };
  }
  return { status: "error", detail: error instanceof Error ? error.message : String(error), ...base };
}
