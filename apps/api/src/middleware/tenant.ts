import { createMiddleware } from "hono/factory";
import { getCookie, setCookie } from "hono/cookie";

import { createDb, type Database } from "../db/index.js";
import { createMeter, type D1Usage } from "../lib/d1-meter.js";
import { envBool, envInt, isDemo, type Env } from "../env.js";
import { createAuth } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";
import { secureCompare } from "../lib/secure-compare.js";
import type { QuotaCheck } from "../lib/quota.js";

export const DEMO_COOKIE = "rib_visitor";

export interface TenantContext {
  /** Where new documents and vectors for this request are written. */
  tenantId: string;
  /**
   * Every tenant this request may read from, most specific first. In demo mode
   * a visitor reads their own workspace plus the shared curated one.
   */
  readTenantIds: string[];
  userId: string;
  mode: "self-host" | "demo";
  /** Stable per-visitor id in demo mode, equal to userId elsewhere. */
  visitorKey: string;
  /** Quota checks every metered action must pass, cheapest scope first. */
  quotaKeys: { visitor: string; global: string };
}

export type AppVariables = {
  db: Database;
  tenant: TenantContext;
  /** Rows this request has actually made D1 read and write, so far. */
  d1Usage: () => D1Usage;
};

export type AppEnv = { Bindings: Env; Variables: AppVariables };

function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/**
 * Derives a stable, non-reversible key from the caller's IP address.
 *
 * The demo meters per visitor. A cookie alone is trivially reset, and a raw IP
 * address is personal data we have no reason to keep, so the counter is keyed
 * on an HMAC of the address with the deployment secret. The address itself is
 * never written anywhere.
 */
async function networkKey(env: Env, request: Request): Promise<string> {
  const address =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const secret = env.DEMO_COOKIE_SECRET ?? env.BETTER_AUTH_SECRET;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(address));
  return [...new Uint8Array(signature)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function demoTenantId(env: Env): string {
  return env.DEMO_TENANT_ID ?? "demo-shared";
}

export function demoLimits(env: Env) {
  return {
    visitorChats: envInt(env.DEMO_VISITOR_CHATS_PER_DAY, 15),
    visitorUploads: envInt(env.DEMO_VISITOR_UPLOADS_PER_DAY, 1),
    globalChats: envInt(env.DEMO_GLOBAL_CHATS_PER_DAY, 120),
    globalUploads: envInt(env.DEMO_GLOBAL_UPLOADS_PER_DAY, 40),
    uploadsEnabled: envBool(env.DEMO_UPLOADS_ENABLED, false),
    /**
     * Deliberately far below the tier's 8 MB. A demo needs to show the pipeline
     * working, which a few pages does, and every megabyte accepted from a
     * stranger is storage the deployment pays for until the purge runs.
     */
    maxUploadBytes: envInt(env.DEMO_MAX_UPLOAD_BYTES, 2 * 1024 * 1024),
    retentionHours: envInt(env.DEMO_RETENTION_HOURS, 3),
  };
}

/**
 * Resolves the tenant for the request.
 *
 * In self-host mode this is the authenticated organization. In demo mode there
 * is no sign-in: the visitor gets a per-browser workspace for anything they add
 * and read access to the curated workspace that holds the featured document.
 * Either way the tenant id comes from the server, never from the request body.
 */
export const withTenant = createMiddleware<AppEnv>(async (c, next) => {
  // Every query goes through the meter so the deployment can report its own
  // consumption against the daily allowance D1 now enforces.
  const meter = createMeter(c.env.DB);
  const db = createDb(meter.binding);
  c.set("db", db);
  c.set("d1Usage", meter.usage);

  // Operator escape hatch used by scripts/seed-demo.ts to write the curated
  // demo workspace. It needs the deployment's admin token, which is a secret
  // that never reaches a browser, and it is inert when no token is configured.
  const adminToken = c.req.header("x-admin-token");
  const impersonated = c.req.header("x-tenant-id");
  if (adminToken && impersonated && secureCompare(adminToken, c.env.ADMIN_TOKEN)) {
    c.set("tenant", {
      tenantId: impersonated,
      readTenantIds: [impersonated],
      userId: "admin",
      mode: "self-host",
      visitorKey: "admin",
      quotaKeys: { visitor: "admin", global: "admin" },
    });
    await next();
    return;
  }

  if (isDemo(c.env)) {
    let visitorId = getCookie(c, DEMO_COOKIE);
    if (!visitorId || !/^[a-f0-9]{32}$/.test(visitorId)) {
      visitorId = randomId();
      setCookie(c, DEMO_COOKIE, visitorId, {
        path: "/",
        httpOnly: true,
        secure: c.env.BETTER_AUTH_URL.startsWith("https://"),
        sameSite: c.env.BETTER_AUTH_URL.startsWith("https://") ? "None" : "Lax",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    const shared = demoTenantId(c.env);
    const own = `demo-v-${visitorId}`;
    const network = await networkKey(c.env, c.req.raw);

    c.set("tenant", {
      tenantId: own,
      readTenantIds: [own, shared],
      userId: `visitor-${visitorId}`,
      mode: "demo",
      visitorKey: visitorId,
      // Metered on the network key rather than the cookie so clearing cookies
      // does not hand out a fresh allowance.
      quotaKeys: { visitor: network, global: "demo" },
    });
    await next();
    return;
  }

  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  }
  const tenantId = session.session.activeOrganizationId;
  if (!tenantId) {
    throw new HttpError(403, "no_active_organization", "This account has no active workspace.");
  }

  c.set("tenant", {
    tenantId,
    readTenantIds: [tenantId],
    userId: session.user.id,
    mode: "self-host",
    visitorKey: session.user.id,
    quotaKeys: { visitor: session.user.id, global: "deployment" },
  });
  await next();
});

/** Builds the quota checks for one metered action. */
export function quotaChecksFor(
  env: Env,
  tenant: TenantContext,
  metric: "chat" | "upload",
  tenantLimit: number,
): QuotaCheck[] {
  if (tenant.mode !== "demo") {
    return [{ scope: "tenant", key: tenant.tenantId, metric, limit: tenantLimit }];
  }
  const limits = demoLimits(env);
  return [
    {
      scope: "visitor",
      key: tenant.quotaKeys.visitor,
      metric,
      limit: metric === "chat" ? limits.visitorChats : limits.visitorUploads,
    },
    {
      scope: "global",
      key: tenant.quotaKeys.global,
      metric,
      limit: metric === "chat" ? limits.globalChats : limits.globalUploads,
    },
  ];
}
