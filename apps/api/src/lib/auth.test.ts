import { describe, expect, it } from "vitest";

import { allowedOrigins } from "../env.js";
import type { Env } from "../env.js";

function env(allowed: string): Env {
  return { ALLOWED_ORIGIN: allowed } as Env;
}

/**
 * ALLOWED_ORIGIN is documented as a comma separated list. It was being read two
 * different ways: the CORS layer split it, and better-auth was handed the whole
 * string as one origin. A deployment naming two origins therefore passed the
 * preflight and then failed every sign-in, password reset and session call with
 * "Invalid origin", which typechecking cannot see because both readings are a
 * string[].
 */
describe("allowedOrigins", () => {
  it("reads a single origin", () => {
    expect(allowedOrigins(env("https://app.example.com"))).toEqual(["https://app.example.com"]);
  });

  it("splits a list, which is the case that was broken", () => {
    expect(allowedOrigins(env("https://example.com,https://app.example.com"))).toEqual([
      "https://example.com",
      "https://app.example.com",
    ]);
  });

  it("tolerates the spaces a person leaves after a comma", () => {
    expect(allowedOrigins(env("https://a.example.com , https://b.example.com"))).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ]);
  });

  it("drops empty entries from a trailing comma", () => {
    expect(allowedOrigins(env("https://a.example.com,"))).toEqual(["https://a.example.com"]);
  });

  it("never returns the raw string when it holds a list", () => {
    // The exact shape of the old bug: one entry that is not an origin at all.
    const origins = allowedOrigins(env("https://a.example.com,https://b.example.com"));
    expect(origins).not.toContain("https://a.example.com,https://b.example.com");
    for (const origin of origins) {
      expect(origin).not.toContain(",");
    }
  });
});

describe("the two readers of ALLOWED_ORIGIN", () => {
  it("both call the shared parser, so they cannot drift again", async () => {
    const [index, auth] = await Promise.all([
      import("node:fs").then((fs) =>
        fs.readFileSync(new URL("../index.ts", import.meta.url), "utf8"),
      ),
      import("node:fs").then((fs) =>
        fs.readFileSync(new URL("./auth.ts", import.meta.url), "utf8"),
      ),
    ]);

    expect(index).toMatch(/allowedOrigins\(/);
    expect(auth).toMatch(/trustedOrigins: allowedOrigins\(env\)/);
    // Neither may reach for the raw variable and interpret it itself.
    expect(auth).not.toMatch(/trustedOrigins: \[env\.ALLOWED_ORIGIN\]/);
    expect(index).not.toMatch(/env\.ALLOWED_ORIGIN\.split/);
  });
});
