/**
 * Highlights an arbitrary run of text inside rendered markdown.
 *
 * The passage a citation points at is a range of the markdown source, and that
 * does not line up with the rendered DOM. The source carries heading marks,
 * emphasis and table pipes that never appear on screen, and the rendered text
 * is split across elements that the source shows as one run. So the passage is
 * located by its words rather than by its offsets, then painted with the CSS
 * Custom Highlight API, which accepts a range crossing element boundaries.
 *
 * Browsers without the API get nothing painted; the reader still scrolls the
 * passage into view, so the feature degrades rather than breaking.
 */

const HIGHLIGHT_NAME = "rag-citation";

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "LI",
  "TD",
  "TH",
  "TR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
  "SECTION",
  "ARTICLE",
  "UL",
  "OL",
  "TABLE",
  "BR",
]);

interface Piece {
  node: Text;
  start: number;
  length: number;
}

function blockAncestor(node: Node): Element | null {
  let current: Node | null = node.parentElement;
  while (current) {
    if (current instanceof Element && BLOCK_TAGS.has(current.tagName)) return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * Flattens the container's text.
 *
 * A separator is inserted where one block ends and the next begins. Without it
 * a heading runs straight into the paragraph below it, and a passage that spans
 * the two can never be matched.
 */
function flatten(container: HTMLElement): { pieces: Piece[]; text: string } {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const pieces: Piece[] = [];
  let text = "";
  let previousBlock: Element | null = null;

  let node = walker.nextNode();
  while (node) {
    const value = node.nodeValue ?? "";
    if (value.length > 0) {
      const block = blockAncestor(node);
      if (text.length > 0 && block !== previousBlock) text += "\n";
      pieces.push({ node: node as Text, start: text.length, length: value.length });
      text += value;
      previousBlock = block;
    }
    node = walker.nextNode();
  }
  return { pieces, text };
}

/** Collapses whitespace and lowercases, keeping a map back to source offsets. */
export function normalize(text: string): { value: string; map: number[] } {
  const map: number[] = [];
  let value = "";
  let previousWasSpace = true;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (/\s/.test(character)) {
      if (previousWasSpace) continue;
      value += " ";
      map.push(index);
      previousWasSpace = true;
      continue;
    }
    value += character.toLowerCase();
    map.push(index);
    previousWasSpace = false;
  }
  // Leading whitespace is skipped by the loop; trailing whitespace is trimmed
  // here so both ends behave the same and offsets stay aligned with the map.
  if (value.endsWith(" ")) {
    value = value.slice(0, -1);
    map.pop();
  }
  return { value, map };
}

/** Removes the markdown syntax that never reaches the rendered page. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}\d+\.\s+/gm, (match) => match)
    .replace(/```+[^\n]*/g, "")
    .replace(/[*_`~]/g, "")
    .replace(/\|/g, " ")
    .replace(/^\s*[-: ]+\s*$/gm, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

function positionOf(pieces: Piece[], offset: number): { node: Text; offset: number } | null {
  for (const piece of pieces) {
    if (offset >= piece.start && offset <= piece.start + piece.length) {
      return { node: piece.node, offset: offset - piece.start };
    }
  }
  const last = pieces.at(-1);
  return last ? { node: last.node, offset: last.length } : null;
}

/** Every place a probe occurs in the haystack. */
export function occurrences(haystack: string, probe: string): number[] {
  const found: number[] = [];
  let at = haystack.indexOf(probe);
  while (at !== -1 && found.length < 64) {
    found.push(at);
    at = haystack.indexOf(probe, at + 1);
  }
  return found;
}

/**
 * The window of the needle that appears in the haystack.
 *
 * Chunks overlap by design, so the same words can appear in two neighbouring
 * passages and a plain first-match search would keep landing on the earlier
 * one. `hint` is where the passage sits in the document, as a fraction, and the
 * occurrence closest to it wins.
 */
function findStart(
  haystack: string,
  needle: string,
  hint: number | null,
): { at: number; window: number } | null {
  const windows = [needle.length, 160, 90, 50, 30];
  for (const size of windows) {
    if (size < 24) continue;
    // Several starting points, so a passage whose opening was dropped by the
    // renderer, such as a table separator row, still matches.
    for (const from of [0, Math.floor(needle.length * 0.25), Math.floor(needle.length * 0.5)]) {
      const probe = needle.slice(from, from + size).trim();
      if (probe.length < 24) continue;
      const places = occurrences(haystack, probe);
      if (places.length === 0) continue;
      if (places.length === 1 || hint === null) {
        return { at: places[0] as number, window: probe.length };
      }
      const expected = hint * haystack.length;
      const best = places.reduce((closest, place) =>
        Math.abs(place - expected) < Math.abs(closest - expected) ? place : closest,
      );
      return { at: best, window: probe.length };
    }
  }
  return null;
}

export function clearHighlight(): void {
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  registry?.delete(HIGHLIGHT_NAME);
}

/**
 * Paints `passage` inside `container` and returns the element to scroll to,
 * or null when the passage could not be located.
 *
 * `hint` is roughly where the passage sits in the document, from 0 to 1. It
 * only breaks ties between repeated text, so an inaccurate hint costs nothing.
 */
export function highlightPassage(
  container: HTMLElement,
  passage: string,
  hint: number | null = null,
): Element | null {
  const registry = (CSS as unknown as { highlights?: Map<string, Highlight> }).highlights;
  const { pieces, text } = flatten(container);
  if (pieces.length === 0) return null;

  const haystack = normalize(text);
  const needle = normalize(stripMarkdown(passage));
  if (needle.value.trim().length < 24) return null;

  const found = findStart(haystack.value, needle.value, hint);
  if (!found) return null;

  // The end is the last part of the passage that is still present after the
  // start, so a passage broken across elements is covered rather than cut off.
  let end = found.at + found.window;
  const tail = needle.value.slice(-60).trim();
  if (tail.length >= 24) {
    const tailAt = haystack.value.indexOf(tail, found.at);
    if (tailAt !== -1) end = tailAt + tail.length;
  }
  end = Math.min(end, haystack.map.length);

  const startOriginal = haystack.map[found.at];
  const endOriginal = haystack.map[Math.max(found.at, end - 1)];
  if (startOriginal === undefined || endOriginal === undefined) return null;

  const start = positionOf(pieces, startOriginal);
  const finish = positionOf(pieces, endOriginal + 1);
  if (!start || !finish) return null;

  const range = document.createRange();
  try {
    range.setStart(start.node, Math.min(start.offset, start.node.length));
    range.setEnd(finish.node, Math.min(finish.offset, finish.node.length));
    if (range.collapsed) return start.node.parentElement;
  } catch {
    return start.node.parentElement;
  }

  if (registry && typeof Highlight === "function") {
    registry.set(HIGHLIGHT_NAME, new Highlight(range));
  }

  return start.node.parentElement;
}
