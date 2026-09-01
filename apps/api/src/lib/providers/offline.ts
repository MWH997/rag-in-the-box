import { indexDimensions, type Env } from "../../env.js";
import type { ChatStreamOptions, ChatStreamResult, EmbeddingResult } from "./types.js";

/**
 * Offline stand-ins for the AI providers.
 *
 * Turned on with OFFLINE_AI=true. Cloudflare has no local emulation for Workers
 * AI, so without this the app cannot be run or tested at all without an
 * account. These implementations are deterministic and self-contained, which
 * makes them useful for contributors, for continuous integration and for
 * end-to-end interface tests.
 *
 * They are not a simulation of model quality. The embedding is a hashed
 * bag-of-words projection and the answer is extractive rather than generated.
 * The deploy script refuses to set OFFLINE_AI on a real deployment.
 */

function hash(value: string): number {
  let h = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

/**
 * Projects a bag of words into a fixed-dimension unit vector.
 *
 * Each token contributes to two dimensions chosen by its hash, with a sign also
 * taken from the hash. Documents that share vocabulary land near each other,
 * which is enough for retrieval to behave sensibly in a test.
 */
export function offlineEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const primary = hash(token);
    const secondary = hash(`${token}#2`);
    const signBit = (primary >>> 31) & 1;
    const primaryIndex = primary % dimensions;
    const secondaryIndex = secondary % dimensions;
    vector[primaryIndex] = (vector[primaryIndex] ?? 0) + (signBit === 0 ? 1 : -1);
    vector[secondaryIndex] = (vector[secondaryIndex] ?? 0) + 0.5;
  }
  let sum = 0;
  for (const value of vector) sum += value * value;
  if (sum === 0) return vector;
  const inverse = 1 / Math.sqrt(sum);
  return vector.map((value) => value * inverse);
}

export function offlineEmbed(env: Env, model: string, inputs: string[]): EmbeddingResult {
  const dimensions = indexDimensions(env);
  return {
    vectors: inputs.map((input) => offlineEmbedding(input, dimensions)),
    model,
    provider: "offline",
    tokens: inputs.reduce((sum, input) => sum + Math.ceil(input.length / 4), 0),
  };
}

/**
 * Answers from the supplied context by quoting the passages it was given.
 *
 * The reply names the passages it used so citation rendering, streaming and
 * usage accounting all exercise the same code paths as a real provider.
 */
export function offlineChat(options: ChatStreamOptions): ChatStreamResult {
  const lastTurn = options.messages.at(-1)?.content ?? "";
  const questionLine = lastTurn.split("\n").find((line) => line.startsWith("Question: "));
  const question = questionLine?.slice("Question: ".length) ?? lastTurn;

  const passages = [...lastTurn.matchAll(/\[(\d+)\]\s([^\n]+)\n([\s\S]*?)(?=\n\n\[\d+\]|\n\nQuestion:|$)/g)];

  const sentences = passages.slice(0, 3).map((match, index) => {
    const body = (match[3] ?? "").replace(/\s+/g, " ").trim();
    return `${body.slice(0, 220)}${body.length > 220 ? "..." : ""} [${match[1] ?? index + 1}]`;
  });

  const answer =
    passages.length === 0
      ? "The documents loaded here do not cover that. Try a question about the material in the reader pane."
      : [
          `Here is what the documents say about "${question.slice(0, 90)}":`,
          "",
          ...sentences.map((sentence) => `- ${sentence}`),
          "",
          "This answer came from the offline development provider, which quotes the retrieved passages rather than generating new text.",
        ].join("\n");

  const promptTokens = Math.ceil(lastTurn.length / 4);
  const completionTokens = Math.ceil(answer.length / 4);

  async function* iterate() {
    // Emitted in small pieces so the interface exercises real streaming.
    const words = answer.split(/(\s+)/);
    let buffer = "";
    for (const word of words) {
      buffer += word;
      if (buffer.length >= 12) {
        yield { text: buffer };
        buffer = "";
      }
    }
    if (buffer.length > 0) yield { text: buffer };
  }

  return { stream: iterate(), usage: () => ({ promptTokens, completionTokens }) };
}
