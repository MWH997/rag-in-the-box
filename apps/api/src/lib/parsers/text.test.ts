import { describe, expect, it } from "vitest";
import { parseText } from "./text.js";
import { readFixture } from "./test-utils.js";

describe("parseText", () => {
  it("returns non-empty markdown-safe content for a utf-8 text fixture", () => {
    const result = parseText(readFixture("sample.txt"));
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("Hello, sample text file.");
  });

  it("handles an empty buffer without throwing", () => {
    const result = parseText(new ArrayBuffer(0));
    expect(result).toBe("");
  });

  it("falls back to latin1 when bytes are not valid utf-8", () => {
    const invalidUtf8 = new Uint8Array([0xff, 0xfe, 0x41, 0x42]);
    const result = parseText(invalidUtf8.buffer);
    expect(result.length).toBeGreaterThan(0);
  });
});
