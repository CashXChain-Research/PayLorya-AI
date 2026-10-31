import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { BuyerAgent } from "../src/agent.js";
import { KEY_PATTERN } from "../src/cfo/api-keys.js";
import { createCfo, mountCfo, type PaymentEngine } from "../src/cfo/index.js";
import { loadConfig } from "../src/config.js";
import { RunStore } from "../src/runs.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => (s.closeAllConnections(), s.close(() => resolve())))));
});

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

async function start() {
  const app = express();
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: "s".repeat(40) });
  const deps = await createCfo(config, { runs: new RunStore(), agent: {} as BuyerAgent } satisfies PaymentEngine, { memory: true, noSweep: true, agentFor: () => ({}) as BuyerAgent });
  mountCfo(app, deps);
  const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ name: "Korbinian Test", email: "owner@example.com", password: "correct-horse-1" }),
  });
  expect(signUp.status).toBe(200);
  const cookie = signUp.headers.get("set-cookie")!.split(";")[0]!;
  return { base, cookie };
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

/** Registers like claude.ai does (public client, dynamic registration) and runs the browser part. */
async function signIn(base: string, cookie: string, opts: { decision?: "allow" | "deny"; access?: "read" | "write" } = {}) {
  const reg = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  expect(reg.status).toBe(201);
  const client = (await reg.json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL(`${base}/authorize`);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "st4te", scope: "read write", resource: `${base}/mcp` })) {
    authorize.searchParams.set(k, v);
  }
  const started = await fetch(authorize, { redirect: "manual" });
  expect(started.status).toBe(302);
  const consent = new URL(started.headers.get("location")!, base);
  expect(consent.pathname).toBe("/oauth/consent");

  // Signed out: the login page, which brings the person back here.
  const signedOut = await fetch(consent, { redirect: "manual" });
  expect(signedOut.status).toBe(302);
  expect(signedOut.headers.get("location")).toBe(`/login?next=${encodeURIComponent(consent.pathname + consent.search)}`);

  const shown = await fetch(consent, { headers: { cookie } });
  expect(shown.status).toBe(200);
  const html = await shown.text();
  expect(html).toContain("Connect Claude?");
  expect(html).toContain("can never approve, sign or send a payment");

  const answered = await fetch(`${base}/oauth/consent`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, origin: base, "content-type": "application/x-www-form-urlencoded" },
    body: form({ request: consent.searchParams.get("request")!, decision: opts.decision ?? "allow", access: opts.access ?? "write" }),
  });
  expect(answered.status).toBe(303);
  return { client, verifier, back: new URL(answered.headers.get("location")!), request: consent.searchParams.get("request")! };
}

const exchange = (base: string, fields: Record<string, string>) =>
  fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "authorization_code", redirect_uri: CALLBACK, ...fields }) });

describe("OAuth for MCP clients (claude.ai connectors)", () => {
  it("points an unauthenticated /mcp call at the metadata, which leads to registration", async () => {
    const { base } = await start();
    const r = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe(`Bearer realm="PayLorya AI", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
    const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(prm).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [`${base}/`], scopes_supported: ["read", "write"] });
    expect((await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()).resource).toBe(`${base}/mcp`);
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    expect(as).toMatchObject({
      issuer: `${base}/`,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("signs in, issues an account key as the token, and spends the code once", async () => {
    const { base, cookie } = await start();
    const { client, verifier, back } = await signIn(base, cookie);
    expect(back.origin + back.pathname).toBe(CALLBACK);
    expect(back.searchParams.get("state")).toBe("st4te");
    const code = back.searchParams.get("code")!;
    expect(code).toBeTruthy();

    const wrong = await exchange(base, { client_id: client.client_id, code, code_verifier: randomBytes(32).toString("base64url") });
    expect(wrong.status).toBe(400);
    const token = await exchange(base, { client_id: client.client_id, code, code_verifier: verifier, resource: `${base}/mcp` });
    expect(token.status).toBe(200);
    const tokens = (await token.json()) as { access_token: string; token_type: string; scope: string };
    expect(tokens.access_token).toMatch(KEY_PATTERN);
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.scope).toBe("read write");
    const again = await exchange(base, { client_id: client.client_id, code, code_verifier: verifier });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe("invalid_grant");

    // The token is a key of this account: /mcp answers, Developers lists it, and revoking it disconnects.
    const me = await (await fetch(`${base}/api/v1/me`, { headers: { authorization: `Bearer ${tokens.access_token}` } })).json();
    expect(me.apiKey).toMatchObject({ name: "Claude (connector)", scopes: ["read", "write"] });
    const init = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
    });
    expect(init.status).toBe(200);
    const keys = (await (await fetch(`${base}/api/v1/api-keys`, { headers: { cookie } })).json()) as Array<{ id: string; name: string }>;
    expect(keys.map(k => k.name)).toEqual(["Claude (connector)"]);
    await fetch(`${base}/api/v1/api-keys/${keys[0]!.id}`, { method: "DELETE", headers: { cookie, origin: base } });
    expect((await fetch(`${base}/api/v1/me`, { headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(401);
  });

  it("gives a read-only key when the person picks read only", async () => {
    const { base, cookie } = await start();
    const { client, verifier, back } = await signIn(base, cookie, { access: "read" });
    const tokens = (await (await exchange(base, { client_id: client.client_id, code: back.searchParams.get("code")!, code_verifier: verifier })).json()) as { access_token: string; scope: string };
    expect(tokens.scope).toBe("read");
    const draft = await fetch(`${base}/api/v1/chats`, { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json" }, body: "{}" });
    expect(draft.status).toBe(403);
  });

  it("returns access_denied when the person cancels, and the request cannot be reused", async () => {
    const { base, cookie } = await start();
    const { back, request } = await signIn(base, cookie, { decision: "deny" });
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
    expect((await fetch(`${base}/oauth/consent?request=${request}`, { headers: { cookie } })).status).toBe(400);
  });

  it("refuses a consent posted from another site and unsafe redirect URIs", async () => {
    const { base, cookie } = await start();
    const forged = await fetch(`${base}/oauth/consent`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
      body: form({ request: "x", decision: "allow" }),
    });
    expect(forged.status).toBe(403);
    for (const uri of ["http://evil.example/cb", "javascript:alert(1)"]) {
      const r = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "x", redirect_uris: [uri], token_endpoint_auth_method: "none" }) });
      expect(r.status, uri).toBe(400);
    }
  });
});
