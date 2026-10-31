import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createCfo, mountCfo } from "../src/cfo/index.js";
import { codeEmail, resendMailer, type CodePurpose, type Mailer } from "../src/cfo/mail.js";
import { loadConfig } from "../src/config.js";
import { RunStore } from "../src/runs.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => (s.closeAllConnections(), s.close(() => resolve())))));
});

interface Sent {
  to: string;
  code: string;
  purpose: CodePurpose;
}

function fakeMailer(fail = false): Mailer & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async sendCode(to, code, purpose) {
      if (fail) throw new Error("Resend answered 403: domain not verified");
      sent.push({ to, code, purpose });
    },
  };
}

async function start(mailer?: Mailer) {
  const app = express();
  const server = await new Promise<Server>(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  servers.push(server);
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: "t".repeat(40) });
  mountCfo(app, await createCfo(config, { runs: new RunStore() }, { memory: true, ...(mailer ? { mailer } : {}) }));
  const post = async (path: string, body: unknown, cookie?: string) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    return { status: res.status, json, cookie: res.headers.get("set-cookie")?.split(";")[0] };
  };
  const me = async (cookie?: string) => (await fetch(`${base}/api/v1/me`, { headers: cookie ? { cookie } : {} })).status;
  const getJson = async (path: string, cookie?: string) => (await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} })).json() as Promise<Record<string, any>>;
  return { base, post, me, getJson };
}

const account = { name: "Ada", email: "ada@example.com", password: "correct-horse-1" };

describe("password-free sign-up and login by email code (the default with Resend)", () => {
  it("the pages learn that codes are on", async () => {
    expect(await (await start(fakeMailer())).getJson("/api/auth-options")).toEqual({ codes: true });
    expect(await (await start()).getJson("/api/auth-options")).toEqual({ codes: false });
  });

  it("sign-up: a code creates the account with the name, no password involved", async () => {
    const mail = fakeMailer();
    const s = await start(mail);
    expect((await s.post("/api/auth/email-otp/send-verification-otp", { email: "lin@example.com", type: "sign-in" })).status).toBe(200);
    expect(mail.sent).toEqual([{ to: "lin@example.com", code: expect.stringMatching(/^\d{6}$/), purpose: "sign-in" }]);

    const res = await s.post("/api/auth/sign-in/email-otp", { email: "lin@example.com", otp: mail.sent[0]!.code, name: "Lin Wu" });
    expect(res.status).toBe(200);
    expect(res.json.user).toMatchObject({ email: "lin@example.com", name: "Lin Wu", emailVerified: true });
    const me = await s.getJson("/api/v1/me", res.cookie);
    expect(me.signIn).toEqual({ password: false, codes: true });

    // There is no password to log in with.
    expect((await s.post("/api/auth/sign-in/email", { email: "lin@example.com", password: "anything-123" })).status).toBe(401);
  });

  it("login: a code signs in an existing account, a wrong code does not", async () => {
    const mail = fakeMailer();
    const s = await start(mail);
    await s.post("/api/auth/email-otp/send-verification-otp", { email: "lin@example.com", type: "sign-in" });
    await s.post("/api/auth/sign-in/email-otp", { email: "lin@example.com", otp: mail.sent[0]!.code, name: "Lin Wu" });

    await s.post("/api/auth/email-otp/send-verification-otp", { email: "lin@example.com", type: "sign-in" });
    const code = mail.sent[1]!.code;
    const wrong = await s.post("/api/auth/sign-in/email-otp", { email: "lin@example.com", otp: code === "000000" ? "111111" : "000000" });
    expect(wrong.status).toBe(400);
    expect(await s.me(wrong.cookie)).toBe(401);
    const ok = await s.post("/api/auth/sign-in/email-otp", { email: "lin@example.com", otp: code });
    expect(ok.status).toBe(200);
    expect(ok.json.user.name).toBe("Lin Wu"); // a login never renames
    expect(await s.me(ok.cookie)).toBe(200);
  });

  it("a password is optional: added later in settings, changed with the current one", async () => {
    const mail = fakeMailer();
    const s = await start(mail);
    await s.post("/api/auth/email-otp/send-verification-otp", { email: "lin@example.com", type: "sign-in" });
    const { cookie } = await s.post("/api/auth/sign-in/email-otp", { email: "lin@example.com", otp: mail.sent[0]!.code, name: "Lin Wu" });

    expect((await s.post("/api/v1/me/password", { password: "short" }, cookie)).status).toBe(400);
    expect((await s.post("/api/v1/me/password", { password: "first-password-1" }, cookie)).status).toBe(204);
    expect((await s.getJson("/api/v1/me", cookie)).signIn).toEqual({ password: true, codes: true });
    expect((await s.post("/api/auth/sign-in/email", { email: "lin@example.com", password: "first-password-1" })).status).toBe(200);

    const again = await s.post("/api/v1/me/password", { password: "second-password-2" }, cookie);
    expect(again.status).toBe(409); // already set: needs the current password
    expect(again.json.error).toMatch(/current password/);
    const wrongCurrent = await s.post("/api/v1/me/password", { password: "second-password-2", currentPassword: "nope-nope-1" }, cookie);
    expect(wrongCurrent.status).toBe(400);
    expect((await s.post("/api/v1/me/password", { password: "second-password-2", currentPassword: "first-password-1" }, cookie)).status).toBe(204);
    expect((await s.post("/api/auth/sign-in/email", { email: "lin@example.com", password: "second-password-2" })).status).toBe(200);
    // Codes keep working next to the password.
    await s.post("/api/auth/email-otp/send-verification-otp", { email: "lin@example.com", type: "sign-in" });
    expect((await s.post("/api/auth/sign-in/email-otp", { email: "lin@example.com", otp: mail.sent.at(-1)!.code })).status).toBe(200);
  });

  it("setting a password needs a session", async () => {
    const s = await start(fakeMailer());
    expect((await s.post("/api/v1/me/password", { password: "first-password-1" })).status).toBe(401);
  });
});

