import { chunkMarkdown, segmentMarkdown, type Chunk, type DemoReader } from "@rag/shared";

import { api } from "./api";
import { extract, kindOf, type Extracted } from "./extract";

/**
 * The upload pipeline, driven from the browser.
 *
 * Extraction and chunking happen here; the Worker receives small batches and
 * does one embedding call per request. `onStage` reports progress so the
 * interface can show what each step actually cost, which is the clearest way to
 * explain why this design fits the free plan.
 *
 * The reader is the one part a demo visitor chooses. Cloudflare reads the file
 * here, in the page; LlamaIndex reads it on LlamaCloud and sends markdown back.
 * Everything after that point is identical, which is deliberate: the toggle is
 * meant to answer "does the reading get better", not to swap the product.
 */

export type IngestStage =
  "extracting" | "parsing" | "chunking" | "uploading" | "embedding" | "done";

export interface IngestProgress {
  stage: IngestStage;
  /** 0 to 1 within the current stage. */
  fraction: number;
  detail: string;
  chunks?: number;
  pages?: number;
  /** Total milliseconds the Worker reported spending, summed over batches. */
  workerMs?: number;
}

export interface IngestResult {
  documentId: string;
  chunks: number;
  pages: number;
  workerMs: number;
  browserMs: number;
}

/** Bytes of segment markdown allowed in one request, well under D1's row cap. */
const SEGMENT_BYTES_PER_CALL = 48_000;

function batchSegments(segments: ReturnType<typeof segmentMarkdown>): (typeof segments)[] {
  const batches: (typeof segments)[] = [];
  let current: typeof segments = [];
  let size = 0;
  for (const segment of segments) {
    if (current.length > 0 && size + segment.markdown.length > SEGMENT_BYTES_PER_CALL) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(segment);
    size += segment.markdown.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** How long to wait between polls of a LlamaParse job, and for how long. */
const PARSE_POLL_MS = 1_500;
const PARSE_TIMEOUT_MS = 120_000;

/**
 * Sends the file to LlamaIndex and waits for the markdown.
 *
 * There are no page breaks in the result, so citations from a document read
 * this way carry a heading rather than a page number. That is a real difference
 * and it is why the Cloudflare path stays the default for files that have
 * extractable text: it knows where the pages are, and this does not.
 */
async function readWithLlamaIndex(
  file: File,
  onProgress: (progress: IngestProgress) => void,
): Promise<Extracted> {
  onProgress({ stage: "parsing", fraction: 0.05, detail: "Sending the file to LlamaIndex" });
  const { jobId } = await api.demoParse(file);

  const deadline = performance.now() + PARSE_TIMEOUT_MS;
  let waited = 0;
  for (;;) {
    if (performance.now() > deadline) {
      throw new Error("LlamaIndex is taking longer than the demo waits. Try Cloudflare instead.");
    }
    await new Promise((resolve) => setTimeout(resolve, PARSE_POLL_MS));
    waited += PARSE_POLL_MS;

    const result = await api.demoParseStatus(jobId);
    if (result.status === "failed") {
      throw new Error(result.error ?? "LlamaIndex could not read that file.");
    }
    if (result.status === "completed") {
      const markdown = (result.markdown ?? "").trim();
      if (markdown.length === 0) {
        throw new Error("LlamaIndex found no text in that file.");
      }
      return { markdown, pageBreaks: [], pageCount: 0 };
    }

    onProgress({
      stage: "parsing",
      // Parsing has no progress to report, so this creeps towards the end of
      // the stage rather than pretending to know how far along it is.
      fraction: 0.05 + 0.2 * Math.min(1, waited / 30_000),
      detail: `LlamaIndex is reading it, ${Math.round(waited / 1000)}s`,
    });
  }
}

export async function ingestFile(
  file: File,
  onProgress: (progress: IngestProgress) => void,
  reader: DemoReader = "cloudflare",
): Promise<IngestResult> {
  const startedAt = performance.now();
  const kind = kindOf(file.name);
  if (!kind) throw new Error("That file type is not supported.");

  let extracted: Extracted;
  if (reader === "llamaindex") {
    extracted = await readWithLlamaIndex(file, onProgress);
  } else {
    onProgress({ stage: "extracting", fraction: 0, detail: "Reading the file" });
    extracted = await extract(file, (done, total) => {
      onProgress({
        stage: "extracting",
        fraction: total > 0 ? done / total : 0,
        detail: `Reading page ${done} of ${total}`,
        pages: total,
      });
    });
  }

  onProgress({
    stage: "chunking",
    fraction: 0.2,
    detail: "Splitting the text into passages",
    pages: extracted.pageCount,
  });
  const chunks: Chunk[] = chunkMarkdown(extracted.markdown, extracted.pageBreaks);
  const segments = segmentMarkdown(extracted.markdown);
  if (chunks.length === 0) throw new Error("No passages could be built from this file.");

  onProgress({
    stage: "uploading",
    fraction: 0.3,
    detail: `Sending ${chunks.length} passages`,
    chunks: chunks.length,
    pages: extracted.pageCount,
  });

  const created = await api.createDocument({
    filename: file.name,
    kind,
    sizeBytes: file.size,
    extractor: reader === "llamaindex" ? "llamaparse" : "browser",
    pageCount: extracted.pageCount,
    totalChunks: chunks.length,
  });

  const segmentBatches = batchSegments(segments);
  const chunkBatches: Chunk[][] = [];
  for (let index = 0; index < chunks.length; index += created.batchSize) {
    chunkBatches.push(chunks.slice(index, index + created.batchSize));
  }

  const totalCalls = Math.max(segmentBatches.length, chunkBatches.length);
  let workerMs = 0;

  for (let call = 0; call < totalCalls; call += 1) {
    const chunkBatch = chunkBatches[call] ?? [];
    const response = await api.ingest(created.documentId, {
      segments: segmentBatches[call] ?? [],
      chunks: chunkBatch.map((chunk) => ({
        seq: chunk.seq,
        heading: chunk.heading,
        page: chunk.page,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        bodyStart: chunk.bodyStart,
        text: chunk.text,
        tokenEstimate: chunk.tokenEstimate,
      })),
      done: call === totalCalls - 1,
    });
    workerMs += response.elapsedMs;

    onProgress({
      stage: "embedding",
      fraction: 0.3 + 0.7 * ((call + 1) / totalCalls),
      detail: `Embedded ${response.embedded} of ${chunks.length} passages`,
      chunks: chunks.length,
      pages: extracted.pageCount,
      workerMs,
    });
  }

  const result: IngestResult = {
    documentId: created.documentId,
    chunks: chunks.length,
    pages: extracted.pageCount,
    workerMs,
    browserMs: Math.round(performance.now() - startedAt),
  };

  onProgress({
    stage: "done",
    fraction: 1,
    detail: `${chunks.length} passages ready`,
    chunks: chunks.length,
    pages: extracted.pageCount,
    workerMs,
  });

  return result;
}
