import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Keeps the environment templates honest.
 *
 * Configuration drifts in one direction: someone adds a field to Env or reads a
 * new variable in the deploy script, and the templates are updated later, or
 * never. The operator then finds out by deploying something that silently does
 * not work, which is exactly what happened with R2. These tests make that a
 * failing build instead.
 */

const root = join(import.meta.dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** Keys an operator fills in, taken from a template file. */
function keysIn(file: string): Set<string> {
  return new Set(
    [...read(file).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1] as string),
  );
}

/** Field names declared on the Env interface. */
function envInterfaceFields(): string[] {
  const source = read("apps/api/src/env.ts");
  const body = source.split("export interface Env {")[1]?.split("\n}")[0] ?? "";
  return [...body.matchAll(/^ {2}([A-Z][A-Z0-9_]*)\??:/gm)].map((match) => match[1] as string);
}

/**
 * Fields no operator ever writes in a .env file, and why.
 *
 * Adding a field to Env without adding it to a template fails the test below
 * unless it is listed here with a reason, which forces the question to be
 * answered rather than skipped.
 */
const NOT_OPERATOR_SET: Record<string, string> = {
  DB: "a D1 binding, declared in wrangler config",
  AI: "a Workers AI binding, declared in wrangler config",
  VECTORIZE: "a Vectorize binding, declared in wrangler config",
  BUCKET: "an R2 binding, written by the deploy script when R2_BUCKET_NAME is set",
  ALLOWED_ORIGIN: "derived from WEB_ORIGIN",
  BETTER_AUTH_URL: "derived from API_ORIGIN",
  APP_MODE: "set from the deploy profile",
  APP_VERSION: "read from package.json at deploy time",
  VECTOR_BACKEND: "always vectorize on a deployment; only local development sets it",
  OFFLINE_AI: "development only, and the deploy script refuses to publish with it set",
};

