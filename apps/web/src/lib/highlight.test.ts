import { describe, expect, it } from "vitest";

import { normalize, occurrences, stripMarkdown } from "./highlight";

describe("stripMarkdown", () => {
  it("removes heading markers so a heading matches its rendered text", () => {
    expect(stripMarkdown("## 6. De-icing")).toBe("6. De-icing");
  });

  it("removes emphasis, code ticks and block quotes", () => {
    expect(stripMarkdown("**bold** and _italic_ and `code`")).toBe("bold and italic and code");
    expect(stripMarkdown("> quoted line")).toBe("quoted line");
  });

  it("turns table pipes into spaces so cells stay separate words", () => {
    expect(stripMarkdown("| a | b |")).toBe("  a   b  ");
  });

  it("keeps link text and drops the target", () => {
    expect(stripMarkdown("see [the guide](https://example.com/x)")).toBe("see the guide");
  });

  it("leaves ordinary prose untouched", () => {
    const prose = "Hold 3 is limited to 1,900 kg because of the reinforced floor section.";
    expect(stripMarkdown(prose)).toBe(prose);
  });
});

describe("normalize", () => {
  it("collapses runs of whitespace and lowercases", () => {
    expect(normalize("  A  B\n\nC ").value).toBe("a b c");
  });

  it("maps every normalised character back to a source offset", () => {
    const source = "A   B";
    const { value, map } = normalize(source);
    expect(value).toBe("a b");
    expect(map).toHaveLength(value.length);
    expect(source[map[0] as number]).toBe("A");
    expect(source[map[2] as number]).toBe("B");
  });

  it("returns nothing for whitespace only input", () => {
    expect(normalize("   \n  ").value).toBe("");
  });
});

describe("occurrences", () => {
  it("finds every position, including overlapping ones", () => {
    expect(occurrences("abcabcabc", "abc")).toEqual([0, 3, 6]);
    expect(occurrences("aaaa", "aa")).toEqual([0, 1, 2]);
  });

  it("returns nothing when the probe is absent", () => {
    expect(occurrences("abc", "xyz")).toEqual([]);
  });
});
