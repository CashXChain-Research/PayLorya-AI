import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { BuyerAgent } from "../src/agent.js";
import { KEY_PATTERN, keyRefusal, RateLimiter } from "../src/cfo/api-keys.js";
import { createCfo, mountCfo, type PaymentEngine } from "../src/cfo/index.js";
import { loadConfig } from "../src/config.js";
import { RunStore } from "../src/runs.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => (s.closeAllConnections(), s.close(() => resolve())))));
});

type Call = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; json: any; headers: Headers }>;

type ScriptStep = { text?: string; tool?: { name: string; input: unknown } };

/** Stand-in for client.messages.stream: replays scripted assistant turns and records each request. */
function fakeClaude(script: ScriptStep[], calls: Array<{ tools: Array<{ name: string }>; system: string }>): Pick<Anthropic, "messages"> {
  let i = 0;
  const messages = {
    stream(params: { tools: Array<{ name: string }>; system: string }) {
      calls.push(params);
      const step = script[i++] ?? { text: "Done." };
      let onText: ((d: string) => void) | undefined;
      const stream = {
        on(event: string, cb: (d: string) => void) {
          if (event === "text") onText = cb;
          return stream;
        },
        async finalMessage() {
          if (step.text) onText?.(step.text);
          const content: unknown[] = [];
          if (step.text) content.push({ type: "text", text: step.text });
          if (step.tool) content.push({ type: "tool_use", id: `tu_${i}`, name: step.tool.name, input: step.tool.input });
          return { content, stop_reason: step.tool ? "tool_use" : "end_turn" };
        },
      };
      return stream;
    },
  };
  return { messages } as unknown as Pick<Anthropic, "messages">;
}

async function start(script: ScriptStep[] = []) {
  const app = express();
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: "s".repeat(40), ANTHROPIC_API_KEY: "test" });
  const engine: PaymentEngine = { runs: new RunStore(), agent: {} as BuyerAgent };
  const deps = await createCfo(config, engine, { memory: true, noSweep: true, agentFor: () => ({}) as BuyerAgent });
  const aiCalls: Array<{ tools: Array<{ name: string }>; system: string }> = [];
  deps.chatClient = fakeClaude(script, aiCalls);
  mountCfo(app, deps);

  const call = (auth: Record<string, string>): Call => async (method, path, body, headers = {}) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), origin: base, ...auth, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    const json = r.headers.get("content-type")?.includes("json") && text ? JSON.parse(text) : text || undefined;
    return { status: r.status, json, headers: r.headers };
  };
  async function user(email: string): Promise<Call> {
    const res = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ name: "Test User", email, password: "correct-horse-1" }),
    });
    expect(res.status).toBe(200);
    return call({ cookie: res.headers.get("set-cookie")!.split(";")[0]! });
  }
  const withKey = (key: string) => call({ authorization: `Bearer ${key}` });
  return { user, withKey, aiCalls };
}

