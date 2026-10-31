import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { CashXChainClient, CxcApiError } from "../src/cashxchain.js";
import { createCfo, mountCfo, type PaymentEngine } from "../src/cfo/index.js";
import { attached, classify, CxcLinker, CXC_SANDBOX_SIGNUP } from "../src/cfo/cxc-link.js";
import { loadConfig } from "../src/config.js";
import { RunStore } from "../src/runs.js";

const MASTER = "cxc_mk_sandbox_testMaster1";
const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * CashXChain Platform routes as the backend implements them (POST /v1/accounts, GET
 * /v1/platform/accounts, Cxc-Account on the money API reads). Emails: signed-in businesses attach;
 * unknown, never-signed-in and other-platform ones answer 409 conflict with the backend's wording.
 */
function fakePlatform() {
  const state = {
    signedIn: new Map<string, string>([["owner@brenner.example", "acc_brenner"]]),
    neverSignedIn: new Set(["new@kranz.example"]),
    otherPlatform: new Set(["taken@vogel.example"]),
    attached: new Map<string, { grant: string; email: string; name: string }>(),
    seen: [] as Array<{ method: string; path: string; auth?: string; account?: string; idem?: string; body?: unknown }>,
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    state.seen.push({ method: req.method, path: req.path, auth: req.header("authorization"), account: req.header("cxc-account"), idem: req.header("idempotency-key"), body: req.body });
    next();
  });
  const conflict = (res: express.Response, message: string) => void res.status(409).json({ success: false, error: "conflict", message });
  app.post("/v1/accounts", (req, res) => {
    const { contact_email: email, display_name: name, country_code: country } = req.body as Record<string, string>;
    if (!email || !name || !country) return void res.status(400).json({ success: false, error: "bad_request", message: "missing field" });
    if (state.otherPlatform.has(email)) return conflict(res, `${email} already belongs to a different platform (6f1c2b9e-0d1a-4c3e-9f7a-2b8d4e6a1c00)`);
    if (state.neverSignedIn.has(email)) return conflict(res, `${email} has no signed-up owner yet, so there is nothing to attach to — the business signs in once, then retry`);
    const id = state.signedIn.get(email);
    if (!id) return conflict(res, `no CashXChain account for ${email} — the business signs up first, then a platform attaches to it`);
    const dto = { id, tenant_id: "t1", contact_email: email, display_name: name, country_code: country, kyb_status: "pending", created_at: "2026-10-31T08:00:00Z" };
    if (state.attached.has(id)) return void res.status(200).json(dto); // no platform_permission_id on a 200
    state.attached.set(id, { grant: `grant_${id}`, email, name });
    res.status(201).json({ ...dto, platform_permission_id: `grant_${id}` });
  });
  app.get("/v1/platform/accounts", (_req, res) =>
    void res.json(
      [...state.attached].map(([id, a]) => ({
        account_id: id,
        display_name: a.name,
        kyb_status: "pending",
        can_move_money: false,
        grant: { id: a.grant, scopes: ["accounts:read", "accounts:write", "payments:read", "fx:read"], kyc_mode: "direct", granted_at: "2026-10-31T08:00:00Z" },
      })),
    ),
  );
  app.get("/v1/banking/accounts", (req, res) => {
    const acting = req.header("cxc-account");
    if (!acting || !state.attached.has(acting)) return void res.status(403).json({ success: false, error: "delegation_no_grant", message: "no grant" });
    res.json({ accounts: [{ id: `${acting}_eur`, currency: "EUR", status: "active", display_name: "EUR" }] });
  });
  app.get("/v1/banking/accounts/:id/balance", (req, res) =>
    void res.json({ balances: [{ account_id: req.params.id, currency: "EUR", available: "1250.0000" }] }),
  );
  return { app, state };
}

