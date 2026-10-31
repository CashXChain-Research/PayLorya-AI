import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;

/** Email + password accounts on the shared SQLite database. Creates the auth tables on start. */
export async function createAuth(db: DatabaseSync, opts: { baseUrl: string; secret?: string }) {
  const secret = opts.secret ?? randomBytes(32).toString("hex");
  if (!opts.secret) console.warn("BETTER_AUTH_SECRET not set: using a random secret, sessions end on restart");
  const options = {
    database: db,
    secret,
    baseURL: opts.baseUrl,
    trustedOrigins: [opts.baseUrl],
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
    session: { expiresIn: 60 * 60 * 24 * 14 },
  } satisfies BetterAuthOptions;
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  const auth = betterAuth(options);
  return {
    auth,
    async userFrom(headers: IncomingHttpHeaders): Promise<SessionUser | undefined> {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
      if (!session) return undefined;
      return { id: session.user.id, name: session.user.name, email: session.user.email };
    },
  };
}
