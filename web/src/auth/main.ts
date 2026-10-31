import { type AuthOptions, loadAuthOptions, startGoogle } from "../shared/google.js";
import { initChrome } from "../shared/nav.js";

initChrome();

type Mode = "login" | "signup" | "verify";

interface ApiError {
  message?: string;
  code?: string;
}

/** What /verify needs: where the code went and which kind it is. */
interface Pending {
  email: string;
  /** "sign-in": a login or password-free sign-up. "email-verification": a sign-up with a password. */
  purpose: "sign-in" | "email-verification";
  /** Sign-up without a password: the name to create the account with. */
  name?: string;
}

const form = document.querySelector<HTMLFormElement>("form[data-auth]");
const mode = form?.dataset.auth as Mode | undefined;

/** Only same-site dashboard paths are honoured as a post-auth target. */
function nextTarget(): string {
  const next = new URLSearchParams(location.search).get("next") ?? "";
  return /^\/app(?:[/?#]|$)/.test(next) ? next : "/app";
}

// Carry ?next across the login <-> signup switch link.
const next = nextTarget();
if (next !== "/app") {
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-keep-next]")) {
    const url = new URL(link.href, location.origin);
    url.searchParams.set("next", next);
    link.href = url.pathname + url.search;
  }
}

// Handed from sign-up/login to /verify in this tab only, never in the URL.
const PENDING_KEY = "paylorya-verify";

function readPending(): Pending | undefined {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as Pending | null;
    return p && typeof p.email === "string" ? p : undefined;
  } catch {
    return undefined;
  }
}

function writePending(p: Pending | undefined): void {
  try {
    if (p) sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // storage blocked: /verify asks for the email
  }
}

/** A code is in the user's inbox: continue on the confirmation page. */
function goVerify(p: Pending): void {
  writePending(p);
  location.assign(next === "/app" ? "/verify" : `/verify?next=${encodeURIComponent(next)}`);
}

// Already signed in: skip the form.
void fetch("/api/auth/get-session", { credentials: "same-origin", headers: { accept: "application/json" } })
  .then(res => (res.ok ? res.json() : null))
  .then((data: { user?: unknown } | null) => {
    if (data?.user) location.replace(next);
  })
  .catch(() => undefined);

const FRIENDLY: Record<string, string> = {
  USER_ALREADY_EXISTS: "An account with this email already exists. Log in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with this email already exists. Log in instead.",
  INVALID_EMAIL_OR_PASSWORD: "That email and password do not match.",
  INVALID_EMAIL: "Enter a valid email address.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters for your password.",
  PASSWORD_TOO_LONG: "That password is too long.",
  INVALID_OTP: "That code is not right. Check the email and try again.",
  OTP_EXPIRED: "That code has expired. Send a new one.",
  TOO_MANY_ATTEMPTS: "Too many wrong codes. Send a new one.",
};

async function readError(res: Response): Promise<ApiError> {
  try {
    return (await res.json()) as ApiError;
  } catch {
    return {}; // non-JSON error body
  }
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
}

function field(name: string): HTMLInputElement | null {
  return form?.querySelector<HTMLInputElement>(`[name="${name}"]`) ?? null;
}

function setFieldError(name: string, message: string): void {
  const input = field(name);
  const hint = document.getElementById(`${name}-err`);
  if (!input || !hint) return;
  input.setAttribute("aria-invalid", message ? "true" : "false");
  hint.textContent = message;
  hint.hidden = !message;
}

function setFormError(message: string): void {
  const box = document.getElementById("form-err");
  if (!box) return;
  const text = box.querySelector("span");
  if (text) text.textContent = message;
  box.hidden = !message;
}

// ── Code or password ─────────────────────────────────────────────────────────────────────
// With email codes on the server (the normal case), sign-up and login send a code and the password
// field stays hidden until the customer asks for it. Without codes (no Resend key), the password is
// required as before.
let codes = true;
let usePassword = false;
const passwordField = document.getElementById("password-field");
const toggle = document.querySelector<HTMLAnchorElement>("[data-password-toggle]");
const submitLabel = form?.querySelector<HTMLElement>('button[type="submit"] span');

function applyMethod(): void {
  if (passwordField) passwordField.hidden = !usePassword;
  if (toggle) {
    toggle.hidden = !codes;
    toggle.textContent =
      mode === "signup"
        ? usePassword ? "Sign up with an email code instead" : "Add a password (optional)"
        : usePassword ? "Use an email code instead" : "Log in with a password instead";
  }
  if (mode === "login" && submitLabel) submitLabel.textContent = usePassword ? "Log in" : "Email me a code";
  if (!usePassword) setFieldError("password", "");
}
if (mode && mode !== "verify") applyMethod();
// From the marketing page's email box (server without email codes): keep what was typed.
const presetEmail = mode !== "verify" ? new URLSearchParams(location.search).get("email") : null;
if (presetEmail && field("email")) (field("email") as HTMLInputElement).value = presetEmail;

