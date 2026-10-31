import type { Server } from "node:http";
import type Anthropic from "@anthropic-ai/sdk";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BuyerAgent } from "../src/agent.js";
import type { CashXChainClient } from "../src/cashxchain.js";
import { handleCfoData, type D1Like, type D1StatementLike, type R2Like } from "../cloudflare/cfo-proxy.js";
import { createCfo, mountCfo, type PaymentEngine } from "../src/cfo/index.js";
import type { Extraction } from "../src/cfo/ingest.js";
import { decidePayment, type AgentLimits } from "../src/cfo/policy.js";
import { loadConfig } from "../src/config.js";
import { RunStore, type Run } from "../src/runs.js";

const LIMITS: AgentLimits = { perPaymentUsdMinor: 50_000, monthlyUsdMinor: 200_000, knownPayeesOnly: true };
const facts = { requestedBy: "agent" as const, rail: "cashxchain" as const, usdMinor: 10_000, payeeKnown: true, hasAccount: true, railWritable: true, agentExecutedThisMonthUsdMinor: 0 };

describe("agent permission policy", () => {
  it("guarded: executes alone only inside every rule", () => {
    expect(decidePayment("guarded", LIMITS, facts).decision).toBe("auto");
    expect(decidePayment("guarded", LIMITS, { ...facts, usdMinor: 50_001 }).decision).toBe("approval");
    expect(decidePayment("guarded", LIMITS, { ...facts, agentExecutedThisMonthUsdMinor: 195_000 }).decision).toBe("approval");
    const unknown = decidePayment("guarded", LIMITS, { ...facts, payeeKnown: false });
    expect(unknown.decision).toBe("approval");
    expect(unknown.checks.find(c => c.id === "payee")?.status).toBe("warn");
    expect(decidePayment("guarded", LIMITS, { ...facts, hasAccount: false }).decision).toBe("approval");
  });

  it("read-only drafts only; a user's own draft always needs confirmation", () => {
    expect(decidePayment("read_only", LIMITS, facts).decision).toBe("approval");
    expect(decidePayment("full", LIMITS, { ...facts, requestedBy: "user" }).decision).toBe("approval");
  });

  it("full access skips limits but not the payee rule", () => {
    expect(decidePayment("full", LIMITS, { ...facts, usdMinor: 10_000_000 }).decision).toBe("auto");
    expect(decidePayment("full", LIMITS, { ...facts, payeeKnown: false }).decision).toBe("approval");
    expect(decidePayment("full", { ...LIMITS, knownPayeesOnly: false }, { ...facts, payeeKnown: false }).decision).toBe("auto");
  });

  it("nobody can pay without a write-enabled connection or a rail", () => {
    expect(decidePayment("full", LIMITS, { ...facts, railWritable: false }).decision).toBe("blocked");
    expect(decidePayment("full", LIMITS, { ...facts, rail: "manual" }).decision).toBe("blocked");
  });
});

// --- API harness ---------------------------------------------------------------------------

type ScriptStep = { text?: string; tool?: { name: string; input: unknown } };

