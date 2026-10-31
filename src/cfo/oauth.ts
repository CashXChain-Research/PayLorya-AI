// OAuth 2.1 for MCP clients that cannot send an API key header (claude.ai connectors, Claude Desktop):
// the MCP SDK's authorization server (metadata, dynamic client registration, PKCE, token endpoint)
// with PayLorya AI as the provider. A person signs in, allows the client on /oauth/consent, and the
// client's access token IS an account API key (ply_sk_…): /mcp and /api/v1 check it as any other key,
// keyRefusal still applies, and Developers lists it, so revoking it there disconnects the client.
import { createHash, randomBytes } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidClientMetadataError, InvalidGrantError, InvalidTargetError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { hashKey, KEY_PATTERN, newKey, RateLimiter, SCOPES, type Scope } from "./api-keys.js";
import type { Auth } from "./auth.js";
import { clientId } from "../ratelimit.js";
import type { Store } from "./store.js";

/** A started sign-in waits this long for the person to allow it; a code is then good this long. */
export const PENDING_MS = 10 * 60_000;
export const CODE_MS = 5 * 60_000;
/** Registrations, authorizations and token calls per client IP and minute. */
const OAUTH_PER_MINUTE = 30;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const scopesOf = (requested: string[] | undefined): Scope[] => {
  const known = (requested ?? []).filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  return known.length ? [...new Set<Scope>(["read", ...known])] : ["read", "write"];
};

/** Redirect URIs a client may register: https, loopback http, or a native app's own scheme. */
function redirectProblem(uri: string): string | undefined {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return `${uri} is not a URL`;
  }
  if (u.hash) return "a redirect_uri must not have a fragment";
  if (["javascript:", "data:", "file:", "blob:", "vbscript:"].includes(u.protocol)) return `${u.protocol} redirect URIs are not allowed`;
  if (u.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return "http redirect URIs must be loopback (localhost)";
  return undefined;
}

class Clients implements OAuthRegisteredClientsStore {
  constructor(private readonly store: Store) {}

  async getClient(id: string): Promise<OAuthClientInformationFull | undefined> {
    const row = (await this.store.sql.query("SELECT info_json FROM oauth_clients WHERE client_id = ?", [id])).rows[0];
    return row ? (JSON.parse(String(row.info_json)) as OAuthClientInformationFull) : undefined;
  }

  async registerClient(client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">): Promise<OAuthClientInformationFull> {
    const full = client as OAuthClientInformationFull;
    if (!full.client_id) throw new InvalidClientMetadataError("client_id was not generated");
    if (!full.redirect_uris?.length || full.redirect_uris.length > 10) throw new InvalidClientMetadataError("Register 1 to 10 redirect_uris");
    for (const uri of full.redirect_uris) {
      const problem = redirectProblem(uri);
      if (problem) throw new InvalidClientMetadataError(problem);
    }
    if (full.client_name && full.client_name.length > 100) full.client_name = full.client_name.slice(0, 100);
    await this.store.sql.query("INSERT INTO oauth_clients (client_id, info_json, created_at) VALUES (?, ?, ?)", [full.client_id, JSON.stringify(full), iso(Date.now())]);
    return full;
  }
}

interface Grant {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes: Scope[];
  expiresAt: string;
  ws?: string;
}

export class PayloryaOAuth implements OAuthServerProvider {
  readonly clientsStore: Clients;

  constructor(
    private readonly store: Store,
    /** The MCP endpoint, as clients name it in `resource` (RFC 8707). */
    readonly resource: URL,
  ) {
    this.clientsStore = new Clients(store);
  }

  private sameResource(resource: URL | undefined): boolean {
    return !resource || resource.href.replace(/\/$/, "") === this.resource.href.replace(/\/$/, "");
  }

