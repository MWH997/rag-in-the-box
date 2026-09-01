import { chunkMarkdown, segmentMarkdown, type Chunk } from "@rag/shared";

import { api } from "./api";
import { extract, kindOf } from "./extract";

/**
 * The upload pipeline, driven from the browser.
 *
 * Extraction and chunking happen here; the Worker receives small batches and
 * does one embedding call per request. `onStage` reports progress so the
 * interface can show what each step actually cost, which is the clearest way to
 * explain why this design fits the free plan.
 */

export type IngestStage = "extracting" | "chunking" | "uploading" | "embedding" | "done";

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

function batchSegments(
  segments: ReturnType<typeof segmentMarkdown>,
): (typeof segments)[] {
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

export async function ingestFile(
  file: File,
  onProgress: (progress: IngestProgress) => void,
): Promise<IngestResult> {
  const startedAt = performance.now();
  const kind = kindOf(file.name);
  if (!kind) throw new Error("That file type is not supported.");

  onProgress({ stage: "extracting", fraction: 0, detail: "Reading the file" });
  const extracted = await extract(file, (done, total) => {
    onProgress({
      stage: "extracting",
      fraction: total > 0 ? done / total : 0,
      detail: `Reading page ${done} of ${total}`,
      pages: total,
    });
  });

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
    extractor: "browser",
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
