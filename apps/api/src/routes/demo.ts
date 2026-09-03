import { Hono, type Context } from "hono";
import { and, asc, eq } from "drizzle-orm";

import { isDemo, type Env } from "../env.js";
import { documents } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import { getJobMarkdown, getJobStatus, submitParseJob } from "../lib/providers/index.js";
import { consumeQuota, readQuota, refundQuota } from "../lib/quota.js";
import { secureCompare } from "../lib/secure-compare.js";
import { nextUtcMidnight } from "../lib/time.js";
import { demoLimits, demoTenantId, quotaChecksFor, type AppEnv } from "../middleware/tenant.js";

export const demoRoute = new Hono<AppEnv>();

/**
 * Quota state for the banner.
 *
 * This endpoint only reads counters, so polling it never consumes allowance.
 * It reports the visitor's own budget and the deployment-wide one separately,
 * because the message a reader needs is different: one means come back
 * tomorrow, the other means the demo is busy today.
 */
demoRoute.get("/demo/status", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");

  if (!isDemo(c.env)) {
    return c.json({
      quota: {
        allowed: true,
        reason: null,
        visitor: { used: 0, limit: 0 },
        global: { used: 0, limit: 0 },
        resetsAt: nextUtcMidnight(),
      },
      featuredDocumentId: null,
      uploadsEnabled: true,
      maxUploadBytes: 0,
      retentionHours: 0,
      uploadsRemaining: 0,
      hasOwnDocuments: false,
      // A self-hosted install chooses its reader in settings, not here, so the
      // demo's toggle is reported as unavailable rather than as a second way to
      // configure the same thing.
      readers: { cloudflare: true, llamaindex: false },
      parsesRemaining: 0,
    });
  }

  const limits = demoLimits(c.env);
  const [visitor, global, visitorUploads, visitorParses] = await readQuota(db, [
    {
      scope: "visitor",
      key: tenant.quotaKeys.visitor,
      metric: "chat",
      limit: limits.visitorChats,
    },
    { scope: "global", key: tenant.quotaKeys.global, metric: "chat", limit: limits.globalChats },
    {
      scope: "visitor",
      key: tenant.quotaKeys.visitor,
      metric: "upload",
      limit: limits.visitorUploads,
    },
    {
      scope: "visitor",
      key: tenant.quotaKeys.visitor,
      metric: "parse",
      limit: limits.visitorParses,
    },
  ]);

  const [featured] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.tenantId, demoTenantId(c.env)), eq(documents.status, "active")))
    .orderBy(asc(documents.createdAt))
    .limit(1);

  // Whether this visitor has anything of their own decides if the export
  // control is worth showing at all.
  const [own] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.tenantId, tenant.tenantId), eq(documents.status, "active")))
    .limit(1);

  const globalExhausted = !global?.allowed;
  const visitorExhausted = !visitor?.allowed;

  return c.json({
    quota: {
      allowed: !globalExhausted && !visitorExhausted,
      reason: globalExhausted
        ? "The demo has used its shared free allowance for today. It resets at midnight UTC."
        : visitorExhausted
          ? "You have used your questions for today. They reset at midnight UTC."
          : null,
      visitor: { used: visitor?.used ?? 0, limit: visitor?.limit ?? 0 },
      global: { used: global?.used ?? 0, limit: global?.limit ?? 0 },
      resetsAt: visitor?.resetsAt ?? nextUtcMidnight(),
    },
    featuredDocumentId: featured?.id ?? null,
    uploadsEnabled: limits.uploadsEnabled,
    maxUploadBytes: limits.maxUploadBytes,
    retentionHours: limits.retentionHours,
    uploadsRemaining: Math.max(0, limits.visitorUploads - (visitorUploads?.used ?? 0)),
    hasOwnDocuments: Boolean(own),
    readers: { cloudflare: true, llamaindex: limits.llamaparseEnabled },
    parsesRemaining: limits.llamaparseEnabled
      ? Math.max(0, limits.visitorParses - (visitorParses?.used ?? 0))
      : 0,
  });
});

/**
 * The LlamaIndex half of the demo's reader toggle.
 *
 * Everything else about a demo upload is unchanged: the browser still chunks
 * the markdown, still sends it in small batches, and Workers AI still embeds
 * it. Only the reading is different, which is the whole point of offering the
 * choice. The Worker forwards the bytes and later reads a status, so it spends
 * almost no processor time and the path stays inside the free plan.
 */