async function start() {
  const platform = fakePlatform();
  const platformUrl = await listen(platform.app);
  const app = express();
  const base = await listen(app);
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: "t".repeat(40) });
  const engine: PaymentEngine = { runs: new RunStore() };
  const deps = await createCfo(config, engine, { memory: true });
  deps.cxc = new CxcLinker(deps.store, new CashXChainClient({ apiKey: MASTER, baseUrl: platformUrl }));
  mountCfo(app, deps);

  async function user(email: string) {
    const res = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ name: "Test User", email, password: "correct-horse-1" }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    return async (method: string, path: string, body?: unknown) => {
      const r = await fetch(`${base}${path}`, {
        method,
        headers: { cookie, origin: base, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, json: (await r.json()) as any };
    };
  }
  const settle = async (call: Awaited<ReturnType<typeof user>>) => {
    for (let i = 0; i < 50; i++) {
      const state = await call("GET", "/api/v1/cashxchain");
      if (state.json.link) return state.json;
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error("never linked");
  };
  return { deps, platform, user, settle };
}

describe("CashXChain sandbox sub-account per AI CFO account", () => {
  it("a new account is attached by its owner's email on its first request; reads go through Cxc-Account", async () => {
    const s = await start();
    const call = await s.user("owner@brenner.example");
    expect((await call("GET", "/api/v1/me")).status).toBe(200);
    const state = await s.settle(call);

    expect(state).toMatchObject({
      platform: true,
      environment: "sandbox",
      signupUrl: CXC_SANDBOX_SIGNUP,
      link: { status: "linked", accountId: "acc_brenner", grantId: "grant_acc_brenner", kybStatus: "pending", canMoveMoney: false, email: "owner@brenner.example" },
      accounts: [{ id: "acc_brenner_eur", currency: "EUR", status: "active", available: "1250.0000" }],
    });
    const attach = s.platform.state.seen.find(r => r.path === "/v1/accounts")!;
    expect(attach).toMatchObject({ method: "POST", auth: `Bearer ${MASTER}`, body: { contact_email: "owner@brenner.example", display_name: "Test's company", country_code: "DE" } });
    expect(attach.idem).toMatch(/^cfo-attach-/);
    // Reads for the sub-account carry its id; the attach itself acts as the platform.
    expect(s.platform.state.seen.filter(r => r.path.startsWith("/v1/banking/")).every(r => r.account === "acc_brenner")).toBe(true);
    expect(attach.account).toBeUndefined();
    // Exactly one automatic attempt, however many requests follow.
    await call("GET", "/api/v1/me");
    await call("GET", "/api/v1/me");
    expect(s.platform.state.seen.filter(r => r.path === "/v1/accounts")).toHaveLength(1);
  });

  it("the CashXChain connection of a linked workspace shows the sub-account's balances", async () => {
    const s = await start();
    const call = await s.user("owner@brenner.example");
    await call("GET", "/api/v1/me");
    await s.settle(call);
    const catalog = await call("GET", "/api/v1/connections/catalog");
    expect(catalog.json.find((c: { kind: string }) => c.kind === "cashxchain")).toMatchObject({ available: true });
    const added = await call("POST", "/api/v1/connections", { kind: "cashxchain" });
    expect(added.status).toBe(201);
    expect(added.json).toMatchObject({ kind: "cashxchain", status: "active", balances: [{ asset: "EUR", amount: "1250.0000" }] });
  });

  it("no CashXChain account yet: needs_signup with the sign-up link; after signing up, retry links it", async () => {
    const s = await start();
    const call = await s.user("later@lakeside.example");
    await call("GET", "/api/v1/me");
    const before = await s.settle(call);
    expect(before.link).toMatchObject({ status: "needs_signup", email: "later@lakeside.example" });
    expect(before.link.detail).toContain("the business signs up first");
    expect(before).not.toHaveProperty("accounts");

    s.platform.state.signedIn.set("later@lakeside.example", "acc_lakeside");
    const after = await call("POST", "/api/v1/cashxchain/link");
    expect(after.status).toBe(200);
    expect(after.json.link).toMatchObject({ status: "linked", accountId: "acc_lakeside", grantId: "grant_acc_lakeside" });
  });

  it("a second attach of the same business (200, no grant in the body) takes the grant from the platform list", async () => {
    const s = await start();
    const call = await s.user("owner@brenner.example");
    await call("GET", "/api/v1/me");
    await s.settle(call);
    const again = await call("POST", "/api/v1/cashxchain/link");
    expect(again.json.link).toMatchObject({ status: "linked", accountId: "acc_brenner", grantId: "grant_acc_brenner" });
  });

  it("tells the other 409 cases apart and keeps CashXChain's message", async () => {
    const s = await start();
    const signin = await s.user("new@kranz.example");
    await signin("GET", "/api/v1/me");
    expect((await s.settle(signin)).link).toMatchObject({ status: "needs_signin", detail: expect.stringContaining("signs in once") });
    const taken = await s.user("taken@vogel.example");
    await taken("GET", "/api/v1/me");
    expect((await s.settle(taken)).link).toMatchObject({ status: "other_platform", detail: expect.stringContaining("different platform") });
  });

  it("without a master key: nothing is attempted, the retry route says why", async () => {
    const s = await start();
    s.deps.cxc = new CxcLinker(s.deps.store, undefined);
    const call = await s.user("owner@brenner.example");
    expect((await call("GET", "/api/v1/cashxchain")).json).toMatchObject({ platform: false, link: null });
    const retry = await call("POST", "/api/v1/cashxchain/link");
    expect(retry.status).toBe(503);
    expect(s.platform.state.seen).toEqual([]);
  });
});

describe("attach response and conflict parsing", () => {
  it("takes the account id from `id` and the grant only when present", () => {
    expect(attached({ id: "acc_1", platform_permission_id: "g1", kyb_status: "pending" })).toEqual({ accountId: "acc_1", grantId: "g1" });
    expect(attached({ id: "acc_1" })).toEqual({ accountId: "acc_1" });
    expect(() => attached({ account_id: "acc_1" })).toThrow(/no account id/);
  });

  it("unknown 409 wording falls back to needs_signup; other errors are errors", () => {
    const base = { email: "x@y.example", updatedAt: "t" };
    expect(classify(new CxcApiError(409, "conflict", "something new", undefined), base).status).toBe("needs_signup");
    expect(classify(new CxcApiError(503, "service_unavailable", "down", undefined), base)).toMatchObject({ status: "error", detail: expect.stringContaining("down") });
  });
});
