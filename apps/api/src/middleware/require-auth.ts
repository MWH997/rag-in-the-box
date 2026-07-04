import { createMiddleware } from "hono/factory";
import type { Env } from "../env.js";
import { createAuth } from "../lib/auth.js";

export type AuthVariables = {
  tenantId: string;
  userId: string;
};

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(
  async (c, next) => {
    const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      return c.json({ error: { code: "unauthorized", message: "Sign in required" } }, 401);
    }

    if (!session.session.activeOrganizationId) {
      return c.json(
        { error: { code: "no_active_organization", message: "No active organization" } },
        403,
      );
    }

    c.set("userId", session.user.id);
    c.set("tenantId", session.session.activeOrganizationId);

    await next();
  },
);
