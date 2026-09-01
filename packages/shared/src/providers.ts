/**
 * Provider and model registry.
 *
 * Every model id, dimension and neuron rate below was read off the vendor's own
 * documentation rather than inferred. Nothing in the runtime hardcodes a model:
 * the runtime reads a provider and model from tenant settings, falls back to
 * the defaults here, and an operator can change both from the settings screen.
 */

/** Default dimension of the Vectorize index. Overridable at deploy time. */
export const DEFAULT_VECTOR_DIMENSIONS = 384;

export const EMBEDDING_PROVIDERS = ["workers-ai", "openai"] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

export const CHAT_PROVIDERS = ["workers-ai", "deepseek", "openai"] as const;
export type ChatProvider = (typeof CHAT_PROVIDERS)[number];

export interface EmbeddingModel {
  id: string;
  label: string;
  note: string;
  /** Dimensions the model emits by default. */
  nativeDimensions: number;
  /**
   * True when the model was trained so a shortened prefix of the vector is
   * still meaningful, which is what makes a smaller index dimension safe.
   * Truncating a model without this property degrades recall, so the app
   * refuses that combination instead of quietly accepting it.
   */
  supportsReducedDimensions: boolean;
  /** Neurons per million input tokens. Zero for providers billed elsewhere. */
  neuronsPerMillionInput: number;
  /** True when the model is reachable on the Cloudflare free plan. */
  freeTier: boolean;
}

export interface ChatModel {
  id: string;
  label: string;
  note: string;
  neuronsPerMillionInput: number;
  neuronsPerMillionOutput: number;
  /** USD per million tokens, for providers billed outside Cloudflare. */
  usdPerMillionInput: number;
  usdPerMillionOutput: number;
  freeTier: boolean;
}

export const EMBEDDING_MODELS: Record<EmbeddingProvider, EmbeddingModel[]> = {
  "workers-ai": [
    {
      id: "@cf/baai/bge-small-en-v1.5",
      label: "BGE Small EN v1.5",
      note: "384 dimensions natively. Cheapest option and the default.",
      nativeDimensions: 384,
      supportsReducedDimensions: false,
      neuronsPerMillionInput: 1841,
      freeTier: true,
    },
    {
      id: "@cf/baai/bge-base-en-v1.5",
      label: "BGE Base EN v1.5",
      note: "768 dimensions. Better recall, needs a 768-dimension index.",
      nativeDimensions: 768,
      supportsReducedDimensions: false,
      neuronsPerMillionInput: 6058,
      freeTier: true,
    },
    {
      id: "@cf/baai/bge-m3",
      label: "BGE M3",
      note: "1024 dimensions, multilingual. Needs a 1024-dimension index.",
      nativeDimensions: 1024,
      supportsReducedDimensions: false,
      neuronsPerMillionInput: 1075,
      freeTier: true,
    },
  ],
  openai: [
    {
      id: "text-embedding-3-small",
      label: "OpenAI text-embedding-3-small",
      note: "1536 dimensions, shortenable to any smaller index dimension.",
      nativeDimensions: 1536,
      supportsReducedDimensions: true,
      neuronsPerMillionInput: 0,
      freeTier: false,
    },
    {
      id: "text-embedding-3-large",
      label: "OpenAI text-embedding-3-large",
      note: "3072 dimensions, shortenable. Highest recall of the options here.",
      nativeDimensions: 3072,
      supportsReducedDimensions: true,
      neuronsPerMillionInput: 0,
      freeTier: false,
    },
  ],
};

