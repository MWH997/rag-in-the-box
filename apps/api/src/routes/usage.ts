import { FREE_NEURONS_PER_DAY, TIER_LIMITS, type UsageDay } from "@rag/shared";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";

import { indexDimensions } from "../env.js";
import { documents } from "../db/schema.js";
import { loadSettings } from "../lib/settings.js";
import { lastNUtcDays, utcDay } from "../lib/time.js";
import { METRICS, readUsage } from "../lib/usage.js";
import type { AppEnv } from "../middleware/tenant.js";

export const usageRoute = new Hono<AppEnv>();

/** Cloudflare's free Vectorize allowance, in stored vector dimensions. */
const FREE_STORED_VECTOR_DIMENSIONS = 5_000_000;
/** Cloudflare's free D1 allowance for rows written per day. */
const FREE_D1_ROWS_WRITTEN_PER_DAY = 100_000;

usageRoute.get("/usage", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");
  const settings = await loadSettings(db, c.env, tenant.tenantId);
  const limits = TIER_LIMITS[settings.tier];

  const days = lastNUtcDays(14);
  const byDay = await readUsage(db, tenant.tenantId, days);

  const toDay = (day: string): UsageDay => {
    const values = byDay[day] ?? {};
    return {
      day,
      chatMessages: Math.round(values[METRICS.chatMessages] ?? 0),
      documentsIngested: Math.round(values[METRICS.documentsIngested] ?? 0),
      embeddingTokens: Math.round(values[METRICS.embeddingTokens] ?? 0),
      chatTokens: Math.round(
        (values[METRICS.chatPromptTokens] ?? 0) + (values[METRICS.chatCompletionTokens] ?? 0),
      ),
      neurons: Number((values[METRICS.neurons] ?? 0).toFixed(2)),
      externalCostUsd: Number((values[METRICS.externalCostUsd] ?? 0).toFixed(4)),
    };
  };

  const [stored] = await db
    .select({ chunks: sql<number>`coalesce(sum(${documents.embeddedCount}), 0)` })
    .from(documents)
    .where(eq(documents.tenantId, tenant.tenantId));

  return c.json({
    today: toDay(utcDay()),
    history: days.map(toDay),
    budget: {
      chatMessagesPerDay: limits.chatMessagesPerDay,
      documentsPerDay: limits.documentsPerDay,
      neuronsPerDay: FREE_NEURONS_PER_DAY,
      d1RowsWrittenPerDay: FREE_D1_ROWS_WRITTEN_PER_DAY,
      vectorDimensionsStored: (stored?.chunks ?? 0) * indexDimensions(c.env),
      vectorDimensionsStoredLimit: FREE_STORED_VECTOR_DIMENSIONS,
    },
  });
});
