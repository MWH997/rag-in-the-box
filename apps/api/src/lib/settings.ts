import {
  CHAT_MODELS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_PROVIDER,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_PROVIDER,
  EMBEDDING_MODELS,
  TIER_LIMITS,
  defaultModelFor,
  embeddingFitsIndex,
  findEmbeddingModel,
  type ChatProvider,
  type EmbeddingProvider,
  type TenantSettings,
  type Tier,
  type UpdateSettingsRequest,
} from "@rag/shared";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";

import { capabilities, indexDimensions, type Env } from "../env.js";
import type { Database } from "../db/index.js";
import { documents, tenantSettings } from "../db/schema.js";
import { HttpError } from "./errors.js";

export const DEFAULT_SYSTEM_PROMPT = [
  "You answer questions using only the numbered context passages supplied with the question.",
  "Cite the passages you used with bracketed numbers such as [1] or [2][3], placed right after the claim they support.",
  "If the passages do not contain the answer, say so plainly and do not guess.",
  "Keep answers short and concrete. Quote figures and names exactly as they appear.",
].join(" ");

export interface ResolvedSettings {
  tier: Tier;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  chatProvider: ChatProvider;
  chatModel: string;
  systemPrompt: string;
}

function defaultTier(env: Env): Tier {
  return env.DEFAULT_TIER === "paid" ? "paid" : "free";
}

/**
 * Reads a tenant's settings, falling back to the deployment defaults.
 *
 * A stored provider whose credential has since been removed is downgraded to
 * Workers AI rather than failing every request. The settings screen shows the
 * downgrade, so this never silently hides a misconfiguration.
 */
export async function loadSettings(
  db: Database,
  env: Env,
  tenantId: string,
): Promise<ResolvedSettings> {
  const [row] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1);

  const caps = capabilities(env);
  const tier = row?.tier ?? defaultTier(env);

  let embeddingProvider = (row?.embeddingProvider ?? DEFAULT_EMBEDDING_PROVIDER) as EmbeddingProvider;
  let embeddingModel = row?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  if (embeddingProvider === "openai" && !caps.openai) {
    embeddingProvider = "workers-ai";
    embeddingModel = DEFAULT_EMBEDDING_MODEL;
  }

  let chatProvider = (row?.chatProvider ?? DEFAULT_CHAT_PROVIDER) as ChatProvider;
  let chatModel = row?.chatModel ?? DEFAULT_CHAT_MODEL;
  if (
    (chatProvider === "openai" && !caps.openai) ||
    (chatProvider === "deepseek" && !caps.deepseek)
  ) {
    chatProvider = "workers-ai";
    chatModel = DEFAULT_CHAT_MODEL;
  }

  return {
    tier,
    embeddingProvider,
    embeddingModel,
    chatProvider,
    chatModel,
    systemPrompt: row?.systemPrompt?.trim() ? row.systemPrompt : DEFAULT_SYSTEM_PROMPT,
  };
}

/** True when documents were embedded with a model other than the current one. */
export async function reindexRequired(
  db: Database,
  tenantId: string,
  embeddingModel: string,
): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        isNotNull(documents.embeddingModel),
        ne(documents.embeddingModel, embeddingModel),
      ),
    );
  return (row?.count ?? 0) > 0;
}