/**
 * Binds a parse job to the visitor who submitted it.
 *
 * The job id is issued by LlamaCloud and is the only thing needed to read the
 * markdown back, so handing it out bare would let anyone holding one read
 * another visitor's document. The id travels as `<id>.<signature>` instead, and
 * the signature covers the visitor as well as the id, so a ticket is useless to
 * anyone else. This is the same reasoning as scoping every query by tenant; a
 * job in flight is just a document that does not have a row yet.
 */
async function ticketKey(env: Env): Promise<CryptoKey> {
  const secret = env.DEMO_COOKIE_SECRET ?? env.BETTER_AUTH_SECRET;
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(env: Env, visitorKey: string, jobId: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await ticketKey(env),
    new TextEncoder().encode(`${visitorKey}:${jobId}`),
  );
  return [...new Uint8Array(signature)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function issueTicket(env: Env, visitorKey: string, jobId: string): Promise<string> {
  return `${jobId}.${await sign(env, visitorKey, jobId)}`;
}

async function openTicket(env: Env, visitorKey: string, ticket: string): Promise<string> {
  const cut = ticket.lastIndexOf(".");
  const jobId = cut === -1 ? "" : ticket.slice(0, cut);
  const presented = cut === -1 ? "" : ticket.slice(cut + 1);
  if (!jobId || !secureCompare(presented, await sign(env, visitorKey, jobId))) {
    throw new HttpError(404, "parse_job_not_found", "That parse job is not one of yours.");
  }
  return jobId;
}

function requireLlamaParse(c: Context<AppEnv>) {
  if (!isDemo(c.env)) {
    throw new HttpError(
      404,
      "not_demo",
      "This endpoint only exists on the demo. A self-hosted install parses on the paid tier.",
    );
  }
  const limits = demoLimits(c.env);
  if (!limits.llamaparseEnabled) {
    throw new HttpError(
      403,
      "demo_llamaparse_disabled",
      "This demo is not offering LlamaIndex right now. Cloudflare still reads the file in your browser.",
    );
  }
  return limits;
}

demoRoute.post("/demo/parse", async (c) => {
  const db = c.get("db");
  const tenant = c.get("tenant");
  const limits = requireLlamaParse(c);

  if (!limits.uploadsEnabled) {
    throw new HttpError(
      403,
      "demo_uploads_disabled",
      "Uploads are turned off on this demo right now. The featured document is still there to ask about.",
    );
  }

  // formData() throws rather than returning empty when the request carries no
  // multipart body at all, so a malformed request would leave here as a 500.
  // What it actually is is a bad request, and it should say so.
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new HttpError(
      400,
      "no_file",
      "Send the document as multipart form data in a field named file.",
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new HttpError(400, "no_file", "Attach the document in a form field named file.");
  }
  if (file.size > limits.maxUploadBytes) {
    throw new HttpError(
      413,
      "demo_upload_too_large",
      `The demo takes files up to ${Math.round(limits.maxUploadBytes / 1024 / 1024)} MB. A few pages is enough to see the pipeline work.`,
    );
  }

  // Parsing is metered on its own budget, separate from uploads, because it
  // spends LlamaCloud credits rather than Vectorize storage.
  const checks = quotaChecksFor(c.env, tenant, "parse", limits.visitorParses);
  await consumeQuota(db, checks);

  try {
    const jobId = await submitParseJob(c.env, file, file.name);
    return c.json({ jobId: await issueTicket(c.env, tenant.visitorKey, jobId) }, 202);
  } catch (cause) {
    // LlamaCloud refused the job, so nothing was parsed and nothing should have
    // been charged. Giving the allowance back is what stops a provider outage
    // from silently spending a visitor's one attempt for the day.
    await refundQuota(db, checks);
    throw cause;
  }
});

demoRoute.get("/demo/parse/:jobId", async (c) => {
  requireLlamaParse(c);
  const tenant = c.get("tenant");
  const jobId = await openTicket(c.env, tenant.visitorKey, c.req.param("jobId"));

  const status = await getJobStatus(c.env, jobId);
  if (status === "PENDING" || status === "RUNNING") {
    return c.json({ status: "parsing", markdown: null, error: null });
  }
  if (status !== "COMPLETED") {
    return c.json({
      status: "failed",
      markdown: null,
      error: `LlamaIndex finished this job as ${status}.`,
    });
  }

  const markdown = await getJobMarkdown(c.env, jobId);
  return c.json({ status: "completed", markdown, error: null });
});
