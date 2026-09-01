import { describe, expect, it } from "vitest";

import { FREE_D1_ROWS_READ_PER_DAY, FREE_D1_ROWS_WRITTEN_PER_DAY } from "@rag/shared";

import { createMeter, isDailyLimitError } from "./d1-meter.js";

/**
 * A stand-in for the D1 binding that reports the meta D1 reports.
 *
 * The point of these tests is that the counter follows a statement through
 * bind(), because every query the application makes is parameterised and an
 * unwrapped bind() would silently count nothing.
 */
function fakeD1(plan: { rowsRead: number; rowsWritten: number }[]): D1Database {
  let call = 0;
  const next = () => {
    const meta = plan[Math.min(call, plan.length - 1)] ?? { rowsRead: 0, rowsWritten: 0 };
    call += 1;
    return {
      results: [],
      meta: { rows_read: meta.rowsRead, rows_written: meta.rowsWritten },
    };
  };

  const statement = {
    bind: () => statement,
    run: async () => next(),
    all: async () => next(),
    first: async () => null,
    raw: async () => [],
  };

  return {
    prepare: () => statement,
    batch: async (statements: unknown[]) => statements.map(() => next()),
    dump: async () => new ArrayBuffer(0),
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

describe("createMeter", () => {
  it("counts rows through a bound statement", async () => {
    const meter = createMeter(fakeD1([{ rowsRead: 12, rowsWritten: 0 }]));
    await meter.binding.prepare("select 1").bind("a").all();

    expect(meter.usage()).toEqual({ rowsRead: 12, rowsWritten: 0, queries: 1 });
  });

  it("counts rows through repeated binds of one statement", async () => {
    const meter = createMeter(
      fakeD1([
        { rowsRead: 3, rowsWritten: 0 },
        { rowsRead: 0, rowsWritten: 7 },
      ]),
    );
    const statement = meter.binding.prepare("select 1");
    await statement.bind("a").all();
    await statement.bind("b").run();

    expect(meter.usage()).toEqual({ rowsRead: 3, rowsWritten: 7, queries: 2 });
  });

  it("counts every statement in a batch", async () => {
    const meter = createMeter(fakeD1([{ rowsRead: 0, rowsWritten: 5 }]));
    const statement = meter.binding.prepare("insert into t values (?)");
    await meter.binding.batch([statement.bind(1), statement.bind(2), statement.bind(3)]);

    expect(meter.usage()).toEqual({ rowsRead: 0, rowsWritten: 15, queries: 3 });
  });

  it("reports nothing before any query runs", () => {
    const meter = createMeter(fakeD1([]));
    expect(meter.usage()).toEqual({ rowsRead: 0, rowsWritten: 0, queries: 0 });
  });

  it("hands back a copy, so a caller cannot corrupt the count", async () => {
    const meter = createMeter(fakeD1([{ rowsRead: 4, rowsWritten: 0 }]));
    await meter.binding.prepare("select 1").all();

    const first = meter.usage();
    first.rowsRead = 9_999;

    expect(meter.usage().rowsRead).toBe(4);
  });
});

describe("isDailyLimitError", () => {
  it("recognises the row read limit", () => {
    const error = new Error(
      "Your account has exceeded D1's free tier daily row read limit. " +
        "Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.",
    );
    expect(isDailyLimitError(error)).toBe("read");
  });

  it("recognises the row write limit", () => {
    const error = new Error(
      "Your account has exceeded D1's free tier daily row write limit. " +
        "Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.",
    );
    expect(isDailyLimitError(error)).toBe("write");
  });

  it("leaves unrelated D1 errors alone", () => {
    expect(isDailyLimitError(new Error("D1_ERROR: too many SQL variables"))).toBe(false);
    expect(isDailyLimitError(new Error("D1 DB is overloaded. Requests queued for too long."))).toBe(
      false,
    );
    expect(isDailyLimitError(null)).toBe(false);
  });
});

describe("the published free tier allowance", () => {
  it("matches what Cloudflare enforces from 1 September 2026", () => {
    expect(FREE_D1_ROWS_READ_PER_DAY).toBe(5_000_000);
    expect(FREE_D1_ROWS_WRITTEN_PER_DAY).toBe(100_000);
  });
});