describe("public API keys", () => {
  it("are created in the dashboard, shown once, and act for that account only", async () => {
    const { user, withKey } = await start();
    const me = await user("owner@example.com");
    const created = await me("POST", "/api/v1/api-keys", { name: "ERP sync", scopes: ["read", "write"] });
    expect(created.status).toBe(201);
    expect(created.json.key).toMatch(KEY_PATTERN);
    expect(created.json.prefix).toBe(`${created.json.key.slice(0, 11)}…${created.json.key.slice(-4)}`);
    const listed = (await me("GET", "/api/v1/api-keys")).json;
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.json.key);
    expect(listed[0]).not.toHaveProperty("hash");

    const api = withKey(created.json.key);
    const whoami = await api("GET", "/api/v1/me");
    expect(whoami.status).toBe(200);
    expect(whoami.json.apiKey).toMatchObject({ id: created.json.id, name: "ERP sync", scopes: ["read", "write"] });
    const ownWs = (await me("GET", "/api/v1/me")).json.workspace.id;
    expect(whoami.json.workspace.id).toBe(ownWs);
    expect((await api("GET", "/api/v1/payments")).status).toBe(200);
    expect((await me("GET", "/api/v1/api-keys")).json[0].lastUsedAt).toBeTruthy();

    // Another account's key sees that account, not this one.
    const other = await user("other@example.com");
    const otherKey = (await other("POST", "/api/v1/api-keys", { name: "other", scopes: ["read"] })).json.key;
    expect((await withKey(otherKey)("GET", "/api/v1/me")).json.workspace.id).not.toBe(ownWs);
  });

  it("refuse unknown, malformed and revoked keys", async () => {
    const { user, withKey } = await start();
    const me = await user("owner@example.com");
    const { key, id } = (await me("POST", "/api/v1/api-keys", { name: "temp", scopes: ["read"] })).json;
    expect((await withKey("ply_sk_" + "A".repeat(40))("GET", "/api/v1/me")).json.code).toBe("invalid_key");
    expect((await withKey("nonsense")("GET", "/api/v1/me")).status).toBe(401);
    expect((await me("DELETE", `/api/v1/api-keys/${id}`)).status).toBe(204);
    const after = await withKey(key)("GET", "/api/v1/payments");
    expect(after.status).toBe(401);
    expect(after.json.code).toBe("invalid_key");
    expect((await me("DELETE", `/api/v1/api-keys/${id}`)).status).toBe(404);
  });

  it("never approve, sign, manage credentials, payees or budgets", async () => {
    const { user, withKey } = await start();
    const me = await user("owner@example.com");
    const api = withKey((await me("POST", "/api/v1/api-keys", { name: "full", scopes: ["read", "write"] })).json.key);
    for (const [method, path, body] of [
      ["POST", "/api/v1/payments/pay_1/approve", { amountMinor: 100, currency: "EUR" }],
      ["POST", "/api/v1/payments/pay_1/reject", {}],
      ["POST", "/api/v1/payments/pay_1/signature", { declined: true }],
      ["POST", "/api/v1/payments/pay_1/transaction", {}],
      ["POST", "/api/v1/api-keys", { name: "escalate", scopes: ["write"] }],
      ["POST", "/api/v1/connections", { kind: "cashxchain", apiKey: "x" }],
      ["DELETE", "/api/v1/connections/c_1", undefined],
      ["PATCH", "/api/v1/workspace", { agentAccess: "full" }],
      ["POST", "/api/v1/payees", { name: "Mallory" }],
      ["PATCH", "/api/v1/payees/p_1", { iban: "DE89370400440532013000" }],
      ["POST", "/api/v1/budgets", { name: "x", category: "x", limitUsdMinor: 1 }],
      ["POST", "/api/v1/funding", {}],
      ["POST", "/api/v1/me/password", { password: "x" }],
    ] as const) {
      const r = await api(method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.json.code, `${method} ${path}`).toBe("human_only");
    }
    // Reading them is fine.
    expect((await api("GET", "/api/v1/payees")).status).toBe(200);
    expect((await api("GET", "/api/v1/connections")).status).toBe(200);
  });

  it("need the write scope to change anything", async () => {
    const { user, withKey } = await start();
    const me = await user("owner@example.com");
    const api = withKey((await me("POST", "/api/v1/api-keys", { name: "reader", scopes: ["read"] })).json.key);
    const r = await api("POST", "/api/v1/chats", {});
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("insufficient_scope");
    expect((await api("GET", "/api/v1/chats")).status).toBe(200);
  });

  it("draft payments that still wait for a person, once per Idempotency-Key", async () => {
    const { user, withKey } = await start();
    const me = await user("owner@example.com");
    const payee = (await me("POST", "/api/v1/payees", { name: "Brenner GmbH", country: "DE", iban: "DE89 3704 0044 0532 0130 00" })).json;
    const api = withKey((await me("POST", "/api/v1/api-keys", { name: "erp", scopes: ["read", "write"] })).json.key);
    const body = { payeeId: payee.id, amountMinor: 12_000, currency: "EUR", reason: "INV-API-1" };
    const first = await api("POST", "/api/v1/payments", body, { "idempotency-key": "inv-api-1" });
    expect(first.status).toBe(201);
    expect(first.json.status).not.toMatch(/approved|executed|paid/i);
    const again = await api("POST", "/api/v1/payments", body, { "idempotency-key": "inv-api-1" });
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.json.id).toBe(first.json.id);
    expect((await api("GET", "/api/v1/payments")).json).toHaveLength(1);

    const changed = await api("POST", "/api/v1/payments", { ...body, amountMinor: 13_000 }, { "idempotency-key": "inv-api-1" });
    expect(changed.status).toBe(422);
    expect(changed.json.code).toBe("idempotency_mismatch");
  });
});

