import { CHAT_PROVIDERS, EMBEDDING_PROVIDERS, TIERS } from "@rag/shared";
import { blob, index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// BetterAuth's tables (user/session/account/verification/organization/member/
// invitation) live in ./auth-schema.ts, regenerated with
// `npx @better-auth/cli generate --config auth.config.ts --output src/db/auth-schema.ts`.
// Re-exported here so this file stays the single schema entry point.
export * from "./auth-schema.js";

/**
 * One uploaded source document per row.
 *
 * `extractor` records where the text came from: the browser (the default and
 * the only path that fits the Cloudflare free plan's 10 ms CPU budget), the
 * Worker itself, or LlamaParse for scanned files. `embeddingModel` records the
 * model that produced the stored vectors, so changing the embedding model can
 * be detected and surfaced as a re-index prompt instead of silently mixing two
 * vector spaces in one index.
 */
export const documents = sqliteTable(
  "documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull(),
    filename: text("filename").notNull(),
    kind: text("kind", { enum: ["pdf", "docx", "csv", "txt", "md"] }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: text("status", {
      enum: ["pending", "extracting", "parsing", "embedding", "active", "failed"],
    }).notNull(),
    extractor: text("extractor", { enum: ["browser", "worker", "llamaparse"] }),
    llamaparseJobId: text("llamaparse_job_id"),
    originalKey: text("original_key"),
    pageCount: integer("page_count").notNull().default(0),
    chunkCount: integer("chunk_count").notNull().default(0),
    embeddedCount: integer("embedded_count").notNull().default(0),
    embeddingModel: text("embedding_model"),
    error: text("error"),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("documents_tenant_idx").on(table.tenantId),
    index("documents_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

/**
 * The document as the reader sees it, split into display segments.
 *
 * D1 caps a single value at 2 MB, and large rows make every read expensive, so
 * the markdown is stored in ordered segments of a few kilobytes each. The
 * side-by-side reader pages through these, and `charStart` lets a citation
 * offset be located without loading the whole document.
 */
export const documentSegments = sqliteTable(
  "document_segments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    seq: integer("seq").notNull(),
    page: integer("page"),
    charStart: integer("char_start").notNull(),
    markdown: text("markdown").notNull(),
  },
  (table) => [index("segments_doc_seq_idx").on(table.documentId, table.seq)],
);

/**
 * Retrieval units. One row per embedded chunk.
 *
 * The text is denormalised from `document_segments` on purpose: retrieval reads
 * chunk text by primary key in a single query, which keeps the chat path at two
 * D1 queries regardless of how many chunks come back. The free plan allows 50
 * queries per invocation, so leaving headroom here matters.
 */
export const chunks = sqliteTable(
  "chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    seq: integer("seq").notNull(),
    heading: text("heading"),
    page: integer("page"),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    /**
     * Offset where the chunk's own content begins.
     *
     * Chunks overlap, so `text` opens with a tail carried from the chunk
     * before it. A citation points here rather than at `char_start`, so the
     * reader lands on this passage and not on the end of the previous one.
     */
    bodyStart: integer("body_start").notNull().default(0),
    text: text("text").notNull(),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    embedded: integer("embedded").notNull().default(0),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [
    index("chunks_doc_seq_idx").on(table.documentId, table.seq),
    index("chunks_tenant_idx").on(table.tenantId),
  ],
);

/**
 * Vectors, when the deployment uses the D1 vector backend instead of Vectorize.
 *
 * Vectorize has no local emulation, so this table is what makes the project
 * runnable end to end without a Cloudflare account. It is also a workable
 * production choice for a small corpus, since a brute-force cosine scan over a
 * few thousand short vectors is fast. Vectorize remains the default whenever
 * its binding is present. See docs/architecture.md for the trade-off.
 */
export const chunkVectors = sqliteTable(
  "chunk_vectors",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    documentId: text("document_id").notNull(),
    /** Float32 values, little-endian, length equal to the index dimension. */
    vector: blob("vector", { mode: "buffer" }).notNull(),
  },
  (table) => [index("chunk_vectors_tenant_idx").on(table.tenantId)],
);

/** Per-tenant configuration, including the free/paid tier switch. */
export const tenantSettings = sqliteTable("tenant_settings", {
  tenantId: text("tenant_id").primaryKey(),
  // The three enums below take their values from the shared registry rather
  // than repeating them. They are type-level only: SQLite stores plain text and
  // the generated DDL carries no constraint, so adding a provider needs no
  // migration, and taking one away needs a data fix rather than a schema one.
  tier: text("tier", { enum: TIERS }).notNull().default("free"),
  embeddingProvider: text("embedding_provider", { enum: EMBEDDING_PROVIDERS })
    .notNull()
    .default("workers-ai"),
  embeddingModel: text("embedding_model").notNull().default("@cf/baai/bge-small-en-v1.5"),
  chatProvider: text("chat_provider", { enum: CHAT_PROVIDERS }).notNull().default("workers-ai"),
  chatModel: text("chat_model").notNull().default("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
  systemPrompt: text("system_prompt").notNull().default(""),
  updatedAt: integer("updated_at")
    .notNull()
    .$defaultFn(() => Date.now()),
});

/** Transcript, kept for the usage view and for debugging bad answers. */
export const chatLogs = sqliteTable(
  "chat_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    citations: text("citations"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    model: text("model").notNull(),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [index("chat_logs_tenant_created_idx").on(table.tenantId, table.createdAt)],
);

/**
 * Daily rollup, one row per tenant per day per metric.
 *
 * Keeping the metric name in a column rather than adding a column per metric
 * means new counters never need a migration, and the whole day for a tenant is
 * one indexed read.
 */
export const usageDaily = sqliteTable(
  "usage_daily",
  {
    tenantId: text("tenant_id").notNull(),
    day: text("day").notNull(),
    metric: text("metric").notNull(),
    value: real("value").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.day, table.metric] })],
);

/**
 * Rate and quota counters.
 *
 * `scope` is "visitor", "tenant" or "global". The demo uses all three: a
 * per-visitor cap so one person cannot drain the day, and a global cap so the
 * deployment as a whole stays inside every provider's free allowance.
 */
export const quotaCounters = sqliteTable(
  "quota_counters",
  {
    scope: text("scope", { enum: ["visitor", "tenant", "global"] }).notNull(),
    key: text("key").notNull(),
    day: text("day").notNull(),
    metric: text("metric").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [primaryKey({ columns: [table.scope, table.key, table.day, table.metric] })],
);
