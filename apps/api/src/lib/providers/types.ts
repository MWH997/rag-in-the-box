export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  provider: string;
  /** Tokens billed by the provider, estimated when the provider omits it. */
  tokens: number;
}

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatStreamOptions {
  model: string;
  messages: ChatTurn[];
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}

export interface ChatStreamChunk {
  text: string;
}

export interface ChatStreamResult {
  stream: AsyncIterable<ChatStreamChunk>;
  /** Resolves once the stream is fully consumed. */
  usage: () => { promptTokens: number; completionTokens: number };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
