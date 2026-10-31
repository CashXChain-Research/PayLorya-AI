import { initChrome } from "../shared/nav.js";

initChrome();

type Mode = "login" | "signup";

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
};

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

  const body: Record<string, string> = {
    email: field("email")?.value.trim() ?? "",
    password: field("password")?.value ?? "",
  };
  if (mode === "signup") body.name = field("name")?.value.trim() ?? "";

  let leaving = false;
  try {
    const res = await fetch(mode === "signup" ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      leaving = true; // keep the spinner while the dashboard loads
      location.assign(next);
      return;
    }
    let err: ApiError = {};
    try {
      err = (await res.json()) as ApiError;
    } catch {
      // non-JSON error body
    }
    const message =
      (err.code && FRIENDLY[err.code]) ||
      err.message ||
      (res.status === 429 ? "Too many attempts. Wait a moment and try again." : "Something went wrong. Please try again.");
    if (err.code === "PASSWORD_TOO_SHORT") setFieldError("password", message);
    else if (err.code === "INVALID_EMAIL") setFieldError("email", message);
    else setFormError(message);
  } catch {
    setFormError("Could not reach the server. Check your connection and try again.");
  } finally {
    if (!leaving) submit?.classList.remove("loading");
    if (submit && !leaving) submit.disabled = false;
  }
});