describe("the environment templates", () => {
  const selfHost = keysIn(".env.example");
  const demo = keysIn(".env.demo.example");
  const either = new Set([...selfHost, ...demo]);

  it("offer every Env field an operator is expected to set", () => {
    const missing = envInterfaceFields().filter(
      (field) => !either.has(field) && !(field in NOT_OPERATOR_SET),
    );

    expect(
      missing,
      `These are read from the environment but appear in no template, so nobody can ` +
        `configure them: ${missing.join(", ")}. Add them to .env.example or ` +
        `.env.demo.example, or list them in NOT_OPERATOR_SET with the reason.`,
    ).toEqual([]);
  });

  it("offer every variable the deploy script reads", () => {
    const script = read("scripts/deploy.sh");
    const read_ = new Set<string>();
    for (const match of script.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}/g)) {
      read_.add(match[1] as string);
    }
    for (const match of script.matchAll(/^\s*require ([A-Z][A-Z0-9_]*)/gm)) {
      read_.add(match[1] as string);
    }

    // Names the script handles without an operator supplying them: some it
    // computes, and two it reads only so it can refuse a value copied in from a
    // development setup. Neither kind belongs in a template.
    const notFromTemplate = new Set([
      "ENV_FILE", // the script's own argument
      "DATABASE_ID", // read back from Cloudflare after creating the database
      "API_ORIGIN", // defaulted from WORKER_NAME when absent
      "WEB_ORIGIN", // defaulted from PAGES_PROJECT when absent
      "OFFLINE_AI", // checked so the script can refuse to deploy the stand-ins
      "VECTOR_BACKEND", // checked so the script can warn about the D1 scan cost
    ]);
    const missing = [...read_].filter((name) => !either.has(name) && !notFromTemplate.has(name));

    expect(
      missing.sort(),
      `scripts/deploy.sh reads these but no template offers them: ${missing.join(", ")}.`,
    ).toEqual([]);
  });

  it("offer the same infrastructure and provider settings in both files", () => {
    // The demo is a deployment like any other: same Cloudflare account, same
    // bindings, same providers. Only the DEMO_ prefixed settings are peculiar
    // to it. Checking each key against "either file" would let one template
    // quietly fall behind the other, which is how OLLAMA_BASE_URL ended up in
    // one and not the other.
    const shared = [...selfHost].filter((key) => !key.startsWith("DEMO_"));
    const missingFromDemo = shared.filter((key) => !demo.has(key));

    expect(
      missingFromDemo.sort(),
      `.env.example offers these but .env.demo.example does not: ` +
        `${missingFromDemo.join(", ")}. The demo deploys to the same platform, so ` +
        `anything that is not DEMO_ prefixed belongs in both.`,
    ).toEqual([]);
  });

  it("agree on the Cloudflare credentials both deployments need", () => {
    for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) {
      expect(selfHost.has(key), `.env.example is missing ${key}`).toBe(true);
      expect(demo.has(key), `.env.demo.example is missing ${key}`).toBe(true);
    }
  });

  it("offer every part of R2, not just the binding", () => {
    // Two separate things, both needed, and the second was missed first time.
    // R2_BUCKET_NAME is what the Worker binds to. The S3 credentials are how
    // anyone reaches the same bucket from outside a Worker, which is the only
    // way to take a backup or migrate off. Naming the bucket and leaving no
    // way to read it elsewhere is half a feature.
    for (const key of [
      "R2_BUCKET_NAME",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_S3_ENDPOINT",
    ]) {
      expect(selfHost.has(key), `.env.example is missing ${key}`).toBe(true);
      expect(demo.has(key), `.env.demo.example is missing ${key}`).toBe(true);
    }
  });

  it("let every hosted provider endpoint be overridden", () => {
    // A hardcoded endpoint is a dead end for anyone the default does not suit.
    // LlamaCloud is the sharp case: it runs a separate EU region and its keys
    // are region specific, so a European key cannot work without this.
    for (const key of ["OPENAI_BASE_URL", "DEEPSEEK_BASE_URL", "LLAMA_CLOUD_BASE_URL"]) {
      expect(selfHost.has(key), `.env.example is missing ${key}`).toBe(true);
    }
  });

  it("leave no vendor endpoint hardcoded without an override", () => {
    // Finds a literal https:// endpoint in provider code and requires that the
    // same file reads a *_BASE_URL override, so a new provider cannot be added
    // with an unconfigurable host.
    const files = ["chat.ts", "embeddings.ts", "llamaparse.ts"];
    for (const file of files) {
      const source = read(`apps/api/src/lib/providers/${file}`);
      const hasLiteralEndpoint = /"https:\/\/[^"]+"/.test(source);
      if (!hasLiteralEndpoint) continue;
      expect(
        /BASE_URL|baseUrl\(/.test(source),
        `${file} hardcodes an endpoint with no way to override it`,
      ).toBe(true);
    }
  });

  it("name no permission the project does not use", () => {
    // Workers KV was listed on the API token for a long time. Nothing in this
    // project uses KV, and asking for a permission that is not needed teaches
    // people to grant tokens more access than the job requires.
    const usesKv = /KVNamespace|kv_namespaces/.test(
      read("apps/api/src/env.ts") + read("apps/api/wrangler.toml"),
    );
    expect(usesKv).toBe(false);

    for (const file of [".env.example", "docs/hosting.md"]) {
      expect(read(file), `${file} asks for a KV permission this project never uses`).not.toMatch(
        /Workers KV/i,
      );
    }
  });

  it("keep every secret placeholder empty", () => {
    // A template that ships a real looking value invites someone to deploy it.
    for (const file of [".env.example", ".env.demo.example"]) {
      const contents = read(file);
      for (const key of ["CLOUDFLARE_API_TOKEN", "BETTER_AUTH_SECRET", "ADMIN_TOKEN"]) {
        const line = contents.match(new RegExp(`^${key}=(.*)$`, "m"));
        expect(line?.[1] ?? "", `${key} in ${file} should be blank`).toBe("");
      }
    }
  });
});
