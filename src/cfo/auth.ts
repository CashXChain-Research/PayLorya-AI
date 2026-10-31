import { randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth } from "better-auth";
import { fromNodeHeaders } from "better-auth/node";
import { emailOTP } from "better-auth/plugins/email-otp";
import type { Mailer } from "./mail.js";
import { sqlDialect, type Sql } from "./sql.js";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export type Auth = ReturnType<typeof createAuth>;

/** How long an emailed code stays valid. */
export const CODE_MINUTES = 10;

/**
 * Accounts in the AI CFO database (tables from db.ts migrations).
 *
 * With a mailer, signing up and signing in work with a 6-digit email code by default
 * (/api/auth/email-otp/send-verification-otp type "sign-in", then /api/auth/sign-in/email-otp,
 * which creates the account on first use). A password is optional: an account created with one
 * confirms its email with a code first (/api/auth/email-otp/verify-email), and a code-only account
 * can add one later (setPassword). Without a mailer: email + password only, as before.
 */
export function createAuth(sql: Sql, opts: { baseUrl: string; trustedOrigins?: string[]; secret?: string; mailer?: Mailer }) {
  const mailer = opts.mailer;
  const secret = opts.secret ?? randomBytes(32).toString("hex");
  if (!opts.secret) console.warn("BETTER_AUTH_SECRET not set: using a random secret, sessions end on restart");
  const auth = betterAuth({
    database: { dialect: sqlDialect(sql), type: "sqlite" },
    secret,
    baseURL: opts.baseUrl,
    trustedOrigins: [opts.baseUrl, ...(opts.trustedOrigins ?? [])],
    // Better Auth skips the Origin check when NODE_ENV is "test"; keep it on so tests see production.
    advanced: { disableOriginCheck: false },
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true, requireEmailVerification: Boolean(mailer) },
    emailVerification: { sendOnSignUp: Boolean(mailer), sendOnSignIn: Boolean(mailer), autoSignInAfterVerification: true },
    plugins: [
      emailOTP({
        // The code replaces Better Auth's verification link.
        overrideDefaultEmailVerification: true,
        otpLength: 6,
        expiresIn: CODE_MINUTES * 60,
        allowedAttempts: 5,
        storeOTP: "hashed",
        // A code for an unknown email creates the account (sign-up without a password).
        disableSignUp: false,
        async sendVerificationOTP({ email, otp, type }) {
          if (!mailer) return;
          // Never fail the request on a mail error: the account exists and the user can ask for a new code.
          await mailer.sendCode(email, otp, type).catch(error => {
            console.error(`verification mail (${type}) not sent: ${error instanceof Error ? error.message : String(error)}`);
          });
        },
      }),
    ],
    // The session is re-read from the database at most every 5 minutes; in between a signed cookie
    // vouches for it. Saves database round trips on every request; a sign-out elsewhere takes effect
    // within those 5 minutes.
    session: { expiresIn: 60 * 60 * 24 * 14, cookieCache: { enabled: true, maxAge: 5 * 60 } },
  });
  return {
    auth,
    /** Whether email codes can be delivered (sign-in by code is offered). */
    codes: Boolean(mailer),
    async hasPassword(headers: IncomingHttpHeaders): Promise<boolean> {
      const accounts = await auth.api.listUserAccounts({ headers: fromNodeHeaders(headers) });
      return accounts.some(a => a.providerId === "credential");
    },
    /** Adds a password to a code-only account, or changes it when currentPassword is given. */
    async setPassword(headers: IncomingHttpHeaders, newPassword: string, currentPassword?: string): Promise<void> {
      const h = fromNodeHeaders(headers);
      if (currentPassword) await auth.api.changePassword({ body: { currentPassword, newPassword }, headers: h });
      else await auth.api.setPassword({ body: { newPassword }, headers: h });
    },
    async userFrom(headers: IncomingHttpHeaders): Promise<SessionUser | undefined> {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
      if (!session) return undefined;
      return { id: session.user.id, name: session.user.name, email: session.user.email };
    },
  };
}
