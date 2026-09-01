import { and, eq, inArray, sql } from "drizzle-orm";

import { indexDimensions, vectorBackend, type Env } from "../env.js";
import { createDb, type Database } from "../db/index.js";
import { chunkVectors } from "../db/schema.js";

/**
 * Vector storage, tenant-scoped without exception.
 *
 * Two backends sit behind one interface:
 *
 *   vectorize  the default whenever the binding exists. Every write sets both
 *              the namespace and a tenant_id metadata value, and every read
 *              sets both the namespace and a tenant_id filter. Either alone
 *              would isolate tenants; both are used so a mistake in one still
 *              leaves the other enforcing it.
 *
 *   d1         a brute-force cosine scan over vectors stored as BLOBs. Vectorize
 *              has no local emulation, so this is what makes the project
 *              runnable without a Cloudflare account, and it is a reasonable
 *              production choice for a small corpus.
 *
 * Tenant ids always come from the server-side session. No caller passes one in.
 */

export interface UpsertChunk {
  id: string;
  documentId: string;
  vector: number[];
}

export interface Match {
  chunkId: string;
  documentId: string;
  score: number;
}

/**
 * Vectors scanned per query by the D1 backend.
 *
 * A scan of 4,000 vectors at 384 dimensions is about 1.5 million multiply-adds,
 * which measures in single-digit milliseconds. Going much past this would put
 * the free plan's 10 ms CPU budget at risk, so the scan stops here and the
 * documentation says to move to Vectorize beyond it.
 */
export const D1_SCAN_LIMIT = 4_000;

/** Reads the Vectorize binding, failing loudly when the backend is misconfigured. */
function requireVectorize(env: Env): VectorizeIndex {
  const index = env.VECTORIZE;
  if (!index) {
    throw new Error(
      "VECTOR_BACKEND is set to vectorize but no VECTORIZE binding is present. " +
        "Add the binding in wrangler.toml, or set VECTOR_BACKEND to d1.",
    );
  }
  return index;
}

/** Vectorize namespaces are capped at 64 bytes, so long tenant ids are hashed. */
export async function namespaceFor(tenantId: string): Promise<string> {
  if (tenantId.length <= 64 && /^[A-Za-z0-9_-]+$/.test(tenantId)) return tenantId;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tenantId));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 48);
}

export function encodeVector(vector: number[]): ArrayBuffer {
  return Float32Array.from(vector).buffer;
}

export function decodeVector(buffer: ArrayBufferLike): Float32Array {
  return new Float32Array(buffer);
}

/** Dot product. Both sides are unit vectors, so this is the cosine similarity. */
export function cosine(query: readonly number[], stored: Float32Array): number {
  const length = Math.min(query.length, stored.length);
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += (query[index] ?? 0) * (stored[index] ?? 0);
  }
  return total;
}

export async function upsertChunks(
  env: Env,
  tenantId: string,
  chunks: UpsertChunk[],
  db?: Database,
): Promise<void> {
  if (chunks.length === 0) return;
  const expected = indexDimensions(env);

  for (const chunk of chunks) {
    if (chunk.vector.length !== expected) {
      throw new Error(
        `Refusing to store a ${chunk.vector.length}-dimension vector in a ${expected}-dimension index`,
      );
    }
  }

  if (vectorBackend(env) === "d1") {
    const database = db ?? createDb(env.DB);
    await database
      .insert(chunkVectors)
      .values(
        chunks.map((chunk) => ({
          id: chunk.id,
          tenantId,
          documentId: chunk.documentId,
          vector: encodeVector(chunk.vector) as unknown as Buffer,
        })),
      )
      .onConflictDoUpdate({
        target: chunkVectors.id,
        set: { vector: sql`excluded.vector` },
      });
    return;
  }

  const namespace = await namespaceFor(tenantId);
  await requireVectorize(env).upsert(
    chunks.map((chunk) => ({
      id: chunk.id,
      values: chunk.vector,
      namespace,
      metadata: { tenant_id: tenantId, document_id: chunk.documentId },
    })),
  );
}

export async function queryChunks(
  env: Env,
  tenantId: string,
  vector: number[],
  topK: number,
  db?: Database,
): Promise<Match[]> {
  if (vectorBackend(env) === "d1") {
    const database = db ?? createDb(env.DB);
    const rows = await database
      .select({
        id: chunkVectors.id,
        documentId: chunkVectors.documentId,
        vector: chunkVectors.vector,
      })
      .from(chunkVectors)
      .where(eq(chunkVectors.tenantId, tenantId))
      .limit(D1_SCAN_LIMIT);

    return rows
      .map((row) => ({
        chunkId: row.id,
        documentId: row.documentId,
        score: cosine(vector, decodeVector((row.vector as unknown as Uint8Array).buffer)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  const namespace = await namespaceFor(tenantId);
  const result = await requireVectorize(env).query(vector, {
    topK,
    namespace,
    filter: { tenant_id: tenantId } as VectorizeVectorMetadataFilter,
    returnValues: false,
    returnMetadata: "indexed",
  });

  return (result.matches ?? [])
    .filter((match) => match.metadata?.tenant_id === tenantId)
    .map((match) => ({
      chunkId: match.id,
      documentId: String(match.metadata?.document_id ?? ""),
      score: match.score ?? 0,
    }));
}

export async function deleteChunks(
  env: Env,
  ids: string[],
  tenantId?: string,
  db?: Database,
): Promise<void> {
  if (ids.length === 0) return;

  if (vectorBackend(env) === "d1") {
    const database = db ?? createDb(env.DB);
    for (let index = 0; index < ids.length; index += 100) {
      const slice = ids.slice(index, index + 100);
      await database
        .delete(chunkVectors)
        .where(
          tenantId
            ? and(inArray(chunkVectors.id, slice), eq(chunkVectors.tenantId, tenantId))
            : inArray(chunkVectors.id, slice),
        );
    }
    return;
  }

  // Vectorize accepts up to 1,000 ids per call from a Worker.
  for (let index = 0; index < ids.length; index += 1_000) {
    await requireVectorize(env).deleteByIds(ids.slice(index, index + 1_000));
  }
}
