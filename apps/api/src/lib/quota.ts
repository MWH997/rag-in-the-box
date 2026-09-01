import { sql } from "drizzle-orm";

import type { Database } from "../db/index.js";
import { quotaCounters } from "../db/schema.js";
import { HttpError } from "./errors.js";
import { nextUtcMidnight, utcDay } from "./time.js";

export type QuotaScope = "visitor" | "tenant" | "global";

export interface QuotaCheck {
  scope: QuotaScope;
  key: string;
  metric: string;
  limit: number;
}

export interface QuotaOutcome {
  allowed: boolean;
  scope: QuotaScope;
  used: number;
  limit: number;
  resetsAt: number;
}

/**
 * Increments a counter and reports the new value, in one statement.
 *
 * Reading then writing would let two concurrent requests both see the same
 * value and both pass a limit check. The upsert makes the increment atomic, so
 * the returned count is authoritative and the caller decides afterwards whether
 * that count is over the line.
 */
async function bump(
  db: Database,
  scope: QuotaScope,
  key: string,
  metric: string,
  amount: number,
  day: string,
): Promise<number> {
  const [row] = await db
    .insert(quotaCounters)
    .values({ scope, key, day, metric, count: amount, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: [quotaCounters.scope, quotaCounters.key, quotaCounters.day, quotaCounters.metric],
      set: {
        count: sql`${quotaCounters.count} + ${amount}`,
        updatedAt: Date.now(),
      },
    })
    .returning({ count: quotaCounters.count });
  return row?.count ?? amount;
}

async function peek(
  db: Database,
  scope: QuotaScope,
  key: string,
  metric: string,
  day: string,
): Promise<number> {
  const [row] = await db
    .select({ count: quotaCounters.count })
    .from(quotaCounters)
    .where(
      sql`${quotaCounters.scope} = ${scope} and ${quotaCounters.key} = ${key} and ${quotaCounters.day} = ${day} and ${quotaCounters.metric} = ${metric}`,
    )
    .limit(1);
  return row?.count ?? 0;
}

/** Reads counters without consuming any allowance. Used by the status banner. */
export async function readQuota(db: Database, checks: QuotaCheck[]): Promise<QuotaOutcome[]> {
  const day = utcDay();
  const resetsAt = nextUtcMidnight();
  const outcomes: QuotaOutcome[] = [];
  for (const check of checks) {
    const used = await peek(db, check.scope, check.key, check.metric, day);
    outcomes.push({
      scope: check.scope,
      used,
      limit: check.limit,
      resetsAt,
      allowed: used < check.limit,
    });
  }
  return outcomes;
}

/**
 * Consumes one unit against every check and throws when any of them is over.
 *
 * Checks run cheapest-scope-first so the common per-visitor rejection costs a
 * single D1 write rather than one per scope.
 */
export async function consumeQuota(
  db: Database,
  checks: QuotaCheck[],
  amount = 1,
): Promise<QuotaOutcome[]> {
  const day = utcDay();
  const resetsAt = nextUtcMidnight();
  const outcomes: QuotaOutcome[] = [];

  for (const check of checks) {
    if (check.limit <= 0) {
      throw new HttpError(429, "quota_disabled", "This action is turned off on this deployment.");
    }
    const used = await bump(db, check.scope, check.key, check.metric, amount, day);
    const outcome: QuotaOutcome = {
      scope: check.scope,
      used,
      limit: check.limit,
      resetsAt,
      allowed: used <= check.limit,
    };
    outcomes.push(outcome);
    if (!outcome.allowed) {
      throw new HttpError(
        429,
        check.scope === "global" ? "quota_global_exhausted" : "quota_exhausted",
        check.scope === "global"
          ? "The shared daily allowance for this deployment is used up. It resets at midnight UTC."
          : "You have used your allowance for today. It resets at midnight UTC.",
        { scope: check.scope, used, limit: check.limit, resetsAt },
      );
    }
  }

  return outcomes;
}

/** Gives back allowance consumed by an action that then failed upstream. */
export async function refundQuota(
  db: Database,
  checks: QuotaCheck[],
  amount = 1,
): Promise<void> {
  const day = utcDay();
  for (const check of checks) {
    await db
      .update(quotaCounters)
      .set({ count: sql`max(0, ${quotaCounters.count} - ${amount})`, updatedAt: Date.now() })
      .where(
        sql`${quotaCounters.scope} = ${check.scope} and ${quotaCounters.key} = ${check.key} and ${quotaCounters.day} = ${day} and ${quotaCounters.metric} = ${check.metric}`,
      );
  }
}
