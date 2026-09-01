import {
  CreateDocumentRequest,
  DocumentListResponse,
  IngestRequest,
  TIER_LIMITS,
  findEmbeddingModel,
  neuronsForEmbedding,
  type DocumentSummary,
} from "@rag/shared";
import { Hono, type Context } from "hono";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { AppEnv } from "../middleware/tenant.js";
import { demoLimits, quotaChecksFor } from "../middleware/tenant.js";
import { chunks, documentSegments, documents } from "../db/schema.js";
import { batchForTable } from "../lib/d1.js";
import { HttpError } from "../lib/errors.js";
import { embed } from "../lib/providers/index.js";
import { consumeQuota } from "../lib/quota.js";
import { loadSettings } from "../lib/settings.js";
import { METRICS, d1Deltas, recordUsage } from "../lib/usage.js";
import { deleteChunks, upsertChunks } from "../lib/vectors.js";

export const documentsRoute = new Hono<AppEnv>();

/** Vector ids are derived, never random, so a chunk maps to its document. */
function chunkId(documentId: string, seq: number): string {
  return `${documentId}:${seq}`;
}

export function documentIdOfChunk(id: string): string {
  const cut = id.lastIndexOf(":");
  return cut === -1 ? id : id.slice(0, cut);
}

async function loadOwnedDocument(c: Context<AppEnv>, documentId: string, writable: boolean) {
  const db = c.get("db");
  const tenant = c.get("tenant");
  const scope = writable ? [tenant.tenantId] : tenant.readTenantIds;

  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), inArray(documents.tenantId, scope)))
    .limit(1);

  if (!row) throw new HttpError(404, "document_not_found", "Document not found.");
  return row;
}

documentsRoute.get("/documents", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");
  const settings = await loadSettings(db, c.env, tenant.tenantId);
  const limits = TIER_LIMITS[settings.tier];

  const rows = await db
    .select()
    .from(documents)
    .where(inArray(documents.tenantId, tenant.readTenantIds))
    .orderBy(asc(documents.createdAt));

  const owned = rows.filter((row) => row.tenantId === tenant.tenantId);
  const chunkTotal = owned.reduce((sum, row) => sum + row.embeddedCount, 0);

  const summaries: DocumentSummary[] = rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    sizeBytes: row.sizeBytes,
    status: row.status,
    extractor: row.extractor,
    chunkCount: row.chunkCount,
    embeddedCount: row.embeddedCount,
    pageCount: row.pageCount,
    error: row.error,
    embeddingModel: row.embeddingModel,
    stale: Boolean(row.embeddingModel) && row.embeddingModel !== settings.embeddingModel,
    shared: row.tenantId !== tenant.tenantId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  return c.json(
    DocumentListResponse.parse({
      documents: summaries,
      usage: {
        documents: owned.length,
        maxDocuments: limits.maxDocuments,
        chunks: chunkTotal,
        maxChunks: limits.maxChunksPerTenant,
      },
    }),
  );
});

documentsRoute.post("/documents", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");
  const body = CreateDocumentRequest.parse(await c.req.json());

  const settings = await loadSettings(db, c.env, tenant.tenantId);
  const limits = TIER_LIMITS[settings.tier];

  if (body.sizeBytes > limits.maxUploadBytes) {
    throw new HttpError(
      413,
      "upload_too_large",
      `This file is larger than the ${Math.round(limits.maxUploadBytes / 1024 / 1024)} MB limit for the ${settings.tier} tier.`,
    );
  }

  // The demo has its own, tighter ceiling and its own off switch. Both are
  // checked before any allowance is consumed, so a refused upload costs the
  // visitor nothing.
  if (tenant.mode === "demo") {
    const demo = demoLimits(c.env);
    if (!demo.uploadsEnabled) {
      throw new HttpError(
        403,
        "demo_uploads_disabled",
        "Uploads are turned off on this demo right now. The featured document is still there to ask about.",
      );
    }
    if (body.sizeBytes > demo.maxUploadBytes) {
      throw new HttpError(
        413,
        "demo_upload_too_large",
        `The demo takes files up to ${Math.round(demo.maxUploadBytes / 1024 / 1024)} MB. A few pages is enough to see the pipeline work.`,
      );
    }
  }
  if (body.extractor !== "browser" && !limits.serverSideParsing) {
    throw new HttpError(
      400,
      "server_parsing_disabled",
      "Server-side parsing needs the paid tier. Extract the text in the browser instead.",
    );
  }

  const [counts] = await db
    .select({
      documents: sql<number>`count(*)`,
      chunkTotal: sql<number>`coalesce(sum(${documents.embeddedCount}), 0)`,
    })
    .from(documents)
    .where(eq(documents.tenantId, tenant.tenantId));

  if ((counts?.documents ?? 0) >= limits.maxDocuments) {
    throw new HttpError(
      409,
      "document_limit_reached",
      `This workspace already holds ${limits.maxDocuments} documents. Delete one to add another.`,
    );
  }
  if ((counts?.chunkTotal ?? 0) + body.totalChunks > limits.maxChunksPerTenant) {
    throw new HttpError(
      409,
      "chunk_limit_reached",
      "This document would take the workspace past its chunk allowance for this tier.",
    );
  }

  await consumeQuota(db, quotaChecksFor(c.env, tenant, "upload", limits.documentsPerDay));

  const [row] = await db
    .insert(documents)
    .values({
      tenantId: tenant.tenantId,
      filename: body.filename,
      kind: body.kind,
      sizeBytes: body.sizeBytes,
      status: "embedding",
      extractor: body.extractor,
      pageCount: body.pageCount,
      chunkCount: body.totalChunks,
      embeddedCount: 0,
    })
    .returning({ id: documents.id });

  if (!row) throw new HttpError(500, "document_insert_failed", "Could not create the document.");

  return c.json({ documentId: row.id, batchSize: limits.ingestBatchSize }, 201);
});

