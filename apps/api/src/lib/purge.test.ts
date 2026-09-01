import { describe, expect, it } from "vitest";

import { DEMO_VISITOR_PREFIX, retentionHours } from "./purge.js";
import type { Env } from "../env.js";

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    AI: {} as Ai,
    ALLOWED_ORIGIN: "http://localhost:5173",
    BETTER_AUTH_URL: "http://localhost:8787",
    BETTER_AUTH_SECRET: "test",
    ...overrides,
  } as Env;
}

describe("retentionHours", () => {
  it("defaults to a window long enough to try the product and export it", () => {
    expect(retentionHours(env())).toBe(3);
  });

  it("takes the configured value", () => {
    expect(retentionHours(env({ DEMO_RETENTION_HOURS: "12" }))).toBe(12);
  });

  it("falls back rather than accepting nonsense", () => {
    expect(retentionHours(env({ DEMO_RETENTION_HOURS: "soon" }))).toBe(3);
  });

  it("allows zero, which means purge on the next run", () => {
    expect(retentionHours(env({ DEMO_RETENTION_HOURS: "0" }))).toBe(0);
  });
});

describe("the visitor workspace prefix", () => {
  /**
   * The purge selects on this prefix. The curated demo workspace must not match
   * it, or the featured document the whole demo is built around would be
   * deleted a few hours after it is seeded.
   */
  it("does not match the curated demo workspace", () => {
    for (const curated of ["demo-curated", "demo-shared", "demo"]) {
      expect(curated.startsWith(DEMO_VISITOR_PREFIX)).toBe(false);
    }
  });

  it("matches the ids middleware actually mints", () => {
    const visitorId = "0123456789abcdef0123456789abcdef";
    expect(`demo-v-${visitorId}`.startsWith(DEMO_VISITOR_PREFIX)).toBe(true);
  });

  it("does not match a self-hosted organisation id", () => {
    expect("org_2abcDEF".startsWith(DEMO_VISITOR_PREFIX)).toBe(false);
  });
});
