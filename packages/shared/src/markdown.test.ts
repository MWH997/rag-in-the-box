import { describe, expect, it } from "vitest";

import { rowsToMarkdown, toMarkdownTable } from "./markdown.js";

describe("toMarkdownTable", () => {
  it("escapes a pipe inside a cell so the table survives", () => {
    const table = toMarkdownTable(["a", "b"], [["x|y", "z"]]);
    expect(table.split("\n")[2]).toBe("| x\\|y | z |");
    // Splitting on unescaped pipes alone gives the header, two cells and the
    // trailing edge, which is what a reader of the markdown would see.
    const cells = (table.split("\n")[2] ?? "").split(/(?<!\\)\|/);
    expect(cells).toHaveLength(4);
  });

  it("pads a short row to the header width", () => {
    const table = toMarkdownTable(["a", "b", "c"], [["1"]]);
    expect(table.split("\n")[2]).toBe("| 1 |  |  |");
  });

  it("drops cells past the header width", () => {
    const table = toMarkdownTable(["a"], [["1", "2", "3"]]);
    expect(table.split("\n")[2]).toBe("| 1 |");
  });

  it("flattens a newline inside a cell", () => {
    expect(toMarkdownTable(["a"], [["one\ntwo"]])).toContain("| one two |");
  });
});

describe("rowsToMarkdown", () => {
  it("returns nothing for empty input", () => {
    expect(rowsToMarkdown([])).toBe("");
    expect(rowsToMarkdown([[]])).toBe("");
  });

  it("renders one table below the split threshold", () => {
    const rows = Array.from({ length: 100 }, (_, index) => [`row ${index}`, String(index)]);
    const output = rowsToMarkdown([["name", "value"], ...rows]);
    expect(output.match(/^## Rows/gm)).toBeNull();
    expect(output.split("\n")).toHaveLength(102);
  });

  it("splits a long table into sections that each keep their header", () => {
    const rows = Array.from({ length: 650 }, (_, index) => [`row ${index}`, String(index)]);
    const output = rowsToMarkdown([["name", "value"], ...rows]);
    expect(output.match(/^## Rows/gm)).toHaveLength(4);
    expect(output.match(/^\| name \| value \|$/gm)).toHaveLength(4);
  });

  it("adds a title heading when one is given", () => {
    expect(rowsToMarkdown([["a"], ["1"]], "Sales").startsWith("# Sales\n\n")).toBe(true);
  });

  it("omits the heading when no title is given", () => {
    expect(rowsToMarkdown([["a"], ["1"]]).startsWith("|")).toBe(true);
  });
});
