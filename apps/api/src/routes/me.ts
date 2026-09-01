import { Hono } from "hono";
import { eq } from "drizzle-orm";

import { organization, user } from "../db/schema.js";
import { loadSettings } from "../lib/settings.js";
import type { AppEnv } from "../middleware/tenant.js";

export const meRoute = new Hono<AppEnv>();

meRoute.get("/me", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");
  const settings = await loadSettings(db, c.env, tenant.tenantId);

  if (tenant.mode === "demo") {
    return c.json({
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: "",
      organizationName: "Demo visitor",
      tier: settings.tier,
    });
  }

  const [account] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, tenant.userId))
    .limit(1);

  const [workspace] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, tenant.tenantId))
    .limit(1);

  return c.json({
    userId: tenant.userId,
    tenantId: tenant.tenantId,
    email: account?.email ?? "",
    organizationName: workspace?.name ?? "Workspace",
    tier: settings.tier,
  });
});