const oauth = document.getElementById("oauth");
const googleButton = document.querySelector<HTMLButtonElement>("[data-google]");

function showGoogle(google: AuthOptions["google"]): void {
  if (!oauth || !google) return;
  googleButton?.addEventListener("click", async () => {
    googleButton.disabled = true;
    googleButton.classList.add("loading");
    const error = await startGoogle(google, {
      callbackURL: next,
      errorCallbackURL: `/${mode === "signup" ? "signup" : "login"}?error=google`,
      fallbackPath: location.pathname + location.search,
    });
    if (error) {
      setFormError(error);
      googleButton.disabled = false;
      googleButton.classList.remove("loading");
    }
  });
  oauth.hidden = false;
  // Back from Google with an error (Better Auth appends its code to errorCallbackURL).
  if (new URLSearchParams(location.search).has("error")) {
    setFormError("Google sign-in did not complete. Try again, or use your email instead.");
  }
}

const ready: Promise<void> =
  mode === "verify"
    ? Promise.resolve()
    : loadAuthOptions().then(o => {
        // Unknown (request failed): keep codes, the normal server setup.
        if (!o) return;
        showGoogle(o.google);
        if (Boolean(o.codes) !== codes) {
          codes = Boolean(o.codes);
          usePassword = !codes;
          applyMethod();
        }
      });

toggle?.addEventListener("click", event => {
  event.preventDefault();
  usePassword = !usePassword;
  applyMethod();
  (usePassword ? field("password") : field("email"))?.focus();
});

function validate(): boolean {
  let ok = true;
  const name = field("name");
  const email = field("email");
  const password = field("password");
  const code = field("code");
  if (name) {
    const bad = name.value.trim().length === 0;
    setFieldError("name", bad ? "Enter your name." : "");
    ok &&= !bad;
  }
  if (email) {
    const bad = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
    setFieldError("email", bad ? "Enter a valid email address." : "");
    if (bad) document.getElementById("email-field")?.removeAttribute("hidden");
    ok &&= !bad;
  }
  if (password && usePassword && mode !== "verify") {
    const min = mode === "signup" ? 8 : 1;
    const bad = password.value.length < min;
    setFieldError("password", bad ? (mode === "signup" ? "Use at least 8 characters." : "Enter your password.") : "");
    ok &&= !bad;
  }
  if (code) {
    const bad = !/^\d{6}$/.test(code.value);
    setFieldError("code", bad ? "Enter the 6-digit code from the email." : "");
    ok &&= !bad;
  }
  if (!ok) form?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
  return ok;
}

// Show / hide password.
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-reveal-pw]")) {
  button.addEventListener("click", () => {
    const input = field("password");
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-pressed", String(show));
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
}

// ── /verify ──────────────────────────────────────────────────────────────────────────────
/**
 * The button in the code email opens /verify#email=…&code=…&type=… and signs in with one click.
 * The fragment never reaches the server; it is dropped from the address bar and history at once.
 */
function linkFromMail(): (Pending & { code: string }) | undefined {
  if (mode !== "verify" || location.hash.length < 2) return undefined;
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname + location.search);
  const email = (h.get("email") ?? "").trim();
  const code = h.get("code") ?? "";
  const type = h.get("type") ?? "sign-in";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code) || (type !== "sign-in" && type !== "email-verification")) return undefined;
  // Same tab as the sign-up: keep the name it was started with.
  const stored = readPending();
  return { email, code, purpose: type, ...(stored?.email === email && stored.name ? { name: stored.name } : {}) };
}
const fromMail = linkFromMail();
/** True until the first submit: errors then speak of the link, not of a typed code. */
let viaLink = Boolean(fromMail);
const pending: Pending | undefined = mode === "verify" ? (fromMail ?? readPending()) : undefined;
if (mode === "verify") {
  const emailInput = field("email");
  if (pending && emailInput) {
    emailInput.value = pending.email;
    const box = document.getElementById("email-field");
    if (box) box.hidden = true;
    const sub = document.getElementById("verify-sub");
    if (sub) {
      sub.textContent = "We sent a 6-digit code to ";
      const b = document.createElement("b");
      b.textContent = pending.email;
      sub.append(b, ". It expires in 10 minutes.");
    }
  }
  if (fromMail) {
    const c = field("code");
    if (c) c.value = fromMail.code;
    const sub = document.getElementById("verify-sub");
    if (sub) {
      sub.textContent = fromMail.purpose === "sign-in" ? "Signing you in as " : "Confirming ";
      const b = document.createElement("b");
      b.textContent = fromMail.email;
      sub.append(b, "…");
    }
  }
  const code = field("code");
  code?.addEventListener("input", () => {
    code.value = code.value.replace(/\D/g, "").slice(0, 6);
  });
  const hint = document.getElementById("code-hint");
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-resend]")) {
    link.addEventListener("click", async event => {
      event.preventDefault();
      const address = field("email")?.value.trim() ?? "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        document.getElementById("email-field")?.removeAttribute("hidden");
        setFieldError("email", "Enter the email you signed up with.");
        return;
      }
      if (hint) hint.textContent = "Sending…";
      try {
        const res = await postJson("/api/auth/email-otp/send-verification-otp", { email: address, type: pending?.purpose ?? "sign-in" });
        if (hint) {
          hint.textContent = res.ok
            ? "We sent a new code. Earlier codes no longer work."
            : res.status === 429
              ? "Please wait a minute before asking for another code."
              : "Could not send a new code. Try again in a moment.";
        }
      } catch {
        if (hint) hint.textContent = "Could not reach the server. Check your connection and try again.";
      }
      setFieldError("code", "");
      if (code) {
        code.value = "";
        code.focus();
      }
    });
  }
}