  /** Remembers the request and sends the browser to the consent page (which signs the person in first). */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (!this.sameResource(params.resource)) {
      const back = new URL(params.redirectUri);
      back.searchParams.set("error", "invalid_target");
      back.searchParams.set("error_description", `This server only issues tokens for ${this.resource.href}`);
      if (params.state) back.searchParams.set("state", params.state);
      res.redirect(302, back.href);
      return;
    }
    const id = randomBytes(24).toString("base64url");
    const now = Date.now();
    await this.store.sql.query("DELETE FROM oauth_grants WHERE expires_at < ?", [iso(now - 24 * 3_600_000)]);
    await this.store.sql.query(
      "INSERT INTO oauth_grants (id, client_id, redirect_uri, code_challenge, state, scopes_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, client.client_id, params.redirectUri, params.codeChallenge, params.state ?? null, JSON.stringify(scopesOf(params.scopes)), iso(now), iso(now + PENDING_MS)],
    );
    res.redirect(302, `/oauth/consent?request=${id}`);
  }

  /** A sign-in still waiting for the person's answer. */
  async pending(id: string): Promise<Grant | undefined> {
    const row = (await this.store.sql.query("SELECT * FROM oauth_grants WHERE id = ? AND code_hash IS NULL AND expires_at > ?", [id, iso(Date.now())])).rows[0];
    if (!row) return undefined;
    return {
      id: String(row.id),
      clientId: String(row.client_id),
      redirectUri: String(row.redirect_uri),
      codeChallenge: String(row.code_challenge),
      state: row.state == null ? undefined : String(row.state),
      scopes: JSON.parse(String(row.scopes_json)) as Scope[],
      expiresAt: String(row.expires_at),
    };
  }

  /** The person allowed it: a single-use code for this account, valid CODE_MS. */
  async approve(id: string, ws: string, userId: string, scopes: Scope[]): Promise<string | undefined> {
    const code = randomBytes(32).toString("base64url");
    const changes = (
      await this.store.sql.query(
        "UPDATE oauth_grants SET code_hash = ?, workspace_id = ?, user_id = ?, scopes_json = ?, expires_at = ? WHERE id = ? AND code_hash IS NULL AND expires_at > ?",
        [sha256(code), ws, userId, JSON.stringify(scopes), iso(Date.now() + CODE_MS), id, iso(Date.now())],
      )
    ).changes;
    return changes === 1 ? code : undefined;
  }

  async deny(id: string): Promise<void> {
    await this.store.sql.query("DELETE FROM oauth_grants WHERE id = ? AND code_hash IS NULL", [id]);
  }

  private async byCode(client: OAuthClientInformationFull, code: string) {
    const row = (
      await this.store.sql.query("SELECT * FROM oauth_grants WHERE code_hash = ? AND client_id = ? AND used_at IS NULL AND expires_at > ?", [sha256(code), client.client_id, iso(Date.now())])
    ).rows[0];
    if (!row) throw new InvalidGrantError("The authorization code is invalid, expired or already used");
    return row;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return String((await this.byCode(client, code)).code_challenge);
  }

  /** Spends the code (once) and issues the account API key that is the access token. */
  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    const row = await this.byCode(client, code);
    if (redirectUri && redirectUri !== String(row.redirect_uri)) throw new InvalidGrantError("redirect_uri does not match the authorization request");
    if (!this.sameResource(resource)) throw new InvalidTargetError(`This server only issues tokens for ${this.resource.href}`);
    const spent = (await this.store.sql.query("UPDATE oauth_grants SET used_at = ? WHERE id = ? AND used_at IS NULL", [iso(Date.now()), row.id as string])).changes;
    if (spent !== 1) throw new InvalidGrantError("The authorization code was already used");
    const ws = String(row.workspace_id);
    if (!(await this.store.workspaceById(ws))) throw new InvalidGrantError("This account no longer exists");
    const scopes = JSON.parse(String(row.scopes_json)) as Scope[];
    const { key, hash, prefix } = newKey();
    const name = `${(client.client_name || "MCP client").slice(0, 60)} (connector)`;
    await this.store.addApiKey(ws, { name, prefix, hash, scopes });
    await this.store.log(ws, "user", "connected MCP client", `${name} (${scopes.join(", ")})`);
    // No expiry and no refresh token: the key works until it is revoked under Developers.
    return { access_token: key, token_type: "Bearer", scope: scopes.join(" ") };
  }

  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new InvalidGrantError("No refresh tokens are issued: access tokens stay valid until revoked");
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const found = KEY_PATTERN.test(token) ? await this.store.apiKeyByHash(hashKey(token)) : undefined;
    if (!found) throw new InvalidTokenError("Unknown, mistyped or revoked token");
    return { token, clientId: found.key.id, scopes: found.key.scopes, resource: this.resource };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const found = KEY_PATTERN.test(request.token) ? await this.store.apiKeyByHash(hashKey(request.token)) : undefined;
    if (found) await this.store.revokeApiKey(found.ws, found.key.id);
  }
}

