import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { BuyerAgent } from "../src/agent.js";
import type { CashXChainClient } from "../src/cashxchain.js";
import { createCfo, mountCfo, type PaymentEngine } from "../src/cfo/index.js";
import { loadConfig } from "../src/config.js";
import { RunStore } from "../src/runs.js";

const servers: Server[] = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map(c => c.close()));
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => (s.closeAllConnections(), s.close(() => resolve())))));
});

// The account's own CashXChain (by API key) and agent wallet: with both, a draft can wait for approval.
const CXC_KEY = "cxc_sk_sandbox_workspaceKey1";
const fakeCxc = {
  listAccounts: async () => ({ accounts: [{ id: "acc_1", currency: "EUR", status: "active" }] }),
  balance: async (id: string) => [{ account_id: id, currency: "EUR", available: "8000.00" }],
};
const AGENT_PHRASE = generateMnemonic(wordlist, 256);

/** Stand-in for client.messages.stream: one workspace tool call, then the answer. */
function fakeClaude(answer: string): Pick<Anthropic, "messages"> {
  let turn = 0;
  const messages = {
    stream() {
      const step = turn++ % 2;
      let onText: ((d: string) => void) | undefined;
      const stream = {
        on(event: string, cb: (d: string) => void) {
          if (event === "text") onText = cb;
          return stream;
        },
        async finalMessage() {
          if (step === 0) return { content: [{ type: "tool_use", id: `tu_${turn}`, name: "list_payments", input: {} }], stop_reason: "tool_use" };
          onText?.(answer);
          return { content: [{ type: "text", text: answer }], stop_reason: "end_turn" };
        },
      };
      return stream;
    },
  };
  return { messages } as unknown as Pick<Anthropic, "messages">;
}

type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>;

