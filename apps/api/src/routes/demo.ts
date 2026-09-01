import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";

import { isDemo } from "../env.js";
import { documents } from "../db/schema.js";
import { readQuota } from "../lib/quota.js";
import { nextUtcMidnight } from "../lib/time.js";
import { demoLimits, demoTenantId, type AppEnv } from "../middleware/tenant.js";

export const demoRoute = new Hono<AppEnv>();

/**
 * Quota state for the banner.
 *
 * This endpoint only reads counters, so polling it never consumes allowance.
 * It reports the visitor's own budget and the deployment-wide one separately,
 * because the message a reader needs is different: one means come back
 * tomorrow, the other means the demo is busy today.
 */
demoRoute.get("/demo/status", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");

  if (!isDemo(c.env)) {
    return c.json({
      quota: {
        allowed: true,
        reason: null,
        visitor: { used: 0, limit: 0 },
        global: { used: 0, limit: 0 },
        resetsAt: nextUtcMidnight(),
      },
      featuredDocumentId: null,
      uploadsEnabled: true,
    });
  }

  const limits = demoLimits(c.env);
  const [visitor, global] = await readQuota(db, [
    {
      scope: "visitor",
      key: tenant.quotaKeys.visitor,
      metric: "chat",
      limit: limits.visitorChats,
    },
    { scope: "global", key: tenant.quotaKeys.global, metric: "chat", limit: limits.globalChats },
  ]);

  const [featured] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.tenantId, demoTenantId(c.env)), eq(documents.status, "active")))
    .orderBy(asc(documents.createdAt))
    .limit(1);

  const globalExhausted = !global?.allowed;
  const visitorExhausted = !visitor?.allowed;

  return c.json({
    quota: {
      allowed: !globalExhausted && !visitorExhausted,
      reason: globalExhausted
        ? "The demo has used its shared free allowance for today. It resets at midnight UTC."
        : visitorExhausted
          ? "You have used your questions for today. They reset at midnight UTC."
          : null,
      visitor: { used: visitor?.used ?? 0, limit: visitor?.limit ?? 0 },
      global: { used: global?.used ?? 0, limit: global?.limit ?? 0 },
      resetsAt: visitor?.resetsAt ?? nextUtcMidnight(),
    },
    featuredDocumentId: featured?.id ?? null,
    uploadsEnabled: limits.uploadsEnabled,
  });
});
