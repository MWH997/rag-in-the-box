import {
  SOURCE_KINDS,
  TIER_LIMITS,
  chunkMarkdown,
  findEmbeddingModel,
  neuronsForEmbedding,
  pageForOffset,
  segmentMarkdown,
  type SourceKind,
} from "@rag/shared";
import { Hono, type Context } from "hono";
import { and, eq, inArray } from "drizzle-orm";

import { chunks, documentSegments, documents } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import { embed, getJobMarkdown, getJobStatus, submitParseJob } from "../lib/providers/index.js";
import { consumeQuota } from "../lib/quota.js";
import { loadSettings } from "../lib/settings.js";
import { triage } from "../lib/triage.js";
import { METRICS, recordUsage } from "../lib/usage.js";
import { upsertChunks } from "../lib/vectors.js";
import { quotaChecksFor, type AppEnv } from "../middleware/tenant.js";

export const uploadRoute = new Hono<AppEnv>();

/**
 * Server-side ingestion, available on the paid tier.
 *
 * The browser path is the default because it is the only one that fits the
 * free plan's 10 ms CPU budget. This route exists for operators on the paid
 * plan who would rather post a file straight at the API, and for scanned
 * documents that need LlamaParse, which the browser cannot do at all.
 */

const EXTENSION_TO_KIND: Record<string, SourceKind> = {
  pdf: "pdf",
  docx: "docx",
  csv: "csv",
  txt: "txt",
  md: "md",
  markdown: "md",
};

function kindOf(filename: string): SourceKind {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const kind = EXTENSION_TO_KIND[extension];
  if (!kind) {
    throw new HttpError(
      415,
      "unsupported_file_type",
      `Supported file types are ${SOURCE_KINDS.join(", ")}.`,
    );
  }
  return kind;
}

/**
 * Batch sizes for writing an extracted document.
 *
 * These are bounded by D1's 100 KB cap on a single SQL statement and by how
 * many inputs an embedding provider accepts per call, not by tier, because
 * exceeding either produces a hard failure rather than a slow request.
 */
const SEGMENT_INSERT_BATCH = 8;
const CHUNK_INSERT_BATCH = 24;

uploadRoute.post("/documents/upload", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");
  const settings = await loadSettings(db, c.env, tenant.tenantId);
  const limits = TIER_LIMITS[settings.tier];

  if (!limits.serverSideParsing) {
    throw new HttpError(
      403,
      "server_parsing_disabled",
      "Server-side upload needs the paid tier. On the free tier the browser extracts the text.",
    );
  }

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new HttpError(400, "no_file", "Attach the document in a form field named file.");
  }
  if (file.size > limits.maxUploadBytes) {
    throw new HttpError(413, "upload_too_large", "That file is larger than this tier allows.");
  }

  const kind = kindOf(file.name);
  await consumeQuota(db, quotaChecksFor(c.env, tenant, "upload", limits.documentsPerDay));

  const buffer = await file.arrayBuffer();
  const decision = await triage(kind, buffer, file.size);

  if (decision.extractor === "llamaparse") {
    if (!limits.ocrFallback || !c.env.LLAMA_CLOUD_API_KEY) {
      throw new HttpError(
        422,
        "needs_ocr",
        `This file needs optical character recognition (${decision.reason}), which requires LLAMA_CLOUD_API_KEY.`,
      );
    }

    const [row] = await db
      .insert(documents)
      .values({
        tenantId: tenant.tenantId,
        filename: file.name,
        kind,
        sizeBytes: file.size,
        status: "parsing",
        extractor: "llamaparse",
        pageCount: decision.pageCount,
      })
      .returning({ id: documents.id });
    if (!row) throw new HttpError(500, "document_insert_failed", "Could not create the document.");

    // The original is kept so a failed parse can be retried without a re-upload.
    if (c.env.BUCKET) {
      const key = `${tenant.tenantId}/${row.id}/${file.name}`;
      await c.env.BUCKET.put(key, buffer);
      await db.update(documents).set({ originalKey: key }).where(eq(documents.id, row.id));
    }

    const jobId = await submitParseJob(c.env, new Blob([buffer]), file.name);
    await db
      .update(documents)
      .set({ llamaparseJobId: jobId, updatedAt: Date.now() })
      .where(eq(documents.id, row.id));

    return c.json({ documentId: row.id, status: "parsing", jobId }, 202);
  }

  const [row] = await db
    .insert(documents)
    .values({
      tenantId: tenant.tenantId,
      filename: file.name,
      kind,
      sizeBytes: file.size,
      status: "embedding",
      extractor: "worker",
      pageCount: decision.pageCount,
    })
    .returning({ id: documents.id });
  if (!row) throw new HttpError(500, "document_insert_failed", "Could not create the document.");

  const result = await ingestMarkdown(c, row.id, decision.markdown, []);
  return c.json({ documentId: row.id, status: "active", ...result }, 201);
});

