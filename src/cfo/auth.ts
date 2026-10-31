import { randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth } from "better-auth";
import { fromNodeHeaders } from "better-auth/node";
import { sqlDialect, type Sql } from "./sql.js";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export type Auth = ReturnType<typeof createAuth>;

/** Email + password accounts in the AI CFO database. Its tables come from db.ts migrations. */
export function createAuth(sql: Sql, opts: { baseUrl: string; secret?: string }) {
  const secret = opts.secret ?? randomBytes(32).toString("hex");
  if (!opts.secret) console.warn("BETTER_AUTH_SECRET not set: using a random secret, sessions end on restart");
  const auth = betterAuth({
    database: { dialect: sqlDialect(sql), type: "sqlite" },
    secret,
    baseURL: opts.baseUrl,
    trustedOrigins: [opts.baseUrl],
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
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
