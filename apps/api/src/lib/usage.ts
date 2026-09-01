import { and, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "../db/index.js";
import { usageDaily } from "../db/schema.js";
import { batchForTable } from "./d1.js";
import { utcDay } from "./time.js";

export const METRICS = {
  chatMessages: "chat_messages",
  documentsIngested: "documents_ingested",
  embeddingTokens: "embedding_tokens",
  chatPromptTokens: "chat_prompt_tokens",
  chatCompletionTokens: "chat_completion_tokens",
  neurons: "neurons",
  externalCostUsd: "external_cost_usd",
} as const;

export type Metric = (typeof METRICS)[keyof typeof METRICS];

export interface MetricDelta {
  metric: Metric;
  value: number;
}

/**
 * Adds to several daily metrics at once.
 *
 * D1 on the free plan allows 50 queries per invocation and 100,000 row writes a
 * day, so the deltas are folded into a single multi-row upsert rather than one
 * statement per metric.
 */
export async function recordUsage(
  db: Database,
  tenantId: string,
  deltas: MetricDelta[],
  day = utcDay(),
): Promise<void> {
  const meaningful = deltas.filter((delta) => delta.value !== 0);
  if (meaningful.length === 0) return;

  for (const batch of batchForTable(usageDaily, meaningful)) {
    await db
      .insert(usageDaily)
      .values(batch.map((delta) => ({ tenantId, day, metric: delta.metric, value: delta.value })))
      .onConflictDoUpdate({
        target: [usageDaily.tenantId, usageDaily.day, usageDaily.metric],
        set: { value: sql`${usageDaily.value} + excluded.value` },
      });
  }
}

export type UsageMap = Record<string, number>;

export async function readUsage(
  db: Database,
  tenantId: string,
  days: string[],
): Promise<Record<string, UsageMap>> {
  if (days.length === 0) return {};
  const rows = await db
    .select()
    .from(usageDaily)
    .where(and(eq(usageDaily.tenantId, tenantId), inArray(usageDaily.day, days)));

  const byDay: Record<string, UsageMap> = {};
  for (const day of days) byDay[day] = {};
  for (const row of rows) {
    const bucket = byDay[row.day] ?? (byDay[row.day] = {});
    bucket[row.metric] = row.value;
  }
  return byDay;
}
