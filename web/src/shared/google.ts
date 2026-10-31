// "Continue with Google" and the sign-in options, shared by the auth pages and the marketing page.

export interface AuthOptions {
  /** Email codes are delivered (sign-in without a password). */
  codes?: boolean;
  /** Present when "Continue with Google" is configured; it only works on this origin. */
  google?: { origin: string };
}

/** Answered by the Worker at the edge (cloudflare/worker.ts), so it does not wait for the container. */
export async function loadAuthOptions(): Promise<AuthOptions | undefined> {
  try {
    const res = await fetch("/api/auth-options", { headers: { accept: "application/json" } });
    return res.ok ? ((await res.json()) as AuthOptions) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sends the browser to Google. On another origin (workers.dev) Google would return to the canonical
 * one, so the user goes to `fallbackPath` there first. Resolves with an error message on failure.
 */
export async function startGoogle(
  google: { origin: string },
  opts: { callbackURL: string; errorCallbackURL: string; fallbackPath: string },
): Promise<string> {
  if (google.origin !== location.origin) {
    location.assign(google.origin + opts.fallbackPath);
    return "";
  }
  try {
    const res = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: opts.callbackURL, errorCallbackURL: opts.errorCallbackURL }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
    if (res.ok && body.url) {
      location.assign(body.url);
      return "";
    }
    return body.message || "Google sign-in is not available right now. Use your email instead.";
  } catch {
    return "Could not reach the server. Check your connection and try again.";
  }
}
