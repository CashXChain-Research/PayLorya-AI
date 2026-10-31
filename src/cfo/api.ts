import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { toNodeHandler } from "better-auth/node";
import { z } from "zod";
import { budgetsWithSpend, forecast, overview } from "./analytics.js";
import type { Auth, SessionUser } from "./auth.js";
import { runChatTurn, toPublic, type Attachment, type ChatDeps, type ChatEvent } from "./chat.js";
import { catalog, fetchBalances, prepareConnection, supportsWrite, type ConnectionEnv } from "./connections.js";
import { SUPPORTED_CURRENCIES } from "./fx.js";
import { ingestDocument, type Extractor } from "./ingest.js";
import { Payments } from "./payments.js";
import type { ConnectionRow, Store, Workspace } from "./store.js";

export interface CfoDeps {
  store: Store;
  auth: Auth;
  payments: Payments;
  connections: ConnectionEnv;
  extract: Extractor;
  model: string;
  aiReady: boolean;
  aiDailyLimit: number;
  /** Tests inject a fake model client; production uses the SDK default. */
  chatClient?: ChatDeps["client"];
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;
// base64 grows by 4/3; one file per document upload, a few per chat message.
const bigJson = express.json({ limit: "64mb" });
const json = express.json({ limit: "256kb" });

interface Ctx {
  user: SessionUser;
  ws: Workspace;
}
const ctx = (res: Response) => res.locals.cfo as Ctx;

const FileUpload = z.object({ filename: z.string().min(1).max(200), mimeType: z.string().max(100), dataBase64: z.string().min(1) });
const PayeeInput = z.object({
  name: z.string().trim().min(1).max(140),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  iban: z.string().transform(v => v.replace(/\s+/g, "").toUpperCase()).pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, "IBAN")).optional(),
  bic: z.string().transform(v => v.replace(/\s+/g, "").toUpperCase()).pipe(z.string().regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, "BIC")).optional(),
  routingNumber: z.string().trim().regex(/^\d{9}$/).optional(),
  accountNumber: z.string().trim().max(34).optional(),
  accountType: z.enum(["checking", "savings"]).optional(),
  cardanoAddress: z.string().trim().regex(/^addr_test1[0-9a-z]{50,}$/, "Cardano Preprod address (addr_test1…)").optional(),
});
const BudgetInput = z.object({ name: z.string().trim().min(1).max(80), category: z.string().trim().min(1).max(60), limitUsdMinor: z.number().int().positive() });
const PaymentCreate = z.object({
  payeeId: z.string(),
  amountMinor: z.number().int().positive(),
  currency: z.enum(SUPPORTED_CURRENCIES as [string, ...string[]]),
  reason: z.string().trim().min(1).max(300),
  documentId: z.string().optional(),
});
const WorkspacePatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  autonomy: z.enum(["read_only", "guarded", "full"]).optional(),
  limits: z
    .object({ perPaymentUsdMinor: z.number().int().min(0).optional(), monthlyUsdMinor: z.number().int().min(0).optional(), knownPayeesOnly: z.boolean().optional() })
    .optional(),
  confirm: z.string().optional(),
});

/** Optional strings arrive as "" from forms; treat them as absent. */
const blanksToUndefined = (body: unknown) =>
  body && typeof body === "object" ? Object.fromEntries(Object.entries(body).filter(([, v]) => v !== "" && v !== null)) : body;

