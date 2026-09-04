import { describe, expect, it } from "vitest";
import { z } from "zod";

import { HttpError } from "./errors.js";
import { readJson } from "./request.js";

/**
 * A body the caller controls and a body an upstream controls both fail with a
 * SyntaxError, and they must not be answered the same way. These tests are the
 * reason the catch lives at the call site rather than in app.onError, so they
 * are what stops someone moving it back there later.
 */
const Body = z.object({ name: z.string() });

const ctx = (json: () => Promise<unknown>) => ({ req: { json } });

describe("readJson", () => {
  it("returns the parsed body when it validates", async () => {
    const value = await readJson(
      ctx(async () => ({ name: "ok" })),
      Body,
    );
    expect(value).toEqual({ name: "ok" });
  });

  it("answers unparseable JSON with 400 rather than letting it reach the generic handler", async () => {
    const error = await readJson(
      ctx(() => Promise.reject(new SyntaxError("Unexpected end of JSON input"))),
      Body,
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
    expect((error as HttpError).code).toBe("invalid_json");
  });

  it("leaves a schema failure as a ZodError, which already becomes a 422", async () => {
    // Rewriting this into an HttpError would lose the failing field paths, and
    // the client shows them.
    const error = await readJson(
      ctx(async () => ({ name: 42 })),
      Body,
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(z.ZodError);
    expect(error).not.toBeInstanceOf(HttpError);
  });

  it("does not swallow an error that is not about parsing", async () => {
    // A body that fails to arrive at all is a transport failure, not a bad
    // request, and it currently cannot be told apart from one. This records
    // that json() rejecting for any reason is reported as a bad body.
    const error = await readJson(
      ctx(() => Promise.reject(new Error("stream closed"))),
      Body,
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
  });
});
