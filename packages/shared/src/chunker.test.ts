import { describe, expect, it } from "vitest";

import { CHUNK_DEFAULTS, chunkMarkdown, pageForOffset, segmentMarkdown } from "./chunker.js";

const HEADINGS = `# Manual

## One

${"Alpha sentence about the first topic. ".repeat(120)}

## Two

${"Beta sentence about the second topic. ".repeat(120)}

## Three

${"Gamma sentence about the third topic. ".repeat(120)}
`;

describe("chunkMarkdown", () => {
  it("never emits a chunk longer than the hard cap", () => {
    for (const chunk of chunkMarkdown(HEADINGS)) {
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_DEFAULTS.maxChars);
    }
  });

  it("keeps a chunk inside one section", () => {
    const chunks = chunkMarkdown(HEADINGS);
    const headings = new Set(chunks.map((chunk) => chunk.heading));
    expect(headings).toContain("One");
    expect(headings).toContain("Two");
    expect(headings).toContain("Three");
    for (const chunk of chunks) {
      if (chunk.heading === "Two") {
        expect(chunk.text).not.toContain("Gamma sentence");
      }
    }
  });

  it("numbers chunks from zero with no gaps", () => {
    const chunks = chunkMarkdown(HEADINGS);
    expect(chunks.map((chunk) => chunk.seq)).toEqual(chunks.map((_, index) => index));
  });

  it("points bodyStart past the text carried over from the previous chunk", () => {
    const chunks = chunkMarkdown(HEADINGS);
    for (const chunk of chunks) {
      expect(chunk.bodyStart).toBeGreaterThanOrEqual(chunk.charStart);
      expect(chunk.bodyStart).toBeLessThanOrEqual(chunk.charEnd);
    }
    // At least one chunk carries overlap, so at least one body starts later
    // than the chunk itself.
    expect(chunks.some((chunk) => chunk.bodyStart > chunk.charStart)).toBe(true);
  });

  it("does not split a table that fits the cap", () => {
    const table = [
      "# Report",
      "",
      "| Name | Value |",
      "| --- | --- |",
      ...Array.from({ length: 20 }, (_, index) => `| row ${index} | ${index} |`),
    ].join("\n");
    const chunks = chunkMarkdown(table);
    const withRows = chunks.filter((chunk) => chunk.text.includes("| row 0 |"));
    expect(withRows).toHaveLength(1);
    expect(withRows[0]?.text).toContain("| row 19 |");
  });

  it("repeats the header when a table has to be split", () => {
    const table = [
      "| Name | Value |",
      "| --- | --- |",
      ...Array.from({ length: 400 }, (_, index) => `| a longer row label ${index} | ${index} |`),
    ].join("\n");
    const chunks = chunkMarkdown(table);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text).toContain("| Name | Value |");
    }
  });

  it("never starts a chunk with half a table row", () => {
    const table = [
      "| Name | Value |",
      "| --- | --- |",
      ...Array.from({ length: 400 }, (_, index) => `| a longer row label ${index} | ${index} |`),
    ].join("\n");
    for (const chunk of chunkMarkdown(table)) {
      expect(chunk.text.startsWith("| Name | Value |")).toBe(true);
    }
  });

  it("keeps a fenced code block whole", () => {
    const source = ["# Code", "", "```js", "const a = 1;", "const b = 2;", "```", ""].join("\n");
    const chunks = chunkMarkdown(source);
    const withCode = chunks.find((chunk) => chunk.text.includes("const a = 1;"));
    expect(withCode?.text).toContain("const b = 2;");
    expect(withCode?.text).toContain("```");
  });

  it("returns a single chunk for a very short document", () => {
    const chunks = chunkMarkdown("Just one short line of text that is still long enough.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.charStart).toBe(0);
  });

  it("returns nothing useful for empty input rather than throwing", () => {
    expect(() => chunkMarkdown("")).not.toThrow();
  });

  it("assigns a page from the page break offsets", () => {
    const text = `${"a".repeat(100)}\n\n${"b".repeat(100)}`;
    const chunks = chunkMarkdown(text, [102]);
    expect(chunks[0]?.page).toBe(1);
  });
});

describe("pageForOffset", () => {
  it("returns null when the document has no pages", () => {
    expect(pageForOffset([], 40)).toBeNull();
  });

  it("maps offsets either side of a break", () => {
    expect(pageForOffset([100, 200], 0)).toBe(1);
    expect(pageForOffset([100, 200], 99)).toBe(1);
    expect(pageForOffset([100, 200], 100)).toBe(2);
    expect(pageForOffset([100, 200], 250)).toBe(3);
  });
});

describe("segmentMarkdown", () => {
  it("covers the whole document with ordered segments", () => {
    const source = Array.from({ length: 400 }, (_, index) => `Line ${index}`).join("\n");
    const segments = segmentMarkdown(source, 800);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.map((segment) => segment.seq)).toEqual(segments.map((_, index) => index));
    expect(segments[0]?.charStart).toBe(0);
    const rebuilt = segments.map((segment) => segment.markdown).join("\n");
    expect(rebuilt).toBe(source);
  });

  it("cuts only on line boundaries so markdown stays valid", () => {
    const source = "# Title\n\nSome body text\n\n## Next\n\nMore body text";
    for (const segment of segmentMarkdown(source, 20)) {
      expect(segment.markdown.startsWith(" ")).toBe(false);
    }
  });
});
