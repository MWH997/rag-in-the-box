import type { ZodType } from "zod";

import { HttpError } from "./errors.js";

/**
 * Reads and validates a JSON request body.
 *
 * json() throws rather than returning null when the body is not JSON, and that
 * throw is a SyntaxError with nothing on it to say where it came from. Left
 * uncaught it reaches the generic handler and the caller is told the server
 * broke, when what actually happened is that they sent something unparseable.
 *
 * Catching SyntaxError centrally in app.onError would look like the tidier fix
 * and would be wrong. The provider clients parse upstream responses with the
 * same call, so a malformed reply from OpenAI or LlamaCloud raises exactly the
 * same error type. Treating that as a bad request would blame the caller for a
 * failure that is not theirs and hide a real outage behind a 400. The two cases
 * are only distinguishable at the point of the call, so that is where this
 * decides.
 *
 * The schema failure is deliberately left to propagate: a ZodError already
 * becomes a 422 with the failing paths, which says more than anything this
 * could add.
 */
export async function readJson<T>(
  c: { req: { json: () => Promise<unknown> } },
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(
      400,
      "invalid_json",
      "The request body was not valid JSON. Send a JSON object with a content-type of application/json.",
    );
  }
  return schema.parse(raw);
}
