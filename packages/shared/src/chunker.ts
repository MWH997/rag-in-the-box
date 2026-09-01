/**
 * Markdown-aware chunker.
 *
 * This lives in the shared package because the browser runs it during upload
 * and the Worker runs it on the server-side ingestion path. One implementation,
 * one set of tests, identical chunk boundaries either way.
 *
 * The strategy is structural first, size second:
 *   1. Split on ATX headings so a chunk never straddles two sections.
 *   2. Inside a section, accumulate whole blocks (paragraphs, list runs, tables,
 *      fenced code) until the size budget is reached.
 *   3. A block larger than the budget on its own is split on sentence
 *      boundaries, then on whitespace, and only then mid-word.
 *   4. Consecutive chunks overlap by a fixed number of characters so a fact
 *      that lands on a boundary still appears whole in one of them.
 *
 * Markdown tables are never split across chunks while they fit the hard cap,
 * and when a table must be split the header row is repeated so each piece stays
 * readable on its own.
 */

export interface ChunkOptions {
  /** Target chunk size in characters. */
  targetChars?: number;
  /** Never emit a chunk longer than this. */
  maxChars?: number;
  /** Characters of trailing context copied into the next chunk. */
  overlapChars?: number;
  /** Drop chunks shorter than this unless they are the only chunk. */
  minChars?: number;
}

export interface Chunk {
  seq: number;
  text: string;
  heading: string | null;
  /** Document offset of the first character of `text`, overlap included. */
  charStart: number;
  charEnd: number;
  /**
   * Document offset where this chunk's own content starts.
   *
   * Consecutive chunks overlap, so `text` begins with a tail carried over from
   * the chunk before it. That tail helps retrieval but it belongs to the
   * previous section, so anything pointing a reader at this chunk, a citation
   * above all, must start here rather than at `charStart`.
   */
  bodyStart: number;
  page: number | null;
  tokenEstimate: number;
}

export const CHUNK_DEFAULTS = {
  targetChars: 1_400,
  maxChars: 2_400,
  overlapChars: 160,
  minChars: 64,
} as const satisfies Required<ChunkOptions>;

/**
 * Rough token count. Four characters per token is the usual English estimate
 * and is only used for budgeting and usage reporting, never for billing.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Maps a character offset to a 1-based page number using page break offsets. */
export function pageForOffset(pageBreaks: readonly number[], offset: number): number | null {
  if (pageBreaks.length === 0) return null;
  let low = 0;
  let high = pageBreaks.length - 1;
  let page = 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const breakpoint = pageBreaks[mid];
    if (breakpoint === undefined) break;
    if (breakpoint <= offset) {
      page = mid + 2;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.min(page, pageBreaks.length + 1);
}

interface Block {
  text: string;
  start: number;
  isTable: boolean;
}

const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*)$/;

/** Splits markdown into blocks, keeping fenced code and tables intact. */
function toBlocks(section: string, sectionStart: number): Block[] {
  const lines = section.split("\n");
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let bufferStart = sectionStart;
  let offset = sectionStart;
  let inFence = false;
  let fenceMarker = "";
  let tableRun = false;

  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join("\n");
    if (text.trim().length > 0) {
      blocks.push({ text, start: bufferStart, isTable: tableRun });
    }
    buffer = [];
    tableRun = false;
  };

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;

    const fenceMatch = /^ {0,3}(```+|~~~+)/.exec(line);
    if (fenceMatch?.[1]) {
      if (!inFence) {
        flush();
        bufferStart = lineStart;
        inFence = true;
        fenceMarker = fenceMatch[1][0] ?? "`";
        buffer.push(line);
        continue;
      }
      if (line.trimStart().startsWith(fenceMarker)) {
        buffer.push(line);
        inFence = false;
        flush();
        continue;
      }
    }

    if (inFence) {
      buffer.push(line);
      continue;
    }

    const isTableLine = line.trimStart().startsWith("|");
    if (line.trim() === "") {
      flush();
      bufferStart = offset;
      continue;
    }

    if (buffer.length === 0) {
      bufferStart = lineStart;
      tableRun = isTableLine;
    } else if (isTableLine !== tableRun) {
      flush();
      bufferStart = lineStart;
      tableRun = isTableLine;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

/** Splits an oversized block, preferring sentence then whitespace boundaries. */
function splitOversized(block: Block, maxChars: number): Block[] {
  if (block.text.length <= maxChars) return [block];

  // A table gets its header repeated on every piece so each stays readable.
  if (block.isTable) {
    const rows = block.text.split("\n");
    const header = rows.slice(0, 2).join("\n");
    const headerLength = header.length + 1;
    const out: Block[] = [];
    let current: string[] = [];
    let currentStart = block.start;
    let cursor = block.start + headerLength;
    for (const row of rows.slice(2)) {
      if (current.length > 0 && headerLength + current.join("\n").length + row.length > maxChars) {
        out.push({ text: `${header}\n${current.join("\n")}`, start: currentStart, isTable: true });
        current = [];
        currentStart = cursor;
      }
      if (current.length === 0) currentStart = cursor;
      current.push(row);
      cursor += row.length + 1;
    }
    if (current.length > 0) {
      out.push({ text: `${header}\n${current.join("\n")}`, start: currentStart, isTable: true });
    }
    return out.length > 0 ? out : [block];
  }

  const out: Block[] = [];
  let rest = block.text;
  let start = block.start;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    let cut = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("? "),
      window.lastIndexOf("! "),
      window.lastIndexOf("\n"),
    );
    if (cut < maxChars * 0.5) cut = window.lastIndexOf(" ");
    if (cut < maxChars * 0.5) cut = maxChars - 1;
    const piece = rest.slice(0, cut + 1);
    out.push({ text: piece.trimEnd(), start, isTable: false });
    start += piece.length;
    rest = rest.slice(piece.length);
  }
  if (rest.trim().length > 0) out.push({ text: rest, start, isTable: false });
  return out;
}

