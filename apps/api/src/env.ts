import { DEFAULT_VECTOR_DIMENSIONS } from "@rag/shared";

/**
 * Worker bindings and configuration.
 *
 * Required bindings are non-optional. Everything a deployment can run without
 * is optional, and `capabilities()` reports what is actually present so the UI
 * can hide options the operator has not configured.
 */
export interface Env {
  /* Required bindings */
  DB: D1Database;
  AI: Ai;

  /* Optional bindings */
  /** Absent when the deployment uses the D1 vector backend. */
  VECTORIZE?: VectorizeIndex;
  /** Absent unless the operator enabled R2 for original-file storage. */
  BUCKET?: R2Bucket;

  /* Required configuration */
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ALLOWED_ORIGIN: string;

  /* Optional configuration */
  APP_MODE?: "self-host" | "demo";
  APP_VERSION?: string;
  ADMIN_TOKEN?: string;
  DEFAULT_TIER?: string;
  /** PBKDF2 iterations for password hashing. See src/lib/password.ts. */
  PASSWORD_KDF_ITERATIONS?: string;
  /** Development only. Replaces the AI providers with offline stand-ins. */
  OFFLINE_AI?: string;
  /** "vectorize" or "d1". Defaults to vectorize when the binding exists. */
  VECTOR_BACKEND?: string;
  /** Dimension the Vectorize index was created with. Must match wrangler.toml. */
  VECTOR_DIMENSIONS?: string;

  /* Optional provider credentials. Absent means the provider is hidden. */
  OPENAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  LLAMA_CLOUD_API_KEY?: string;
  /**
   * Endpoint overrides, each without a trailing slash.
   *
   * These exist because the vendor default is not always right. LlamaCloud
   * runs a separate EU region and its keys are region specific, so a European
   * key fails against the North American endpoint with no way to correct it.
   * OpenAI and DeepSeek are overridable for the same reason a proxy or a
   * compatible gateway is common in front of them.
   */
  OPENAI_BASE_URL?: string;
  DEEPSEEK_BASE_URL?: string;
  LLAMA_CLOUD_BASE_URL?: string;
  /**
   * Base URL of a local Ollama server, without the /v1 suffix.
   *
   * Setting this is what enables the local provider, so there is deliberately
   * no default: an unset value means the operator has not opted in, and the
   * models stay hidden rather than failing against a URL nothing is serving.
   */
  OLLAMA_BASE_URL?: string;

  /* Demo-only configuration. Ignored unless APP_MODE is "demo". */
  DEMO_TENANT_ID?: string;
  DEMO_VISITOR_CHATS_PER_DAY?: string;
  DEMO_VISITOR_UPLOADS_PER_DAY?: string;
  DEMO_GLOBAL_CHATS_PER_DAY?: string;
  DEMO_GLOBAL_UPLOADS_PER_DAY?: string;
  DEMO_UPLOADS_ENABLED?: string;
  DEMO_COOKIE_SECRET?: string;
  /** Largest file a demo visitor may upload. Smaller than the tier limit on purpose. */
  DEMO_MAX_UPLOAD_BYTES?: string;
  /** Hours a visitor's upload survives before the scheduled purge removes it. */
  DEMO_RETENTION_HOURS?: string;
  /**
   * Whether a demo visitor may choose LlamaIndex to read their file.
   *
   * Off unless set, and inert without LLAMA_CLOUD_API_KEY, so the choice never
   * appears on a deployment that cannot honour it. It is separate from the key
   * because turning the path off should not mean deleting a working credential.
   */
  DEMO_LLAMAPARSE_ENABLED?: string;
  /**
   * LlamaParse jobs allowed per visitor and per day, deployment wide.
   *
   * A separate budget from the upload one because it is a separate scarce
   * thing: uploads are bounded by Vectorize storage, which does not reset, and
   * parses by the 10,000 LlamaCloud credits a month the free plan grants.
   *
   * The grant is what sets the number. At three credits a page on the
   * cost_effective tier it buys about 3,300 pages a month, or 110 a day. A
   * two megabyte upload is a handful of pages, so twenty parses a day of five
   * pages each spends 300 credits a day and 9,000 a month, which fits with
   * enough headroom for a heavier day. Raising this without redoing that
   * arithmetic is how the demo starts failing halfway through a month.
   */
  DEMO_VISITOR_PARSES_PER_DAY?: string;
  DEMO_GLOBAL_PARSES_PER_DAY?: string;
}

export interface Capabilities {
  workersAi: boolean;
  openai: boolean;
  deepseek: boolean;
  llamaparse: boolean;
  ollama: boolean;
  r2: boolean;
}

export function capabilities(env: Env): Capabilities {
  return {
    workersAi: Boolean(env.AI),
    openai: Boolean(env.OPENAI_API_KEY),
    deepseek: Boolean(env.DEEPSEEK_API_KEY),
    llamaparse: Boolean(env.LLAMA_CLOUD_API_KEY),
    ollama: Boolean(env.OLLAMA_BASE_URL),
    r2: Boolean(env.BUCKET),
  };
}

/** Base URL of the local Ollama server, with any trailing slash removed. */
export function ollamaBaseUrl(env: Env): string | null {
  const raw = env.OLLAMA_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/** An endpoint override, trimmed of any trailing slash, or the vendor default. */
export function baseUrl(override: string | undefined, fallback: string): string {
  const raw = override?.trim();
  if (!raw) return fallback;
  return raw.replace(/\/+$/, "");
}

/**
 * Origins allowed to call this API.
 *
 * ALLOWED_ORIGIN is documented as a comma separated list so one deployment can
 * serve a marketing site and an app subdomain without a wildcard. The CORS
 * layer split it; better-auth was handed the raw string as a single origin, so
 * a deployment with two origins passed the preflight and then failed every
 * sign-in with "Invalid origin". Both now ask this function.
 */
export function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function appMode(env: Env): "self-host" | "demo" {
  return env.APP_MODE === "demo" ? "demo" : "self-host";
}

export function isDemo(env: Env): boolean {
  return appMode(env) === "demo";
}

/** Parses an integer environment string, falling back when unset or malformed. */
export function envInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Dimension of the configured Vectorize index. */
export function indexDimensions(env: Env): number {
  return envInt(env.VECTOR_DIMENSIONS, DEFAULT_VECTOR_DIMENSIONS);
}

export function isOfflineAi(env: Env): boolean {
  return envBool(env.OFFLINE_AI, false);
}

/**
 * Whether the deterministic stand-ins answer, given the provider that was asked for.
 *
 * OFFLINE_AI means "nothing is configured, use the stand-ins". Choosing Ollama
 * is a statement that something now is, so it outranks the flag. Both the
 * dispatcher and the usage report ask this question, and answering it in one
 * place is what stops them crediting different models for the same answer.
 */
export function servedOffline(env: Env, provider: string): boolean {
  if (provider === "ollama") return false;
  return isOfflineAi(env);
}

export function vectorBackend(env: Env): "vectorize" | "d1" {
  if (env.VECTOR_BACKEND === "d1") return "d1";
  if (env.VECTOR_BACKEND === "vectorize") return "vectorize";
  return env.VECTORIZE ? "vectorize" : "d1";
}

export function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}
