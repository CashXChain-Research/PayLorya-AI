import { mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  CompiledQuery,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
} from "kysely";

/**
 * The AI CFO's only way to its data. In Cloudflare it is D1 (SQL) and R2 (files), reached from the
 * container through the Worker's outbound handler (cloudflare/cfo-proxy.ts); locally and in tests it
 * is node:sqlite and a directory. Both sides speak the same small protocol.
 */
export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;
export interface Statement {
  sql: string;
  params?: SqlValue[];
}

export interface Sql {
  query(sql: string, params?: SqlValue[]): Promise<{ rows: SqlRow[]; changes: number }>;
  /** Runs all statements atomically (D1 batch; a transaction locally). */
  batch(statements: Statement[]): Promise<void>;
}

export interface Files {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}

export function localSql(db: DatabaseSync): Sql {
  db.exec("PRAGMA foreign_keys = ON;");
  const query = (sql: string, params: SqlValue[] = []) => {
    const stmt = db.prepare(sql);
    // node:sqlite refuses all() on statements that return no columns.
    if (stmt.columns().length === 0) {
      const r = stmt.run(...(params as SQLInputValue[]));
      return { rows: [], changes: Number(r.changes) };
    }
    return { rows: stmt.all(...(params as SQLInputValue[])) as SqlRow[], changes: 0 };
  };
  return {
    async query(sql, params) {
      return query(sql, params);
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        for (const s of statements) query(s.sql, s.params);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/** HTTP client for cloudflare/cfo-proxy.ts. The base URL is only reachable from inside the container. */
export function remoteSql(baseUrl: string, f: typeof fetch = fetch): Sql {
  const call = async <T>(body: unknown): Promise<T> => {
    const res = await f(`${baseUrl}/sql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) throw new Error(`database: ${json.error ?? res.status}`);
    return json;
  };
  return {
    query: (sql, params = []) => call({ op: "query", sql, params }),
    batch: async statements => {
      await call({ op: "batch", statements });
    },
  };
}

export function localFiles(dir: string): Files {
  mkdirSync(dir, { recursive: true });
  const path = (key: string) => join(dir, key.replace(/[^A-Za-z0-9._-]/g, "_"));
  return {
    put: (key, data) => writeFile(path(key), data),
    get: async key => {
      try {
        return new Uint8Array(await readFile(path(key)));
      } catch {
        return undefined;
      }
    },
    delete: key => rm(path(key), { force: true }),
  };
}

export function memoryFiles(): Files {
  const files = new Map<string, Uint8Array>();
  return {
    put: async (key, data) => void files.set(key, data),
    get: async key => files.get(key),
    delete: async key => void files.delete(key),
  };
}

export function remoteFiles(baseUrl: string, f: typeof fetch = fetch): Files {
  const url = (key: string) => `${baseUrl}/files/${encodeURIComponent(key)}`;
  return {
    async put(key, data, contentType) {
      const res = await f(url(key), { method: "PUT", headers: { "content-type": contentType }, body: new Uint8Array(data) });
      if (!res.ok) throw new Error(`file store: ${res.status}`);
    },
    async get(key) {
      const res = await f(url(key));
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`file store: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      const res = await f(url(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`file store: ${res.status}`);
    },
  };
}

/**
 * Kysely dialect over `Sql`, so Better Auth uses the same database. D1 has no interactive
 * transactions; Better Auth's few multi-statement writes run without one.
 */
export function sqlDialect(sql: Sql): Dialect {
  const connection: DatabaseConnection = {
    async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
      const { rows, changes } = await sql.query(compiled.sql, compiled.parameters.map(toSqlValue));
      return { rows: rows as R[], numAffectedRows: BigInt(changes) };
    },
    async *streamQuery() {
      throw new Error("streaming queries are not supported");
    },
  };
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection;
    },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  };
  return {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => driver,
    createQueryCompiler: () => new SqliteQueryCompiler(),
    createIntrospector: (db: Kysely<unknown>) => new SqliteIntrospector(db),
  };
}

function toSqlValue(v: unknown): SqlValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
}
