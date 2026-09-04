import { embeddingFitsIndex, findEmbeddingModel, type EmbeddingProvider } from "@rag/shared";

import { baseUrl, indexDimensions, ollamaBaseUrl, servedOffline, type Env } from "../../env.js";
import { offlineEmbed } from "./offline.js";
import { ProviderError, type EmbeddingResult } from "./types.js";

/**
 * Scales a vector to unit length.
 *
 * Vectorize is configured for cosine distance, which does not require unit
 * vectors, but OpenAI's own guidance is to renormalise after shortening an
 * embedding with the `dimensions` parameter. Normalising both providers keeps
 * scores on one scale, so a relevance threshold means the same thing whichever
 * provider produced the vector.
 */
function normalize(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  if (sum === 0) return vector;
  const inverse = 1 / Math.sqrt(sum);
  return vector.map((value) => value * inverse);
}

function assertDimensions(vectors: number[][], model: string, expected: number): void {
  const first = vectors[0];
  if (!first) throw new ProviderError("Embedding provider returned no vectors", "embed_empty");
  if (first.length !== expected) {
    throw new ProviderError(
      `Model ${model} returned ${first.length} dimensions, index expects ${expected}`,
      "embed_dimension_mismatch",
      500,
    );
  }
}

/**
 * Rejects a model that cannot fill the configured index.
 *
 * Shortening is only safe for models trained for it. Silently truncating any
 * other model would quietly wreck recall, so this throws instead.
 */
function checkModelFitsIndex(provider: EmbeddingProvider, model: string, expected: number): void {
  const known = findEmbeddingModel(provider, model);
  if (!known) return;
  if (!embeddingFitsIndex(known, expected)) {
    throw new ProviderError(
      `Model ${model} emits ${known.nativeDimensions} dimensions and cannot fill a ${expected}-dimension index. ` +
        "Pick a model with matching dimensions or recreate the index at that size.",
      "embed_model_index_mismatch",
      400,
    );
  }
}

/**
 * Reads a provider's JSON reply.
 *
 * response.json() throws a SyntaxError when the body is not JSON, which happens
 * when a gateway returns an HTML error page with a 200, and that error carries
 * nothing identifying it as a provider's fault. Left bare it reaches the client
 * as "something went wrong", naming the deployment rather than the upstream
 * that actually failed. Saying which provider returned the mess is the whole
 * value of catching it here.
 */
async function readProviderJson<T>(response: Response, provider: string, code: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderError(`${provider} returned a reply that was not JSON`, code, 502);
  }
}