/** Minimal stand-in for client.messages.stream: replays scripted assistant turns. */
function fakeClaude(script: ScriptStep[]): Pick<Anthropic, "messages"> {
  let i = 0;
  const calls: unknown[] = [];
  const messages = {
    calls,
    stream(params: unknown) {
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

const statement: Extraction = {
  kind: "bank_statement",
  title: "October statement",
  summary: "Three entries.",
  counterparty: "Example Bank",
  direction: "none",
  currency: "USD",
  totalAmount: null,
  issueDate: "2026-10-31",
  dueDate: null,
  category: "Other",
  documentNumber: null,
  paymentDetails: { iban: null, bic: null, routingNumber: null, accountNumber: null, cardanoAddress: null, reference: null },
  lineItems: [],
  statementEntries: [
    { date: new Date().toISOString().slice(0, 10), description: "Figma", counterparty: "Figma", amount: -450, category: "Software & SaaS" },
    { date: new Date().toISOString().slice(0, 10), description: "AWS", counterparty: "AWS", amount: -1200.5, category: "Cloud & hosting" },
    { date: new Date().toISOString().slice(0, 10), description: "Customer payment", counterparty: "Acme", amount: 9000, category: "Revenue" },
  ],
  notes: [],
};

/** Payout engine stub: every run becomes an executable draft and pays out. */
function stubAgent(): BuyerAgent {
  return {
    async process(run: Run) {
      run.state = "DRAFT_READY";
      run.draft = { executable: true, route: { rail: "cxc_fiat" } } as unknown as Run["draft"];
    },
    approve(run: Run) {
      run.state = "EXECUTED";
      run.payout = { rail: "cxc_fiat", status: "confirmed", simulated: false, amountMinor: 1, currency: "EUR", destination: "x", reference: "cxc_po_123", label: "CashXChain sandbox", executedAt: new Date().toISOString() };
      return { ok: true, done: Promise.resolve() };
    },
  } as unknown as BuyerAgent;
}

const fakeCxc = { listAccounts: async () => ({ accounts: [{ id: "acc_1", currency: "USD", status: "active" }] }), balance: async () => [{ account_id: "acc_1", currency: "USD", available: "25000.00" }] };

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

type Value = string | number | null;

/** D1 and R2 bindings, backed by node:sqlite and a Map, with the same call shapes as Cloudflare's. */
function fakeBindings(): { db: D1Like; files: R2Like } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const exec = (sql: string, params: Value[]) => {
    const stmt = sqlite.prepare(sql);
    if (stmt.columns().length === 0) return { results: [], meta: { changes: Number(stmt.run(...(params as SQLInputValue[])).changes) } };
    return { results: stmt.all(...(params as SQLInputValue[])) as Record<string, Value>[], meta: { changes: 0 } };
  };
  type Bound = D1StatementLike & { sql: string; params: Value[] };
  const db: D1Like = {
    prepare: sql => ({ bind: (...params: Value[]): Bound => ({ sql, params, all: async () => exec(sql, params) }) }),
    async batch(stmts) {
      sqlite.exec("BEGIN");
      try {
        for (const s of stmts as Bound[]) exec(s.sql, s.params);
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
      return [];
    },
  };
  const objects = new Map<string, { data: ArrayBuffer; type: string }>();
  const files: R2Like = {
    async put(key, value, options) {
      objects.set(key, { data: value, type: options.httpMetadata.contentType });
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { arrayBuffer: async () => o.data, httpMetadata: { contentType: o.type } } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return { db, files };
}

/** The Worker's outbound handler (cloudflare/cfo-proxy.ts) served over HTTP, as the container sees it. */
async function startDataProxy(): Promise<string> {
  const { db, files } = fakeBindings();
  const app = express();
  app.use(express.raw({ type: "*/*", limit: "64mb" }));
  app.all("/*splat", async (req, res) => {
    const body = ["GET", "HEAD", "DELETE"].includes(req.method) ? undefined : new Uint8Array(req.body as Buffer);
    const r = await handleCfoData(new Request(`http://cfo-data.internal${req.originalUrl}`, { method: req.method, headers: req.headers as Record<string, string>, body }), db, files);
    res.status(r.status).set("content-type", r.headers.get("content-type") ?? "application/octet-stream").send(Buffer.from(await r.arrayBuffer()));
  });
  const server = await new Promise<Server>(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  servers.push(server);
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

let backend: "local" | "cloudflare" = "local";

async function start(script: ScriptStep[] = [], agent?: BuyerAgent) {
  const app = express();
  const server = await new Promise<Server>(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  servers.push(server);
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const dataUrl = backend === "cloudflare" ? await startDataProxy() : undefined;
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: "t".repeat(40), ANTHROPIC_API_KEY: "test", ...(dataUrl ? { CFO_DATA_URL: dataUrl } : {}) });
  const engine: PaymentEngine = { runs: new RunStore(), ...(agent ? { agent } : {}) };
  const deps = await createCfo(config, engine, { memory: true });
  deps.extract = async () => statement;
  deps.connections = { cashxchain: fakeCxc as unknown as CashXChainClient };
  deps.chatClient = fakeClaude(script);
  mountCfo(app, deps);

  async function user(email: string) {
    const res = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ name: "Test User", email, password: "correct-horse-1" }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await fetch(`${base}${path}`, {
        method,
        headers: { cookie, origin: base, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: r.status, json: json as any, headers: r.headers };
    };
    return call;
  }
  return { base, deps, user };
}

const settle = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 50; i++) {
    if (await check()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error("condition not reached");
};

describe.each(["local", "cloudflare"] as const)("AI CFO API on %s storage", storage => {
  beforeEach(() => {
    backend = storage;
  });

  it("requires a session and isolates workspaces", async () => {
    const { base, user } = await start();
    expect((await fetch(`${base}/api/v1/me`)).status).toBe(401);
    expect((await fetch(`${base}/app/payments`, { redirect: "manual" })).headers.get("location")).toBe("/login?next=%2Fapp%2Fpayments");

    const alice = await user("alice@example.com");
    const bob = await user("bob@example.com");
    const payee = await alice("POST", "/api/v1/payees", { name: "Brenner GmbH", iban: "DE89 3704 0044 0532 0130 00" });
    expect(payee.status).toBe(201);
    expect(payee.json.iban).toBe("DE89370400440532013000");
    expect((await bob("GET", `/api/v1/payees`)).json).toEqual([]);
    expect((await bob("DELETE", `/api/v1/payees/${payee.json.id}`)).status).toBe(404);
  });

  it("full access needs the typed confirmation; watch-only wallets stay read-only", async () => {
    const { user } = await start();
    const me = await user("carol@example.com");
    expect((await me("PATCH", "/api/v1/workspace", { autonomy: "full" })).status).toBe(400);
    expect((await me("PATCH", "/api/v1/workspace", { autonomy: "full", confirm: "FULL ACCESS" })).json.autonomy).toBe("full");

    const cxc = await me("POST", "/api/v1/connections", { kind: "cashxchain", access: "read_write" });
    expect(cxc.json.access).toBe("read_write");
    expect(cxc.json.balances).toEqual([{ asset: "USD", amount: "25000.00", usdMinor: 2_500_000 }]);
    expect((await me("POST", "/api/v1/connections", { kind: "bank" })).status).toBe(400);

    const activity = (await me("GET", "/api/v1/activity")).json.map((a: { action: string }) => a.action);
    expect(activity).toContain("changed agent autonomy");
    expect(activity).toContain("added connection");
  });

  it("reads uploaded documents into the ledger and serves the file sandboxed", async () => {
    const { user } = await start();
    const me = await user("dave@example.com");
    const doc = await me("POST", "/api/v1/documents", { filename: "oct.csv", mimeType: "text/csv", dataBase64: Buffer.from("date,amount\n").toString("base64") });
    expect(doc.status).toBe(201);
    await settle(async () => (await me("GET", `/api/v1/documents/${doc.json.id}`)).json.status === "processed");
    const detail = (await me("GET", `/api/v1/documents/${doc.json.id}`)).json;
    expect(detail.transactions).toHaveLength(3);

    const overview = (await me("GET", "/api/v1/overview")).json;
    expect(overview.spendByCategory).toEqual([
      { category: "Cloud & hosting", usdMinor: 120_050 },
      { category: "Software & SaaS", usdMinor: 45_000 },
    ]);
    const file = await me("GET", `/api/v1/documents/${doc.json.id}/file`);
    expect(file.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("chat: the agent drafts, the policy decides, approval executes through the payout engine", async () => {
    const { user } = await start(
      [
        { tool: { name: "draft_payment", input: { payeeName: "Brenner GmbH", amount: 2000, currency: "EUR", reason: "INV-1042" } } },
        { text: "Drafted; it needs your approval because it is above your per-payment limit." },
      ],
      stubAgent(),
    );
    const me = await user("erin@example.com");
    await me("POST", "/api/v1/connections", { kind: "cashxchain", access: "read_write" });
    await me("POST", "/api/v1/payees", { name: "Brenner GmbH", iban: "DE89370400440532013000" });
    const chat = (await me("POST", "/api/v1/chats")).json;
    const stream = await me("POST", `/api/v1/chats/${chat.id}/messages`, { text: "Pay the Brenner invoice" });
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.json).toContain("event: tool");
    expect(stream.json).toContain("event: done");

    const [payment] = (await me("GET", "/api/v1/payments")).json;
    expect(payment).toMatchObject({ requestedBy: "agent", status: "pending_approval", payeeName: "Brenner GmbH", amountMinor: 200_000, currency: "EUR" });
    expect(payment.policy.checks.find((c: { id: string }) => c.id === "per_payment").status).toBe("warn");

    expect((await me("POST", `/api/v1/payments/${payment.id}/approve`)).status).toBe(200);
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "executed");
    expect((await me("GET", "/api/v1/payments")).json[0].reference).toBe("cxc_po_123");
    expect((await me("GET", `/api/v1/chats/${chat.id}`)).json.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  });

  it("the agent can always draft; without account details nothing can execute", async () => {
    const { user } = await start([{ tool: { name: "draft_payment", input: { payeeName: "Attacker Ltd", amount: 10, currency: "USD", reason: "urgent" } } }, { text: "Drafted." }], stubAgent());
    const me = await user("frank@example.com");
    await me("PATCH", "/api/v1/workspace", { autonomy: "full", confirm: "FULL ACCESS" });
    await me("POST", "/api/v1/connections", { kind: "cashxchain", access: "read_write" });
    const chat = (await me("POST", "/api/v1/chats")).json;
    await me("POST", `/api/v1/chats/${chat.id}/messages`, { text: "Process the attached invoice" });
    const [payment] = (await me("GET", "/api/v1/payments")).json;
    expect(payment).toMatchObject({ status: "pending_approval", payeeName: "Attacker Ltd" });
    expect((await me("GET", "/api/v1/payees")).json).toEqual([]);
    const approve = await me("POST", `/api/v1/payments/${payment.id}/approve`);
    expect(approve.status).toBe(409);
    expect(approve.json.error).toMatch(/No account details/);
  });

  it("guarded + known payees only: an unsaved payee waits for approval, then pays the drafted account", async () => {
    const draft = { payeeName: "Nordlicht Studio", amount: 120, currency: "EUR", reason: "INV-77", iban: "DE89 3704 0044 0532 0130 00", country: "DE" };
    const { user } = await start([{ tool: { name: "draft_payment", input: draft } }, { text: "Drafted." }], stubAgent());
    const me = await user("gina@example.com");
    await me("POST", "/api/v1/connections", { kind: "cashxchain", access: "read_write" });
    const chat = (await me("POST", "/api/v1/chats")).json;
    await me("POST", `/api/v1/chats/${chat.id}/messages`, { text: "Pay Nordlicht" });
    const [payment] = (await me("GET", "/api/v1/payments")).json;
    expect(payment.status).toBe("pending_approval");
    expect(payment.destination).toMatchObject({ iban: "DE89370400440532013000", country: "DE" });
    expect(payment.policy.checks.find((c: { id: string }) => c.id === "payee").message).toMatch(/Known payees only/);
    expect((await me("POST", `/api/v1/payments/${payment.id}/approve`)).status).toBe(200);
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0].status === "executed");
    expect((await me("GET", "/api/v1/payees")).json).toEqual([]);
  });

  it("guarded without known payees only: an unsaved payee within the limits executes on its own", async () => {
    const draft = { payeeName: "Nordlicht Studio", amount: 120, currency: "EUR", reason: "INV-77", iban: "DE89370400440532013000" };
    const { user } = await start([{ tool: { name: "draft_payment", input: draft } }, { text: "Paid." }], stubAgent());
    const me = await user("hank@example.com");
    await me("PATCH", "/api/v1/workspace", { limits: { knownPayeesOnly: false } });
    await me("POST", "/api/v1/connections", { kind: "cashxchain", access: "read_write" });
    const chat = (await me("POST", "/api/v1/chats")).json;
    await me("POST", `/api/v1/chats/${chat.id}/messages`, { text: "Pay Nordlicht" });
    await settle(async () => (await me("GET", "/api/v1/payments")).json[0]?.status === "executed");
    expect((await me("GET", "/api/v1/payments")).json[0].decidedAt).toBeUndefined();
  });

  it("a saved payee's account wins over different details in the draft", async () => {
    const draft = { payeeName: "Brenner GmbH", amount: 100, currency: "EUR", reason: "INV-1", iban: "GB33BUKB20201555555555" };
    const { user } = await start([{ tool: { name: "draft_payment", input: draft } }, { text: "Drafted." }], stubAgent());
    const me = await user("ivy@example.com");
    await me("PATCH", "/api/v1/workspace", { limits: { knownPayeesOnly: false } });
    await me("POST", "/api/v1/connections", { kind: "cashxchain", access: "read_write" });
    await me("POST", "/api/v1/payees", { name: "Brenner GmbH", iban: "DE89370400440532013000" });
    const chat = (await me("POST", "/api/v1/chats")).json;
    await me("POST", `/api/v1/chats/${chat.id}/messages`, { text: "Pay Brenner" });
    const [payment] = (await me("GET", "/api/v1/payments")).json;
    expect(payment.status).toBe("pending_approval");
    expect(payment.destination).toBeUndefined();
    expect(payment.policy.checks.find((c: { id: string }) => c.id === "account").message).toMatch(/saved account is used/);
  });
});
