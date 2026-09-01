#!/usr/bin/env node
/**
 * Loads a document into a deployment's curated workspace.
 *
 * The public demo needs something worth reading already indexed, so a visitor
 * can ask a real question the moment the page opens. This script does what the
 * browser normally does, from Node: read the file, split it into passages, and
 * send them to the API in small batches.
 *
 * The default source is the NIST Cybersecurity Framework 2.0, a work of the
 * United States government and therefore in the public domain. It is dense,
 * well structured, useful to the kind of person who would want this tool, and
 * about as far from contentious as a document gets. The file is fetched from
 * NIST at run time rather than copied into this repository.
 *
 *   ADMIN_TOKEN=... node scripts/seed-demo.ts \
 *     --api https://rib-api.mwhassan.com \
 *     --tenant demo-curated
 *
 * Pass --source with a URL or a local path to load something else.
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { chunkMarkdown, pageForOffset, segmentMarkdown } from "@rag/shared";
import { extractText, getDocumentProxy } from "unpdf";

const DEFAULT_SOURCE = "https://nvlpubs.nist.gov/nistpubs/CSWP/NIST.CSWP.29.pdf";
const DEFAULT_TITLE = "NIST Cybersecurity Framework 2.0.pdf";

const { values } = parseArgs({
  options: {
    api: { type: "string", default: "http://127.0.0.1:8787" },
    tenant: { type: "string", default: "demo-curated" },
    source: { type: "string", default: DEFAULT_SOURCE },
    title: { type: "string", default: DEFAULT_TITLE },
    batch: { type: "string", default: "24" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(
    [
      "Usage: ADMIN_TOKEN=... node scripts/seed-demo.ts [options]",
      "",
      "  --api      API origin            (default http://127.0.0.1:8787)",
      "  --tenant   curated workspace id  (default demo-curated)",
      "  --source   url or local path     (default the NIST CSF 2.0 pdf)",
      "  --title    filename to show      (default the NIST title)",
      "  --batch    passages per request  (default 24)",
    ].join("\n"),
  );
  process.exit(0);
}

const adminToken = process.env.ADMIN_TOKEN;
if (!adminToken) {
  console.error("ADMIN_TOKEN is not set. It must match the deployment's ADMIN_TOKEN secret.");
  process.exit(1);
}

const api = values.api.replace(/\/$/, "");
const headers = {
  "content-type": "application/json",
  "x-admin-token": adminToken,
  "x-tenant-id": values.tenant,
};

async function loadBytes(source: string): Promise<Uint8Array> {
  if (/^https?:\/\//.test(source)) {
    process.stdout.write(`Downloading ${source}\n`);
    const response = await fetch(source);
    if (!response.ok) throw new Error(`The source responded ${response.status}.`);
    return new Uint8Array(await response.arrayBuffer());
  }
  process.stdout.write(`Reading ${source}\n`);
  return new Uint8Array(await readFile(source));
}

async function toMarkdown(
  bytes: Uint8Array,
  filename: string,
): Promise<{ markdown: string; pageBreaks: number[]; pageCount: number }> {
  if (!filename.toLowerCase().endsWith(".pdf")) {
    const text = new TextDecoder().decode(bytes);
    return { markdown: text, pageBreaks: [], pageCount: 1 };
  }

  const pdf = await getDocumentProxy(bytes);
  const { text, totalPages } = await extractText(pdf, { mergePages: false });

  const pageBreaks: number[] = [];
  let markdown = "";
  text.forEach((page, index) => {
    const cleaned = page
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (index > 0) {
      markdown += "\n\n";
      pageBreaks.push(markdown.length);
    }
    markdown += cleaned;
  });

  return { markdown, pageBreaks, pageCount: totalPages };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${path} responded ${response.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as T;
}

const bytes = await loadBytes(values.source);
process.stdout.write(`Read ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB\n`);

const { markdown, pageBreaks, pageCount } = await toMarkdown(bytes, values.title);
if (markdown.trim().length === 0) {
  throw new Error("No text came out of that file. A scanned document needs LlamaParse.");
}

const chunks = chunkMarkdown(markdown, pageBreaks);
const segments = segmentMarkdown(markdown);
process.stdout.write(
  `Extracted ${pageCount} pages into ${chunks.length} passages and ${segments.length} display segments\n`,
);

const created = await post<{ documentId: string; batchSize: number }>("/api/documents", {
  filename: values.title,
  kind: values.title.toLowerCase().endsWith(".pdf") ? "pdf" : "md",
  sizeBytes: bytes.byteLength,
  extractor: "browser",
  pageCount,
  totalChunks: chunks.length,
});
process.stdout.write(`Created document ${created.documentId}\n`);

const batchSize = Math.min(Number.parseInt(values.batch, 10) || 24, created.batchSize);
const segmentBatches: (typeof segments)[] = [];
for (let index = 0; index < segments.length; index += 4) {
  segmentBatches.push(segments.slice(index, index + 4));
}
const chunkBatches: (typeof chunks)[] = [];
for (let index = 0; index < chunks.length; index += batchSize) {
  chunkBatches.push(chunks.slice(index, index + batchSize));
}

const calls = Math.max(segmentBatches.length, chunkBatches.length);
let workerMs = 0;

/** Removes the half-built document so a failed run leaves nothing behind. */
async function discard(): Promise<void> {
  try {
    await fetch(`${api}/api/documents/${created.documentId}`, { method: "DELETE", headers });
    process.stderr.write(`\nRemoved the incomplete document ${created.documentId}.\n`);
  } catch {
    process.stderr.write(
      `\nCould not remove ${created.documentId}. Delete it by hand before seeding again.\n`,
    );
  }
}

try {
  for (let call = 0; call < calls; call += 1) {
    const response = await post<{ embedded: number; elapsedMs: number }>(
      `/api/documents/${created.documentId}/ingest`,
      {
        segments: (segmentBatches[call] ?? []).map((segment) => ({
          seq: segment.seq,
          charStart: segment.charStart,
          page: pageForOffset(pageBreaks, segment.charStart),
          markdown: segment.markdown,
        })),
        chunks: (chunkBatches[call] ?? []).map((chunk) => ({
          seq: chunk.seq,
          heading: chunk.heading,
          page: chunk.page,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          bodyStart: chunk.bodyStart,
          text: chunk.text,
          tokenEstimate: chunk.tokenEstimate,
        })),
        done: call === calls - 1,
      },
    );
    workerMs += response.elapsedMs;
    process.stdout.write(
      `\r  batch ${call + 1}/${calls}, ${response.embedded}/${chunks.length} passages embedded`,
    );
  }
} catch (cause) {
  await discard();
  throw cause;
}

process.stdout.write(
  `\nDone. ${chunks.length} passages, ${workerMs} ms of server time across ${calls} requests.\n`,
);
