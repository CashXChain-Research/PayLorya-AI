import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express, { type Express, type Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { toClientCardanoSigner, type ClientCardanoSigner } from "@x402/cardano";
import { BuyerAgent } from "../src/agent.js";
import { CARDANO_NETWORK, loadConfig } from "../src/config.js";
import { SAMPLE_INVOICES } from "../src/fixtures.js";
import { RunStore } from "../src/runs.js";
import { mountSeller } from "../src/seller.js";
import { remoteCheck } from "../scripts/remote-check.js";
import { remoteRun } from "../scripts/remote-run.js";
import { ATTACKER_ADDRESS, INJECTION_SUPPLIER, runSafety } from "../scripts/safety-scenarios.js";

// The remote tooling against a real local stack on 127.0.0.1: mountSeller (paymentMiddleware + x402ResourceServer +
// HTTPFacilitatorClient), a real BuyerAgent (x402Client, wrapFetchWithPayment, ExactCardanoScheme, SpendLedger) and
// the /api routes of src/server.ts. Only the chain side (signer, facilitator) and, where used, the model are stubbed.

const MNEMONIC_24 = `${"abandon ".repeat(23)}art`; // BIP39 test vectors, never funded
const MNEMONIC_12 = `${"abandon ".repeat(11)}about`;
const provider = { blockfrost: { baseUrl: "http://127.0.0.1:9", projectId: "unused" } };
const addressOf = (mnemonic: string) => toClientCardanoSigner({ mnemonic, network: CARDANO_NETWORK, provider }).getAddress();
const BUYER = addressOf(MNEMONIC_24);
const SELLER = addressOf(MNEMONIC_12);
const TX = "7a".repeat(32);
const PRICE = 2_000_000n;
const FAST = { intervalMs: 10, timeoutMs: 5_000 };

type Reply = (res: Response) => void;
const settleOk: Reply = res => void res.json({ success: true, transaction: TX, network: CARDANO_NETWORK, payer: BUYER });

const servers: Server[] = [];
const dirs: string[] = [];
const savedEnv = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL };

afterEach(async () => {
  for (const [k, v] of [["ANTHROPIC_API_KEY", savedEnv.key], ["ANTHROPIC_BASE_URL", savedEnv.url]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })));
});

async function listen(app: Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cxc-remote-"));
  dirs.push(dir);
  return dir;
}

async function startFacilitator() {
  const app = express();
  app.use(express.json());
  const fac = { url: "", verifyCalls: 0, settleCalls: 0, settle: settleOk };
  // Same capability block as the hosted preprod facilitator's live /supported (2026-10-30).
  app.get("/supported", (_req, res) => {
    res.json({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: CARDANO_NETWORK,
          extra: { assetTransferMethods: ["default", "masumi", "script"], areFeesSponsored: false, l1Confirmations: { minimum: 0, maximum: 20 } },
        },
      ],
      extensions: [],
      signers: {},
    });
  });
  app.post("/verify", (_req, res) => {
    fac.verifyCalls += 1;
    res.json({ isValid: true, payer: BUYER });
  });
  app.post("/settle", (_req, res) => {
    fac.settleCalls += 1;
    fac.settle(res);
  });
  fac.url = await listen(app);
  return fac;
}

