import type { Sql, Statement } from "./sql.js";

// Append-only list; each entry runs once, atomically, recorded in cfo_migrations. Same SQL on D1
// and node:sqlite. Version 1 includes Better Auth's tables (its own SQLite schema, verbatim), so
// the auth library never has to introspect or alter the database at runtime.
const MIGRATIONS: string[][] = [
  [
    `create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null)`,
    `create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade)`,
    `create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null)`,
    `create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null)`,
    `create index "session_userId_idx" on "session" ("userId")`,
    `create index "account_userId_idx" on "account" ("userId")`,
    `create index "verification_identifier_idx" on "verification" ("identifier")`,
    `CREATE TABLE workspaces (
       id TEXT PRIMARY KEY,
       owner_user_id TEXT NOT NULL UNIQUE,
       name TEXT NOT NULL,
       autonomy TEXT NOT NULL DEFAULT 'guarded',
       per_payment_usd_minor INTEGER NOT NULL,
       monthly_usd_minor INTEGER NOT NULL,
       known_payees_only INTEGER NOT NULL DEFAULT 1,
       created_at TEXT NOT NULL
     )`,
    `CREATE TABLE connections (
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
     )`,
    // The file itself is in the file store (R2), keyed by the document id.
    `CREATE TABLE documents (
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
       created_at TEXT NOT NULL
     )`,
    `CREATE TABLE payees (
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
     )`,
    `CREATE TABLE payments (
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
     )`,
    `CREATE TABLE transactions (
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
     )`,
    `CREATE TABLE budgets (
       id TEXT PRIMARY KEY,
       workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
       name TEXT NOT NULL,
       category TEXT NOT NULL,
       limit_usd_minor INTEGER NOT NULL,
       created_at TEXT NOT NULL
     )`,
    `CREATE TABLE activity (
       id TEXT PRIMARY KEY,
       workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
       at TEXT NOT NULL,
       actor TEXT NOT NULL,
       action TEXT NOT NULL,
       detail TEXT NOT NULL,
       ref_type TEXT,
       ref_id TEXT
     )`,
    `CREATE TABLE chats (
       id TEXT PRIMARY KEY,
       workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
       title TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
    `CREATE TABLE chat_messages (
       id TEXT PRIMARY KEY,
       chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
       seq INTEGER NOT NULL,
       role TEXT NOT NULL,
       text TEXT NOT NULL,
       content_json TEXT NOT NULL,
       attachments_json TEXT,
       tools_json TEXT,
       created_at TEXT NOT NULL
     )`,
    `CREATE TABLE ai_usage (
       workspace_id TEXT NOT NULL,
       day TEXT NOT NULL,
       calls INTEGER NOT NULL,
       PRIMARY KEY (workspace_id, day)
     )`,
    `CREATE INDEX documents_ws ON documents(workspace_id, created_at)`,
    `CREATE INDEX transactions_ws ON transactions(workspace_id, date)`,
    `CREATE INDEX payments_ws ON payments(workspace_id, created_at)`,
    `CREATE INDEX activity_ws ON activity(workspace_id, at)`,
    `CREATE INDEX chat_messages_chat ON chat_messages(chat_id, seq)`,
  ],
  // CashXChain sandbox sub-account (Platform managed account) per workspace: src/cfo/cxc-link.ts.
  [`ALTER TABLE workspaces ADD COLUMN cxc_link_json TEXT`],
  // Account details a draft carries when its payee is not saved (from the invoice or the agent).
  [`ALTER TABLE payments ADD COLUMN destination_json TEXT`],
  // A connection's own credential (a workspace's CashXChain API key), sealed by src/cfo/vault.ts.
  // The hint is the key's prefix and last four characters, for display.
  [`ALTER TABLE connections ADD COLUMN secret_enc TEXT`, `ALTER TABLE connections ADD COLUMN secret_hint TEXT`],
  // A tADA payout from the workspace's own wallet (Store.CardanoPayout; the name is from its first use).
  [`ALTER TABLE payments ADD COLUMN sign_request_json TEXT`],
  // The payout's idempotency key, fixed at the first attempt (a resumed payment pays the same).
  [`ALTER TABLE payments ADD COLUMN payout_key TEXT`],
  // The x402 verification bought on Cardano from the account's agent wallet before the payout.
  [`ALTER TABLE payments ADD COLUMN verification_json TEXT`],
  // Test tADA granted once to the account's agent wallet (src/cfo/funder.ts); funded_at counts grants per day.
  [`ALTER TABLE workspaces ADD COLUMN funded_json TEXT`, `ALTER TABLE workspaces ADD COLUMN funded_at TEXT`],
  // Public API: keys per account (only their SHA-256), and replies kept per Idempotency-Key (24 h).
  [
    `CREATE TABLE api_keys (
       id TEXT PRIMARY KEY,
       workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
       name TEXT NOT NULL,
       prefix TEXT NOT NULL,
       hash TEXT NOT NULL UNIQUE,
       scopes_json TEXT NOT NULL,
       created_at TEXT NOT NULL,
       last_used_at TEXT,
       revoked_at TEXT
     )`,
    `CREATE INDEX api_keys_ws ON api_keys(workspace_id, created_at)`,
    `CREATE TABLE api_idempotency (
       key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
       idem_key TEXT NOT NULL,
       request_hash TEXT NOT NULL,
       status INTEGER NOT NULL,
       body_json TEXT,
       created_at TEXT NOT NULL,
       PRIMARY KEY (key_id, idem_key)
     )`,
  ],
  // OAuth for MCP clients (src/cfo/oauth.ts): registered clients, and sign-ins from request to spent code.
  // The access token is an api_keys row; nothing secret is kept here (codes only as SHA-256).
  [
    `CREATE TABLE oauth_clients (client_id TEXT PRIMARY KEY, info_json TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE oauth_grants (
       id TEXT PRIMARY KEY,
       client_id TEXT NOT NULL,
       redirect_uri TEXT NOT NULL,
       code_challenge TEXT NOT NULL,
       state TEXT,
       scopes_json TEXT NOT NULL,
       created_at TEXT NOT NULL,
       expires_at TEXT NOT NULL,
       code_hash TEXT UNIQUE,
       workspace_id TEXT,
       user_id TEXT,
       used_at TEXT
     )`,
  ],
];

export async function migrate(sql: Sql): Promise<void> {
  await sql.query("CREATE TABLE IF NOT EXISTS cfo_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const { rows } = await sql.query("SELECT version FROM cfo_migrations");
  const done = new Set(rows.map(r => Number(r.version)));
  for (let v = 1; v <= MIGRATIONS.length; v++) {
    if (done.has(v)) continue;
    const statements: Statement[] = MIGRATIONS[v - 1]!.map(s => ({ sql: s }));
    // The version row is part of the same batch: a migration is applied completely or not at all.
    statements.push({ sql: "INSERT INTO cfo_migrations (version, applied_at) VALUES (?, ?)", params: [v, new Date().toISOString()] });
    await sql.batch(statements);
  }
}
