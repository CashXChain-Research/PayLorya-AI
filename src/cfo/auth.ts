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
 * Email + password accounts in the AI CFO database. Its tables come from db.ts migrations.
 * With a mailer, a new account must confirm its email with a 6-digit code before it gets a session:
 * sign-up mails the code, a sign-in while unconfirmed mails a fresh one, and
 * POST /api/auth/email-otp/verify-email signs the user in. Without a mailer nothing changes.
 */
export function createAuth(sql: Sql, opts: { baseUrl: string; secret?: string; mailer?: Mailer }) {
  const mailer = opts.mailer;
  const secret = opts.secret ?? randomBytes(32).toString("hex");
  if (!opts.secret) console.warn("BETTER_AUTH_SECRET not set: using a random secret, sessions end on restart");
  const auth = betterAuth({
    database: { dialect: sqlDialect(sql), type: "sqlite" },
    secret,
    baseURL: opts.baseUrl,
    trustedOrigins: [opts.baseUrl],
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
        // Codes confirm or sign in existing accounts; new accounts come only from the sign-up form.
        disableSignUp: true,
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
    async userFrom(headers: IncomingHttpHeaders): Promise<SessionUser | undefined> {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
      if (!session) return undefined;
      return { id: session.user.id, name: session.user.name, email: session.user.email };
    },
  };
}
