import { rowsToMarkdown, type SourceKind } from "@rag/shared";

/**
 * Text extraction, in the browser.
 *
 * This is the piece that makes the Cloudflare free plan viable. Reading a PDF
 * costs hundreds of milliseconds of processor time against a 10 ms per-request
 * budget in a Worker, so the work happens on the reader's own machine and the
 * Worker only ever receives text.
 *
 * Every extractor returns markdown plus the character offset where each page
 * begins, which is what lets a citation resolve back to a page number.
 */

export interface Extracted {
  markdown: string;
  /** Character offset of the start of each page after the first. */
  pageBreaks: number[];
  pageCount: number;
}

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".csv", ".txt", ".md"] as const;

const EXTENSION_TO_KIND: Record<string, SourceKind> = {
  pdf: "pdf",
  docx: "docx",
  csv: "csv",
  txt: "txt",
  md: "md",
  markdown: "md",
};

export function kindOf(filename: string): SourceKind | null {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TO_KIND[extension] ?? null;
}

/** Lets the browser paint between pages of a long document. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function extractPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<Extracted> {
  // Imported lazily so the PDF engine is only downloaded when a PDF is opened.
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = new Uint8Array(await file.arrayBuffer());
  // pdf.js 6 moved teardown onto the loading task, so the task is kept rather
  // than discarded. Destroying it is what terminates the worker thread.
  const loadingTask = pdfjs.getDocument({ data });
  const document = await loadingTask.promise;

  const parts: string[] = [];
  const pageBreaks: number[] = [];
  let offset = 0;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();

    // pdf.js hands back positioned runs, not lines. Runs are joined with a
    // space, and a run flagged as ending a line starts a new one, which keeps
    // headings and list items on their own lines instead of running together.
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str;
      if (item.hasEOL) text += "\n";
      else if (item.str.length > 0 && !item.str.endsWith(" ")) text += " ";
    }
    page.cleanup();

    const cleaned = text
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const block = `${pageNumber > 1 ? "\n\n" : ""}${cleaned}`;
    if (pageNumber > 1) pageBreaks.push(offset + 2);
    parts.push(block);
    offset += block.length;

    onProgress?.(pageNumber, document.numPages);
    if (pageNumber % 5 === 0) await yieldToBrowser();
  }

  const pageCount = document.numPages;
  await loadingTask.destroy();
  return { markdown: parts.join(""), pageBreaks, pageCount };
}

async function extractDocx(file: File): Promise<Extracted> {
  // Loaded on demand so a reader who never opens a Word file never downloads
  // the converter. Same reasoning as the PDF engine above.
  const mammoth = (await import("mammoth")).default;
  const arrayBuffer = await file.arrayBuffer();
  // convertToMarkdown exists at runtime but is missing from mammoth's types.
  const converter = mammoth as unknown as {
    convertToMarkdown: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  };
  const result = await converter.convertToMarkdown({ arrayBuffer });
  return { markdown: result.value.trim(), pageBreaks: [], pageCount: 1 };
}

async function extractCsv(file: File): Promise<Extracted> {
  const Papa = (await import("papaparse")).default;
  const text = await file.text();
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const title = file.name.replace(/\.[^.]+$/, "");
  return { markdown: rowsToMarkdown(parsed.data, title), pageBreaks: [], pageCount: 1 };
}

async function extractText(file: File): Promise<Extracted> {
  const text = await file.text();
  return { markdown: text.trim(), pageBreaks: [], pageCount: 1 };
}

export async function extract(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<Extracted> {
  const kind = kindOf(file.name);
  if (!kind) {
    throw new Error(`Supported file types are ${ACCEPTED_EXTENSIONS.join(", ")}.`);
  }

  const extracted =
    kind === "pdf"
      ? await extractPdf(file, onProgress)
      : kind === "docx"
        ? await extractDocx(file)
        : kind === "csv"
          ? await extractCsv(file)
          : await extractText(file);

  if (extracted.markdown.trim().length === 0) {
    throw new Error(
      kind === "pdf"
        ? "No text could be read from this PDF. It is most likely a scan, which needs optical character recognition on the paid tier."
        : "This file contained no readable text.",
    );
  }
  return extracted;
}