async function embedWorkersAi(env: Env, model: string, inputs: string[]): Promise<EmbeddingResult> {
  const expected = indexDimensions(env);
  checkModelFitsIndex("workers-ai", model, expected);
  let response: { data?: number[][]; shape?: number[] };
  try {
    response = (await env.AI.run(
      model as Parameters<Ai["run"]>[0],
      {
        text: inputs,
      } as never,
    )) as { data?: number[][]; shape?: number[] };
  } catch (cause) {
    throw new ProviderError(
      `Workers AI embedding call failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      "embed_workers_ai_failed",
    );
  }

  const data = response.data;
  if (!Array.isArray(data) || data.length !== inputs.length) {
    throw new ProviderError("Workers AI returned an unexpected embedding shape", "embed_bad_shape");
  }

  const vectors = data.map((vector) => normalize(vector));
  assertDimensions(vectors, model, expected);
  return {
    vectors,
    model,
    provider: "workers-ai",
    tokens: inputs.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
  };
}

async function embedOpenAi(env: Env, model: string, inputs: string[]): Promise<EmbeddingResult> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("OPENAI_API_KEY is not configured", "embed_missing_key", 400);
  }
  const expected = indexDimensions(env);
  checkModelFitsIndex("openai", model, expected);

  const endpoint = `${baseUrl(env.OPENAI_BASE_URL, "https://api.openai.com/v1")}/embeddings`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    // `dimensions` shortens the embedding at the source so OpenAI models can
    // fill the same index as a smaller Cloudflare model. Supported by the
    // text-embedding-3 family, which is trained for shortened prefixes.
    body: JSON.stringify({ model, input: inputs, dimensions: expected }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ProviderError(
      `OpenAI embeddings responded ${response.status}: ${detail.slice(0, 300)}`,
      "embed_openai_failed",
    );
  }

  const payload = await readProviderJson<{
    data?: { embedding: number[]; index: number }[];
    usage?: { total_tokens?: number };
  }>(response, "OpenAI", "embed_openai_bad_json");
  const rows = payload.data;
  if (!Array.isArray(rows) || rows.length !== inputs.length) {
    throw new ProviderError("OpenAI returned an unexpected embedding shape", "embed_bad_shape");
  }

  const ordered = [...rows].sort((a, b) => a.index - b.index);
  const vectors = ordered.map((row) => normalize(row.embedding));
  assertDimensions(vectors, model, expected);
  return {
    vectors,
    model,
    provider: "openai",
    tokens:
      payload.usage?.total_tokens ??
      inputs.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
  };
}

/**
 * Embeds through a local Ollama server.
 *
 * Ollama serves the OpenAI embeddings shape but has no `dimensions` parameter,
 * so the model must already emit the index's width. That is why all-minilm is
 * the default here: 384 dimensions natively, the same as the index. The shared
 * fit check catches the mismatch before the call, and assertDimensions catches
 * a model that lies about its own width.
 */
async function embedOllama(env: Env, model: string, inputs: string[]): Promise<EmbeddingResult> {
  const base = ollamaBaseUrl(env);
  if (!base) {
    throw new ProviderError(
      "OLLAMA_BASE_URL is not configured. Start Ollama and set it, or pick another provider.",
      "embed_missing_ollama_url",
      400,
    );
  }
  const expected = indexDimensions(env);
  checkModelFitsIndex("ollama", model, expected);

  let response: Response;
  try {
    response = await fetch(`${base}/v1/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: inputs }),
    });
  } catch (cause) {
    throw new ProviderError(
      `Could not reach Ollama at ${base}: ${cause instanceof Error ? cause.message : String(cause)}`,
      "embed_ollama_unreachable",
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ProviderError(
      `Ollama embeddings responded ${response.status}. Check the model is pulled: ${detail.slice(0, 200)}`,
      "embed_ollama_failed",
    );
  }

  const payload = await readProviderJson<{
    data?: { embedding: number[]; index: number }[];
    usage?: { total_tokens?: number };
  }>(response, "Ollama", "embed_ollama_bad_json");
  const rows = payload.data;
  if (!Array.isArray(rows) || rows.length !== inputs.length) {
    throw new ProviderError("Ollama returned an unexpected embedding shape", "embed_bad_shape");
  }

  const ordered = [...rows].sort((a, b) => a.index - b.index);
  const vectors = ordered.map((row) => normalize(row.embedding));
  assertDimensions(vectors, model, expected);
  return {
    vectors,
    model,
    provider: "ollama",
    tokens:
      payload.usage?.total_tokens ??
      inputs.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
  };
}

/**
 * Embeds a batch of texts.
 *
 * Callers are responsible for batch size. The ingestion route derives it from
 * the tier so a single Worker invocation stays inside its CPU and subrequest
 * budget: this function issues exactly one outbound call per invocation.
 */
export async function embed(
  env: Env,
  provider: EmbeddingProvider,
  model: string,
  inputs: string[],
): Promise<EmbeddingResult> {
  if (inputs.length === 0) {
    return { vectors: [], model, provider, tokens: 0 };
  }
  if (servedOffline(env, provider)) return offlineEmbed(env, model, inputs);
  if (provider === "ollama") return embedOllama(env, model, inputs);
  return provider === "openai"
    ? embedOpenAi(env, model, inputs)
    : embedWorkersAi(env, model, inputs);
}