describe("the AI CFO asked with an API key", () => {
  it("cannot change budgets, and its drafts wait for a person", async () => {
    const { user, withKey, aiCalls } = await start([
      { tool: { name: "set_budget", input: { name: "Travel", category: "travel", monthlyLimitUsd: 99_999 } } },
      { tool: { name: "draft_payment", input: { payeeName: "Brenner GmbH", amount: 120, currency: "EUR", reason: "INV-CHAT-1" } } },
      { text: "Drafted." },
    ]);
    const me = await user("owner@example.com");
    await me("POST", "/api/v1/payees", { name: "Brenner GmbH", country: "DE", iban: "DE89 3704 0044 0532 0130 00" });
    const api = withKey((await me("POST", "/api/v1/api-keys", { name: "mcp", scopes: ["read", "write"] })).json.key);
    const chat = (await api("POST", "/api/v1/chats", {})).json;
    expect((await api("POST", `/api/v1/chats/${chat.id}/messages`, { text: "Raise travel and pay Brenner" })).status).toBe(200);

    expect(aiCalls[0]!.tools.map(t => t.name)).not.toContain("set_budget");
    expect(aiCalls[0]!.system).toMatch(/through the API/);
    expect((await me("GET", "/api/v1/budgets")).json).toEqual([]);
    const [payment] = (await me("GET", "/api/v1/payments")).json;
    expect(payment).toMatchObject({ payeeName: "Brenner GmbH", requestedBy: "user" });
    expect(payment.status).not.toBe("executing");
  });

  it("keeps every tool in the dashboard", async () => {
    const { user, aiCalls } = await start([{ text: "Hi." }]);
    const me = await user("owner@example.com");
    const chat = (await me("POST", "/api/v1/chats", {})).json;
    await me("POST", `/api/v1/chats/${chat.id}/messages`, { text: "Hello" });
    expect(aiCalls[0]!.tools.map(t => t.name)).toContain("set_budget");
    expect(aiCalls[0]!.system).not.toMatch(/through the API/);
  });
});

describe("keyRefusal and RateLimiter", () => {
  it("lets reads through with the read scope only", () => {
    expect(keyRefusal("GET", "/payments", ["read"])).toBeUndefined();
    expect(keyRefusal("GET", "/payees", ["read"])).toBeUndefined();
    expect(keyRefusal("POST", "/payments", ["read"])?.code).toBe("insufficient_scope");
    expect(keyRefusal("POST", "/payments", ["write"])).toBeUndefined();
    expect(keyRefusal("POST", "/payments/abc/approve", ["read", "write"])?.code).toBe("human_only");
  });

  it("allows a burst, then asks to wait, then refills", () => {
    const limiter = new RateLimiter(3);
    const t = 1_000_000;
    expect([limiter.take("k", t), limiter.take("k", t), limiter.take("k", t)]).toEqual([0, 0, 0]);
    expect(limiter.take("k", t)).toBe(20);
    expect(limiter.take("other", t)).toBe(0);
    expect(limiter.take("k", t + 20_000)).toBe(0);
  });
});
