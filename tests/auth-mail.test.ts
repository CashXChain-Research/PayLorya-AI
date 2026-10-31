import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCfo, mountCfo } from "../src/cfo/index.js";
import { codeEmail, codeLink, resendMailer, type CodePurpose, type Mailer } from "../src/cfo/mail.js";
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

async function start(mailer?: Mailer, env: Record<string, string> = {}) {
  const app = express();
  const server = await new Promise<Server>(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  servers.push(server);
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const config = loadConfig({ PUBLIC_BASE_URL: base, BETTER_AUTH_SECRET: "t".repeat(40), ...env });
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

describe("sign-in origins (custom domain)", () => {
  // A browser with any cookie gets its Origin checked by Better Auth; a wrong password then answers 401.
  const signInFrom = async (base: string, origin: string) => {
    const res = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie: "theme=dark" },
      body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password-1" }),
    });
    return { status: res.status, code: ((await res.json().catch(() => ({}))) as { code?: string }).code };
  };

  it("PUBLIC_BASE_URL on paylorya.valentin.is plus AUTH_TRUSTED_ORIGINS: both hosts sign in, others are refused", async () => {
    const s = await start(undefined, {
      PUBLIC_BASE_URL: "https://paylorya.valentin.is",
      AUTH_TRUSTED_ORIGINS: "https://cxc-agentpay.cashxchain.workers.dev/",
    });
    expect(await signInFrom(s.base, "https://paylorya.valentin.is")).toMatchObject({ status: 401 });
    expect(await signInFrom(s.base, "https://cxc-agentpay.cashxchain.workers.dev")).toMatchObject({ status: 401 });
    expect(await signInFrom(s.base, "https://evil.example")).toEqual({ status: 403, code: "INVALID_ORIGIN" });
  });

  it("the code mail sent through Resend links and loads the logo from PUBLIC_BASE_URL", async () => {
    const sent: Array<{ html: string; text: string }> = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) !== "https://api.resend.com/emails") return realFetch(url, init);
      sent.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
    try {
      const s = await start(undefined, { PUBLIC_BASE_URL: "https://paylorya.valentin.is", RESEND_API_KEY: "re_test_key" });
      const res = await realFetch(`${s.base}/api/auth/email-otp/send-verification-otp`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://paylorya.valentin.is" },
        body: JSON.stringify({ email: "lin@example.com", type: "sign-in" }),
      });
      expect(res.status).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.html).toContain('href="https://paylorya.valentin.is/verify#email=lin%40example.com&amp;code=');
      expect(sent[0]!.html).toContain('<img src="https://paylorya.valentin.is/apple-touch-icon.png?v=3"');
      expect(sent[0]!.text).toMatch(/^https:\/\/paylorya\.valentin\.is\/verify#email=lin%40example\.com&code=\d{6}&type=sign-in$/m);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("without it (the config before #46) paylorya.valentin.is gets INVALID_ORIGIN", async () => {
    const s = await start(undefined, { PUBLIC_BASE_URL: "https://cxc-agentpay.cashxchain.workers.dev" });
    expect(await signInFrom(s.base, "https://paylorya.valentin.is")).toEqual({ status: 403, code: "INVALID_ORIGIN" });
  });
});