/** The WWW-Authenticate challenge /mcp sends without a valid token: where to find the sign-in. */
export function mcpChallenge(resource: URL, invalid: boolean): string {
  return `Bearer realm="PayLorya AI", resource_metadata="${getOAuthProtectedResourceMetadataUrl(resource)}"${invalid ? ', error="invalid_token"' : ""}`;
}

/**
 * Mounts the OAuth endpoints at the root (/authorize, /token, /register, /revoke and the
 * /.well-known metadata, as the MCP SDK lays them out) and the consent page at /oauth/consent.
 * Returns the resource URL, or undefined when the public URL cannot be an issuer (plain http).
 */
export function mountOAuth(app: Express, deps: { store: Store; auth: Auth; baseUrl: string }): URL | undefined {
  const { store, auth } = deps;
  const issuer = new URL(deps.baseUrl);
  const resource = new URL("/mcp", issuer);
  const provider = new PayloryaOAuth(store, resource);
  let router: express.RequestHandler;
  try {
    router = mcpAuthRouter({
      provider,
      issuerUrl: issuer,
      resourceServerUrl: resource,
      scopesSupported: [...SCOPES],
      resourceName: "PayLorya AI",
      serviceDocumentationUrl: new URL("/developers.html", issuer),
      // The SDK's limiter keys on req.ip, which behind the Worker is the same for everyone.
      authorizationOptions: { rateLimit: false },
      tokenOptions: { rateLimit: false },
      revocationOptions: { rateLimit: false },
      clientRegistrationOptions: { rateLimit: false, clientSecretExpirySeconds: 0 },
    });
  } catch (error) {
    console.warn(`OAuth for MCP clients is off: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  const limiter = new RateLimiter(OAUTH_PER_MINUTE);
  app.use(["/authorize", "/token", "/register", "/revoke"], (req: Request, res: Response, next: NextFunction) => {
    const wait = limiter.take(`oauth:${clientId(name => req.header(name), req.socket.remoteAddress).id}`);
    if (!wait) return next();
    res.setHeader("retry-after", String(wait));
    res.status(429).json({ error: "too_many_requests", error_description: `Try again in ${wait} s` });
  });
  app.use(router);
  // Some clients look for the resource metadata at the root as well as under /mcp.
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({ resource: resource.href, authorization_servers: [issuer.href], scopes_supported: [...SCOPES], resource_name: "PayLorya AI" });
  });

  const consentUrl = (req: Request) => `/login?next=${encodeURIComponent(req.originalUrl)}`;
  app.get("/oauth/consent", async (req, res, next) => {
    try {
      res.setHeader("cache-control", "no-store");
      const user = await auth.userFrom(req.headers);
      if (!user) return void res.redirect(302, consentUrl(req));
      const grant = await provider.pending(String(req.query.request ?? ""));
      if (!grant) return void res.status(400).type("html").send(page("This sign-in expired", "<p>Go back to your AI app and connect PayLorya AI again.</p>"));
      const client = await provider.clientsStore.getClient(grant.clientId);
      const ws = await store.workspaceForUser(user.id, `${user.name.split(" ")[0] || "My"}'s company`);
      res.type("html").send(consentPage(grant, client?.client_name || "An MCP client", ws.name, user.email));
    } catch (error) {
      next(error);
    }
  });
  app.post("/oauth/consent", express.urlencoded({ extended: false, limit: "8kb" }), async (req, res, next) => {
    try {
      res.setHeader("cache-control", "no-store");
      // The session cookie is SameSite=Lax; the Origin check also stops a same-site form posting here.
      const origin = req.header("origin");
      if (origin && origin !== issuer.origin) return void res.status(403).type("html").send(page("Not allowed", "<p>This form must be sent from PayLorya AI.</p>"));
      const user = await auth.userFrom(req.headers);
      if (!user) return void res.redirect(303, consentUrl(req));
      const body = req.body as Record<string, string | undefined>;
      const grant = await provider.pending(String(body.request ?? ""));
      if (!grant) return void res.status(400).type("html").send(page("This sign-in expired", "<p>Go back to your AI app and connect PayLorya AI again.</p>"));
      const back = new URL(grant.redirectUri);
      if (grant.state) back.searchParams.set("state", grant.state);
      if (body.decision !== "allow") {
        await provider.deny(grant.id);
        back.searchParams.set("error", "access_denied");
        return void res.redirect(303, back.href);
      }
      const scopes: Scope[] = body.access === "read" ? ["read"] : grant.scopes;
      const ws = await store.workspaceForUser(user.id, `${user.name.split(" ")[0] || "My"}'s company`);
      const code = await provider.approve(grant.id, ws.id, user.id, scopes);
      if (!code) return void res.status(400).type("html").send(page("This sign-in expired", "<p>Go back to your AI app and connect PayLorya AI again.</p>"));
      back.searchParams.set("code", code);
      back.searchParams.set("iss", issuer.href);
      res.redirect(303, back.href);
    } catch (error) {
      next(error);
    }
  });
  return resource;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · PayLorya AI</title><meta name="robots" content="noindex">