// Clear a field's error as soon as the user edits it.
form?.addEventListener("input", event => {
  const target = event.target as HTMLInputElement;
  if (target.getAttribute("aria-invalid") === "true") setFieldError(target.name, "");
  setFormError("");
});

/** One request per mode and method; what to do with a success is decided by the caller. */
function request(email: string): Promise<Response> {
  if (mode === "verify") {
    const otp = field("code")?.value ?? "";
    // No pending record (direct visit): a sign-in code, the common case.
    return (pending?.purpose ?? "sign-in") === "sign-in"
      ? postJson("/api/auth/sign-in/email-otp", { email, otp, ...(pending?.name ? { name: pending.name } : {}) })
      : postJson("/api/auth/email-otp/verify-email", { email, otp });
  }
  if (!usePassword) return postJson("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
  const password = field("password")?.value ?? "";
  return mode === "signup"
    ? postJson("/api/auth/sign-up/email", { email, password, name: field("name")?.value.trim() ?? "" })
    : postJson("/api/auth/sign-in/email", { email, password });
}

form?.addEventListener("submit", async event => {
  event.preventDefault();
  setFormError("");
  await ready;
  if (!validate()) return;

  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  submit?.classList.add("loading");
  if (submit) submit.disabled = true;

  const email = field("email")?.value.trim() ?? "";
  let leaving = false;
  try {
    const res = await request(email);
    if (res.ok) {
      leaving = true; // keep the spinner while the next page loads
      if (mode !== "verify" && !usePassword) {
        const name = mode === "signup" ? field("name")?.value.trim() : undefined;
        return goVerify({ email, purpose: "sign-in", ...(name ? { name } : {}) });
      }
      // A password sign-up with email confirmation on creates the account but no session yet.
      const data = (await res.json().catch(() => ({}))) as { token?: string | null };
      if (mode === "signup" && data.token === null) return goVerify({ email, purpose: "email-verification" });
      if (mode === "verify") writePending(undefined);
      location.assign(next);
      return;
    }
    const err = await readError(res);
    // A password account that never confirmed its email: the server has just mailed a fresh code.
    if (err.code === "EMAIL_NOT_VERIFIED") {
      leaving = true;
      return goVerify({ email, purpose: "email-verification" });
    }
    const message =
      (err.code && FRIENDLY[err.code]) ||
      err.message ||
      (res.status === 429 ? "Too many attempts. Wait a moment and try again." : "Something went wrong. Please try again.");
    if (viaLink && (err.code === "INVALID_OTP" || err.code === "OTP_EXPIRED"))
      setFieldError("code", "This link was already used or has expired. Send a new code below.");
    else if (mode === "verify" && err.code !== "INVALID_EMAIL") setFieldError("code", message);
    else if (err.code === "PASSWORD_TOO_SHORT") setFieldError("password", message);
    else if (err.code === "INVALID_EMAIL") setFieldError("email", message);
    else setFormError(message);
  } catch {
    setFormError("Could not reach the server. Check your connection and try again.");
  } finally {
    viaLink = false;
    if (!leaving) submit?.classList.remove("loading");
    if (submit && !leaving) submit.disabled = false;
  }
});

// Opened from the email button: submit the code right away (errors show as for a typed code).
if (fromMail) form?.requestSubmit();
