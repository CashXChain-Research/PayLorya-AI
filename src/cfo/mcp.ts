import type { Express, Request } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { bearerToken, hashKey, KEY_PATTERN } from "./api-keys.js";
import { mcpChallenge } from "./oauth.js";
import type { PublicMessage } from "./chat.js";
import { SUPPORTED_CURRENCIES } from "./fx.js";
import type { PaymentStatus, Store } from "./store.js";

/**
 * The public REST API (/api/v1) as the MCP caller: their own Authorization header, over loopback to
 * the port this request came in on. Each tool is one ordinary API call, so the key check, scopes,
 * human-only routes, rate limit, idempotency and workspace isolation all apply unchanged.
 */
type Rest = (method: "GET" | "POST", path: string, opts?: { body?: unknown; idempotencyKey?: string; signal?: AbortSignal }) => Promise<Response>;

function restFor(req: Request): Rest {
  const base = `http://127.0.0.1:${req.socket.localPort}/api/v1`;
  const authorization = req.header("authorization")!;
  return (method, path, { body, idempotencyKey, signal } = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        authorization,
        accept: "application/json, text/event-stream",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
}

// Most REST errors carry a code (api.ts); the plain HttpErrors get one from their status.
const CODES: Record<number, string> = { 400: "invalid_request", 401: "invalid_key", 403: "forbidden", 404: "not_found", 409: "conflict", 413: "too_large", 422: "invalid_request", 429: "rate_limited", 503: "unavailable" };

/** A tool error the model can read and act on; tools never throw. */
const failed = (error: string, code: string, status?: number): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error, code, ...(status ? { status } : {}) }) }],
});

/** A REST reply as a tool result: its JSON when it worked, else its message and code. */
async function toResult(r: Response, pick: (data: any) => unknown = data => data): Promise<CallToolResult> {
  const text = await r.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: passed on as text.
  }
  if (r.ok) return { content: [{ type: "text", text: JSON.stringify(pick(body)) }] };
  const e = (body ?? {}) as { error?: unknown; code?: unknown };
  const code = typeof e.code === "string" ? e.code : (CODES[r.status] ?? (r.status >= 500 ? "server_error" : `http_${r.status}`));
  return failed(typeof e.error === "string" ? e.error : `HTTP ${r.status}`, code, r.status);
}

const unreachable = (error: unknown): CallToolResult =>
  failed(`PayLorya AI could not complete the call: ${error instanceof Error ? error.message : String(error)}`, "unavailable");

async function call(rest: Rest, method: "GET" | "POST", path: string, opts?: Parameters<Rest>[2], pick?: (data: any) => unknown): Promise<CallToolResult> {
  try {
    return await toResult(await rest(method, path, opts), pick);
  } catch (error) {
    return unreachable(error);
  }
}

/**
 * Reads a chat reply's event stream (ChatEvent in chat.ts: user, text, tool, done, error) to its end.
 * The answer is the stored reply from `done`; tool steps and keep-alives become progress notes.
 */
async function answerFrom(r: Response, chatId: string, progress: (message: string) => void): Promise<CallToolResult> {
  const decoder = new TextDecoder();
  let buffer = "";
  let done: PublicMessage | undefined;
  let error: string | undefined;
  for await (const chunk of r.body!) {
    buffer += decoder.decode(chunk, { stream: true });
    for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!event || !data) {
        progress("Still working…");
        continue;
      }
      const payload = JSON.parse(data) as { summary?: string; message?: unknown };
      if (event === "tool" && payload.summary) progress(payload.summary);
      else if (event === "done") done = payload.message as PublicMessage;
      else if (event === "error") error = String(payload.message);
    }
  }
  if (error) return failed(error, "chat_failed");
  if (!done) return failed("The AI CFO stopped before it finished answering. Try again.", "chat_incomplete");
  const meta = { chatId, ...(done.tools ? { steps: done.tools.map(t => t.summary) } : {}), ...(done.attachments ? { files: done.attachments } : {}) };
  return { content: [{ type: "text", text: done.text || "(no answer)" }, { type: "text", text: JSON.stringify(meta) }] };
}

const INSTRUCTIONS = `PayLorya AI is the AI CFO of one business. This server acts for the account that owns the API key.
Amounts: fields ending in Minor are minor units of their currency (cents; lovelace for ADA; whole yen for JPY).
Fields ending in UsdMinor are indicative US cents. Payments run on the CashXChain sandbox and Cardano Preprod (test money).
You can read the finances, ask the AI CFO and draft payments. Every payment drafted with draft_payment waits for a person
to approve it in the PayLorya AI dashboard. Approving, signing, payees, budgets, connections and API keys stay with people
in the dashboard: no tool here changes them.`;

