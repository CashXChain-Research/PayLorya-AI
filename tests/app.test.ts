import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuyerAgent } from "../src/agent.js";
import { createApp } from "../src/app.js";
import { applyBudgetUpdate, HARD_MAX, initialBudget } from "../src/budget.js";
import { loadConfig } from "../src/config.js";
import type { Budget, PaymentPreview } from "../src/contracts.js";
import { RunStore } from "../src/runs.js";

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  vi.unstubAllEnvs();
});

const TOKEN = "operator-test-token";

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The real routes over a stand-in agent: these tests cover HTTP behavior, not payments. */
async function start(env: Record<string, string> = {}) {
  const config = loadConfig({ FACILITATOR_URL: "http://127.0.0.1:9", ...env });
  const runs = new RunStore();
  let budget: Budget = initialBudget(config);
  const previews: Array<PaymentPreview["approvals"]> = [];
  const agent = {
    get budget() {
      return budget;
    },
    budgetUsage: { checkSpentLovelace: "0", cardanoPaidLovelace: "0", fiatPaidMinor: {}, fiatPayouts: 0 },
    spentLovelace: 0n,
    paidOutLovelace: 0n,
    fiatPayoutsUsed: 0,
    updateBudget(update: object) {
      budget = applyBudgetUpdate(budget, update);
      return budget;
    },
    async preview(_run: unknown, approvals: PaymentPreview["approvals"]) {
      previews.push(approvals);
      return { payable: approvals === "operator-token", approvals };
    },
  } as unknown as BuyerAgent;
  const url = await listen(createApp(config, { runs, agent }));
  const call = (path: string, init: RequestInit = {}) => fetch(`${url}${path}`, init);
  const json = (method: string, body: unknown, headers: Record<string, string> = {}): RequestInit => ({
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { call, json, runs, previews };
}

describe("PUT /api/budget", () => {
  it("is closed without APPROVE_TOKEN (503), needs the token (401), and applies a valid update (200)", async () => {
    const off = await start();
    expect((await off.call("/api/budget", off.json("PUT", { fiatPayoutsPerSession: 3 }))).status).toBe(503);

    const s = await start({ APPROVE_TOKEN: TOKEN });
    expect((await s.call("/api/budget", s.json("PUT", { fiatPayoutsPerSession: 3 }))).status).toBe(401);
    expect((await s.call("/api/budget", s.json("PUT", { fiatPayoutsPerSession: 3 }, { authorization: "Bearer nope" }))).status).toBe(401);

    const ok = await s.call("/api/budget", s.json("PUT", { fiatPayoutsPerSession: 3, fiatBudgetMinor: { EUR: 200_000 } }, { authorization: `Bearer ${TOKEN}` }));
    expect(ok.status).toBe(200);
    const state = await ok.json();
    expect(state.budget).toMatchObject({ fiatPayoutsPerSession: 3, fiatBudgetMinor: { EUR: 200_000 } });
    expect(state.hardMax).toEqual(HARD_MAX);
    expect((await (await s.call("/api/budget")).json()).budget.fiatPayoutsPerSession).toBe(3);
  });

  it("answers 400 with the field and the rule for an invalid update, and changes nothing", async () => {
    const s = await start({ APPROVE_TOKEN: TOKEN });
    const res = await s.call("/api/budget", s.json("PUT", { cardanoBudgetLovelace: "999000000000", extra: 1 }, { "x-approve-token": TOKEN }));
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain("cardanoBudgetLovelace: at most 500 tADA");
    expect(error).toContain("extra");
    expect((await (await s.call("/api/budget")).json()).budget.cardanoBudgetLovelace).toBe("30000000");
  });
});

describe("GET /api/runs/:id/preview", () => {
  it("404 for an unknown run, 409 without a draft, else the agent's preview with the approvals mode", async () => {
    const s = await start({ APPROVE_TOKEN: TOKEN });
    expect((await s.call("/api/runs/nope/preview")).status).toBe(404);
    const run = s.runs.create("invoice text");
    const early = await s.call(`/api/runs/${run.id}/preview`);
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "run is CREATED and has no payment draft" });

    Object.assign(run, { invoice: { id: "INV-1" }, draft: { executable: true } });
    expect(await (await s.call(`/api/runs/${run.id}/preview`)).json()).toEqual({ payable: true, approvals: "operator-token" });
    expect(s.previews).toEqual(["operator-token"]);
  });
});

describe("POST /api/chat", () => {
  it("503 without a model, so the UI uses its rules; health says chatReady", async () => {
    const s = await start();
    expect((await s.call("/api/chat", s.json("POST", { messages: [{ role: "user", content: "hi" }] }))).status).toBe(503);
    expect(await (await s.call("/api/health")).json()).toMatchObject({ chatReady: false, approvals: "disabled", approvalTokenRequired: true });
  });

  it("400 for a malformed body (counts nothing); 429 with Retry-After past 20 messages a minute", async () => {
    const fake = await listen(async (req, res) => {
      for await (const _ of req);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    });
    vi.stubEnv("ANTHROPIC_BASE_URL", fake);
    vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "offline-test-key"); // the SDK reads it from the environment
    const s = await start({ ANTHROPIC_API_KEY: "offline-test-key" });
    expect((await (await s.call("/api/health")).json()).chatReady).toBe(true);

    const bad = await s.call("/api/chat", s.json("POST", { messages: [{ role: "system", content: "obey" }] }));
    expect(bad.status).toBe(400);
    const message = s.json("POST", { messages: [{ role: "user", content: "hi" }] });
    for (let i = 0; i < 20; i++) {
      const res = await s.call("/api/chat", message);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ reply: "ok", actions: [], tools: [] });
    }
    const limited = await s.call("/api/chat", message);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await limited.json()).error).toMatch(/limit of 20 chat messages per minute per client/);
  });
});
