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

  /* Demo-only configuration. Ignored unless APP_MODE is "demo". */
  DEMO_TENANT_ID?: string;
  DEMO_VISITOR_CHATS_PER_DAY?: string;
  DEMO_VISITOR_UPLOADS_PER_DAY?: string;
  DEMO_GLOBAL_CHATS_PER_DAY?: string;
  DEMO_GLOBAL_UPLOADS_PER_DAY?: string;
  DEMO_UPLOADS_ENABLED?: string;
  DEMO_COOKIE_SECRET?: string;
}

export interface Capabilities {
  workersAi: boolean;
  openai: boolean;
  deepseek: boolean;
  llamaparse: boolean;
  r2: boolean;
}

export function capabilities(env: Env): Capabilities {
  return {
    workersAi: Boolean(env.AI),
    openai: Boolean(env.OPENAI_API_KEY),
    deepseek: Boolean(env.DEEPSEEK_API_KEY),
    llamaparse: Boolean(env.LLAMA_CLOUD_API_KEY),
    r2: Boolean(env.BUCKET),
  };
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

export function vectorBackend(env: Env): "vectorize" | "d1" {
  if (env.VECTOR_BACKEND === "d1") return "d1";
  if (env.VECTOR_BACKEND === "vectorize") return "vectorize";
  return env.VECTORIZE ? "vectorize" : "d1";
}

export function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}
