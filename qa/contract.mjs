/**
 * Checks what the API actually returns against the schemas that describe it.
 *
 * The web client casts responses rather than parsing them:
 *
 *   return payload as T;
 *
 * That is fast and it is a blind spot. TypeScript believes the cast, so if the
 * server renames a field or changes a type, nothing complains. The client reads
 * undefined, renders something wrong, and fails somewhere far from the cause.
 * There are thirty one schemas in packages/shared describing these responses and
 * until now nothing compared them to a real response.
 *
 * Run against a live API:
 *
 *   BASE_URL=http://127.0.0.1:8787 node qa/contract.mjs
 *
 * Exits non-zero on the first mismatch, printing the path and what was wrong.
 */

import {
  DemoStatusResponse,
  DocumentContentResponse,
  DocumentListResponse,
  HealthResponse,
  IngestResponse,
  MeResponse,
  UsageResponse,
} from "@rag/shared";

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const ADMIN = process.env.ADMIN_TOKEN ?? "development-only-admin-token";
const TENANT = `contract-${Date.now()}`;

const headers = {
  "content-type": "application/json",
  "x-admin-token": ADMIN,
  "x-tenant-id": TENANT,
};

let failures = 0;
let checked = 0;

async function call(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

/** Parses a response with its schema and reports every mismatch. */
function check(label, schema, value) {
  checked += 1;
  const result = schema.safeParse(value);
  if (result.success) {
    console.log(`  ok    ${label}`);
    return true;
  }
  failures += 1;
  console.error(`  FAIL  ${label}`);
  for (const issue of result.error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    console.error(`          ${path}: ${issue.message}`);
  }
  return false;
}

console.log(`Contract check against ${BASE}\n`);

// Health is unauthenticated and lives outside /api.
const health = await fetch(`${BASE}/health`).then((r) => r.json());
check("GET /health", HealthResponse, health);

const me = await call("/api/me");
if (me.ok) check("GET /api/me", MeResponse, me.body);
else console.log(`  skip  GET /api/me (${me.status}, admin header has no user)`);

check("GET /api/documents", DocumentListResponse, (await call("/api/documents")).body);
check("GET /api/usage", UsageResponse, (await call("/api/usage")).body);
check("GET /api/demo/status", DemoStatusResponse, (await call("/api/demo/status")).body);

// A document, so the shapes that only exist with content are covered too.
const markdown = `# Contract\n\nA paragraph long enough to become a passage on its own, so the chunker has something real to work with and the reader has something to display.\n`;
const created = await call("/api/documents", {
  method: "POST",
  body: JSON.stringify({
    filename: "contract.md",
    kind: "md",
    sizeBytes: markdown.length,
    extractor: "browser",
    pageCount: 1,
    totalChunks: 1,
  }),
});

if (!created.ok) {
  console.error(`  FAIL  POST /api/documents returned ${created.status}`);
  console.error(`          ${JSON.stringify(created.body).slice(0, 200)}`);
  failures += 1;
} else {
  const id = created.body.documentId;
  const ingested = await call(`/api/documents/${id}/ingest`, {
    method: "POST",
    body: JSON.stringify({
      segments: [{ seq: 0, charStart: 0, page: 1, markdown }],
      chunks: [
        {
          seq: 0,
          heading: "Contract",
          page: 1,
          charStart: 0,
          charEnd: markdown.length,
          bodyStart: 0,
          text: markdown,
          tokenEstimate: 40,
        },
      ],
      done: true,
    }),
  });
  check("POST /api/documents/:id/ingest", IngestResponse, ingested.body);
  check(
    "GET /api/documents/:id/content",
    DocumentContentResponse,
    (await call(`/api/documents/${id}/content`)).body,
  );
  check("GET /api/documents (with one)", DocumentListResponse, (await call("/api/documents")).body);
  await call(`/api/documents/${id}`, { method: "DELETE" });
}

console.log(`\n${checked - failures} of ${checked} responses matched their schema.`);
if (failures > 0) {
  console.error("\nThe API and the shared schemas disagree. The web client casts rather than");
  console.error("parses, so this would have reached a user as a blank field or a crash.");
  process.exit(1);
}