describe("sign-up with an optional password confirms the email with a code", () => {
  it("mails a code on sign-up, signs in only after the code is entered", async () => {
    const mail = fakeMailer();
    const s = await start(mail);

    const signUp = await s.post("/api/auth/sign-up/email", account);
    expect(signUp.status).toBe(200);
    expect(signUp.json.token).toBeNull(); // no session before the email is confirmed
    expect(await s.me(signUp.cookie)).toBe(401);
    expect(mail.sent).toEqual([{ to: account.email, code: expect.stringMatching(/^\d{6}$/), purpose: "email-verification" }]);

    // Signing in while unconfirmed is refused and mails a fresh code.
    const early = await s.post("/api/auth/sign-in/email", { email: account.email, password: account.password });
    expect(early.status).toBe(403);
    expect(early.json.code).toBe("EMAIL_NOT_VERIFIED");
    expect(mail.sent).toHaveLength(2);

    const wrong = await s.post("/api/auth/email-otp/verify-email", { email: account.email, otp: "000000" === mail.sent[1]!.code ? "111111" : "000000" });
    expect(wrong.status).toBe(400);
    expect(wrong.json.code).toBe("INVALID_OTP");

    const ok = await s.post("/api/auth/email-otp/verify-email", { email: account.email, otp: mail.sent[1]!.code });
    expect(ok.status).toBe(200);
    expect(ok.json.user.emailVerified).toBe(true);
    expect(ok.cookie).toMatch(/session_token=/);
    expect(await s.me(ok.cookie)).toBe(200);

    const later = await s.post("/api/auth/sign-in/email", { email: account.email, password: account.password });
    expect(later.status).toBe(200);
    expect(mail.sent).toHaveLength(2); // a confirmed account gets no more codes on a password sign-in
  });

  it("'send a new code' mails another one, and the old code stops working", async () => {
    const mail = fakeMailer();
    const s = await start(mail);
    await s.post("/api/auth/sign-up/email", account);
    const first = mail.sent[0]!.code;

    const resend = await s.post("/api/auth/email-otp/send-verification-otp", { email: account.email, type: "email-verification" });
    expect(resend.status).toBe(200);
    expect(mail.sent).toHaveLength(2);
    const second = mail.sent[1]!.code;

    if (first !== second) expect((await s.post("/api/auth/email-otp/verify-email", { email: account.email, otp: first })).status).toBe(400);
    expect((await s.post("/api/auth/email-otp/verify-email", { email: account.email, otp: second })).status).toBe(200);
  });

  it("a failing mail send does not fail the sign-up; the user can ask for a new code", async () => {
    const s = await start(fakeMailer(true));
    const signUp = await s.post("/api/auth/sign-up/email", account);
    expect(signUp.status).toBe(200);
    expect(signUp.json.token).toBeNull();
  });
});

describe("confirmation page", () => {
  it("GET /verify serves the code page", async () => {
    const s = await start(fakeMailer());
    const res = await fetch(`${s.base}/verify`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<form data-auth="verify"');
    expect(html).toContain('autocomplete="one-time-code"');
  });
});

describe("without Resend nothing changes", () => {
  it("sign-up signs in straight away", async () => {
    const s = await start();
    const signUp = await s.post("/api/auth/sign-up/email", account);
    expect(signUp.status).toBe(200);
    expect(signUp.json.token).toEqual(expect.any(String));
    expect(await s.me(signUp.cookie)).toBe(200);
  });
});

describe("Resend mailer", () => {
  it("posts the documented request: bearer key, idempotency key, from/to/subject/text/html", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const mailer = resendMailer({
      apiKey: "re_test_key",
      from: "PayFlow AI <no-reply@cashxchain.com>",
      expiresMinutes: 10,
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      }) as typeof fetch,
    });
    await mailer.sendCode("ada@example.com", "123456", "email-verification");
    await mailer.sendCode("ada@example.com", "123456", "email-verification");

    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_key");
    expect(headers["idempotency-key"]).toMatch(/^payflow-code-[0-9a-f]{32}$/);
    expect((calls[1]!.init.headers as Record<string, string>)["idempotency-key"]).toBe(headers["idempotency-key"]);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ from: "PayFlow AI <no-reply@cashxchain.com>", to: ["ada@example.com"] });
    expect(body.subject).toBe("123456 is your PayFlow AI code: confirm your email");
    expect(body.text).toContain("123456");
    expect(body.text).toContain("expires in 10 minutes");
    expect(body.html).toContain("123456");
  });

  it("reports a refused send with Resend's status", async () => {
    const mailer = resendMailer({
      apiKey: "re_x",
      from: "PayFlow AI <no-reply@cashxchain.com>",
      expiresMinutes: 10,
      fetch: (async () => new Response('{"message":"domain is not verified"}', { status: 403 })) as unknown as typeof fetch,
    });
    await expect(mailer.sendCode("a@b.co", "1", "sign-in")).rejects.toThrow(/Resend answered 403: .*domain is not verified/);
  });

  it("names the product and nothing user-supplied in the mail", () => {
    const mail = codeEmail("654321", "forget-password", 10);
    expect(mail.subject).toBe("654321 is your PayFlow AI code: reset your password");
    expect(mail.html).toContain("PayFlow AI");
  });
});
