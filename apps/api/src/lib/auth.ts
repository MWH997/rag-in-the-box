import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { organization } from "better-auth/plugins/organization";
import { createDb } from "../db/index.js";
import * as authSchema from "../db/auth-schema.js";
import type { Env } from "../env.js";

export interface AuthHooks {
  /** TICKET-23's admin provisioning route captures the reset link here instead of it being emailed (no email provider is configured/in scope). */
  onSendResetPassword?: (data: { url: string; token: string }) => void;
}

export function createAuth(env: Env, hooks: AuthHooks = {}) {
  const db = createDb(env.DB);

  // Pages (apps/web) and Workers (apps/api) are cross-origin in production, so
  // cookies need sameSite: "none" + secure: true there. Locally both run on
  // http://localhost (different ports, but browsers still refuse to set/send
  // "Secure" cookies without TLS), so dev instead uses sameSite: "lax" +
  // secure: false. We key off BETTER_AUTH_URL's scheme since it's already
  // required to be set correctly per environment (§2.3).
  const isSecureContext = env.BETTER_AUTH_URL.startsWith("https://");

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.ALLOWED_ORIGIN],
    database: drizzleAdapter(db, { provider: "sqlite", schema: authSchema }),
    emailAndPassword: {
      enabled: true,
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
      // Organization auto-provisioning lives entirely in session.create.before
      // rather than user.create.after: better-auth's sign-up flow creates the
      // session immediately after the user, without awaiting the user-create
      // "after" hook first, which raced the org/member inserts against the
      // very first session (it landed with activeOrganizationId still null).
      // Doing the "does this user have an org yet, if not create one" check
      // synchronously right before the session insert removes that race and
      // covers both sign-up (first session) and every later sign-in.
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
                name: `${user?.name || user?.email}'s Organization`,
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

            return {
              data: {
                ...session,
                activeOrganizationId,
              },
            };
          },
        },
      },
    },
  });
}
