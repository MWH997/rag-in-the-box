import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

// BetterAuth's tables (user/session/account/verification/organization/member/
// invitation) live in ./auth-schema.ts, regenerated via
// `npx @better-auth/cli generate --config auth.config.ts --output src/db/auth-schema.ts`.
// Re-exported here so this file stays the single schema entry point per §2.1.
export * from "./auth-schema.js";

export const documents = sqliteTable(
  "documents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    r2Key: text("r2_key"),
    llamaparseJobId: text("llamaparse_job_id"),
    status: text("status", {
      enum: ["uploading", "parsing", "embedding", "active", "failed"],
    }).notNull(),
    parser: text("parser", { enum: ["local", "llamaparse"] }),
    error: text("error"),
    chunkCount: integer("chunk_count").notNull().default(0),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    updatedAt: integer("updated_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [index("documents_tenant_id_idx").on(table.tenantId)],
);

export const chatLogs = sqliteTable(
  "chat_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["user", "assistant", "tool"] }).notNull(),
    content: text("content").notNull(),
    toolName: text("tool_name"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    model: text("model").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .$defaultFn(() => Date.now()),
  },
  (table) => [index("chat_logs_tenant_id_idx").on(table.tenantId)],
);

export const usageDaily = sqliteTable(
  "usage_daily",
  {
    tenantId: text("tenant_id").notNull(),
    day: text("day").notNull(),
    api: text("api", { enum: ["openai", "deepseek", "llamaparse"] }).notNull(),
    tokens: integer("tokens").notNull().default(0),
    requests: integer("requests").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.day, table.api] })],
);