function validateModel(next: ResolvedSettings, env: Env): void {
  const embedding = findEmbeddingModel(next.embeddingProvider, next.embeddingModel);
  if (!embedding) {
    const known = EMBEDDING_MODELS[next.embeddingProvider].map((model) => model.id).join(", ");
    throw new HttpError(400, "unknown_embedding_model", `Unknown embedding model. Known: ${known}`);
  }
  const dimensions = indexDimensions(env);
  if (!embeddingFitsIndex(embedding, dimensions)) {
    throw new HttpError(
      400,
      "embedding_index_mismatch",
      `${embedding.label} emits ${embedding.nativeDimensions} dimensions and cannot fill this ${dimensions}-dimension index.`,
    );
  }

  const chat = CHAT_MODELS[next.chatProvider].find((model) => model.id === next.chatModel);
  if (!chat) {
    const known = CHAT_MODELS[next.chatProvider].map((model) => model.id).join(", ");
    throw new HttpError(400, "unknown_chat_model", `Unknown chat model. Known: ${known}`);
  }

  const caps = capabilities(env);
  if (next.chatProvider === "openai" && !caps.openai) {
    throw new HttpError(400, "missing_openai_key", "OPENAI_API_KEY is not set on this deployment.");
  }
  if (next.chatProvider === "deepseek" && !caps.deepseek) {
    throw new HttpError(
      400,
      "missing_deepseek_key",
      "DEEPSEEK_API_KEY is not set on this deployment.",
    );
  }
  if (next.embeddingProvider === "openai" && !caps.openai) {
    throw new HttpError(400, "missing_openai_key", "OPENAI_API_KEY is not set on this deployment.");
  }
  if (next.tier === "free" && !chat.freeTier) {
    throw new HttpError(
      400,
      "model_needs_paid_tier",
      `${chat.label} is not available on the free tier. Switch the tier to paid first.`,
    );
  }
}

export async function saveSettings(
  db: Database,
  env: Env,
  tenantId: string,
  patch: UpdateSettingsRequest,
): Promise<ResolvedSettings> {
  const current = await loadSettings(db, env, tenantId);

  // Changing provider without naming a model moves to that provider's default,
  // which avoids leaving a model id that the new provider does not recognise.
  const embeddingProvider = patch.embeddingProvider ?? current.embeddingProvider;
  const chatProvider = patch.chatProvider ?? current.chatProvider;

  const next: ResolvedSettings = {
    tier: patch.tier ?? current.tier,
    embeddingProvider,
    embeddingModel:
      patch.embeddingModel ??
      (patch.embeddingProvider && patch.embeddingProvider !== current.embeddingProvider
        ? defaultModelFor("embedding", embeddingProvider)
        : current.embeddingModel),
    chatProvider,
    chatModel:
      patch.chatModel ??
      (patch.chatProvider && patch.chatProvider !== current.chatProvider
        ? defaultModelFor("chat", chatProvider)
        : current.chatModel),
    systemPrompt: patch.systemPrompt ?? current.systemPrompt,
  };

  validateModel(next, env);

  await db
    .insert(tenantSettings)
    .values({
      tenantId,
      tier: next.tier,
      embeddingProvider: next.embeddingProvider,
      embeddingModel: next.embeddingModel,
      chatProvider: next.chatProvider,
      chatModel: next.chatModel,
      systemPrompt: next.systemPrompt,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: tenantSettings.tenantId,
      set: {
        tier: next.tier,
        embeddingProvider: next.embeddingProvider,
        embeddingModel: next.embeddingModel,
        chatProvider: next.chatProvider,
        chatModel: next.chatModel,
        systemPrompt: next.systemPrompt,
        updatedAt: Date.now(),
      },
    });

  return next;
}

export async function toApiSettings(
  db: Database,
  env: Env,
  tenantId: string,
  resolved: ResolvedSettings,
): Promise<TenantSettings> {
  const limits = TIER_LIMITS[resolved.tier];
  return {
    ...resolved,
    available: capabilities(env),
    reindexRequired: await reindexRequired(db, tenantId, resolved.embeddingModel),
    indexDimensions: indexDimensions(env),
    limits: {
      maxUploadBytes: limits.maxUploadBytes,
      maxDocuments: limits.maxDocuments,
      maxChunksPerTenant: limits.maxChunksPerTenant,
      ingestBatchSize: limits.ingestBatchSize,
      chatMessagesPerDay: limits.chatMessagesPerDay,
      documentsPerDay: limits.documentsPerDay,
      retrievalTopK: limits.retrievalTopK,
      serverSideParsing: limits.serverSideParsing,
      ocrFallback: limits.ocrFallback,
    },
  };
}
