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
  /**
   * Rows D1 reported reading and writing, as measured by lib/d1-meter.ts.
   *
   * Cloudflare enforces the free plan's daily allowance from 1 September 2026,
   * so these are the two numbers that decide whether a deployment keeps working
   * until midnight UTC. They undercount by the handful of rows the recording
   * upsert itself writes, which is a fixed cost of at most a few rows.
   */
  d1RowsRead: "d1_rows_read",
  d1RowsWritten: "d1_rows_written",
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

/**
 * Turns a meter reading into deltas, for folding into an existing usage write.
 *
 * Only the expensive operations record this: ingestion and chat. Metering every
 * cheap read as well would cost a row write per request to measure a handful of
 * row reads, which would consume more allowance than it accounts for. The
 * consequence is that the reported figure is a floor, not a total.
 */
export function d1Deltas(usage: { rowsRead: number; rowsWritten: number }): MetricDelta[] {
  return [
    { metric: METRICS.d1RowsRead, value: usage.rowsRead },
    { metric: METRICS.d1RowsWritten, value: usage.rowsWritten },
  ];
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
