import { Hono } from "hono";
import { cors } from "hono/cors";
import { HealthResponse } from "@rag/shared";
import type { Env } from "./env.js";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const corsMiddleware = cors({ origin: c.env.ALLOWED_ORIGIN });
  return corsMiddleware(c, next);
});

app.get("/health", (c) => {
  const body: HealthResponse = { ok: true };
  return c.json(HealthResponse.parse(body));
});

export default app;
