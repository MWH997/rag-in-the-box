import { describe, expect, it } from "vitest";

import { cn, formatBytes, formatCount, formatDuration, formatUntil } from "./utils";

describe("cn", () => {
  it("keeps the last of two conflicting utilities", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });
});

describe("formatBytes", () => {
  it("reads bytes, kilobytes and megabytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(8 * 1024 * 1024)).toBe("8.0 MB");
  });
});

describe("formatCount", () => {
  it("shortens thousands and millions", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1_500)).toBe("1.5k");
    expect(formatCount(2_400_000)).toBe("2.4M");
  });

  it("rounds rather than truncating below a thousand", () => {
    expect(formatCount(46.6)).toBe("47");
  });
});

describe("formatDuration", () => {
  it("uses milliseconds below a second and seconds above", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(999)).toBe("999 ms");
    expect(formatDuration(1_000)).toBe("1.0 s");
    expect(formatDuration(12_500)).toBe("12.5 s");
  });
});

describe("formatUntil", () => {
  it("says now for a time already passed", () => {
    expect(formatUntil(Date.now() - 1_000)).toBe("now");
  });

  it("reports hours and minutes ahead", () => {
    expect(formatUntil(Date.now() + 3_600_000 * 2 + 60_000 * 30)).toMatch(/^2h 3\dm$/);
  });

  it("reports minutes alone within the hour", () => {
    expect(formatUntil(Date.now() + 60_000 * 20)).toMatch(/^\d+m$/);
  });
});