export const CHAT_MODELS: Record<ChatProvider, ChatModel[]> = {
  "workers-ai": [
    {
      id: "@cf/openai/gpt-oss-20b",
      label: "GPT-OSS 20B",
      note: "Default. Cheapest per answer, so it stretches the free allowance furthest.",
      neuronsPerMillionInput: 18_182,
      neuronsPerMillionOutput: 27_273,
      usdPerMillionInput: 0.2,
      usdPerMillionOutput: 0.3,
      freeTier: true,
    },
    {
      id: "@cf/openai/gpt-oss-120b",
      label: "GPT-OSS 120B",
      note: "Stronger reasoning, roughly twice the cost per answer.",
      neuronsPerMillionInput: 31_818,
      neuronsPerMillionOutput: 68_182,
      usdPerMillionInput: 0.35,
      usdPerMillionOutput: 0.75,
      freeTier: true,
    },
    {
      id: "@cf/meta/llama-4-scout-17b-16e-instruct",
      label: "Llama 4 Scout 17B",
      note: "Good long-context behaviour on document questions.",
      neuronsPerMillionInput: 24_545,
      neuronsPerMillionOutput: 77_273,
      usdPerMillionInput: 0.27,
      usdPerMillionOutput: 0.85,
      freeTier: true,
    },
    {
      id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      label: "Llama 3.3 70B Instruct (fast)",
      note: "Most capable free-plan option. Output tokens cost the most neurons.",
      neuronsPerMillionInput: 26_668,
      neuronsPerMillionOutput: 204_805,
      usdPerMillionInput: 0.293,
      usdPerMillionOutput: 2.253,
      freeTier: true,
    },
    {
      id: "@cf/deepseek-ai/deepseek-v4-flash-0731",
      label: "DeepSeek v4 Flash",
      note: "Cloudflare requires a paid billing method for this model.",
      neuronsPerMillionInput: 40_000,
      neuronsPerMillionOutput: 120_000,
      usdPerMillionInput: 0.44,
      usdPerMillionOutput: 1.32,
      freeTier: false,
    },
  ],
  deepseek: [
    {
      id: "deepseek-chat",
      label: "DeepSeek Chat",
      note: "Needs DEEPSEEK_API_KEY. Billed by DeepSeek, not Cloudflare.",
      neuronsPerMillionInput: 0,
      neuronsPerMillionOutput: 0,
      usdPerMillionInput: 0.28,
      usdPerMillionOutput: 0.42,
      freeTier: false,
    },
    {
      id: "deepseek-reasoner",
      label: "DeepSeek Reasoner",
      note: "Slower, better on multi-step questions.",
      neuronsPerMillionInput: 0,
      neuronsPerMillionOutput: 0,
      usdPerMillionInput: 0.55,
      usdPerMillionOutput: 2.19,
      freeTier: false,
    },
  ],
  openai: [
    {
      id: "gpt-4.1-mini",
      label: "OpenAI GPT-4.1 mini",
      note: "Needs OPENAI_API_KEY. Billed by OpenAI, not Cloudflare.",
      neuronsPerMillionInput: 0,
      neuronsPerMillionOutput: 0,
      usdPerMillionInput: 0.4,
      usdPerMillionOutput: 1.6,
      freeTier: false,
    },
    {
      id: "gpt-4.1",
      label: "OpenAI GPT-4.1",
      note: "Highest cost of the options here.",
      neuronsPerMillionInput: 0,
      neuronsPerMillionOutput: 0,
      usdPerMillionInput: 2,
      usdPerMillionOutput: 8,
      freeTier: false,
    },
  ],
};

export const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProvider = "workers-ai";
export const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";
export const DEFAULT_CHAT_PROVIDER: ChatProvider = "workers-ai";
export const DEFAULT_CHAT_MODEL = "@cf/openai/gpt-oss-20b";

/** Cloudflare grants this many Workers AI neurons a day on every plan. */
export const FREE_NEURONS_PER_DAY = 10_000;

export function findEmbeddingModel(
  provider: EmbeddingProvider,
  id: string,
): EmbeddingModel | undefined {
  return EMBEDDING_MODELS[provider].find((model) => model.id === id);
}

export function findChatModel(provider: ChatProvider, id: string): ChatModel | undefined {
  return CHAT_MODELS[provider].find((model) => model.id === id);
}

/**
 * Reports whether a model can fill an index of the given dimension.
 * A model may match exactly, or be shortened when it was trained for it.
 */
export function embeddingFitsIndex(model: EmbeddingModel, indexDimensions: number): boolean {
  if (model.nativeDimensions === indexDimensions) return true;
  return model.supportsReducedDimensions && model.nativeDimensions > indexDimensions;
}

export function neuronsForChat(
  model: ChatModel,
  promptTokens: number,
  completionTokens: number,
): number {
  return (
    (promptTokens * model.neuronsPerMillionInput +
      completionTokens * model.neuronsPerMillionOutput) /
    1_000_000
  );
}

export function usdForChat(
  model: ChatModel,
  promptTokens: number,
  completionTokens: number,
): number {
  return (
    (promptTokens * model.usdPerMillionInput + completionTokens * model.usdPerMillionOutput) /
    1_000_000
  );
}

export function neuronsForEmbedding(model: EmbeddingModel, tokens: number): number {
  return (tokens * model.neuronsPerMillionInput) / 1_000_000;
}
