import { createHash } from "node:crypto";

export type CodePurpose = "email-verification" | "sign-in" | "forget-password" | "change-email";

/** Sends one-time codes. Production: Resend. Tests: an in-memory fake. */
export interface Mailer {
  sendCode(to: string, code: string, purpose: CodePurpose): Promise<void>;
}

export const PRODUCT = "PayLorya AI";
/** Footer of every mail, worded as on /legal: "PayLorya AI is a product of CashXChain Inc." */
export const COMPANY = { name: "CashXChain Inc.", url: "https://cashxchain.com" };

/**
 * Mail colors and font, mirroring the base.css tokens (--primary, --accent, --font). Mail clients
 * ignore CSS variables, so the values live here once; change them together with base.css.
 */
export const MAIL_THEME = {
  primary: "#1f2328",
  accent: "#c2410c",
  ink: "#1f2328",
  muted: "#5f6368",
  page: "#faf7f2",
  card: "#ffffff",
  font: "Manrope,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
};
const RESEND_API = "https://api.resend.com/emails";

const COPY: Record<CodePurpose, { subject: string; lead: string; button?: string; linkLead?: string }> = {
  "email-verification": {
    subject: "confirm your email",
    lead: `Welcome to ${PRODUCT}. Enter this code to confirm your email address:`,
    button: "Confirm my email",
    linkLead: `Welcome to ${PRODUCT}. Confirm your email address with one click:`,
  },
  "sign-in": {
    subject: "your sign-in code",
    lead: `Enter this code to sign in to ${PRODUCT}. New here? The same code creates your account.`,
    button: `Sign in to ${PRODUCT}`,
    linkLead: `Sign in to ${PRODUCT} with one click. New here? The same link creates your account.`,
  },
  "forget-password": { subject: "reset your password", lead: `Enter this code to reset your ${PRODUCT} password:` },
  "change-email": { subject: "confirm your new email", lead: `Enter this code to confirm your new ${PRODUCT} email address:` },
};

/** Logo in the mail: the app icon (opaque tile, so it also reads in dark-mode mail apps). */
export const LOGO_PATH = "/apple-touch-icon.png?v=3";

/**
 * One-click link for sign-in and email confirmation: /verify reads email, code and type from the
 * fragment (never sent to the server, dropped from the address bar on load) and submits the code.
 * Password reset and email change have no link; they need input on the page.
 */
export function codeLink(baseUrl: string, to: string, code: string, purpose: CodePurpose): string | undefined {
  if (purpose !== "sign-in" && purpose !== "email-verification") return undefined;
  return `${baseUrl.replace(/\/+$/, "")}/verify#${new URLSearchParams({ email: to, code, type: purpose })}`;
}

const attr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** With a baseUrl the mail shows the logo and, for sign-in and email confirmation, a one-click link. */
export function codeEmail(code: string, purpose: CodePurpose, minutes: number, opts: { baseUrl?: string; to?: string } = {}) {
  const copy = COPY[purpose];
  const base = opts.baseUrl?.replace(/\/+$/, "");
  const link = base && opts.to ? codeLink(base, opts.to, code, purpose) : undefined;
  const lead = link && copy.linkLead ? copy.linkLead : copy.lead;
  const ignore = `If you did not ask for this, ignore this email; nothing happens without the ${link ? "link or code" : "code"}.`;
  const footerText = `${PRODUCT}${base ? ` · ${base}` : ""}\nA product of ${COMPANY.name} · ${COMPANY.url}`;
  const text = link
    ? `${lead}\n\n${link}\n\nOr enter this code: ${code}\n\nThe link and code expire in ${minutes} minutes. ${ignore}\n\n${footerText}`
    : `${lead}\n\n${code}\n\nThe code expires in ${minutes} minutes. ${ignore}\n\n${footerText}`;
  // Inline styles only: mail clients drop <style>. The code is digits; the only user input is the
  // recipient address, percent-encoded inside the link and attribute-escaped.
  const t = MAIL_THEME;
  const logo = base
    ? `<img src="${attr(base + LOGO_PATH)}" width="36" height="36" alt="" style="display:inline-block;vertical-align:middle;border:0;border-radius:9px;margin-right:10px">`
    : "";
  const codeCell = `font-size:32px;font-weight:700;letter-spacing:8px;color:${t.primary};font-family:SFMono-Regular,Menlo,Consolas,monospace`;
  const body = link
    ? `<tr><td style="font-size:15px;line-height:1.5;padding-bottom:20px">${lead}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${attr(link)}" style="display:inline-block;background:${t.primary};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:10px">${copy.button}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:${t.muted};padding-bottom:4px">Or enter this code:</td></tr>
<tr><td style="${codeCell};padding:4px 0 20px">${code}</td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:${t.muted}">The link and code expire in ${minutes} minutes. ${ignore}</td></tr>`
    : `<tr><td style="font-size:15px;line-height:1.5;padding-bottom:16px">${lead}</td></tr>
<tr><td style="${codeCell};padding:12px 0 20px">${code}</td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:${t.muted}">The code expires in ${minutes} minutes. ${ignore}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:${t.page};font-family:${t.font};color:${t.ink}">
<table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:${t.card};border-radius:12px;padding:28px">
<tr><td style="font-size:18px;font-weight:700;color:${t.primary};padding-bottom:16px;border-bottom:3px solid ${t.accent}">${logo}<span style="vertical-align:middle">PayLorya <span style="color:${t.accent}">AI</span></span></td></tr>
<tr><td style="height:16px"></td></tr>
${body}
</table>
<table role="presentation" width="100%" style="max-width:480px;margin:16px auto 0">
<tr><td style="font-size:12px;line-height:1.6;color:${t.muted};text-align:center">${
    base ? `<a href="${attr(base)}/" style="color:${t.primary};font-weight:600;text-decoration:none">${PRODUCT}</a>` : PRODUCT
  } is a product of <a href="${COMPANY.url}" style="color:${t.muted};text-decoration:underline">${COMPANY.name}</a></td></tr>
</table></body></html>`;
  return { subject: `${code} is your ${PRODUCT} code: ${copy.subject}`, text, html };
}

/** Resend over its REST API (the same call the CashXChain backend makes in notify.rs). */
export function resendMailer(opts: {
  apiKey: string;
  from: string;
  expiresMinutes: number;
  /** Public URL of the app (PUBLIC_BASE_URL): logo and one-click link in the mail. */
  baseUrl?: string;
  fetch?: typeof fetch;
}): Mailer {
  const send = opts.fetch ?? fetch;
  return {
    async sendCode(to, code, purpose) {
      const mail = codeEmail(code, purpose, opts.expiresMinutes, { baseUrl: opts.baseUrl, to });
      const res = await send(RESEND_API, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
          // Resend dedupes on this for 24 h: a retried request does not mail the same code twice.
          "idempotency-key": `paylorya-code-${createHash("sha256").update(`${to}|${purpose}|${code}`).digest("hex").slice(0, 32)}`,
        },
        body: JSON.stringify({ from: opts.from, to: [to], subject: mail.subject, text: mail.text, html: mail.html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}
