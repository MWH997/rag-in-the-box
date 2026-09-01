import {
  ChatRequest,
  TIER_LIMITS,
  findChatModel,
  neuronsForChat,
  usdForChat,
  type Citation,
} from "@rag/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, eq, inArray } from "drizzle-orm";

import { servedOffline } from "../env.js";
import { chatLogs, chunks, documents } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import { buildContextBlock, buildUserTurn, trimHistory } from "../lib/prompt.js";
import { embed, streamChat, type ChatTurn } from "../lib/providers/index.js";
import { consumeQuota, refundQuota } from "../lib/quota.js";
import { loadSettings } from "../lib/settings.js";
import { METRICS, d1Deltas, recordUsage } from "../lib/usage.js";
import { queryChunks } from "../lib/vectors.js";
import { quotaChecksFor, type AppEnv } from "../middleware/tenant.js";

export const chatRoute = new Hono<AppEnv>();

/**
 * Turns of conversation carried into the next prompt.
 *
 * Fixed on purpose, unlike the context budget, answer length and temperature,
 * which are per workspace. This one trades against the same prompt budget the
 * retrieved passages need, so two settings competing for one budget would let a
 * workspace starve its own retrieval without seeing why the answers got worse.
 */
const HISTORY_TURNS = 6;

chatRoute.post("/chat", async (c) => {
  const startedAt = Date.now();
  const db = c.get("db");
  const tenant = c.get("tenant");
  const body = ChatRequest.parse(await c.req.json());

  const question = body.messages.at(-1);
  if (!question || question.role !== "user") {
    throw new HttpError(400, "no_question", "The last message must come from the user.");
  }

  const settings = await loadSettings(db, c.env, tenant.tenantId);
  const limits = TIER_LIMITS[settings.tier];
  const quotaChecks = quotaChecksFor(c.env, tenant, "chat", limits.chatMessagesPerDay);
  await consumeQuota(db, quotaChecks);

  return streamSSE(c, async (stream) => {
    const send = async (payload: unknown) => {
      await stream.writeSSE({ data: JSON.stringify(payload) });
    };

    try {
      await send({ type: "status", stage: "retrieving" });
      const retrievalStarted = Date.now();

      const embedding = await embed(c.env, settings.embeddingProvider, settings.embeddingModel, [
        question.content,
      ]);
      const vector = embedding.vectors[0];
      if (!vector) throw new HttpError(502, "embed_failed", "Could not embed the question.");

      // Read tenants are searched separately because Vectorize scopes a query to
      // one namespace. In self-host mode there is exactly one.
      const matches = (
        await Promise.all(
          tenant.readTenantIds.map((readTenantId) =>
            queryChunks(c.env, readTenantId, vector, limits.retrievalTopK, db),
          ),
        )
      )
        .flat()
        .filter((match) => {
          if (!body.documentIds || body.documentIds.length === 0) return true;
          return body.documentIds.includes(match.documentId);
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limits.retrievalTopK);

      const chunkIds = matches.map((match) => match.chunkId);
      const rows =
        chunkIds.length > 0
          ? await db
              .select({
                id: chunks.id,
                documentId: chunks.documentId,
                heading: chunks.heading,
                page: chunks.page,
                charStart: chunks.charStart,
                charEnd: chunks.charEnd,
                bodyStart: chunks.bodyStart,
                text: chunks.text,
                filename: documents.filename,
              })
              .from(chunks)
              .innerJoin(documents, eq(documents.id, chunks.documentId))
              .where(
                and(inArray(chunks.id, chunkIds), inArray(chunks.tenantId, tenant.readTenantIds)),
              )
          : [];

      const byId = new Map(rows.map((row) => [row.id, row]));
      const passages = matches
        .map((match, index) => {
          const row = byId.get(match.chunkId);
          if (!row) return null;
          // The snippet skips the overlap carried from the previous chunk, so
          // the reader is pointed at this passage rather than at the tail of
          // the one before it.
          const bodyOffset = Math.max(
            0,
            Math.min(row.bodyStart - row.charStart, row.text.length - 1),
          );
          const citation: Citation = {
            index: index + 1,
            chunkId: row.id,
            documentId: row.documentId,
            filename: row.filename,
            heading: row.heading,
            page: row.page,
            score: match.score,
            charStart: row.bodyStart,
            charEnd: row.charEnd,
            snippet: row.text.slice(bodyOffset, bodyOffset + 260),
          };
          return { citation, text: row.text };
        })
        .filter((value): value is { citation: Citation; text: string } => value !== null)
        .map((passage, index) => ({
          ...passage,
          citation: { ...passage.citation, index: index + 1 },
        }));

      const { block, used } = buildContextBlock(passages, settings.contextCharBudget);
      const retrievalMs = Date.now() - retrievalStarted;
      await send({ type: "citations", citations: used });
      await send({ type: "status", stage: "generating" });

      const history = trimHistory(body.messages.slice(0, -1), HISTORY_TURNS);
      const turns: ChatTurn[] = [
        { role: "system", content: settings.systemPrompt },
        ...history,
        { role: "user", content: buildUserTurn(question.content, block) },
      ];

      const result = streamChat(c.env, settings.chatProvider, {
        model: settings.chatModel,
        messages: turns,
        maxTokens: settings.maxAnswerTokens,
        temperature: settings.temperature,
      });

      let answer = "";
      for await (const piece of result.stream) {
        answer += piece.text;
        await send({ type: "token", text: piece.text });
      }

      const usage = result.usage();

      // A model can finish successfully and say nothing. The reasoning models
      // do it when their thinking uses the whole output budget: tokens are
      // spent, the request succeeds, and the reader gets an empty bubble with
      // no idea why. Say so instead, and name the cause, because the fix is to
      // pick a different model or raise the answer length.
      if (answer.trim().length === 0) {
        await send({
          type: "error",
          code: "empty_answer",
          message:
            "The model finished without writing an answer. This usually means it spent its whole answer budget reasoning. Raise the answer length in settings, or choose a model that replies directly.",
        });
        await refundQuota(db, quotaChecks).catch(() => undefined);
        await send({
          type: "done",
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          model: settings.chatModel,
          retrievalMs,
          totalMs: Date.now() - startedAt,
        });
        return;
      }

      // Report what actually answered, asking the same question the dispatcher
      // asked, so the two cannot credit different models for one answer.
      const offline = servedOffline(c.env, settings.chatProvider);
      const model = offline ? undefined : findChatModel(settings.chatProvider, settings.chatModel);
      const reportedModel = offline ? "offline development provider" : settings.chatModel;
      const totalMs = Date.now() - startedAt;

      await send({
        type: "done",
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        model: reportedModel,
        retrievalMs,
        totalMs,
      });

      // Persistence happens after the answer is on the wire so a slow write
      // never delays the reader.
      await db.insert(chatLogs).values([
        {
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          role: "user",
          content: question.content,
          model: reportedModel,
        },
        {
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          role: "assistant",
          content: answer,
          citations: JSON.stringify(used),
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          model: reportedModel,
          latencyMs: totalMs,
        },
      ]);

      await recordUsage(db, tenant.tenantId, [
        { metric: METRICS.chatMessages, value: 1 },
        { metric: METRICS.chatPromptTokens, value: usage.promptTokens },
        { metric: METRICS.chatCompletionTokens, value: usage.completionTokens },
        {
          metric: METRICS.neurons,
          value: model ? neuronsForChat(model, usage.promptTokens, usage.completionTokens) : 0,
        },
        {
          metric: METRICS.externalCostUsd,
          value:
            model && settings.chatProvider !== "workers-ai"
              ? usdForChat(model, usage.promptTokens, usage.completionTokens)
              : 0,
        },
        ...d1Deltas(c.get("d1Usage")()),
      ]);
    } catch (cause) {
      // The allowance is returned when the failure was ours, not the caller's.
      await refundQuota(db, quotaChecks).catch(() => undefined);
      const message =
        cause instanceof HttpError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "The answer could not be generated.";
      const code = cause instanceof HttpError ? cause.code : "chat_failed";
      await send({ type: "error", message, code });
    }
  });
});
