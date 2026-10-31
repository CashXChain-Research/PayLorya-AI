import { loadAuthOptions, startGoogle } from "../shared/google.js";
import { initChrome, initScrollReveal } from "../shared/nav.js";

initChrome();
initScrollReveal();

interface SessionResponse {
  user?: { name?: string; email?: string } | null;
}

/** Signed-in visitors get "Open dashboard" instead of the sign-up CTAs; "Log in" is hidden. */
async function reflectSession(): Promise<void> {
  try {
    const res = await fetch("/api/auth/get-session", { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!res.ok) return;
    const data = (await res.json()) as SessionResponse | null;
    if (!data?.user) return;
  } catch {
    return; // auth unavailable: keep the signed-out CTAs
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-auth-cta]")) {
    link.href = "/app";
    const label = link.querySelector("span");
    (label ?? link).textContent = "Open dashboard";
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-auth-hide]")) el.hidden = true;
  const quick = document.querySelector<HTMLElement>("[data-quick-auth]");
  const signedIn = document.querySelector<HTMLElement>("[data-quick-signed-in]");
  if (quick && signedIn) {
    quick.hidden = true;
    signedIn.hidden = false;
  }
}

void reflectSession();

// ── Hero sign-up: email code or Google, without leaving the page ───────────────────────────
const quick = document.querySelector<HTMLFormElement>("form[data-quick-auth]");
const quickEmail = quick?.querySelector<HTMLInputElement>('input[name="email"]');
const quickErr = quick?.querySelector<HTMLElement>(".quick-err");
const quickGoogle = quick?.querySelector<HTMLButtonElement>("[data-quick-google]");
/** Read by /verify (web/src/auth/main.ts): where the code went. Same tab only, never in the URL. */
const PENDING_KEY = "paylorya-verify";

function quickError(message: string): void {
  if (!quickErr) return;
  quickErr.textContent = message;
  quickErr.hidden = !message;
}

const options = quick ? loadAuthOptions() : Promise.resolve(undefined);

void options.then(o => {
  if (!o?.google || !quickGoogle) return;
  const google = o.google;
  quickGoogle.hidden = false;
  quickGoogle.addEventListener("click", async () => {
    quickError("");
    quickGoogle.disabled = true;
    quickGoogle.classList.add("loading");
    const error = await startGoogle(google, { callbackURL: "/app", errorCallbackURL: "/login?error=google", fallbackPath: "/login" });
    if (error) {
      quickError(error);
      quickGoogle.disabled = false;
      quickGoogle.classList.remove("loading");
    }
  });
});

quickEmail?.addEventListener("input", () => quickError(""));

quick?.addEventListener("submit", async event => {
  event.preventDefault();
  const email = quickEmail?.value.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    quickError("Enter a valid email address.");
    quickEmail?.focus();
    return;
  }
  const o = await options;
  // No email codes on this server: the sign-up page asks for a password.
  if (o && !o.codes) {
    location.assign(`/signup?email=${encodeURIComponent(email)}`);
    return;
  }
  const button = quick.querySelector<HTMLButtonElement>('button[type="submit"]');
  button?.classList.add("loading");
  if (button) button.disabled = true;
  try {
    // Signs in, or creates the account on first use.
    const res = await fetch("/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email, type: "sign-in" }),
    });
    if (res.ok) {
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ email, purpose: "sign-in" }));
      } catch {
        // /verify then asks for the email again
      }
      location.assign("/verify");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    quickError(res.status === 429 ? "Too many attempts. Wait a moment and try again." : body.message || "Something went wrong. Please try again.");
  } catch {
    quickError("Could not reach the server. Check your connection and try again.");
  }
  button?.classList.remove("loading");
  if (button) button.disabled = false;
});
