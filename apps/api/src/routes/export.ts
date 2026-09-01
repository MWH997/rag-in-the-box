import { Hono } from "hono";
import { and, asc, eq, inArray } from "drizzle-orm";

import { chunkVectors, chunks, documentSegments, documents } from "../db/schema.js";
import { indexDimensions, vectorBackend } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { loadSettings } from "../lib/settings.js";
import { decodeVector } from "../lib/vectors.js";
import { demoLimits, type AppEnv } from "../middleware/tenant.js";

export const exportRoute = new Hono<AppEnv>();

/** Documents included in one export, so the response cannot grow without bound. */
const MAX_DOCUMENTS = 10;

/**
 * Hands back everything this workspace holds, as one JSON file.
 *
 * The demo deletes visitor uploads a few hours after they arrive, so an export
 * is the difference between trying the product and losing the work. It is not
 * demo-only, though: being able to take the index elsewhere is the point of an
 * open source tool, and a format nobody can leave is a lock-in whatever the
 * licence says.
 *
 * Vectors are included when they can be read back. Under Vectorize they cannot
 * be, not without a query per chunk, so the export says so rather than
 * pretending the field is missing for some other reason. The extracted text and
 * the chunk boundaries are the expensive part to reproduce, and those are
 * always present.
 */
exportRoute.get("/export", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");
  const settings = await loadSettings(db, c.env, tenant.tenantId);

  // Only what this visitor added. The curated demo document belongs to the
  // deployment, not to whoever is looking at it.
  const owned = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      kind: documents.kind,
      sizeBytes: documents.sizeBytes,
      pageCount: documents.pageCount,
      chunkCount: documents.chunkCount,
      embeddingModel: documents.embeddingModel,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.tenantId, tenant.tenantId), eq(documents.status, "active")))
    .orderBy(asc(documents.createdAt))
    .limit(MAX_DOCUMENTS);

  if (owned.length === 0) {
    throw new HttpError(
      404,
      "nothing_to_export",
      "This workspace has no documents of its own to export yet.",
    );
  }

  const documentIds = owned.map((document) => document.id);

  const segmentRows = await db
    .select({
      documentId: documentSegments.documentId,
      seq: documentSegments.seq,
      page: documentSegments.page,
      charStart: documentSegments.charStart,
      markdown: documentSegments.markdown,
    })
    .from(documentSegments)
    .where(inArray(documentSegments.documentId, documentIds))
    .orderBy(asc(documentSegments.documentId), asc(documentSegments.seq));

  const chunkRows = await db
    .select({
      id: chunks.id,
      documentId: chunks.documentId,
      seq: chunks.seq,
      heading: chunks.heading,
      page: chunks.page,
      charStart: chunks.charStart,
      charEnd: chunks.charEnd,
      bodyStart: chunks.bodyStart,
      text: chunks.text,
      tokenEstimate: chunks.tokenEstimate,
    })
    .from(chunks)
    .where(inArray(chunks.documentId, documentIds))
    .orderBy(asc(chunks.documentId), asc(chunks.seq));

  // Vectorize has no read-back that returns values in bulk, so vectors only
  // travel when they live in D1. Saying which case applies is more useful than
  // an absent field the reader has to guess about.
  let vectors: Record<string, number[]> | null = null;
  if (vectorBackend(c.env) === "d1") {
    const vectorRows = await db
      .select({ id: chunkVectors.id, vector: chunkVectors.vector })
      .from(chunkVectors)
      .where(eq(chunkVectors.tenantId, tenant.tenantId));
    vectors = {};
    for (const row of vectorRows) {
      vectors[row.id] = Array.from(decodeVector((row.vector as unknown as Uint8Array).buffer));
    }
  }

  const byDocument = (documentId: string) => ({
    ...owned.find((document) => document.id === documentId)!,
    segments: segmentRows
      .filter((segment) => segment.documentId === documentId)
      .map(({ documentId: _ignored, ...segment }) => segment),
    chunks: chunkRows
      .filter((chunk) => chunk.documentId === documentId)
      .map(({ documentId: _ignored, ...chunk }) => chunk),
  });

  const payload = {
    format: "rag-in-the-box/export",
    version: 1,
    exportedAt: new Date().toISOString(),
    embedding: {
      provider: settings.embeddingProvider,
      model: settings.embeddingModel,
      dimensions: indexDimensions(c.env),
      /** Vectors are unit length, so a dot product is the cosine similarity. */
      normalized: true,
    },
    vectorsIncluded: vectors !== null,
    vectorsNote:
      vectors === null
        ? "This deployment stores vectors in Vectorize, which cannot return them in bulk. Re-embed the chunks with the model named above to rebuild the index."
        : "One entry per chunk id, in the same order the model emitted them.",
    retention:
      tenant.mode === "demo"
        ? `Uploads to this demo are deleted after ${demoLimits(c.env).retentionHours} hours.`
        : null,
    documents: documentIds.map(byDocument),
    vectors,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return c.json(payload, 200, {
    "content-disposition": `attachment; filename="rag-export-${stamp}.json"`,
  });
});
