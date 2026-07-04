import { eq, sql } from "drizzle-orm";
import type { Env } from "../env.js";
import { createDb } from "../db/index.js";
import { documents, usageDaily } from "../db/schema.js";
import { parseText } from "./parsers/text.js";
import { parseCsv } from "./parsers/csv.js";
import { parseDocx } from "./parsers/docx.js";
import { extractPdfText } from "./parsers/pdf.js";
import { UnsupportedLocalParse } from "./parsers/errors.js";

/**
 * Tuning constants for the parse triage heuristic. Any change to these
 * values is a routing-behavior change and must be recorded in §10 Decisions.
 */
export const TRIAGE = {
  /** Files above this size skip local extraction entirely — local parsers need the whole buffer resident, and Workers has 128 MB total memory. */
  MAX_LOCAL_BYTES: 20 * 1024 * 1024,
  /** Minimum average extracted characters per PDF page to consider it real ("digital") text rather than a scan. */
  MIN_CHARS_PER_PAGE: 200,
  /** Minimum fraction of PDF pages that must contain any extracted text at all. */
  MIN_NON_EMPTY_PAGE_RATIO: 0.8,
  /** Maximum fraction of extracted characters that may be the Unicode replacement character before the extraction is considered unreliable/garbled. */
  MAX_GARBAGE_RATIO: 0.05,
} as const;

export type RouteDecision =
  | { parser: "local"; markdown: string }
  | { parser: "llamaparse"; totalPages?: number };

export interface RoutableDocument {
  id: string;
  tenantId: string;
  filename: string;
  sizeBytes: number;
}

function extensionOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function garbageRatio(text: string): number {
  if (text.length === 0) {
    return 1;
  }
  const replacementChars = text.match(/�/g)?.length ?? 0;
  return replacementChars / text.length;
}

function isDigitalPdf(charsPerPage: number[], text: string): boolean {
  if (charsPerPage.length === 0) {
    return false;
  }
  const avgCharsPerPage = charsPerPage.reduce((sum, n) => sum + n, 0) / charsPerPage.length;
  const nonEmptyRatio = charsPerPage.filter((n) => n > 0).length / charsPerPage.length;

  return (
    avgCharsPerPage >= TRIAGE.MIN_CHARS_PER_PAGE &&
    nonEmptyRatio >= TRIAGE.MIN_NON_EMPTY_PAGE_RATIO &&
    garbageRatio(text) < TRIAGE.MAX_GARBAGE_RATIO
  );
}

/**
 * Decides the cheapest adequate parser for a document and records the
 * outcome on its `documents` row (`parser`, `status`). Local routing skips
 * TICKET-12's polling entirely by setting status "embedding" directly.
 * LlamaParse routing stops at "decided + recorded" — actually submitting the
 * job is TICKET-11's job (`lib/llamaparse.ts`, not yet built), invoked ONLY
 * from this router's fallback branch once it exists.
 */
export async function routeDocument(
  env: Env,
  doc: RoutableDocument,
  // Lazy: oversized PDFs/DOCX skip local parsing entirely and never need the
  // buffer materialized at all, so callers shouldn't pay for it upfront.
  getBuf: () => Promise<ArrayBuffer>,
): Promise<RouteDecision> {
  const db = createDb(env.DB);
  const extension = extensionOf(doc.filename);
  const oversized = doc.sizeBytes > TRIAGE.MAX_LOCAL_BYTES;

  async function routeLocal(markdown: string): Promise<RouteDecision> {
    await db
      .update(documents)
      .set({ parser: "local", status: "embedding", updatedAt: Date.now() })
      .where(eq(documents.id, doc.id));
    return { parser: "local", markdown };
  }

  async function routeLlamaparse(totalPages?: number): Promise<RouteDecision> {
    await db
      .update(documents)
      .set({ parser: "llamaparse", status: "parsing", updatedAt: Date.now() })
      .where(eq(documents.id, doc.id));

    const today = new Date().toISOString().slice(0, 10);
    const pages = totalPages ?? 1;
    await db
      .insert(usageDaily)
      .values({ tenantId: doc.tenantId, day: today, api: "llamaparse", tokens: pages, requests: 1 })
      .onConflictDoUpdate({
        target: [usageDaily.tenantId, usageDaily.day, usageDaily.api],
        set: {
          tokens: sql`${usageDaily.tokens} + ${pages}`,
          requests: sql`${usageDaily.requests} + 1`,
        },
      });

    return { parser: "llamaparse", totalPages };
  }

  if (extension === "txt" || extension === "md") {
    return routeLocal(parseText(await getBuf()));
  }

  if (extension === "csv") {
    return routeLocal(parseCsv(await getBuf()));
  }

  if (extension === "docx") {
    if (oversized) {
      return routeLlamaparse();
    }
    try {
      const markdown = await parseDocx(await getBuf());
      return routeLocal(markdown);
    } catch (error) {
      if (error instanceof UnsupportedLocalParse) {
        return routeLlamaparse();
      }
      throw error;
    }
  }

  if (extension === "pdf") {
    if (oversized) {
      return routeLlamaparse();
    }
    const { text, totalPages, charsPerPage } = await extractPdfText(await getBuf());
    if (isDigitalPdf(charsPerPage, text)) {
      return routeLocal(text);
    }
    return routeLlamaparse(totalPages);
  }

  throw new Error(`Unsupported extension for routing: ${extension}`);
}
