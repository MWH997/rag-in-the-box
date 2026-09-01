import { HealthResponse } from "@rag/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

import { appMode, type Env } from "./env.js";
import { HttpError } from "./lib/errors.js";
import { isDailyLimitError } from "./lib/d1-meter.js";
import { ProviderError } from "./lib/providers/index.js";
import { createAuth } from "./lib/auth.js";
import { nextUtcMidnight } from "./lib/time.js";
import { withTenant, type AppEnv } from "./middleware/tenant.js";
import { adminRoute } from "./routes/admin.js";
import { chatRoute } from "./routes/chat.js";
import { demoRoute } from "./routes/demo.js";
import { documentsRoute } from "./routes/documents.js";
import { meRoute } from "./routes/me.js";
import { settingsRoute } from "./routes/settings.js";
import { uploadRoute } from "./routes/upload.js";
import { usageRoute } from "./routes/usage.js";

const app = new Hono<AppEnv>();

/**
 * Origins allowed to call this API.
 *
 * ALLOWED_ORIGIN accepts a comma-separated list so one deployment can serve a
 * marketing site and an app subdomain without a wildcard. Credentials are on,
 * which rules out a wildcard anyway: a browser refuses to send cookies to one.
 */
function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

app.use("*", (c, next) =>
  cors({
    origin: (origin) => (allowedOrigins(c.env).includes(origin) ? origin : null),
    credentials: true,
    allowHeaders: ["content-type", "x-admin-token", "x-tenant-id"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86_400,
  })(c, next),
);

app.get("/health", (c) =>
  c.json(
    HealthResponse.parse({
      ok: true,
      version: c.env.APP_VERSION ?? "1.0.0",
      mode: appMode(c.env),
    }),
  ),
);

// Auth is only mounted when the deployment expects sign-in. The public demo has
// no accounts, so leaving the routes reachable there would be surface with no
// purpose.
app.on(["GET", "POST"], ["/api/auth/*"], async (c) => {
  if (appMode(c.env) === "demo") {
    return c.json({ error: "Accounts are disabled on the demo.", code: "demo_no_auth" }, 404);
  }
  return createAuth(c.env).handler(c.req.raw);
});

app.route("/api", adminRoute);

// Everything below resolves a tenant first.
app.use("/api/*", withTenant);
app.route("/api", meRoute);
app.route("/api", documentsRoute);
app.route("/api", uploadRoute);
app.route("/api", chatRoute);
app.route("/api", settingsRoute);
app.route("/api", usageRoute);
app.route("/api", demoRoute);

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json(
      { error: error.message, code: error.code, details: error.details },
      error.status as ContentfulStatusCode,
    );
  }
  if (error instanceof ZodError) {
    return c.json(
      {
        error: "The request body did not validate.",
        code: "invalid_request",
        details: error.issues,
      },
      422,
    );
  }
  if (error instanceof ProviderError) {
    return c.json({ error: error.message, code: error.code }, error.status as ContentfulStatusCode);
  }
  // From 1 September 2026 D1 rejects every query once the account passes its
  // daily free allowance. That is not a bug in the request, so it gets its own
  // answer rather than a generic failure the reader cannot act on.
  const limit = isDailyLimitError(error);
  if (limit) {
    return c.json(
      {
        error:
          limit === "read"
            ? "This deployment has read its daily free database allowance. It resets at midnight UTC."
            : "This deployment has written its daily free database allowance. It resets at midnight UTC.",
        code: "d1_daily_limit",
        details: { kind: limit, resetsAt: nextUtcMidnight() },
      },
      503,
    );
  }

  console.error("unhandled error", error);
  return c.json({ error: "Something went wrong.", code: "internal_error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found.", code: "not_found" }, 404));

export default app;
