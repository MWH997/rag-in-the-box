import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq } from "drizzle-orm";
import { HealthResponse } from "@rag/shared";
import type { Env } from "./env.js";
import { createDb } from "./db/index.js";
import { documents } from "./db/schema.js";
import { createAuth } from "./lib/auth.js";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  // credentials: true is required for BetterAuth's session cookie to be
  // accepted cross-origin (Pages frontend <-> Workers API in prod).
  const corsMiddleware = cors({ origin: c.env.ALLOWED_ORIGIN, credentials: true });
  return corsMiddleware(c, next);
});

app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

app.get("/health", (c) => {
  const body: HealthResponse = { ok: true };
  return c.json(HealthResponse.parse(body));
});

// TEMPORARY: proves Drizzle + D1 wiring end-to-end. Removed in TICKET-30.
app.get("/debug/db", async (c) => {
  const db = createDb(c.env.DB);
  const [inserted] = await db
    .insert(documents)
    .values({
      tenantId: "debug-tenant",
      filename: "debug.txt",
      mimeType: "text/plain",
      sizeBytes: 0,
      status: "uploading",
    })
    .returning();

  if (!inserted) {
    return c.json({ error: "insert returned no row" }, 500);
  }

  const [selected] = await db.select().from(documents).where(eq(documents.id, inserted.id));

  return c.json({ inserted, selected });
});

export default app;
