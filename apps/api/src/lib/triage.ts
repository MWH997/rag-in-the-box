import type { SourceKind } from "@rag/shared";

import { UnsupportedLocalParse } from "./parsers/errors.js";
import { parseCsv } from "./parsers/csv.js";
import { parseDocx } from "./parsers/docx.js";
import { extractPdfText } from "./parsers/pdf.js";
import { parseText } from "./parsers/text.js";

/**
 * Parse triage for the server-side ingestion path.
 *
 * The browser path handles every ordinary upload, so this runs only when an
 * operator on the paid tier posts a file directly to the API. It picks the
 * cheapest parser that can actually read the file and escalates to LlamaParse
 * only for files no local parser can handle, which is what keeps LlamaParse
 * spend on the minority of documents that genuinely need vision-based parsing.
 *
 * The decision is a pure function of the file so it can be tested without a
 * database, a network call or an API key.
 */
export const TRIAGE = {
  /**
   * Files above this size skip local extraction. Local parsers need the whole
   * buffer resident and a Worker has 128 MB of memory in total.
   */
  MAX_LOCAL_BYTES: 20 * 1024 * 1024,
  /** Average extracted characters per page below which a PDF reads as scanned. */
  MIN_CHARS_PER_PAGE: 200,
  /** Fraction of pages that must contain any text at all. */
  MIN_NON_EMPTY_PAGE_RATIO: 0.8,
  /** Fraction of replacement characters above which extraction is unreliable. */
  MAX_GARBAGE_RATIO: 0.05,
} as const;

export type TriageDecision =
  | { extractor: "worker"; markdown: string; pageCount: number }
  | { extractor: "llamaparse"; reason: string; pageCount: number };

function garbageRatio(text: string): number {
  if (text.length === 0) return 1;
  const replacements = text.match(/�/g)?.length ?? 0;
  return replacements / text.length;
}

export function isDigitalPdf(charsPerPage: number[], text: string): boolean {
  if (charsPerPage.length === 0) return false;
  const average = charsPerPage.reduce((sum, value) => sum + value, 0) / charsPerPage.length;
  const nonEmpty = charsPerPage.filter((value) => value > 0).length / charsPerPage.length;
  return (
    average >= TRIAGE.MIN_CHARS_PER_PAGE &&
    nonEmpty >= TRIAGE.MIN_NON_EMPTY_PAGE_RATIO &&
    garbageRatio(text) < TRIAGE.MAX_GARBAGE_RATIO
  );
}

/** Decides how to read a file, and reads it when a local parser can. */
export async function triage(
  kind: SourceKind,
  buffer: ArrayBuffer,
  sizeBytes: number,
): Promise<TriageDecision> {
  // Plain text formats are always parsed locally. They never reach LlamaParse,
  // so an oversized one is rejected before it gets here.
  if (kind === "txt" || kind === "md") {
    return { extractor: "worker", markdown: parseText(buffer), pageCount: 1 };
  }
  if (kind === "csv") {
    return { extractor: "worker", markdown: parseCsv(buffer), pageCount: 1 };
  }

  if (sizeBytes > TRIAGE.MAX_LOCAL_BYTES) {
    return {
      extractor: "llamaparse",
      reason: "larger than the in-Worker parsing limit",
      pageCount: 0,
    };
  }

  if (kind === "docx") {
    try {
      return { extractor: "worker", markdown: await parseDocx(buffer), pageCount: 1 };
    } catch (cause) {
      if (cause instanceof UnsupportedLocalParse) {
        return { extractor: "llamaparse", reason: "unsupported docx features", pageCount: 0 };
      }
      throw cause;
    }
  }

  const extracted = await extractPdfText(buffer);
  if (isDigitalPdf(extracted.charsPerPage, extracted.text)) {
    return {
      extractor: "worker",
      markdown: extracted.text,
      pageCount: extracted.totalPages,
    };
  }
  return {
    extractor: "llamaparse",
    reason: "little or no extractable text, most likely a scan",
    pageCount: extracted.totalPages,
  };
}