async function start() {
  const app = express();
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: "s".repeat(40), ANTHROPIC_API_KEY: "test" });
  const engine: PaymentEngine = { runs: new RunStore(), agent: {} as BuyerAgent };
  const deps = await createCfo(config, engine, {
    memory: true,
    noSweep: true,
    cashxchainFor: () => fakeCxc as unknown as CashXChainClient,
    agentFor: () => ({}) as BuyerAgent,
  });
  deps.connections = { acceptsApiKey: true };
  deps.chatClient = fakeClaude("Cash is 8,000 EUR. Nothing is waiting for approval.");
  mountCfo(app, deps);

  /** A signed-in dashboard user (session cookie): makes keys, payees and connections. */
  async function user(email: string): Promise<Call> {
    const res = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ name: "Test User", email, password: "correct-horse-1" }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    return async (method, path, body) => {
      const r = await fetch(`${base}${path}`, {
        method,
        headers: { cookie, origin: base, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      return { status: r.status, json: text ? JSON.parse(text) : undefined };
    };
  }
  const key = async (me: Call, scopes: string[]) => (await me("POST", "/api/v1/api-keys", { name: "mcp", scopes })).json.key as string;
  async function mcp(apiKey: string): Promise<Client> {
    const client = new Client({ name: "mcp-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${apiKey}` } } }));
    clients.push(client);
    return client;
  }
  return { base, user, key, mcp };
}

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const text = (r: ToolResult, i = 0) => (r.content as Array<{ type: string; text: string }>)[i]!.text;
const json = (r: ToolResult, i = 0) => JSON.parse(text(r, i));

describe("MCP server at /mcp", () => {
  it("lists the tools; none approves, signs or manages payees, budgets, connections or keys", async () => {
    const { user, key, mcp } = await start();
    const client = await mcp(await key(await user("owner@example.com"), ["read"]));
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual([
      "ask_cfo",
      "draft_payment",
      "get_activity",
      "get_document",
      "get_forecast",
      "get_overview",
      "list_budgets",
      "list_documents",
      "list_payees",
      "list_payments",
      "list_transactions",
    ]);
    const draft = tools.find(t => t.name === "draft_payment")!;
    expect(draft.description).toMatch(/waits for a person to approve it in the PayLorya AI dashboard/);
    expect(draft.inputSchema.required).toEqual(["payeeId", "amountMinor", "currency", "reason"]);
    expect(tools.find(t => t.name === "list_payees")!.annotations?.readOnlyHint).toBe(true);
  });

  it("reads through the REST API, for the key's own account only", async () => {
    const { user, key, mcp } = await start();
    const me = await user("owner@example.com");
    await me("POST", "/api/v1/payees", { name: "Brenner GmbH", iban: "DE89370400440532013000" });
    const client = await mcp(await key(me, ["read"]));
    const payees = await client.callTool({ name: "list_payees", arguments: {} });
    expect(payees.isError).toBeFalsy();
    expect(json(payees)).toMatchObject([{ name: "Brenner GmbH", iban: "DE89370400440532013000" }]);
    const overview = json(await client.callTool({ name: "get_overview", arguments: {} }));
    expect(overview.workspace.id).toBe((await me("GET", "/api/v1/me")).json.workspace.id);
    expect(json(await client.callTool({ name: "get_forecast", arguments: { days: 30 } })).days).toBe(30);

    const other = await mcp(await key(await user("other@example.com"), ["read"]));
    expect(json(await other.callTool({ name: "list_payees", arguments: {} }))).toEqual([]);
    const missing = await other.callTool({ name: "get_document", arguments: { documentId: "00000000-0000-0000-0000-000000000000" } });
    expect(missing.isError).toBe(true);
    expect(json(missing)).toMatchObject({ code: "not_found", status: 404 });
  });

  it("draft_payment creates a payment that waits for a person's approval, once per idempotencyKey", async () => {
    const { user, key, mcp } = await start();
    const me = await user("owner@example.com");
    await me("POST", "/api/v1/connections", { kind: "cashxchain", apiKey: CXC_KEY, access: "read_write" });
    await me("POST", "/api/v1/connections", { kind: "cardano_agent_wallet", recoveryPhrase: AGENT_PHRASE, access: "read_write" });
    const payee = (await me("POST", "/api/v1/payees", { name: "Brenner GmbH", country: "DE", iban: "DE89370400440532013000" })).json;
    const client = await mcp(await key(me, ["read", "write"]));

    const args = { payeeId: payee.id, amountMinor: 12_000, currency: "EUR", reason: "INV-MCP-1", idempotencyKey: "inv-mcp-1" };
    const drafted = await client.callTool({ name: "draft_payment", arguments: args });
    expect(drafted.isError).toBeFalsy();
    const payment = json(drafted);
    expect(payment).toMatchObject({ status: "pending_approval", requestedBy: "user", payeeName: "Brenner GmbH", amountMinor: 12_000, currency: "EUR" });
    expect(json(await client.callTool({ name: "draft_payment", arguments: args })).id).toBe(payment.id);
    expect((await me("GET", "/api/v1/payments")).json).toMatchObject([{ id: payment.id, status: "pending_approval" }]);
    expect(json(await client.callTool({ name: "list_payments", arguments: { status: "executed" } }))).toEqual([]);

    // Without the key: the REST API's own duplicate check answers, as a tool error.
    const twin = await client.callTool({ name: "draft_payment", arguments: { ...args, idempotencyKey: undefined } });
    expect(twin.isError).toBe(true);
    expect(json(twin)).toMatchObject({ code: "conflict", status: 409 });
    expect(json(twin).error).toContain(payment.id);
  });

  it("a read-only key gets a tool error, not a payment", async () => {
    const { user, key, mcp } = await start();
    const me = await user("owner@example.com");
    const payee = (await me("POST", "/api/v1/payees", { name: "Brenner GmbH", iban: "DE89370400440532013000" })).json;
    const client = await mcp(await key(me, ["read"]));
    const r = await client.callTool({ name: "draft_payment", arguments: { payeeId: payee.id, amountMinor: 100, currency: "EUR", reason: "x" } });
    expect(r.isError).toBe(true);
    expect(json(r)).toMatchObject({ code: "insufficient_scope", status: 403 });
    expect((await client.callTool({ name: "ask_cfo", arguments: { question: "How is cash?" } })).isError).toBe(true);
    expect((await me("GET", "/api/v1/payments")).json).toEqual([]);
  });

  it("ask_cfo collects the streamed answer and continues the same chat", async () => {
    const { user, key, mcp } = await start();
    const me = await user("owner@example.com");
    const client = await mcp(await key(me, ["read", "write"]));
    const progress: Array<string | undefined> = [];
    const first = await client.callTool({ name: "ask_cfo", arguments: { question: "How is cash?" } }, undefined, { onprogress: p => progress.push(p.message) });
    expect(first.isError).toBeFalsy();
    expect(text(first)).toBe("Cash is 8,000 EUR. Nothing is waiting for approval.");
    const { chatId, steps } = json(first, 1);
    expect(steps).toEqual(["Checked 0 payments"]);
    // The CFO's tool steps reach the client as progress notifications while it works.
    expect(progress).toContain("Checked 0 payments");
    await client.callTool({ name: "ask_cfo", arguments: { question: "And next month?", chatId } });
    expect((await me("GET", `/api/v1/chats/${chatId}`)).json.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("answers 401 with WWW-Authenticate without a valid key, and only takes POST", async () => {
    const { base, user, key, mcp } = await start();
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
    const post = (headers: Record<string, string>) =>
      fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(init) });

    const none = await post({});
    expect(none.status).toBe(401);
    // resource_metadata leads OAuth clients (claude.ai connectors) to the sign-in (src/cfo/oauth.ts).
    expect(none.headers.get("www-authenticate")).toBe(`Bearer realm="PayLorya AI", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
    expect((await none.json()).code).toBe("missing_key");
    const bad = await post({ authorization: `Bearer ply_sk_${"A".repeat(40)}` });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect((await bad.json()).code).toBe("invalid_key");
    await expect(mcp("nonsense")).rejects.toMatchObject({ code: 401 });

    const me = await user("owner@example.com");
    const { key: revoked, id } = (await me("POST", "/api/v1/api-keys", { name: "temp", scopes: ["read"] })).json;
    expect((await post({ authorization: `Bearer ${revoked}` })).status).toBe(200);
    await me("DELETE", `/api/v1/api-keys/${id}`);
    expect((await post({ authorization: `Bearer ${revoked}` })).status).toBe(401);

    const get = await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${await key(me, ["read"])}`, accept: "text/event-stream" } });
    expect(get.status).toBe(405);
  });
});