<style>
:root{--bg:#f6f4f1;--card:#fff;--ink:#1d1d1f;--muted:#6b6b70;--line:#e7e3dd;--accent:#1d1d1f;--warn:#fff6e8}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1d1d20;--ink:#f2f2f3;--muted:#a1a1a8;--line:#2e2e33;--accent:#f2f2f3;--warn:#2a2418}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px}
h1{font-size:21px;margin:0 0 6px}p{margin:0 0 14px;color:var(--muted)}b{color:var(--ink)}
.brand{font-weight:700;margin-bottom:18px;display:flex;gap:8px;align-items:center}.brand span{font-size:11px;border:1px solid var(--line);border-radius:6px;padding:0 5px}
fieldset{border:0;padding:0;margin:0 0 14px}label{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;cursor:pointer}
label small{display:block;color:var(--muted)}input{margin-top:4px}
.note{background:var(--warn);border-radius:12px;padding:10px 12px;font-size:13.5px;color:var(--ink)}
.row{display:flex;gap:10px;margin-top:18px}button{flex:1;font:inherit;font-weight:600;border-radius:999px;padding:11px 16px;cursor:pointer;border:1px solid var(--line);background:transparent;color:var(--ink)}
button.primary{background:var(--accent);color:var(--card);border-color:var(--accent)}
</style></head><body><main><div class="brand">PayLorya<span>AI</span></div><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

function consentPage(grant: Grant, clientName: string, workspace: string, email: string): string {
  let host = grant.redirectUri;
  try {
    host = new URL(grant.redirectUri).host || grant.redirectUri;
  } catch {
    // shown as is
  }
  const write = grant.scopes.includes("write");
  return page(
    `Connect ${clientName}?`,
    `<p><b>${esc(clientName)}</b> wants to use PayLorya AI for <b>${esc(workspace)}</b> (signed in as ${esc(email)}). You return to <b>${esc(host)}</b> afterwards.</p>
<form method="post" action="/oauth/consent">
<input type="hidden" name="request" value="${esc(grant.id)}">
<fieldset>
${write ? `<label><input type="radio" name="access" value="write" checked><span><b>Read &amp; draft</b><small>Read your finances, draft payments and ask the AI CFO.</small></span></label>` : ""}
<label><input type="radio" name="access" value="read"${write ? "" : " checked"}><span><b>Read only</b><small>Read your finances; change nothing.</small></span></label>
</fieldset>
<p class="note">It can never approve, sign or send a payment, or change payees, budgets, connections or agent rights: those always need you in the dashboard. Disconnect it any time under Developers.</p>
<div class="row"><button type="submit" name="decision" value="deny">Cancel</button><button class="primary" type="submit" name="decision" value="allow">Allow</button></div>
</form>`,
  );
}

