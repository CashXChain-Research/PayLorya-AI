import { initChrome } from "../shared/nav.js";

initChrome();

type Mode = "login" | "signup" | "verify";

interface ApiError {
  message?: string;
  code?: string;
}

const form = document.querySelector<HTMLFormElement>("form[data-auth]");
const mode = form?.dataset.auth as Mode | undefined;

/** Only same-site dashboard paths are honoured as a post-auth target. */
function nextTarget(): string {
  const next = new URLSearchParams(location.search).get("next") ?? "";
  return /^\/app(?:[/?#]|$)/.test(next) ? next : "/app";
}

// The address a code was mailed to, handed from sign-up/login to /verify. Kept out of the URL.
const VERIFY_EMAIL_KEY = "payflow-verify-email";

function storedEmail(): string {
  try {
    return sessionStorage.getItem(VERIFY_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeEmail(email: string | undefined): void {
  try {
    if (email) sessionStorage.setItem(VERIFY_EMAIL_KEY, email);
    else sessionStorage.removeItem(VERIFY_EMAIL_KEY);
  } catch {
    // storage blocked: /verify asks for the email
  }
}

/** The server mailed a code (Resend configured): continue on the confirmation page. */
function goVerify(email: string): void {
  storeEmail(email);
  location.assign(next === "/app" ? "/verify" : `/verify?next=${encodeURIComponent(next)}`);
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
    ok &&= !bad;
  }
  if (password) {
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

// /verify: prefill the address the code went to, keep the code field digits-only, offer a new code.
if (mode === "verify") {
  const email = storedEmail();
  const emailInput = field("email");
  if (email && emailInput) {
    emailInput.value = email;
    const box = document.getElementById("email-field");
    if (box) box.hidden = true;
    const sub = document.getElementById("verify-sub");
    if (sub) {
      sub.textContent = "We sent a 6-digit code to ";
      const b = document.createElement("b");
      b.textContent = email;
      sub.append(b, ". It expires in 10 minutes.");
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
        const res = await fetch("/api/auth/email-otp/send-verification-otp", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ email: address, type: "email-verification" }),
        });
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

form?.addEventListener("submit", async event => {
  event.preventDefault();
  setFormError("");
  if (!validate()) return;

  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  submit?.classList.add("loading");
  if (submit) submit.disabled = true;

  const email = field("email")?.value.trim() ?? "";
  const body: Record<string, string> =
    mode === "verify" ? { email, otp: field("code")?.value ?? "" } : { email, password: field("password")?.value ?? "" };
  if (mode === "signup") body.name = field("name")?.value.trim() ?? "";
  const endpoint =
    mode === "verify" ? "/api/auth/email-otp/verify-email" : mode === "signup" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email";

  let leaving = false;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      leaving = true; // keep the spinner while the next page loads
      // With email confirmation on, sign-up creates the account but no session: the code comes next.
      const data = (await res.json().catch(() => ({}))) as { token?: string | null };
      if (mode === "signup" && data.token === null) return goVerify(email);
      if (mode === "verify") storeEmail(undefined);
      location.assign(next);
      return;
    }
    const err = await readError(res);
    // Unconfirmed account: the server has just mailed a fresh code.
    if (err.code === "EMAIL_NOT_VERIFIED") {
      leaving = true;
      return goVerify(email);
    }
    const message =
      (err.code && FRIENDLY[err.code]) ||
      err.message ||
      (res.status === 429 ? "Too many attempts. Wait a moment and try again." : "Something went wrong. Please try again.");
    if (mode === "verify" && err.code !== "INVALID_EMAIL") setFieldError("code", message);
    else if (err.code === "PASSWORD_TOO_SHORT") setFieldError("password", message);
    else if (err.code === "INVALID_EMAIL") setFieldError("email", message);
    else setFormError(message);
  } catch {
    setFormError("Could not reach the server. Check your connection and try again.");
  } finally {
    if (!leaving) submit?.classList.remove("loading");
    if (submit && !leaving) submit.disabled = false;
  }
});
