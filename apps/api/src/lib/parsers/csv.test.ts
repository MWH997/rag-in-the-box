import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.js";
import { readFixture } from "./test-utils.js";

function toBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("parseCsv", () => {
  it("renders a valid GitHub-flavored markdown table for a small CSV fixture", () => {
    const result = parseCsv(readFixture("sample.csv"));
    const lines = result.split("\n");

    expect(result.length).toBeGreaterThan(0);
    expect(lines[0]).toBe("| name | role | age |");
    expect(lines[1]).toBe("| --- | --- | --- |");
    expect(lines.length).toBe(2 + 5); // header + separator + 5 data rows
    expect(result).toContain("Person 0");
  });

  it("splits CSVs over 500 rows into ##-sectioned tables of at most 200 rows", () => {
    const header = "name,value";
    const rows = Array.from({ length: 650 }, (_, i) => `row-${i},${i}`);
    const csv = [header, ...rows].join("\n");

    const result = parseCsv(toBuffer(csv));

    const sectionHeadings = result.match(/^## Rows .+$/gm) ?? [];
    expect(sectionHeadings.length).toBe(4); // ceil(650 / 200)
    expect(sectionHeadings[0]).toBe("## Rows 1 to 200");
    expect(sectionHeadings[3]).toBe("## Rows 601 to 650");

    // every section's table still has its own header/separator/rows intact
    const tableHeaders = result.match(/^\| name \| value \|$/gm) ?? [];
    expect(tableHeaders.length).toBe(4);
  });
});
