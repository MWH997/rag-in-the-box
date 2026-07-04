import { describe, expect, it } from "vitest";
import { extractPdfText } from "./pdf.js";
import { readFixture } from "./test-utils.js";

describe("extractPdfText", () => {
  it("reports a high chars/page average for a digitally-authored PDF", async () => {
    const result = await extractPdfText(readFixture("digital.pdf"));
    const avgCharsPerPage =
      result.charsPerPage.reduce((sum, n) => sum + n, 0) / result.totalPages;

    expect(result.totalPages).toBe(2);
    expect(avgCharsPerPage).toBeGreaterThan(200);
    expect(result.text).toContain("digitally-authored PDF fixture");
  });

  it("reports near-zero chars/page for a scanned (text-less) PDF", async () => {
    const result = await extractPdfText(readFixture("scanned.pdf"));
    const avgCharsPerPage =
      result.charsPerPage.reduce((sum, n) => sum + n, 0) / result.totalPages;

    expect(result.totalPages).toBe(1);
    expect(avgCharsPerPage).toBeLessThan(5);
  });
});
