import { and, eq, inArray, like, lt } from "drizzle-orm";

import { createDb, type Database } from "../db/index.js";
import { chunks, documentSegments, documents } from "../db/schema.js";
import { envInt, isDemo, type Env } from "../env.js";
import { deleteChunks } from "./vectors.js";

/**
 * Deletes what demo visitors upload, on a schedule.
 *
 * The demo takes files from strangers with no account. Keeping those is a
 * liability nobody asked for, and it would fill the free allowances within
 * days: Vectorize storage does not reset daily, and its free index holds about
 * 13,000 passages at 384 dimensions, so a few hundred uploads would exhaust it
 * permanently. The visitor is told the retention up front and can export
 * everything before it goes.
 *
 * Only visitor workspaces are touched. The curated document the demo is built
 * around lives in its own tenant and is matched by nothing here.
 */

/** Prefix of a per-visitor demo workspace, set in middleware/tenant.ts. */
export const DEMO_VISITOR_PREFIX = "demo-v-";

/** Documents handled per run, so one invocation cannot run long or write unboundedly. */
const DOCUMENTS_PER_RUN = 25;

export interface PurgeResult {
  documents: number;
  chunks: number;
  /** True when the cap was hit and more remains for the next run. */
  more: boolean;
}

export function retentionHours(env: Env): number {
  return envInt(env.DEMO_RETENTION_HOURS, 3);
}

/**
 * Removes visitor uploads older than the retention window.
 *
 * Vectors go first. A vector left behind after its chunk row is gone would be
 * unreachable and unremovable, since the ids to delete it by are the chunk ids.
 * Losing a D1 row after its vector is deleted is merely untidy, so the order
 * fails in the safe direction.
 */
export async function purgeExpiredDemoUploads(env: Env, db?: Database): Promise<PurgeResult> {
  if (!isDemo(env)) return { documents: 0, chunks: 0, more: false };

  const database = db ?? createDb(env.DB);
  const cutoff = Date.now() - retentionHours(env) * 60 * 60 * 1000;

  const expired = await database
    .select({ id: documents.id, tenantId: documents.tenantId })
    .from(documents)
    .where(
      and(like(documents.tenantId, `${DEMO_VISITOR_PREFIX}%`), lt(documents.createdAt, cutoff)),
    )
    .limit(DOCUMENTS_PER_RUN + 1);

  const batch = expired.slice(0, DOCUMENTS_PER_RUN);
  if (batch.length === 0) return { documents: 0, chunks: 0, more: false };

  let removedChunks = 0;

  for (const document of batch) {
    const ids = await database
      .select({ id: chunks.id })
      .from(chunks)
      .where(and(eq(chunks.documentId, document.id), eq(chunks.tenantId, document.tenantId)));

    await deleteChunks(
      env,
      ids.map((row) => row.id),
      document.tenantId,
      database,
    );
    removedChunks += ids.length;
  }

  const documentIds = batch.map((document) => document.id);
  await database.delete(chunks).where(inArray(chunks.documentId, documentIds));
  await database.delete(documentSegments).where(inArray(documentSegments.documentId, documentIds));
  await database.delete(documents).where(inArray(documents.id, documentIds));

  return { documents: batch.length, chunks: removedChunks, more: expired.length > batch.length };
}
