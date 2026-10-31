// Worker side of the AI CFO data path: the container calls http://cfo-data.internal, the outbound
// handler in worker.ts answers here with the D1 and R2 bindings. Never routed from the public
// internet. No Cloudflare imports, so vitest can run it against node:sqlite (tests/cfo-store.test.ts).

export const CFO_DATA_HOST = "cfo-data.internal";

type Value = string | number | null;

// The slices of the D1 and R2 binding APIs this proxy uses.
export interface D1Like {
  prepare(sql: string): { bind(...values: Value[]): D1StatementLike };
  batch(statements: D1StatementLike[]): Promise<unknown>;
}
export interface D1StatementLike {
  all(): Promise<{ results: Record<string, Value>[]; meta: { changes?: number } }>;
}
export interface R2Like {
  put(key: string, value: ArrayBuffer, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function isValues(v: unknown): v is Value[] {
  return Array.isArray(v) && v.every(x => x === null || typeof x === "string" || typeof x === "number");
}

export async function handleCfoData(request: Request, db: D1Like, files: R2Like): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/sql" && request.method === "POST") {
      const body = (await request.json()) as { op?: string; sql?: unknown; params?: unknown; statements?: unknown };
      if (body.op === "query" && typeof body.sql === "string" && isValues(body.params ?? [])) {
        const r = await db.prepare(body.sql).bind(...((body.params as Value[]) ?? [])).all();
        return json({ rows: r.results, changes: r.meta.changes ?? 0 });
      }
      if (body.op === "batch" && Array.isArray(body.statements)) {
        const stmts = body.statements.map((s: { sql?: unknown; params?: unknown }) => {
          if (typeof s.sql !== "string" || !isValues(s.params ?? [])) throw new Error("bad statement");
          return db.prepare(s.sql).bind(...((s.params as Value[]) ?? []));
        });
        await db.batch(stmts);
        return json({ ok: true });
      }
      return json({ error: "bad request" }, 400);
    }
    const file = url.pathname.match(/^\/files\/([^/]+)$/);
    if (file) {
      const key = decodeURIComponent(file[1]!);
      if (request.method === "PUT") {
        await files.put(key, await request.arrayBuffer(), { httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" } });
        return json({ ok: true });
      }
      if (request.method === "GET") {
        const obj = await files.get(key);
        if (!obj) return json({ error: "not found" }, 404);
        return new Response(await obj.arrayBuffer(), { headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream" } });
      }
      if (request.method === "DELETE") {
        await files.delete(key);
        return json({ ok: true });
      }
    }
    return json({ error: "not found" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
