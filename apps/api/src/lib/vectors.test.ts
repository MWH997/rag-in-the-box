import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Vectorize returns only the metadata fields that have an index when asked for
 * "indexed", and only tenant_id has one. Asking for indexed metadata therefore
 * left document_id undefined on every match, so a question scoped to a single
 * document filtered all of its own matches away and answered that the documents
 * do not cover the topic.
 *
 * The D1 backend reads the document id from a column, so local development was
 * unaffected and the failure only existed in a deployment. That is why this is
 * pinned by reading the source: there is no local Vectorize to test against.
 */
describe("the vectorize query", () => {
  const source = readFileSync(new URL("./vectors.ts", import.meta.url), "utf8");

  it("asks for all metadata, not only the indexed fields", () => {
    expect(source).toMatch(/returnMetadata:\s*"all"/);
    expect(source).not.toMatch(/returnMetadata:\s*"indexed"/);
  });

  it("still scopes by namespace and by a tenant filter", () => {
    // Either alone isolates tenants. Both are used so a mistake in one leaves
    // the other enforcing it, and neither may be dropped quietly.
    expect(source).toMatch(/namespace,/);
    expect(source).toMatch(/filter:\s*\{\s*tenant_id: tenantId\s*\}/);
  });

  it("does not ask for the vectors back, which are large and unused", () => {
    expect(source).toMatch(/returnValues:\s*false/);
  });
});