const STATUSES = ["pending_approval", "blocked", "executing", "awaiting_signature", "approved", "executed", "rejected", "failed"] as const satisfies readonly PaymentStatus[];
const Id = (what: string) => z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, `a ${what} id`);
const READ = { readOnlyHint: true, openWorldHint: false } as const;

/** A fresh server per request (stateless): it holds nothing but this caller's REST client. */
function mcpServer(rest: Rest): McpServer {
  const server = new McpServer({ name: "paylorya-ai", title: "PayLorya AI", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "get_overview",
    {
      title: "Financial overview",
      description:
        "The business's financial picture in one call: cash across connected accounts, open payables (unpaid bills, the next ones due), payments waiting for approval, this month's spend by category, money in and out over recent months, budgets with this month's spend, the AI agent's autonomy level and limits, and documents still being read. Start here for any question about the company's finances.",
      annotations: READ,
    },
    async () => call(rest, "GET", "/overview"),
  );

  server.registerTool(
    "get_forecast",
    {
      title: "Cash forecast",
      description:
        "Day-by-day cash forecast: today's connected balances, minus open payables on their due dates, plus open receivables. Overdue items and payments waiting for approval land today. Deterministic, no AI. Returns startUsdMinor, the balance for each day (points) and the events that move it.",
      inputSchema: { days: z.number().int().min(7).max(365).optional().describe("How many days ahead, 7 to 365. Default 90.") },
      annotations: READ,
    },
    async ({ days }) => call(rest, "GET", `/forecast${days ? `?days=${days}` : ""}`),
  );

  server.registerTool(
    "list_payments",
    {
      title: "List payments",
      description:
        "Payments, newest first: payee, amount, reason, linked document, who drafted it (user: a person or an API key; agent: the AI CFO), the policy checks and the status. Status: pending_approval waits for a person in the dashboard; blocked cannot execute yet (policy.checks says why); executing; awaiting_signature is a tADA payout waiting for the owner's wallet; executed; rejected; failed.",
      inputSchema: { status: z.enum(STATUSES).optional().describe("Only payments with this status.") },
      annotations: READ,
    },
    async ({ status }) => call(rest, "GET", "/payments", {}, (payments: Array<{ status: string }>) => (status ? payments.filter(p => p.status === status) : payments)),
  );

  server.registerTool(
    "draft_payment",
    {
      title: "Draft a payment for approval",
      description:
        "Draft a payment to a saved payee (payeeId from list_payees). Drafting moves no money: the payment waits for a person to approve it in the PayLorya AI dashboard (status pending_approval), or is blocked when the account cannot pay it yet (status blocked, e.g. no connection with read & write access; policy.checks says why). No tool can approve, sign or execute it. A second draft for the same invoice, or for the same payee and amount while one is open, is refused with the existing payment's id. Needs an API key with the write scope.",
      inputSchema: {
        payeeId: z.string().min(1).describe("The saved payee's id, from list_payees."),
        amountMinor: z
          .number()
          .int()
          .positive()
          .describe("Amount in minor units of the currency: cents for USD, EUR and most others (12000 = 120.00), whole yen for JPY, lovelace for ADA (1 ADA = 1000000)."),
        currency: z.enum(SUPPORTED_CURRENCIES as [string, ...string[]]).describe("ADA pays test ADA on Cardano Preprod; the others pay through CashXChain (sandbox)."),
        reason: z.string().min(1).max(300).describe("What it pays for, e.g. the invoice number. The approver sees it."),
        documentId: Id("document").optional().describe("The invoice this pays, from list_documents."),
        idempotencyKey: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Any unique string. Retrying with the same key and the same fields returns the first result again instead of a second draft."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ idempotencyKey, ...payment }) => call(rest, "POST", "/payments", { body: payment, ...(idempotencyKey ? { idempotencyKey } : {}) }),
  );

  server.registerTool(
    "list_payees",
    {
      title: "List payees",
      description:
        "The saved payee directory, by name: id, name, country and account details (IBAN and BIC, US routing and account number, or Cardano address). Pass a payee's id to draft_payment. Only a person can add or change payees, in the dashboard.",
      annotations: READ,
    },
    async () => call(rest, "GET", "/payees"),
  );

  server.registerTool(
    "list_budgets",
    {
      title: "List budgets",
      description: "Monthly budgets per spending category: limitUsdMinor and this month's spend (spentUsdMinor). Only a person can create or change budgets, in the dashboard.",
      annotations: READ,
    },
    async () => call(rest, "GET", "/budgets"),
  );

  server.registerTool(
    "list_transactions",
    {
      title: "List transactions",
      description:
        "Ledger entries, newest first, read from uploaded documents (bank statements, invoices, receipts) and from executed payments: date, description, counterparty, category, amountMinor in its currency (negative is money out) and usdMinor. Pass month to narrow it down.",
      inputSchema: { month: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM").optional().describe("Only this calendar month, as YYYY-MM.") },
      annotations: READ,
    },
    async ({ month }) => call(rest, "GET", `/transactions${month ? `?month=${month}` : ""}`),
  );

  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description:
        "Uploaded documents, newest first: invoices, receipts, bank statements, contracts, payroll and tax papers, with what was read from them (kind, title, summary, counterparty, amount, issue and due date, category) and their status (processing, processed, failed). get_document has the full extraction.",
      annotations: READ,
    },
    async () => call(rest, "GET", "/documents"),
  );

  server.registerTool(
    "get_document",
    {
      title: "Get a document",
      description: "One document with everything read from it (line items, payment details, statement entries, notes), the ledger transactions taken from it, and the payments linked to it.",
      inputSchema: { documentId: Id("document").describe("The document's id, from list_documents.") },
      annotations: READ,
    },
    async ({ documentId }) => call(rest, "GET", `/documents/${encodeURIComponent(documentId)}`),
  );

  server.registerTool(
    "get_activity",
    {
      title: "Activity log",
      description:
        "The account's audit log, newest first: who (user, agent or system) did what and when, e.g. drafted, approved or rejected payments, uploaded documents, changed the agent's rights or connections, created API keys.",
      inputSchema: { limit: z.number().int().min(1).max(500).optional().describe("How many entries, 1 to 500. Default 100.") },
      annotations: READ,
    },
    async ({ limit }) => call(rest, "GET", `/activity${limit ? `?limit=${limit}` : ""}`),
  );

  server.registerTool(
    "ask_cfo",
    {
      title: "Ask the AI CFO",
      description:
        "Ask PayLorya AI, the business's AI CFO, in plain language and get its written answer. It works on the account's real data (documents, ledger, payments, budgets, forecast), can research companies on the web, calculate, and create files (Excel, PDF, CSV) that are saved as documents. Use it for analysis the other tools do not answer directly. It can draft payments too; every payment drafted this way waits for a person to approve it in the dashboard, and it cannot change budgets. Takes seconds to a few minutes and counts against the account's daily AI limit. Returns the answer and a chatId: pass it back to continue the same conversation. Needs an API key with the write scope.",
      inputSchema: {
        question: z.string().min(1).max(20_000).describe("The question or request, in plain language."),
        chatId: Id("chat").optional().describe("Continue this conversation (the chatId of an earlier answer). Omit to start a new one."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ question, chatId }, extra) => {
      const token = extra._meta?.progressToken;
      let step = 0;
      const progress = (message: string) => {
        if (token === undefined) return;
        void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++step, message } }).catch(() => undefined);
      };
      try {
        let id = chatId;
        if (!id) {
          const created = await rest("POST", "/chats", { signal: extra.signal });
          if (!created.ok) return await toResult(created);
          id = ((await created.json()) as { id: string }).id;
        }
        const r = await rest("POST", `/chats/${encodeURIComponent(id)}/messages`, { body: { text: question }, signal: extra.signal });
        if (!r.ok || !r.headers.get("content-type")?.startsWith("text/event-stream")) return await toResult(r);
        return await answerFrom(r, id, progress);
      } catch (error) {
        return unreachable(error);
      }
    },
  );

  return server;
}