export function chunkMarkdown(
  markdown: string,
  pageBreaks: readonly number[] = [],
  options: ChunkOptions = {},
): Chunk[] {
  const targetChars = options.targetChars ?? CHUNK_DEFAULTS.targetChars;
  const maxChars = Math.max(options.maxChars ?? CHUNK_DEFAULTS.maxChars, targetChars);
  const overlapChars = options.overlapChars ?? CHUNK_DEFAULTS.overlapChars;
  const minChars = options.minChars ?? CHUNK_DEFAULTS.minChars;

  // Pass one: cut the document into heading-delimited sections.
  const lines = markdown.split("\n");
  const sections: { heading: string | null; start: number; body: string }[] = [];
  let sectionLines: string[] = [];
  let sectionHeading: string | null = null;
  let sectionStart = 0;
  let offset = 0;

  const pushSection = () => {
    const body = sectionLines.join("\n");
    if (body.trim().length > 0 || sectionHeading) {
      sections.push({ heading: sectionHeading, start: sectionStart, body });
    }
    sectionLines = [];
  };

  let inFence = false;
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    if (/^ {0,3}(```+|~~~+)/.test(line)) inFence = !inFence;
    const headingMatch = inFence ? null : HEADING_RE.exec(line);
    if (headingMatch) {
      pushSection();
      sectionHeading = (headingMatch[2] ?? "").trim() || null;
      sectionStart = lineStart;
      sectionLines = [line];
      continue;
    }
    if (sectionLines.length === 0 && sectionHeading === null) sectionStart = lineStart;
    sectionLines.push(line);
  }
  pushSection();

  // Pass two: pack blocks into chunks inside each section.
  const chunks: Chunk[] = [];
  let seq = 0;

  for (const section of sections) {
    const blocks = toBlocks(section.body, section.start).flatMap((block) =>
      splitOversized(block, maxChars),
    );
    if (blocks.length === 0) continue;

    let buffer: Block[] = [];
    let bufferLength = 0;
    // Characters at the head of `buffer` carried over from the previous chunk.
    let carriedLength = 0;

    const emit = () => {
      if (buffer.length === 0) return;
      const first = buffer[0];
      const last = buffer[buffer.length - 1];
      if (!first || !last) return;
      const text = buffer.map((block) => block.text).join("\n\n");
      const charStart = first.start;
      const charEnd = last.start + last.text.length;
      // The carried block is joined to the next with two newlines, so the
      // chunk's own content starts just past it.
      const bodyStart =
        carriedLength > 0 && buffer.length > 1 ? charStart + carriedLength + 2 : charStart;

      chunks.push({
        seq: seq++,
        text,
        heading: section.heading,
        charStart,
        charEnd,
        bodyStart: Math.min(bodyStart, charEnd),
        page: pageForOffset(pageBreaks, Math.min(bodyStart, charEnd)),
        tokenEstimate: estimateTokens(text),
      });

      // Carry the tail of this chunk into the next one as overlap context.
      // Never after a table: the tail would be a partial row, which reads as
      // broken markdown and gives retrieval a fragment with no column names.
      if (overlapChars > 0 && text.length > overlapChars && !last.isTable) {
        const tail = text.slice(-overlapChars);
        const cut = tail.indexOf(" ");
        const carried = cut >= 0 ? tail.slice(cut + 1) : tail;
        if (carried.trim()) {
          buffer = [{ text: carried, start: charEnd - carried.length, isTable: false }];
          carriedLength = carried.length;
        } else {
          buffer = [];
          carriedLength = 0;
        }
      } else {
        buffer = [];
        carriedLength = 0;
      }
      bufferLength = buffer.reduce((sum, block) => sum + block.text.length + 2, 0);
    };

    for (const block of blocks) {
      const projected = bufferLength + block.text.length + 2;
      if (bufferLength > 0 && projected > targetChars) emit();
      buffer.push(block);
      bufferLength += block.text.length + 2;
      if (bufferLength >= maxChars) emit();
    }
    emit();
  }

  const usable = chunks.filter((chunk) => chunk.text.trim().length >= minChars);
  const kept = usable.length > 0 ? usable : chunks.slice(0, 1);
  return kept.map((chunk, index) => ({ ...chunk, seq: index }));
}

/**
 * Splits markdown into display segments for the side-by-side reader.
 * Segments are cut on line boundaries so rendered markdown stays valid.
 */
export function segmentMarkdown(
  markdown: string,
  maxChars = 12_000,
): {
  seq: number;
  charStart: number;
  markdown: string;
  page: number | null;
}[] {
  const lines = markdown.split("\n");
  const segments: { seq: number; charStart: number; markdown: string; page: number | null }[] = [];
  let buffer: string[] = [];
  let start = 0;
  let offset = 0;
  let length = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    segments.push({
      seq: segments.length,
      charStart: start,
      markdown: buffer.join("\n"),
      page: null,
    });
    buffer = [];
    length = 0;
  };

  for (const line of lines) {
    if (length > 0 && length + line.length + 1 > maxChars) {
      flush();
      start = offset;
    }
    if (buffer.length === 0) start = offset;
    buffer.push(line);
    length += line.length + 1;
    offset += line.length + 1;
  }
  flush();
  return segments;
}
