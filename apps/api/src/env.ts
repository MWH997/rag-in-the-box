export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  BUCKET: R2Bucket;
  DEEPSEEK_MODEL: string;
  ALLOWED_ORIGIN: string;
}
