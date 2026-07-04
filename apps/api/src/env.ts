export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  BUCKET: R2Bucket;
  DEEPSEEK_MODEL: string;
  ALLOWED_ORIGIN: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}
