import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Env } from "../env.js";
import { createAuth } from "../lib/auth.js";
import { createDb } from "../db/index.js";
import { member, organization } from "../db/schema.js";
import { secureCompare } from "../lib/secure-compare.js";

export const adminRoute = new Hono<{ Bindings: Env }>();

const ProvisionRequest = z.object({
  email: z.email(),
  orgName: z.string().min(1).max(100),
});

adminRoute.post("/admin/provision", async (c) => {
  const authHeader = c.req.header("Authorization");
  const providedToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : undefined;

  if (!secureCompare(providedToken, c.env.ADMIN_TOKEN)) {
    return c.json({ error: "Invalid admin token", code: "unauthorized" }, 401);
  }

  // Self-serve tenant creation has no place on the public demo deployment.
  if (c.env.APP_MODE === "demo") {
    return c.json({ error: "Provisioning is disabled on the demo.", code: "demo_disabled" }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = ProvisionRequest.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", code: "invalid_request", details: parsed.error.issues },
      422,
    );
  }

  let resetLink: string | undefined;
  const auth = createAuth(c.env, {
    onSendResetPassword: ({ url }) => {
      resetLink = url;
    },
  });

  // A random throwaway password: this account is only ever accessed via the
  // one-time reset link below, never by signing in with this password.
  const temporaryPassword = crypto.randomUUID();
  const signUpResult = await auth.api.signUpEmail({
    body: { email: parsed.data.email, password: temporaryPassword, name: parsed.data.orgName },
  });

  // signUpEmail's session-create hook (src/lib/auth.ts) already provisioned
  // a default-named organization for the new user; rename it to the
  // requested orgName instead of duplicating that provisioning logic here.
  const db = createDb(c.env.DB);
  const [membership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, signUpResult.user.id))
    .limit(1);

  if (membership) {
    await db
      .update(organization)
      .set({ name: parsed.data.orgName })
      .where(eq(organization.id, membership.organizationId));
  }

  // The link lands on the interface, not on the API, because that is where the
  // form for choosing a password lives.
  await auth.api.requestPasswordReset({
    body: {
      email: parsed.data.email,
      redirectTo: `${c.env.ALLOWED_ORIGIN.split(",")[0]?.trim() ?? ""}/reset-password`,
    },
  });

  if (!resetLink) {
    return c.json({ error: "Could not generate invite link", code: "internal_error" }, 500);
  }

  return c.json({
    userId: signUpResult.user.id,
    email: parsed.data.email,
    organizationId: membership?.organizationId,
    inviteUrl: resetLink,
  });
});