/** Polls a LlamaParse job and finishes ingestion once it has completed. */
uploadRoute.post("/documents/:id/resume", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");
  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, c.req.param("id")), eq(documents.tenantId, tenant.tenantId)))
    .limit(1);

  if (!document) throw new HttpError(404, "document_not_found", "Document not found.");
  if (document.status !== "parsing" || !document.llamaparseJobId) {
    return c.json({ documentId: document.id, status: document.status });
  }

  const status = await getJobStatus(c.env, document.llamaparseJobId);
  if (status === "PENDING" || status === "RUNNING") {
    return c.json({ documentId: document.id, status: "parsing" });
  }
  if (status !== "COMPLETED") {
    await db
      .update(documents)
      .set({ status: "failed", error: `LlamaParse job ${status}`, updatedAt: Date.now() })
      .where(eq(documents.id, document.id));
    throw new HttpError(502, "parse_failed", `The parse job finished as ${status}.`);
  }

  const markdown = await getJobMarkdown(c.env, document.llamaparseJobId);
  await db
    .update(documents)
    .set({ status: "embedding", updatedAt: Date.now() })
    .where(eq(documents.id, document.id));

  const result = await ingestMarkdown(c, document.id, markdown, []);
  return c.json({ documentId: document.id, status: "active", ...result });
});

/** Chunks, embeds and stores a whole markdown document. Paid tier only. */
async function ingestMarkdown(
  c: Context<AppEnv>,
  documentId: string,
  markdown: string,
  pageBreaks: number[],
): Promise<{ chunks: number; segments: number }> {
  const db = c.get("db");
  const tenant = c.get("tenant");
  const settings = await loadSettings(db, c.env, tenant.tenantId);
  const limits = TIER_LIMITS[settings.tier];

  const segments = segmentMarkdown(markdown);
  for (let index = 0; index < segments.length; index += SEGMENT_INSERT_BATCH) {
    await db.insert(documentSegments).values(
      segments.slice(index, index + SEGMENT_INSERT_BATCH).map((segment) => ({
        documentId,
        tenantId: tenant.tenantId,
        seq: segment.seq,
        page: pageForOffset(pageBreaks, segment.charStart),
        charStart: segment.charStart,
        markdown: segment.markdown,
      })),
    );
  }

  const produced = chunkMarkdown(markdown, pageBreaks);
  if (produced.length > limits.maxChunksPerTenant) {
    throw new HttpError(
      409,
      "chunk_limit_reached",
      "This document alone exceeds the chunk allowance for this tier.",
    );
  }

  let embeddingTokens = 0;
  for (let index = 0; index < produced.length; index += CHUNK_INSERT_BATCH) {
    const batch = produced.slice(index, index + CHUNK_INSERT_BATCH);
    const embedded = await embed(
      c.env,
      settings.embeddingProvider,
      settings.embeddingModel,
      batch.map((chunk) => chunk.text),
    );
    embeddingTokens += embedded.tokens;

    await db.insert(chunks).values(
      batch.map((chunk) => ({
        id: `${documentId}:${chunk.seq}`,
        documentId,
        tenantId: tenant.tenantId,
        seq: chunk.seq,
        heading: chunk.heading,
        page: chunk.page,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        text: chunk.text,
        tokenEstimate: chunk.tokenEstimate,
        embedded: 1,
      })),
    );

    await upsertChunks(
      c.env,
      tenant.tenantId,
      batch.map((chunk, offset) => ({
        id: `${documentId}:${chunk.seq}`,
        documentId,
        vector: embedded.vectors[offset] ?? [],
      })),
      db,
    );
  }

  await db
    .update(documents)
    .set({
      status: "active",
      chunkCount: produced.length,
      embeddedCount: produced.length,
      embeddingModel: settings.embeddingModel,
      updatedAt: Date.now(),
    })
    .where(eq(documents.id, documentId));

  const embeddingModel = findEmbeddingModel(settings.embeddingProvider, settings.embeddingModel);
  await recordUsage(db, tenant.tenantId, [
    { metric: METRICS.embeddingTokens, value: embeddingTokens },
    {
      metric: METRICS.neurons,
      value: embeddingModel ? neuronsForEmbedding(embeddingModel, embeddingTokens) : 0,
    },
    { metric: METRICS.documentsIngested, value: 1 },
  ]);

  return { chunks: produced.length, segments: segments.length };
}

/** Re-embeds every document after the embedding model changed. */
uploadRoute.post("/documents/reindex", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");
  const settings = await loadSettings(db, c.env, tenant.tenantId);

  const stale = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.tenantId, tenant.tenantId));

  const ids = stale.map((row) => row.id);
  if (ids.length === 0) return c.json({ reindexed: 0 });

  let reindexed = 0;
  for (const documentId of ids) {
    const rows = await db
      .select({ id: chunks.id, seq: chunks.seq, text: chunks.text })
      .from(chunks)
      .where(and(eq(chunks.documentId, documentId), inArray(chunks.tenantId, [tenant.tenantId])));

    for (let index = 0; index < rows.length; index += CHUNK_INSERT_BATCH) {
      const batch = rows.slice(index, index + CHUNK_INSERT_BATCH);
      const embedded = await embed(
        c.env,
        settings.embeddingProvider,
        settings.embeddingModel,
        batch.map((row) => row.text),
      );
      await upsertChunks(
        c.env,
        tenant.tenantId,
        batch.map((row, offset) => ({
          id: row.id,
          documentId,
          vector: embedded.vectors[offset] ?? [],
        })),
        db,
      );
    }

    await db
      .update(documents)
      .set({ embeddingModel: settings.embeddingModel, updatedAt: Date.now() })
      .where(eq(documents.id, documentId));
    reindexed += 1;
  }

  return c.json({ reindexed });
});
