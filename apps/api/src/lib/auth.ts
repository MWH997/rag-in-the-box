import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { organization } from "better-auth/plugins/organization";

import { createDb } from "../db/index.js";
import * as authSchema from "../db/auth-schema.js";
import { allowedOrigins, envInt, type Env } from "../env.js";
import { FREE_TIER_ITERATIONS, hashPassword, verifyPassword } from "./password.js";

export interface AuthHooks {
  /**
   * The admin provisioning route captures the password-reset link here rather
   * than sending it by email. No email provider is configured, and the operator
   * hands the link to the new tenant directly.
   */
  onSendResetPassword?: (data: { url: string; token: string }) => void;
}

export function createAuth(env: Env, hooks: AuthHooks = {}) {
  const db = createDb(env.DB);

  // Pages and Workers are cross-origin in production, so the session cookie
  // needs sameSite "none" with secure true there. Locally both run over plain
  // http on localhost, where browsers refuse to store a Secure cookie, so dev
  // uses sameSite "lax" without secure. BETTER_AUTH_URL's scheme decides which,
  // since it already has to be set correctly per environment.
  const isSecureContext = env.BETTER_AUTH_URL.startsWith("https://");

  // See src/lib/password.ts for why this is not better-auth's default scrypt.
  const iterations = envInt(env.PASSWORD_KDF_ITERATIONS, FREE_TIER_ITERATIONS);

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: allowedOrigins(env),
    database: drizzleAdapter(db, { provider: "sqlite", schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      password: {
        hash: (password) => hashPassword(password, iterations),
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
      sendResetPassword: async ({ url, token }) => {
        hooks.onSendResetPassword?.({ url, token });
      },
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: isSecureContext ? "none" : "lax",
        secure: isSecureContext,
      },
    },
    plugins: [organization()],
    databaseHooks: {
      // Organization auto-provisioning lives in session.create.before rather
      // than user.create.after. Better-auth's sign-up flow creates the session
      // immediately after the user without awaiting the user-create "after"
      // hook, which raced the org and member inserts and left the first session
      // with a null activeOrganizationId. Doing the "does this user have an org
      // yet" check synchronously right before the session insert removes the
      // race and covers sign-up and every later sign-in with one code path.
      session: {
        create: {
          before: async (session) => {
            const [membership] = await db
              .select({ organizationId: authSchema.member.organizationId })
              .from(authSchema.member)
              .where(eq(authSchema.member.userId, session.userId))
              .limit(1);

            let activeOrganizationId = membership?.organizationId;

            if (!activeOrganizationId) {
              const [user] = await db
                .select({ name: authSchema.user.name, email: authSchema.user.email })
                .from(authSchema.user)
                .where(eq(authSchema.user.id, session.userId))
                .limit(1);

              activeOrganizationId = crypto.randomUUID();
              await db.insert(authSchema.organization).values({
                id: activeOrganizationId,
                name: `${user?.name || user?.email}'s workspace`,
                slug: `org-${session.userId}`,
                createdAt: new Date(),
              });
              await db.insert(authSchema.member).values({
                id: crypto.randomUUID(),
                organizationId: activeOrganizationId,
                userId: session.userId,
                role: "owner",
                createdAt: new Date(),
              });
            }

            return { data: { ...session, activeOrganizationId } };
          },
        },
      },
    },
  });
}