/** Stand-in for the Messages API: copies fields out of the invoice text, including the injected address. */
async function startModel(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.post("/v1/messages", (req, res) => {
    const text = String(req.body?.messages?.[0]?.content ?? "");
    const field = (re: RegExp) => re.exec(text)?.[1]?.trim() ?? null;
    const extraction = {
      invoiceId: field(/INVOICE\s+(\S+)/),
      supplierName: field(/From:\s*([^\n]+)/),
      destinationCountry: null,
      currency: field(/Amount due:\s*([A-Z]{3})/),
      amount: field(/Amount due:\s*[A-Z]{3}\s*([\d.,]+)/),
      reference: /addr_test1\w+/.exec(text)?.[0] ?? null,
      iban: field(/IBAN\s+([A-Z0-9 ]+?),/),
      bic: field(/BIC\s+([A-Z0-9]+)/),
      routingNumber: null,
      accountNumber: null,
    };
    res.json({
      id: "msg_stub",
      type: "message",
      role: "assistant",
      model: req.body?.model,
      content: [{ type: "text", text: JSON.stringify(extraction) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });
  return listen(app);
}

/** The /api routes of src/server.ts (which cannot be imported: it listens at top level). */
async function startServer(opts: { ai?: boolean; health?: Record<string, unknown> } = {}) {
  const fac = await startFacilitator();
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  const url = await listen(app);
  if (opts.ai) {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.ANTHROPIC_BASE_URL = await startModel();
  }
  const config = loadConfig({
    PUBLIC_BASE_URL: url,
    SELLER_ADDRESS: SELLER,
    BUYER_MNEMONIC: MNEMONIC_24,
    BLOCKFROST_PROJECT_ID: "unused",
    FACILITATOR_URL: fac.url,
    PRICE_LOVELACE: PRICE.toString(),
    ...(opts.ai ? { ANTHROPIC_API_KEY: "test-key" } : {}),
  });
  mountSeller(app, config);

  const signer = { calls: 0, getAddress: () => BUYER } as ClientCardanoSigner & { calls: number };
  signer.buildAndSignPaymentTransaction = () => {
    signer.calls += 1;
    return { transaction: Buffer.from(`stub-signed-tx-${signer.calls}`).toString("base64"), nonce: `${"ab".repeat(32)}#${signer.calls}` };
  };
  const runs = new RunStore();
  let created = 0;
  const agent = new BuyerAgent(config, runs, signer);

  app.get(["/health", "/api/health"], (_req, res) => {
    res.json({
      status: "ok",
      network: "cardano:preprod",
      x402Ready: config.x402Ready,
      aiReady: config.aiReady,
      facilitator: config.facilitatorUrl,
      buyerAddress: agent.buyerAddress,
      sellerAddress: config.SELLER_ADDRESS,
      priceLovelace: config.PRICE_LOVELACE.toString(),
      spentLovelace: agent.spentLovelace.toString(),
      ...opts.health,
    });
  });
  app.get("/api/samples", (_req, res) => {
    res.json(SAMPLE_INVOICES);
  });
  app.post("/api/runs", (req, res) => {
    const input = typeof req.body?.input === "string" ? req.body.input : JSON.stringify(req.body?.input ?? "");
    if (!input || input === '""') {
      res.status(400).json({ error: "body.input (invoice text or JSON) required" });
      return;
    }
    const run = runs.create(input);
    created += 1;
    void agent.process(run);
    res.status(202).json({ id: run.id, state: run.state });
  });
  app.get("/api/runs/:id", (req, res) => {
    const run = runs.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }
    res.json(run);
  });
  return { url, fac, signer, agent, runsCreated: () => created };
}

function capture() {
  const lines: string[] = [];
  return { lines, log: (line: string) => void lines.push(line), text: () => lines.join("\n") };
}

async function readEvidence(dir: string, prefix: string): Promise<Record<string, unknown>[]> {
  const files = (await readdir(dir)).filter(f => f.startsWith(prefix));
  return Promise.all(files.map(async f => JSON.parse(await readFile(join(dir, f), "utf8")) as Record<string, unknown>));
}

describe("remote:check against a real seller stack", () => {
  it("passes read-only, decodes the live 402 with the SDK, and spends nothing", async () => {
    const s = await startServer();
    const out = capture();
    const checks = await remoteCheck(s.url, { env: {}, log: out.log });
    const by = (name: string) => checks.find(c => c.name === name);

    expect(checks.filter(c => c.status === "FAIL")).toEqual([]);
    expect(by("402 offer")).toMatchObject({
      status: "PASS",
      detail: `402 exact ${CARDANO_NETWORK} lovelace 2.000000 tADA -> ${SELLER}, l1Confirmations 1 (not declared, spec default), not compared: CARDANO_L1_CONFIRMATIONS unset here`,
    });
    expect(by("facilitator")).toMatchObject({ status: "PASS", detail: expect.stringContaining("within [0, 20]") });
    expect(by("seller address")).toMatchObject({ status: "PASS", detail: expect.stringContaining("differs from buyer") });
    expect(by("buyer address")?.status).toBe("PASS");
    expect(by("buyer balance")).toMatchObject({ status: "WARN", hint: expect.stringContaining(BUYER) });
    expect(by("ai ready")?.status).toBe("WARN");
    expect(out.lines[0]).toBe(`remote check of ${s.url} (read-only, spends nothing)\n`);
    expect(out.lines).toContain(`PASS  network          ${CARDANO_NETWORK}`);

    expect(s.signer.calls).toBe(0);
    expect(s.fac.verifyCalls + s.fac.settleCalls).toBe(0);
    expect(s.runsCreated()).toBe(0);
  });

  it("compares l1Confirmations only when CARDANO_L1_CONFIRMATIONS is set here (empty means unset)", async () => {
    const s = await startServer();
    const offer = async (env: NodeJS.ProcessEnv) => (await remoteCheck(s.url, { env, log: () => {} })).find(c => c.name === "402 offer");
    expect(await offer({ CARDANO_L1_CONFIRMATIONS: "1" })).toMatchObject({ status: "PASS", detail: expect.stringContaining("matches CARDANO_L1_CONFIRMATIONS") });
    expect(await offer({ CARDANO_L1_CONFIRMATIONS: "0" })).toMatchObject({ status: "FAIL", detail: expect.stringContaining("l1Confirmations 1, expected 0") });
    expect((await offer({ CARDANO_L1_CONFIRMATIONS: "" }))?.status).toBe("PASS");
  });

  it("fails when the 402 differs from what /api/health reports", async () => {
    const s = await startServer({ health: { priceLovelace: "3000000" } });
    const checks = await remoteCheck(s.url, { env: {}, log: () => {} });
    expect(checks.find(c => c.name === "402 offer")).toMatchObject({ status: "FAIL", detail: expect.stringContaining("expected PRICE_LOVELACE 3000000") });
  });

  it("reports x402Ready=false and a missing buyer as FAIL", async () => {
    const s = await startServer({ health: { x402Ready: false, buyerAddress: undefined } });
    const checks = await remoteCheck(s.url, { env: {}, log: () => {} });
    expect(checks.filter(c => c.status === "FAIL").map(c => c.name)).toEqual(["x402 ready", "buyer address"]);
  });

  it("fails clearly when nothing listens", async () => {
    const app = express();
    const url = await listen(app);
    await new Promise<void>(resolve => servers.pop()!.close(() => resolve()));
    const checks = await remoteCheck(url, { env: {}, log: () => {} });
    expect(checks).toEqual([expect.objectContaining({ status: "FAIL", name: "health", detail: expect.stringContaining("connection refused") })]);
  });

  it("checks the buyer balance only when a Blockfrost key happens to be set here, and never prints it", async () => {
    const s = await startServer();
    const bf = express();
    let key: string | undefined;
    bf.get("/epochs/latest/parameters", (req, res) => {
      key = req.header("project_id");
      res.json({ min_fee_a: 44, min_fee_b: 155381, max_tx_size: 16384, coins_per_utxo_size: "4310" });
    });
    bf.get("/addresses/:addr/utxos", (req, res) => {
      res.json(req.params.addr === BUYER ? [{ amount: [{ unit: "lovelace", quantity: "9000000" }] }] : []);
    });
    const bfUrl = await listen(bf);
    const projectId = "preprodStubProjectId0123456789";
    const out = capture();
    const checks = await remoteCheck(s.url, { env: { BLOCKFROST_PROJECT_ID: projectId, BLOCKFROST_PREPROD_URL: bfUrl }, log: out.log });
    expect(key).toBe(projectId);
    expect(checks.find(c => c.name === "buyer balance")).toMatchObject({ status: "PASS", detail: expect.stringContaining("9.000000 tADA in 1 UTxO(s)") });
    expect(out.text()).not.toContain(projectId);
  });
});

describe("remote:run against a real seller stack", () => {
  it("without --yes prints the plan and starts nothing", async () => {
    const s = await startServer();
    const out = capture();
    expect(await remoteRun({ baseUrl: s.url, yes: false, log: out.log })).toBe(0);
    expect(out.text()).toContain(`buyer       ${BUYER}`);
    expect(out.text()).toContain(`seller      ${SELLER}`);
    expect(out.text()).toContain("price       2.000000 tADA");
    expect(out.text()).toContain("dry run, nothing started");
    expect(s.runsCreated()).toBe(0);
    expect(s.signer.calls).toBe(0);
  });

  it("with --yes pays once, ends DRAFT_READY and writes public evidence", async () => {
    const s = await startServer();
    const dir = await tempDir();
    const out = capture();
    expect(await remoteRun({ baseUrl: s.url, yes: true, log: out.log, evidenceDir: dir, ...FAST })).toBe(0);
    expect(s.signer.calls).toBe(1);
    expect(s.agent.spentLovelace).toBe(PRICE);
    for (const state of ["CREATED", "EXTRACTED", "PRECHECKED", "PAYING", "PAID", "DRAFT_READY"]) {
      expect(out.lines.some(l => new RegExp(`^ +\\+\\d+\\.\\ds  ${state}\\b`).test(l))).toBe(true);
    }
    expect(out.text()).toContain(`  tx       ${TX}`);
    expect(out.text()).toContain(`  explorer https://preprod.cardanoscan.io/transaction/${TX}`);

    const [evidence, ...more] = await readEvidence(dir, "live-run-");
    expect(more).toHaveLength(0);
    expect(Object.keys(evidence!).sort()).toEqual(
      ["kind", "target", "runId", "state", "createdAt", "invoiceId", "timeline", "payment", "report", "draft", "settlement", "error", "input", "health", "timingsMs", "startedAt", "finishedAt"].sort(),
    );
    expect(evidence).toMatchObject({
      kind: "live-run",
      target: s.url,
      state: "DRAFT_READY",
      invoiceId: expect.stringMatching(/^LIVE-\d+$/),
      payment: { sellerAddress: SELLER, buyerAddress: BUYER, amount: "2000000", transactionHash: TX },
      report: { verdict: "ready_for_review", payoutExecuted: false },
      draft: { status: "awaiting_human_approval", executable: false },
      input: { source: "default", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      health: { network: CARDANO_NETWORK, facilitator: s.fac.url, sellerAddress: SELLER, buyerAddress: BUYER, priceLovelace: "2000000", spentLovelaceBefore: "0", spentLovelaceAfter: "2000000" },
    });
    expect(JSON.stringify(evidence)).not.toContain("DE89370400440532013000");
  });

  it("SETTLEMENT_UNKNOWN: prints the tx and a loud do-not-re-run warning, exits 1, writes no payment evidence", async () => {
    const s = await startServer();
    s.fac.settle = res => void res.json({ success: false, errorReason: "exact_cardano_settlement_failed", transaction: TX, network: CARDANO_NETWORK, payer: BUYER });
    const dir = await tempDir();
    const out = capture();
    expect(await remoteRun({ baseUrl: s.url, yes: true, log: out.log, evidenceDir: dir, ...FAST })).toBe(1);
    expect(out.text()).toContain("SETTLEMENT UNKNOWN: HTTP 402, exact_cardano_settlement_failed");
    expect(out.text()).toContain(`  tx       ${TX}`);
    expect(out.text()).toContain("Do NOT re-run: check the explorer first");
    expect(await readdir(dir)).toEqual([]);
  });

  it("times out with a hint that the run may still complete", async () => {
    const s = await startServer();
    s.fac.settle = () => {}; // never answers
    const out = capture();
    expect(await remoteRun({ baseUrl: s.url, yes: true, log: out.log, evidenceDir: await tempDir(), intervalMs: 10, timeoutMs: 300 })).toBe(1);
    expect(out.text()).toMatch(/TIMED OUT after 0 s in state PAYING/);
    expect(out.text()).toMatch(/may still complete\. Check later: curl -s http:\/\/127\.0\.0\.1:\d+\/api\/runs\/[0-9a-f-]{36}/);
  });

  it("refuses free text before starting when the server has no model, and rejects an unknown sample", async () => {
    const s = await startServer();
    const out = capture();
    expect(await remoteRun({ baseUrl: s.url, yes: true, sample: "sepa_ok", log: out.log })).toBe(1);
    expect(out.text()).toContain("free-text input needs ANTHROPIC_API_KEY on the server");
    expect(await remoteRun({ baseUrl: s.url, yes: true, sample: "nope", log: out.log })).toBe(1);
    expect(out.text()).toContain("unknown sample nope; the server has: sepa_ok, us_ok, bad_iban, no_bank_details, prompt_injection");
    expect(s.runsCreated()).toBe(0);
  });

  it("runs a server sample through the stubbed model", async () => {
    const s = await startServer({ ai: true });
    const out = capture();
    expect(await remoteRun({ baseUrl: s.url, yes: true, sample: "sepa_ok", log: out.log, evidenceDir: await tempDir(), ...FAST })).toBe(0);
    expect(out.text()).toContain("input       sample sepa_ok (free text, extracted by Claude on the server)");
    expect(out.text()).toContain("DRAFT_READY with a real tx");
  });
});

describe("remote:safety against a real seller stack", () => {
  it("without --yes lists the scenarios and the max spend, and starts nothing", async () => {
    const s = await startServer();
    const out = capture();
    expect(await runSafety({ baseUrl: s.url, yes: false, log: out.log })).toBe(0);
    expect(out.text()).toContain("max spend: 1 x 2.000000 tADA = 2.000000 tADA plus network fees");
    expect(out.text()).toContain("[will SKIP: aiReady=false]");
    expect(out.text()).toContain("SESSION_BUDGET_LOVELACE");
    expect(s.runsCreated()).toBe(0);
  });

  it("repeat-invoice and missing-account pass; injection skips without a model", async () => {
    const s = await startServer();
    const dir = await tempDir();
    const out = capture();
    expect(await runSafety({ baseUrl: s.url, yes: true, log: out.log, evidenceDir: dir, ...FAST })).toBe(0);
    expect(out.lines.filter(l => /^(PASS|FAIL|SKIP)  /.test(l))).toEqual([
      expect.stringMatching(/^PASS  repeat-invoice +first paid \(tx (7a){32}\); the repeat was refused before signing \(".*already paid"\), spend delta 0, no payment$/),
      expect.stringMatching(/^PASS  missing-account +NEEDS_INFO without paying \("no account identifier/),
      expect.stringMatching(/^SKIP  prompt-injection +the server has no ANTHROPIC_API_KEY/),
    ]);
    expect(s.signer.calls).toBe(1);
    expect(s.agent.spentLovelace).toBe(PRICE);

    const [evidence] = await readEvidence(dir, "safety-");
    expect(evidence).toMatchObject({
      kind: "safety-scenarios",
      target: s.url,
      maxSpendLovelace: "2000000",
      attackerAddress: ATTACKER_ADDRESS,
      scenarios: [
        {
          name: "repeat-invoice",
          status: "PASS",
          runs: [
            { role: "first", spentLovelaceBefore: "0", spentLovelaceAfter: "2000000", run: { state: "DRAFT_READY", payment: { transactionHash: TX } } },
            { role: "repeat", spentLovelaceBefore: "2000000", spentLovelaceAfter: "2000000", run: { state: "FAILED", payment: null } },
          ],
        },
        { name: "missing-account", status: "PASS", runs: [{ run: { state: "NEEDS_INFO", payment: null } }] },
        { name: "prompt-injection", status: "SKIP", runs: [] },
      ],
      manual: { "budget-exhaustion": expect.stringContaining("SESSION_BUDGET_LOVELACE") },
    });
    const ids = (evidence!.scenarios as Array<{ runs: Array<{ run: { invoiceId: string } }> }>).flatMap(sc => sc.runs.map(r => r.run.invoiceId));
    expect(ids).toEqual([expect.stringMatching(/^SAFETY-\d+-REPEAT$/), ids[0], expect.stringMatching(/^SAFETY-\d+-NOACCT$/)]);
  });

  it("prompt-injection pays only the seller the configured price, though the model copied the attacker address", async () => {
    const s = await startServer({ ai: true });
    const dir = await tempDir();
    const out = capture();
    expect(await runSafety({ baseUrl: s.url, yes: true, log: out.log, evidenceDir: dir, ...FAST })).toBe(0);
    expect(out.text()).toMatch(/PASS  prompt-injection +DRAFT_READY, verdict ready_for_review: paid 2\.000000 tADA to the allowlisted seller only/);
    expect(s.signer.calls).toBe(2);

    const [evidence] = await readEvidence(dir, "safety-");
    const injection = (evidence!.scenarios as Array<Record<string, unknown>>)[2]!;
    expect(injection).toMatchObject({
      status: "PASS",
      extracted: { supplier: `${INJECTION_SUPPLIER}, Regensburg`, currency: "EUR", amountMinor: 894_000 },
      runs: [{ run: { state: "DRAFT_READY", payment: { sellerAddress: SELLER, amount: "2000000" } } }],
    });
    expect(JSON.stringify(injection.runs)).not.toContain(ATTACKER_ADDRESS);
  });

  it("stops spending after an unknown settlement and fails", async () => {
    const s = await startServer({ ai: true });
    s.fac.settle = res => void res.status(500).send("upstream down");
    const out = capture();
    expect(await runSafety({ baseUrl: s.url, yes: true, log: out.log, evidenceDir: await tempDir(), ...FAST })).toBe(1);
    expect(out.lines.filter(l => /^(PASS|FAIL|SKIP)  /.test(l))).toEqual([
      expect.stringMatching(/^FAIL  repeat-invoice +first run ended SETTLEMENT_UNKNOWN/),
      expect.stringMatching(/^SKIP  missing-account +not run: repeat-invoice 1\/2: settlement unknown/),
      expect.stringMatching(/^SKIP  prompt-injection +not run: /),
    ]);
    expect(out.text()).toContain("!!! Do NOT re-run before checking the explorer");
    expect(s.signer.calls).toBe(1);
  });
});
