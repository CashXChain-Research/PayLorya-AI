import { createHash } from "node:crypto";

export type CodePurpose = "email-verification" | "sign-in" | "forget-password" | "change-email";

/** Sends one-time codes. Production: Resend. Tests: an in-memory fake. */
export interface Mailer {
  sendCode(to: string, code: string, purpose: CodePurpose): Promise<void>;
}

export const PRODUCT = "PayFlow AI";
const RESEND_API = "https://api.resend.com/emails";

const COPY: Record<CodePurpose, { subject: string; lead: string }> = {
  "email-verification": { subject: "confirm your email", lead: `Welcome to ${PRODUCT}. Enter this code to confirm your email address:` },
  "sign-in": { subject: "your sign-in code", lead: `Enter this code to sign in to ${PRODUCT}:` },
  "forget-password": { subject: "reset your password", lead: `Enter this code to reset your ${PRODUCT} password:` },
  "change-email": { subject: "confirm your new email", lead: `Enter this code to confirm your new ${PRODUCT} email address:` },
};

export function codeEmail(code: string, purpose: CodePurpose, minutes: number) {
  const { subject, lead } = COPY[purpose];
  const ignore = "If you did not ask for this, ignore this email; nothing happens without the code.";
  const text = `${lead}\n\n${code}\n\nThe code expires in ${minutes} minutes. ${ignore}\n\n${PRODUCT}`;
  // Inline styles only: mail clients drop <style>. The code is digits, nothing else is user input.
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf7f2;font-family:Manrope,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2328">
<table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
<tr><td style="font-size:18px;font-weight:800;color:#1f2328;padding-bottom:16px;border-bottom:3px solid #e8553a">PayFlow <span style="color:#c2410c">AI</span></td></tr>
<tr><td style="height:16px"></td></tr>
<tr><td style="font-size:15px;line-height:1.5;padding-bottom:16px">${lead}</td></tr>
<tr><td style="font-size:32px;font-weight:700;letter-spacing:8px;color:#1f2328;padding:12px 0 20px;font-family:SFMono-Regular,Menlo,Consolas,monospace">${code}</td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#555">The code expires in ${minutes} minutes. ${ignore}</td></tr>
</table></body></html>`;
  return { subject: `${code} is your ${PRODUCT} code: ${subject}`, text, html };
}

/** Resend over its REST API (the same call the CashXChain backend makes in notify.rs). */
export function resendMailer(opts: { apiKey: string; from: string; expiresMinutes: number; fetch?: typeof fetch }): Mailer {
  const send = opts.fetch ?? fetch;
  return {
    async sendCode(to, code, purpose) {
      const mail = codeEmail(code, purpose, opts.expiresMinutes);
      const res = await send(RESEND_API, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
          // Resend dedupes on this for 24 h: a retried request does not mail the same code twice.
          "idempotency-key": `payflow-code-${createHash("sha256").update(`${to}|${purpose}|${code}`).digest("hex").slice(0, 32)}`,
        },
        body: JSON.stringify({ from: opts.from, to: [to], subject: mail.subject, text: mail.text, html: mail.html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}
