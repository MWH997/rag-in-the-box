import type { ChatProvider } from "@rag/shared";

import { isOfflineAi, type Env } from "../../env.js";
import { offlineChat } from "./offline.js";
import {
  ProviderError,
  type ChatStreamOptions,
  type ChatStreamResult,
  type ChatTurn,
} from "./types.js";

const OPENAI_COMPATIBLE_BASE: Record<"openai" | "deepseek", string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
};

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function promptTokensFor(messages: ChatTurn[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
}

/**
 * Reads a Server-Sent Events body and yields each `data:` payload.
 *
 * Both Workers AI and the OpenAI-compatible providers stream SSE, so one reader
 * serves all three. Parsing is done incrementally on a small buffer rather than
 * accumulating the whole body, which keeps memory flat on long answers.
 */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const line of frame.split("\n")) {
          const trimmed = line.trimStart();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload.length > 0) yield payload;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function streamWorkersAi(env: Env, options: ChatStreamOptions): ChatStreamResult {
  let completionTokens = 0;
  const promptTokens = promptTokensFor(options.messages);

  async function* iterate() {
    let raw: unknown;
    try {
      raw = await env.AI.run(options.model as Parameters<Ai["run"]>[0], {
        messages: options.messages,
        stream: true,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
      } as never);
    } catch (cause) {
      throw new ProviderError(
        `Workers AI chat call failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        "chat_workers_ai_failed",
      );
    }

    if (!(raw instanceof ReadableStream)) {
      // Some models ignore `stream` and answer in one piece. Handle both.
      const single = raw as { response?: string; usage?: { completion_tokens?: number } };
      const text = single.response ?? "";
      completionTokens = single.usage?.completion_tokens ?? estimateTokens(text);
      if (text) yield { text };
      return;
    }

    for await (const payload of readSse(raw as ReadableStream<Uint8Array>)) {
      if (payload === "[DONE]") break;
      let parsed: { response?: string; usage?: { completion_tokens?: number } };
      try {
        parsed = JSON.parse(payload) as typeof parsed;
      } catch {
        continue;
      }
      if (parsed.usage?.completion_tokens) completionTokens = parsed.usage.completion_tokens;
      const text = parsed.response;
      if (typeof text === "string" && text.length > 0) {
        if (!parsed.usage?.completion_tokens) completionTokens += estimateTokens(text);
        yield { text };
      }
    }
  }

  return {
    stream: iterate(),
    usage: () => ({ promptTokens, completionTokens }),
  };
}

function streamOpenAiCompatible(
  env: Env,
  provider: "openai" | "deepseek",
  options: ChatStreamOptions,
): ChatStreamResult {
  const apiKey = provider === "openai" ? env.OPENAI_API_KEY : env.DEEPSEEK_API_KEY;
  let promptTokens = promptTokensFor(options.messages);
  let completionTokens = 0;

  async function* iterate() {
    if (!apiKey) {
      throw new ProviderError(
        `${provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY"} is not configured`,
        "chat_missing_key",
        400,
      );
    }

    const response = await fetch(`${OPENAI_COMPATIBLE_BASE[provider]}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new ProviderError(
        `${provider} chat responded ${response.status}: ${detail.slice(0, 300)}`,
        "chat_upstream_failed",
      );
    }

    for await (const payload of readSse(response.body)) {
      if (payload === "[DONE]") break;
      let parsed: {
        choices?: { delta?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        parsed = JSON.parse(payload) as typeof parsed;
      } catch {
        continue;
      }
      if (parsed.usage) {
        promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
        completionTokens = parsed.usage.completion_tokens ?? completionTokens;
      }
      const text = parsed.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        if (!parsed.usage) completionTokens += estimateTokens(text);
        yield { text };
      }
    }
  }

  return {
    stream: iterate(),
    usage: () => ({ promptTokens, completionTokens }),
  };
}

export function streamChat(
  env: Env,
  provider: ChatProvider,
  options: ChatStreamOptions,
): ChatStreamResult {
  if (isOfflineAi(env)) return offlineChat(options);
  if (provider === "workers-ai") return streamWorkersAi(env, options);
  return streamOpenAiCompatible(env, provider, options);
}
