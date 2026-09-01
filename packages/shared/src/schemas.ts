import { z } from "zod";

import {
  CHAT_PROVIDERS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_PROVIDERS,
  type ChatProvider,
  type EmbeddingProvider,
} from "./providers.js";
import { TIERS } from "./tiers.js";

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

export const HealthResponse = z.object({
  ok: z.literal(true),
  version: z.string(),
  mode: z.enum(["self-host", "demo"]),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ApiError = z.object({
  error: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const SOURCE_KINDS = ["pdf", "docx", "csv", "txt", "md"] as const;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKind>;

export const DOCUMENT_STATUSES = [
  "pending",
  "extracting",
  "parsing",
  "embedding",
  "active",
  "failed",
] as const;
export const DocumentStatus = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const EXTRACTORS = ["browser", "worker", "llamaparse"] as const;
export const Extractor = z.enum(EXTRACTORS);
export type Extractor = z.infer<typeof Extractor>;

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Document creation carries metadata only.
 *
 * The text itself arrives afterwards through the ingest endpoint in small
 * batches. Splitting it that way keeps every Worker invocation inside the
 * free plan's 10 ms CPU budget, its 50 D1 queries, and D1's 100 KB cap on a
 * single SQL statement, none of which a whole-document upload could respect.
 */
export const CreateDocumentRequest = z.object({
  filename: z.string().min(1).max(255),
  kind: SourceKind,
  sizeBytes: z.number().int().nonnegative().max(1_000_000_000),
  extractor: Extractor,
  pageCount: z.number().int().nonnegative().max(20_000),
  totalChunks: z.number().int().nonnegative().max(50_000),
});
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequest>;

export const CreateDocumentResponse = z.object({
  documentId: z.string(),
  /** Chunks the client may send per ingest call for this tenant's tier. */
  batchSize: z.number().int().positive(),
});
export type CreateDocumentResponse = z.infer<typeof CreateDocumentResponse>;

/** One slice of the document as the reader pane displays it. */
export const IngestSegment = z.object({
  seq: z.number().int().nonnegative(),
  charStart: z.number().int().nonnegative(),
  page: z.number().int().positive().nullable(),
  markdown: z.string().max(24_000),
});
export type IngestSegment = z.infer<typeof IngestSegment>;

/** One retrieval unit, already chunked in the browser. */
export const IngestChunk = z.object({
  seq: z.number().int().nonnegative(),
  heading: z.string().max(300).nullable(),
  page: z.number().int().positive().nullable(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  /** Where this chunk's own content starts, past any carried overlap. */
  bodyStart: z.number().int().nonnegative(),
  text: z.string().min(1).max(8_000),
  tokenEstimate: z.number().int().nonnegative(),
});
export type IngestChunk = z.infer<typeof IngestChunk>;

export const IngestRequest = z
  .object({
    segments: z.array(IngestSegment).max(32).default([]),
    chunks: z.array(IngestChunk).max(128).default([]),
    done: z.boolean().default(false),
  })
  .refine((value) => value.segments.length > 0 || value.chunks.length > 0 || value.done, {
    message: "Send segments, chunks, or done",
  });
export type IngestRequest = z.infer<typeof IngestRequest>;

export const IngestResponse = z.object({
  documentId: z.string(),
  status: DocumentStatus,
  embedded: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** Wall-clock time the Worker spent on this batch, shown in the pipeline view. */
  elapsedMs: z.number().nonnegative(),
});
export type IngestResponse = z.infer<typeof IngestResponse>;

export const DocumentSummary = z.object({
  id: z.string(),
  filename: z.string(),
  kind: SourceKind,
  sizeBytes: z.number().int().nonnegative(),
  status: DocumentStatus,
  extractor: Extractor.nullable(),
  chunkCount: z.number().int().nonnegative(),
  embeddedCount: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
  embeddingModel: z.string().nullable(),
  /** True when this document was embedded with a different model than current. */
  stale: z.boolean(),
  /** True when the document belongs to the shared curated workspace. */
  shared: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

export const DocumentListResponse = z.object({
  documents: z.array(DocumentSummary),
  usage: z.object({
    documents: z.number().int().nonnegative(),
    maxDocuments: z.number().int().nonnegative(),
    chunks: z.number().int().nonnegative(),
    maxChunks: z.number().int().nonnegative(),
  }),
});
export type DocumentListResponse = z.infer<typeof DocumentListResponse>;

export const DocumentContentResponse = z.object({
  id: z.string(),
  filename: z.string(),
  pageCount: z.number().int().nonnegative(),
  segments: z.array(
    z.object({
      seq: z.number().int().nonnegative(),
      charStart: z.number().int().nonnegative(),
      page: z.number().int().positive().nullable(),
      markdown: z.string(),
    }),
  ),
});
export type DocumentContentResponse = z.infer<typeof DocumentContentResponse>;

/* -------------------------------------------------------------------------- */
/* Chat                                                                        */
/* -------------------------------------------------------------------------- */

export const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8_000),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatRequest = z.object({
  messages: z.array(ChatMessage).min(1).max(20),
  documentIds: z.array(z.string()).max(50).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

export const Citation = z.object({
  index: z.number().int().positive(),
  chunkId: z.string(),
  documentId: z.string(),
  filename: z.string(),
  heading: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  score: z.number(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  snippet: z.string(),
});
export type Citation = z.infer<typeof Citation>;

/** Server-sent event payloads streamed by POST /api/chat. */
export const ChatEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), stage: z.string() }),
  z.object({ type: z.literal("citations"), citations: z.array(Citation) }),
  z.object({ type: z.literal("token"), text: z.string() }),
  z.object({
    type: z.literal("done"),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    model: z.string(),
    retrievalMs: z.number().nonnegative(),
    totalMs: z.number().nonnegative(),
  }),
  z.object({ type: z.literal("error"), message: z.string(), code: z.string() }),
]);
export type ChatEvent = z.infer<typeof ChatEvent>;

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export const TenantSettings = z.object({
  tier: z.enum(TIERS),
  embeddingProvider: z.enum(EMBEDDING_PROVIDERS),
  embeddingModel: z.string().min(1),
  chatProvider: z.enum(CHAT_PROVIDERS),
  chatModel: z.string().min(1),
  systemPrompt: z.string().max(4_000),
  /** Read-only view of which optional keys the deployment actually has. */
  available: z.object({
    workersAi: z.boolean(),
    openai: z.boolean(),
    deepseek: z.boolean(),
    llamaparse: z.boolean(),
    r2: z.boolean(),
  }),
  /** True when stored vectors were produced by a different embedding model. */
  reindexRequired: z.boolean(),
  /** Dimension the Vectorize index was created with. */
  indexDimensions: z.number().int().positive(),
  limits: z.object({
    maxUploadBytes: z.number().int(),
    maxDocuments: z.number().int(),
    maxChunksPerTenant: z.number().int(),
    ingestBatchSize: z.number().int(),
    chatMessagesPerDay: z.number().int(),
    documentsPerDay: z.number().int(),
    retrievalTopK: z.number().int(),
    serverSideParsing: z.boolean(),
    ocrFallback: z.boolean(),
  }),
});
export type TenantSettings = z.infer<typeof TenantSettings>;

export const UpdateSettingsRequest = z
  .object({
    tier: z.enum(TIERS).optional(),
    embeddingProvider: z.enum(EMBEDDING_PROVIDERS).optional(),
    embeddingModel: z.string().min(1).max(120).optional(),
    chatProvider: z.enum(CHAT_PROVIDERS).optional(),
    chatModel: z.string().min(1).max(120).optional(),
    systemPrompt: z.string().max(4_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;

/* -------------------------------------------------------------------------- */
/* Usage and quota                                                             */
/* -------------------------------------------------------------------------- */

export const UsageDay = z.object({
  day: z.string(),
  chatMessages: z.number().int().nonnegative(),
  documentsIngested: z.number().int().nonnegative(),
  embeddingTokens: z.number().int().nonnegative(),
  chatTokens: z.number().int().nonnegative(),
  neurons: z.number().nonnegative(),
  externalCostUsd: z.number().nonnegative(),
});
export type UsageDay = z.infer<typeof UsageDay>;

export const UsageResponse = z.object({
  today: UsageDay,
  history: z.array(UsageDay),
  budget: z.object({
    chatMessagesPerDay: z.number().int(),
    documentsPerDay: z.number().int(),
    neuronsPerDay: z.number().int(),
    d1RowsWrittenPerDay: z.number().int(),
    vectorDimensionsStored: z.number().int(),
    vectorDimensionsStoredLimit: z.number().int(),
  }),
});
export type UsageResponse = z.infer<typeof UsageResponse>;

export const QuotaState = z.object({
  allowed: z.boolean(),
  reason: z.string().nullable(),
  visitor: z.object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
  }),
  global: z.object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
  }),
  resetsAt: z.number().int(),
});
export type QuotaState = z.infer<typeof QuotaState>;

export const DemoStatusResponse = z.object({
  quota: QuotaState,
  featuredDocumentId: z.string().nullable(),
  uploadsEnabled: z.boolean(),
});
export type DemoStatusResponse = z.infer<typeof DemoStatusResponse>;

/* -------------------------------------------------------------------------- */
/* Session                                                                     */
/* -------------------------------------------------------------------------- */

export const MeResponse = z.object({
  userId: z.string(),
  tenantId: z.string(),
  email: z.string(),
  organizationName: z.string(),
  tier: z.enum(TIERS),
});
export type MeResponse = z.infer<typeof MeResponse>;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function defaultModelFor(kind: "embedding", provider: EmbeddingProvider): string;
export function defaultModelFor(kind: "chat", provider: ChatProvider): string;
export function defaultModelFor(
  kind: "embedding" | "chat",
  provider: EmbeddingProvider | ChatProvider,
): string {
  if (kind === "embedding") {
    return provider === "openai" ? "text-embedding-3-small" : DEFAULT_EMBEDDING_MODEL;
  }
  if (provider === "openai") return "gpt-4.1-mini";
  if (provider === "deepseek") return "deepseek-chat";
  return DEFAULT_CHAT_MODEL;
}