function decodeFile(f: z.infer<typeof FileUpload>): Attachment {
  const data = Buffer.from(f.dataBase64, "base64");
  if (data.byteLength === 0) throw new HttpError(400, `${f.filename} is empty`);
  if (data.byteLength > MAX_FILE_BYTES) throw new HttpError(413, `${f.filename} is larger than 15 MB`);
  return { filename: f.filename, mimeType: f.mimeType || "application/octet-stream", data: new Uint8Array(data) };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Mounts Better Auth (/api/auth/*), the dashboard pages and the AI CFO API (/api/v1/*). Must run
 * before any global express.json(): Better Auth reads the raw request body itself.
 */
export function mountCfo(app: Express, deps: CfoDeps): void {
  const { store, auth } = deps;
  app.all("/api/auth/*splat", toNodeHandler(auth.auth));

  // Pages. The dashboard checks the session server-side so a signed-out visitor never sees it flash.
  app.get(["/app", "/app/*splat"], async (req, res) => {
    if (!(await auth.userFrom(req.headers))) {
      res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    res.sendFile("app.html", { root: "public" });
  });
  app.get("/login", (_req, res) => res.sendFile("login.html", { root: "public" }));
  app.get("/signup", (_req, res) => res.sendFile("signup.html", { root: "public" }));
  app.get("/demo", (_req, res) => res.sendFile("demo.html", { root: "public" }));

  const api = express.Router();
  api.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await auth.userFrom(req.headers);
      if (!user) {
        res.status(401).json({ error: "Sign in to continue" });
        return;
      }
      const ws = store.workspaceForUser(user.id, `${user.name.split(" ")[0] || "My"}'s company`);
      res.locals.cfo = { user, ws } satisfies Ctx;
      next();
    } catch (error) {
      next(error);
    }
  });

  const takeAi = (ws: string) => {
    if (!deps.aiReady) throw new HttpError(503, "The AI model is not configured on this server");
    if (!store.takeAiCall(ws, deps.aiDailyLimit)) throw new HttpError(429, `Daily AI limit reached (${deps.aiDailyLimit} documents and messages). Try again tomorrow.`);
  };

  // Workspace ------------------------------------------------------------------------------
  api.get("/me", (_req, res) => {
    const { user, ws } = ctx(res);
    res.json({ user, workspace: ws });
  });

  api.patch("/workspace", json, (req, res) => {
    const { ws } = ctx(res);
    const patch = WorkspacePatch.parse(req.body);
    if (patch.autonomy === "full" && ws.autonomy !== "full" && patch.confirm !== "FULL ACCESS") {
      throw new HttpError(400, 'Type "FULL ACCESS" to give the agent full access');
    }
    const updated = store.updateWorkspace(ws.id, patch);
    if (patch.autonomy && patch.autonomy !== ws.autonomy) store.log(ws.id, "user", "changed agent autonomy", `${ws.autonomy} → ${patch.autonomy}`, { type: "workspace", id: ws.id });
    if (patch.limits) {
      const l = updated.limits;
      store.log(ws.id, "user", "changed agent limits", `$${l.perPaymentUsdMinor / 100} per payment, $${l.monthlyUsdMinor / 100} per month, known payees only: ${l.knownPayeesOnly ? "yes" : "no"}`, {
        type: "workspace",
        id: ws.id,
      });
    }
    if (patch.name && patch.name !== ws.name) store.log(ws.id, "user", "renamed workspace", patch.name, { type: "workspace", id: ws.id });
    res.json(updated);
  });

  api.get("/overview", (_req, res) => res.json(overview(store, ctx(res).ws.id)));
  api.get("/forecast", (req, res) => {
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
    res.json(forecast(store, ctx(res).ws.id, days));
  });

  // Connections ----------------------------------------------------------------------------
  const publicConnection = (c: ConnectionRow) => ({
    id: c.id,
    kind: c.kind,
    label: c.label,
    network: c.network,
    ...(c.address ? { address: c.address } : {}),
    access: c.access,
    supports: { read: true, write: supportsWrite(c.kind) },
    status: c.error ? "error" : c.kind === "bank" ? "coming_soon" : "active",
    balances: c.balances,
    ...(c.error ? { error: c.error } : {}),
    createdAt: c.createdAt,
  });

  const refresh = async (ws: string, c: ConnectionRow) => {
    try {
      store.updateConnection(ws, c.id, { balances: await fetchBalances(deps.connections, c), error: null });
    } catch (error) {
      store.updateConnection(ws, c.id, { error: error instanceof Error ? error.message : String(error) });
    }
    return store.connection(ws, c.id)!;
  };

  api.get("/connections/catalog", (_req, res) => res.json(catalog(deps.connections)));
  api.get("/connections", async (_req, res) => {
    const ws = ctx(res).ws.id;
    // Balances older than a minute are refreshed on read, in parallel.
    const stale = (c: ConnectionRow) => !c.refreshedAt || Date.now() - Date.parse(c.refreshedAt) > 60_000;
    const rows = await Promise.all(store.connections(ws).map(c => (stale(c) ? refresh(ws, c) : c)));
    res.json(rows.map(publicConnection));
  });
  api.post("/connections", json, async (req, res) => {
    const ws = ctx(res).ws.id;
    const prepared = prepareConnection(deps.connections, req.body ?? {});
    if ("error" in prepared) throw new HttpError(400, prepared.error);
    const duplicate = store.connections(ws).find(c => c.kind === prepared.kind && c.address === prepared.address);
    if (duplicate) throw new HttpError(409, `${duplicate.label} is already connected`);
    const created = store.addConnection(ws, prepared);
    store.log(ws, "user", "added connection", `${created.label} (${created.access === "read_write" ? "read & write" : "read-only"})`, { type: "connection", id: created.id });
    res.status(201).json(publicConnection(await refresh(ws, created)));
  });
  api.patch("/connections/:id", json, (req, res) => {
    const ws = ctx(res).ws.id;
    const c = store.connection(ws, req.params.id as string);
    if (!c) throw new HttpError(404, "connection not found");
    const body = z.object({ label: z.string().trim().min(1).max(80).optional(), access: z.enum(["read", "read_write"]).optional() }).parse(req.body);
    if (body.access === "read_write" && !supportsWrite(c.kind)) throw new HttpError(400, `${c.label} is read-only`);
    store.updateConnection(ws, c.id, body);
    if (body.access && body.access !== c.access) store.log(ws, "user", "changed connection access", `${c.label}: ${body.access === "read_write" ? "read & write" : "read-only"}`, { type: "connection", id: c.id });
    res.json(publicConnection(store.connection(ws, c.id)!));
  });
  api.post("/connections/:id/refresh", async (req, res) => {
    const ws = ctx(res).ws.id;
    const c = store.connection(ws, req.params.id as string);
    if (!c) throw new HttpError(404, "connection not found");
    res.json(publicConnection(await refresh(ws, c)));
  });
  api.delete("/connections/:id", (req, res) => {
    const ws = ctx(res).ws.id;
    const c = store.connection(ws, req.params.id as string);
    if (!c || !store.deleteConnection(ws, c.id)) throw new HttpError(404, "connection not found");
    store.log(ws, "user", "removed connection", c.label, { type: "connection", id: c.id });
    res.status(204).end();
  });

  // Documents ------------------------------------------------------------------------------
  const publicDoc = ({ extracted: _x, ...d }: ReturnType<Store["documents"]>[number]) => d;
  api.get("/documents", (_req, res) => res.json(store.documents(ctx(res).ws.id).map(publicDoc)));
  api.post("/documents", bigJson, (req, res) => {
    const ws = ctx(res).ws.id;
    const file = decodeFile(FileUpload.parse(req.body));
    takeAi(ws);
    const doc = store.addDocument(ws, { ...file, source: "upload" });
    store.log(ws, "user", "uploaded document", file.filename, { type: "document", id: doc.id });
    void ingestDocument(store, ws, doc.id, deps.extract);
    res.status(201).json(publicDoc(doc));
  });
  api.get("/documents/:id", (req, res) => {
    const ws = ctx(res).ws.id;
    const d = store.document(ws, req.params.id as string);
    if (!d) throw new HttpError(404, "document not found");
    res.json({ ...d, transactions: store.transactionsForDocument(ws, d.id), payments: store.payments(ws).filter(p => p.documentId === d.id) });
  });
  api.get("/documents/:id/file", (req, res) => {
    const f = store.documentFile(ctx(res).ws.id, req.params.id as string);
    if (!f) throw new HttpError(404, "document not found");
    res.setHeader("content-type", f.mimeType);
    res.setHeader("content-disposition", `inline; filename="${f.filename.replace(/["\\\r\n]/g, "_")}"`);
    // Served same-origin; never let an uploaded HTML/SVG file run as a page of this site.
    res.setHeader("content-security-policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    res.setHeader("x-content-type-options", "nosniff");
    res.send(Buffer.from(f.data));
  });
  api.delete("/documents/:id", (req, res) => {
    const ws = ctx(res).ws.id;
    const d = store.document(ws, req.params.id as string);
    if (!d || !store.deleteDocument(ws, d.id)) throw new HttpError(404, "document not found");
    store.log(ws, "user", "deleted document", d.title ?? d.filename);
    res.status(204).end();
  });

  api.get("/transactions", (req, res) => {
    const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : undefined;
    res.json(store.transactions(ctx(res).ws.id, month ? { from: `${month}-01`, to: `${month}-31` } : {}));
  });

  // Payees ---------------------------------------------------------------------------------
  api.get("/payees", (_req, res) => res.json(store.payees(ctx(res).ws.id)));
  api.post("/payees", json, (req, res) => {
    const ws = ctx(res).ws.id;
    const p = store.savePayee(ws, PayeeInput.parse(blanksToUndefined(req.body)));
    store.log(ws, "user", "added payee", p.name, { type: "payee", id: p.id });
    res.status(201).json(p);
  });
  api.patch("/payees/:id", json, (req, res) => {
    const ws = ctx(res).ws.id;
    const existing = store.payee(ws, req.params.id as string);
    if (!existing) throw new HttpError(404, "payee not found");
    const { id: _id, createdAt: _c, ...current } = existing;
    // A field sent as "" or null is cleared; a field left out keeps its value.
    const merged: Record<string, unknown> = { ...current, ...(req.body as object) };
    const p = store.savePayee(ws, PayeeInput.parse(blanksToUndefined(merged)), existing.id);
    store.log(ws, "user", "updated payee", p.name, { type: "payee", id: p.id });
    res.json(p);
  });
  api.delete("/payees/:id", (req, res) => {
    const ws = ctx(res).ws.id;
    const p = store.payee(ws, req.params.id as string);
    if (!p || !store.deletePayee(ws, p.id)) throw new HttpError(404, "payee not found");
    store.log(ws, "user", "removed payee", p.name);
    res.status(204).end();
  });

  // Budgets --------------------------------------------------------------------------------
  const budgetById = (ws: string, id: string) => budgetsWithSpend(store, ws).find(b => b.id === id)!;
  api.get("/budgets", (_req, res) => res.json(budgetsWithSpend(store, ctx(res).ws.id)));
  api.post("/budgets", json, (req, res) => {
    const ws = ctx(res).ws.id;
    const b = store.saveBudget(ws, BudgetInput.parse(req.body));
    store.log(ws, "user", "created budget", `${b.name}: $${b.limitUsdMinor / 100}/month`, { type: "budget", id: b.id });
    res.status(201).json(budgetById(ws, b.id));
  });
  api.patch("/budgets/:id", json, (req, res) => {
    const ws = ctx(res).ws.id;
    const existing = store.budget(ws, req.params.id as string);
    if (!existing) throw new HttpError(404, "budget not found");
    const b = store.saveBudget(ws, BudgetInput.parse({ name: existing.name, category: existing.category, limitUsdMinor: existing.limitUsdMinor, ...req.body }), existing.id);
    store.log(ws, "user", "updated budget", `${b.name}: $${b.limitUsdMinor / 100}/month`, { type: "budget", id: b.id });
    res.json(budgetById(ws, b.id));
  });
  api.delete("/budgets/:id", (req, res) => {
    const ws = ctx(res).ws.id;
    const b = store.budget(ws, req.params.id as string);
    if (!b || !store.deleteBudget(ws, b.id)) throw new HttpError(404, "budget not found");
    store.log(ws, "user", "deleted budget", b.name);
    res.status(204).end();
  });

  // Payments -------------------------------------------------------------------------------
  api.get("/payments", (_req, res) => res.json(store.payments(ctx(res).ws.id)));
  api.post("/payments", json, (req, res) => {
    const ws = ctx(res).ws.id;
    const body = PaymentCreate.parse(req.body);
    if (!store.payee(ws, body.payeeId)) throw new HttpError(400, "payee not found");
    if (body.documentId && !store.document(ws, body.documentId)) throw new HttpError(400, "document not found");
    res.status(201).json(deps.payments.draft(ws, { ...body, requestedBy: "user" }));
  });
  api.post("/payments/:id/:decision", (req, res) => {
    const ws = ctx(res).ws.id;
    const decision = req.params.decision;
    if (decision !== "approve" && decision !== "reject") throw new HttpError(404, "not found");
    const result = decision === "approve" ? deps.payments.approve(ws, req.params.id as string) : deps.payments.reject(ws, req.params.id as string);
    if (!result.ok) throw new HttpError(409, result.error);
    res.json(result.payment);
  });

  api.get("/activity", (req, res) => res.json(store.activity(ctx(res).ws.id, Math.min(500, Math.max(1, Number(req.query.limit) || 100)))));

  // Chat -----------------------------------------------------------------------------------
  api.get("/chats", (_req, res) => res.json(store.chats(ctx(res).ws.id)));
  api.post("/chats", json, (_req, res) => res.status(201).json(store.createChat(ctx(res).ws.id)));
  api.get("/chats/:id", (req, res) => {
    const chat = store.chat(ctx(res).ws.id, req.params.id as string);
    if (!chat) throw new HttpError(404, "chat not found");
    res.json({ chat, messages: store.messages(chat.id).map(toPublic) });
  });
  api.delete("/chats/:id", (req, res) => {
    if (!store.deleteChat(ctx(res).ws.id, req.params.id as string)) throw new HttpError(404, "chat not found");
    res.status(204).end();
  });
  const busy = new Set<string>();
  api.post("/chats/:id/messages", bigJson, async (req, res) => {
    const ws = ctx(res).ws.id;
    const chat = store.chat(ws, req.params.id as string);
    if (!chat) throw new HttpError(404, "chat not found");
    const body = z.object({ text: z.string().max(20_000).default(""), attachments: z.array(FileUpload).max(10).default([]) }).parse(req.body);
    if (!body.text.trim() && body.attachments.length === 0) throw new HttpError(400, "Write a message or attach a file");
    const files = body.attachments.map(decodeFile);
    if (busy.has(chat.id)) throw new HttpError(409, "This chat is still answering");
    takeAi(ws);

    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    const emit = (e: ChatEvent) => {
      const { type, ...data } = e;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    busy.add(chat.id);
    try {
      await runChatTurn({ store, payments: deps.payments, extract: deps.extract, model: deps.model, client: deps.chatClient }, ws, chat.id, body.text, files, emit);
    } catch (error) {
      console.error("chat turn failed", error);
      emit({ type: "error", message: "The AI CFO could not answer. Please try again." });
    } finally {
      busy.delete(chat.id);
      clearInterval(keepAlive);
      res.end();
    }
  });

  api.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues.map(i => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    } else if (error && typeof error === "object" && (error as { type?: string }).type === "entity.too.large") {
      res.status(413).json({ error: "File too large (max 15 MB)" });
    } else {
      console.error(error);
      res.status(500).json({ error: "Something went wrong" });
    }
  });
  app.use("/api/v1", api);
}