/**
 * Accepts one batch of display segments and retrieval chunks.
 *
 * The whole batch costs a bounded amount of work: at most two D1 writes, one
 * embedding call and one Vectorize upsert, no matter how large the document is.
 * The client keeps calling until it has nothing left to send, then sets `done`.
 */
documentsRoute.post("/documents/:id/ingest", async (c) => {
  const started = Date.now();
  const db = c.get("db");
  const tenant = c.get("tenant");
  const document = await loadOwnedDocument(c, c.req.param("id"), true);
  const body = IngestRequest.parse(await c.req.json());

  const settings = await loadSettings(db, c.env, tenant.tenantId);
  const limits = TIER_LIMITS[settings.tier];

  if (body.chunks.length > limits.ingestBatchSize) {
    throw new HttpError(
      400,
      "batch_too_large",
      `Send at most ${limits.ingestBatchSize} chunks per call on the ${settings.tier} tier.`,
    );
  }

  // Inserts are split by bound-parameter count, not row count: D1 rejects a
  // statement with more than 100 parameters, and one row binds one per column.
  for (const batch of batchForTable(documentSegments, body.segments)) {
    await db.insert(documentSegments).values(
      batch.map((segment) => ({
        documentId: document.id,
        tenantId: tenant.tenantId,
        seq: segment.seq,
        page: segment.page,
        charStart: segment.charStart,
        markdown: segment.markdown,
      })),
    );
  }

  let embeddedNow = 0;
  let embeddingTokens = 0;

  if (body.chunks.length > 0) {
    const result = await embed(
      c.env,
      settings.embeddingProvider,
      settings.embeddingModel,
      body.chunks.map((chunk) => chunk.text),
    );
    embeddingTokens = result.tokens;

    for (const batch of batchForTable(chunks, body.chunks)) {
      await db.insert(chunks).values(
        batch.map((chunk) => ({
          id: chunkId(document.id, chunk.seq),
          documentId: document.id,
          tenantId: tenant.tenantId,
          seq: chunk.seq,
          heading: chunk.heading,
          page: chunk.page,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          bodyStart: chunk.bodyStart,
          text: chunk.text,
          tokenEstimate: chunk.tokenEstimate,
          embedded: 1,
        })),
      );
    }

    await upsertChunks(
      c.env,
      tenant.tenantId,
      body.chunks.map((chunk, index) => ({
        id: chunkId(document.id, chunk.seq),
        documentId: document.id,
        vector: result.vectors[index] ?? [],
      })),
      db,
    );

    embeddedNow = body.chunks.length;
  }

  const [updated] = await db
    .update(documents)
    .set({
      embeddedCount: sql`${documents.embeddedCount} + ${embeddedNow}`,
      status: body.done ? "active" : "embedding",
      embeddingModel: settings.embeddingModel,
      updatedAt: Date.now(),
    })
    .where(eq(documents.id, document.id))
    .returning({ embeddedCount: documents.embeddedCount, status: documents.status });

  const embeddingModel = findEmbeddingModel(settings.embeddingProvider, settings.embeddingModel);
  await recordUsage(db, tenant.tenantId, [
    { metric: METRICS.embeddingTokens, value: embeddingTokens },
    {
      metric: METRICS.neurons,
      value: embeddingModel ? neuronsForEmbedding(embeddingModel, embeddingTokens) : 0,
    },
    { metric: METRICS.documentsIngested, value: body.done ? 1 : 0 },
    ...d1Deltas(c.get("d1Usage")()),
  ]);

  return c.json({
    documentId: document.id,
    status: updated?.status ?? "embedding",
    embedded: updated?.embeddedCount ?? 0,
    total: document.chunkCount,
    elapsedMs: Date.now() - started,
  });
});

documentsRoute.get("/documents/:id/content", async (c) => {
  const db = c.get("db");
  const document = await loadOwnedDocument(c, c.req.param("id"), false);

  const rows = await db
    .select({
      seq: documentSegments.seq,
      charStart: documentSegments.charStart,
      page: documentSegments.page,
      markdown: documentSegments.markdown,
    })
    .from(documentSegments)
    .where(eq(documentSegments.documentId, document.id))
    .orderBy(asc(documentSegments.seq));

  return c.json({
    id: document.id,
    filename: document.filename,
    pageCount: document.pageCount,
    segments: rows,
  });
});

documentsRoute.delete("/documents/:id", async (c) => {
  const db = c.get("db");
  const document = await loadOwnedDocument(c, c.req.param("id"), true);

  const ids = await db
    .select({ id: chunks.id })
    .from(chunks)
    .where(eq(chunks.documentId, document.id));

  await deleteChunks(
    c.env,
    ids.map((row) => row.id),
    document.tenantId,
    db,
  );
  await db.delete(chunks).where(eq(chunks.documentId, document.id));
  await db.delete(documentSegments).where(eq(documentSegments.documentId, document.id));
  await db.delete(documents).where(eq(documents.id, document.id));

  if (document.originalKey && c.env.BUCKET) {
    await c.env.BUCKET.delete(document.originalKey);
  }

  return c.json({ deleted: document.id });
});