/**
 * MCP over Streamable HTTP at /mcp, stateless: each POST gets its own server and transport, so any
 * container can answer and nothing outlives the request. Auth is the REST API's key
 * (Authorization: Bearer ply_sk_…), or the same kind of key issued by OAuth (src/cfo/oauth.ts).
 */
export function mountMcp(app: Express, store: Store, resource?: URL): void {
  app.all("/mcp", async (req, res) => {
    try {
      const token = bearerToken(req.header("authorization"));
      const found = token && KEY_PATTERN.test(token) ? await store.apiKeyByHash(hashKey(token)) : undefined;
      if (!found || !(await store.workspaceById(found.ws))) {
        // RFC 6750: no error code when no token was sent at all.
        // With OAuth on, resource_metadata tells the client where to sign in (RFC 9728).
        res.setHeader("www-authenticate", resource ? mcpChallenge(resource, Boolean(token)) : token ? 'Bearer realm="PayLorya AI", error="invalid_token"' : 'Bearer realm="PayLorya AI"');
        res
          .status(401)
          .json(
            token
              ? { error: "This API key is not valid: unknown, mistyped or revoked.", code: "invalid_key" }
              : { error: "Send an API key from the PayLorya AI dashboard: Authorization: Bearer ply_sk_…", code: "missing_key" },
          );
        return;
      }
      // No session, so no standalone event stream (GET) and nothing to end (DELETE).
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this MCP server is stateless, use POST." }, id: null });
        return;
      }
      const server = mcpServer(restFor(req));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close().catch(() => undefined);
        void server.close().catch(() => undefined);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("mcp request failed", error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });
}
