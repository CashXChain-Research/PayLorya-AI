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
}

void reflectSession();
