import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * One SQLite file holds auth (Better Auth tables) and workspace data. A Cloudflare Container has no
 * persistent disk, so a redeploy or sleep starts empty; point DATA_DIR at a mounted volume, or move
 * to Postgres/D1 (Better Auth supports both) before relying on it for customers.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

// Append-only: each entry runs once, in order, tracked in user_version.
const MIGRATIONS = [
  `CREATE TABLE workspaces (
     id TEXT PRIMARY KEY,
     owner_user_id TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     autonomy TEXT NOT NULL DEFAULT 'guarded',
     per_payment_usd_minor INTEGER NOT NULL,
     monthly_usd_minor INTEGER NOT NULL,
     known_payees_only INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL
   );
   CREATE TABLE connections (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     label TEXT NOT NULL,
     network TEXT NOT NULL,
     address TEXT,
     access TEXT NOT NULL DEFAULT 'read',
     balances_json TEXT NOT NULL DEFAULT '[]',
     error TEXT,
     refreshed_at TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE documents (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     filename TEXT NOT NULL,
     mime_type TEXT NOT NULL,
     size INTEGER NOT NULL,
     source TEXT NOT NULL,
     status TEXT NOT NULL,
     kind TEXT,
     title TEXT,
     summary TEXT,
     counterparty TEXT,
     amount_minor INTEGER,
     currency TEXT,
     issue_date TEXT,
     due_date TEXT,
     category TEXT,
     extracted_json TEXT,
     error TEXT,
     data BLOB NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE payees (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     country TEXT,
     iban TEXT,
     bic TEXT,
     routing_number TEXT,
     account_number TEXT,
     account_type TEXT,
     cardano_address TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE payments (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     payee_id TEXT,
     payee_name TEXT NOT NULL,
     amount_minor INTEGER NOT NULL,
     currency TEXT NOT NULL,
     usd_minor INTEGER NOT NULL,
     rail TEXT NOT NULL,
     reason TEXT NOT NULL,
     document_id TEXT,
     status TEXT NOT NULL,
     requested_by TEXT NOT NULL,
     policy_json TEXT NOT NULL,
     run_id TEXT,
     tx_hash TEXT,
     explorer_url TEXT,
     reference TEXT,
     error TEXT,
     created_at TEXT NOT NULL,
     decided_at TEXT,
     executed_at TEXT
   );
   CREATE TABLE transactions (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     date TEXT NOT NULL,
     description TEXT NOT NULL,
     counterparty TEXT,
     category TEXT NOT NULL,
     amount_minor INTEGER NOT NULL,
     currency TEXT NOT NULL,
     usd_minor INTEGER NOT NULL,
     source TEXT NOT NULL,
     document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
     payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL
   );
   CREATE TABLE budgets (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     category TEXT NOT NULL,
     limit_usd_minor INTEGER NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE activity (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     at TEXT NOT NULL,
     actor TEXT NOT NULL,
     action TEXT NOT NULL,
     detail TEXT NOT NULL,
     ref_type TEXT,
     ref_id TEXT
   );
   CREATE TABLE chats (
     id TEXT PRIMARY KEY,
     workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE chat_messages (
     id TEXT PRIMARY KEY,
     chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL,
     role TEXT NOT NULL,
     text TEXT NOT NULL,
     content_json TEXT NOT NULL,
     attachments_json TEXT,
     tools_json TEXT,
     created_at TEXT NOT NULL
   );
   CREATE TABLE ai_usage (
     workspace_id TEXT NOT NULL,
     day TEXT NOT NULL,
     calls INTEGER NOT NULL,
     PRIMARY KEY (workspace_id, day)
   );
   CREATE INDEX documents_ws ON documents(workspace_id, created_at);
   CREATE INDEX transactions_ws ON transactions(workspace_id, date);
   CREATE INDEX payments_ws ON payments(workspace_id, created_at);
   CREATE INDEX activity_ws ON activity(workspace_id, at);
   CREATE INDEX chat_messages_chat ON chat_messages(chat_id, seq);`,
  // CashXChain sandbox sub-account (Platform managed account) per workspace: src/cfo/cxc-link.ts.
  `ALTER TABLE workspaces ADD COLUMN cxc_link_json TEXT;`
];

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
