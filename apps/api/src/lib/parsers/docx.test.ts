import { describe, expect, it } from "vitest";
import { parseDocx } from "./docx.js";
import { UnsupportedLocalParse } from "./errors.js";
import { readFixture } from "./test-utils.js";

describe("parseDocx", () => {
  it("returns non-empty markdown for a valid docx fixture", async () => {
    const result = await parseDocx(readFixture("sample.docx"));
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("Hello, sample DOCX");
    expect(result).toContain("Second paragraph for testing");
  });

  it("throws UnsupportedLocalParse for a file that isn't a valid docx", async () => {
    const garbage = new TextEncoder().encode("not a docx file").buffer as ArrayBuffer;
    await expect(parseDocx(garbage)).rejects.toBeInstanceOf(UnsupportedLocalParse);
  });
});