describe("Resend mailer", () => {
  it("posts the documented request: bearer key, idempotency key, from/to/subject/text/html", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const mailer = resendMailer({
      apiKey: "re_test_key",
      from: "PayLorya AI <no-reply@mail.valentin.is>",
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
    expect(headers["idempotency-key"]).toMatch(/^paylorya-code-[0-9a-f]{32}$/);
    expect((calls[1]!.init.headers as Record<string, string>)["idempotency-key"]).toBe(headers["idempotency-key"]);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ from: "PayLorya AI <no-reply@mail.valentin.is>", to: ["ada@example.com"] });
    expect(body.subject).toBe("123456 is your PayLorya AI code: confirm your email");
    expect(body.text).toContain("123456");
    expect(body.text).toContain("expires in 10 minutes");
    expect(body.html).toContain("123456");
  });

  it("reports a refused send with Resend's status", async () => {
    const mailer = resendMailer({
      apiKey: "re_x",
      from: "PayLorya AI <no-reply@mail.valentin.is>",
      expiresMinutes: 10,
      fetch: (async () => new Response('{"message":"domain is not verified"}', { status: 403 })) as unknown as typeof fetch,
    });
    await expect(mailer.sendCode("a@b.co", "1", "sign-in")).rejects.toThrow(/Resend answered 403: .*domain is not verified/);
  });

  it("with the public URL: posts the logo and the one-click link", async () => {
    const calls: { init: RequestInit }[] = [];
    const mailer = resendMailer({
      apiKey: "re_test_key",
      from: "PayLorya AI <no-reply@mail.valentin.is>",
      expiresMinutes: 10,
      baseUrl: "https://app.example/",
      fetch: (async (_url: string, init: RequestInit) => {
        calls.push({ init });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await mailer.sendCode("ada@example.com", "123456", "sign-in");
    const body = JSON.parse(String(calls[0]!.init.body));
    const link = "https://app.example/verify#email=ada%40example.com&code=123456&type=sign-in";
    expect(body.text).toContain(link);
    expect(body.text).toContain("Or enter this code: 123456");
    expect(body.html).toContain(`href="${link.replace(/&/g, "&amp;")}"`);
    expect(body.html).toContain('<img src="https://app.example/apple-touch-icon.png?v=3"');
    expect(body.html).toContain("Sign in to PayLorya AI");
    expect(body.html).toContain("123456");
    // Footer: our website.
    expect(body.html).toContain('<a href="https://paylorya.valentin.is/"');
    expect(body.html).toContain(">paylorya.valentin.is</a>");
    expect(body.html).not.toContain("cashxchain.com");
    expect(body.text).toContain("PayLorya AI · https://paylorya.valentin.is/");
  });

  it("links only sign-in and email confirmation; reset and email change keep the plain code", () => {
    expect(codeLink("https://a.example", "a@b.co", "123456", "email-verification")).toBe("https://a.example/verify#email=a%40b.co&code=123456&type=email-verification");
    expect(codeLink("https://a.example", "a@b.co", "123456", "forget-password")).toBeUndefined();
    const reset = codeEmail("654321", "forget-password", 10, { baseUrl: "https://a.example", to: "a@b.co" });
    expect(reset.html).not.toContain("/verify#");
    expect(reset.html).toContain("https://a.example/apple-touch-icon.png");
    expect(reset.text).not.toContain("/verify");
    // Markup in the address cannot break out of the link.
    const odd = codeEmail("123456", "sign-in", 10, { baseUrl: "https://a.example", to: '"><script>@x.co' });
    expect(odd.html).not.toContain("<script>");
  });

  it("the link's email, code and type sign in through the same API the /verify page calls", async () => {
    const mail = fakeMailer();
    const s = await start(mail);
    await s.post("/api/auth/email-otp/send-verification-otp", { email: "lin@example.com", type: "sign-in" });
    const link = new URL(codeLink(s.base, "lin@example.com", mail.sent[0]!.code, "sign-in")!);
    expect(link.pathname).toBe("/verify");
    expect(link.search).toBe(""); // all in the fragment: nothing reaches server logs
    const h = new URLSearchParams(link.hash.slice(1));
    expect(h.get("type")).toBe("sign-in");
    const res = await s.post("/api/auth/sign-in/email-otp", { email: h.get("email"), otp: h.get("code") });
    expect(res.status).toBe(200);
    expect(await s.me(res.cookie)).toBe(200);
  });

  it("names the product and nothing user-supplied in the mail", () => {
    const mail = codeEmail("654321", "forget-password", 10);
    expect(mail.subject).toBe("654321 is your PayLorya AI code: reset your password");
    expect(mail.html).toContain("PayLorya AI");
  });
});
