/**
 * Looks for secrets in the built interface.
 *
 * The interface is a static bundle served from a CDN. Anything compiled into it
 * is readable by anyone who opens the developer tools, and a build tool will
 * happily inline whatever it is handed. Vite only exposes variables prefixed
 * VITE_, which is a good rule right up until somebody names a secret that way
 * or writes one into source directly.
 *
 * Two passes:
 *
 *   1. Shape. Known credential formats and long random-looking strings, found
 *      without needing to know any actual secret, so it works in CI where no
 *      env file exists.
 *   2. Exact. If an env file is present, every non-public value in it is
 *      searched for literally. This is the pass that cannot be fooled by a
 *      credential format nobody anticipated.
 *
 *   node qa/secret-scan.mjs [--dist apps/web/dist] [--env .env.demo]
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let dist = "apps/web/dist";
let envFile = null;
for (let i = 2; i < process.argv.length; i += 2) {
  if (process.argv[i] === "--dist") dist = process.argv[i + 1];
  if (process.argv[i] === "--env") envFile = process.argv[i + 1];
}

function files(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...files(path));
    else found.push(path);
  }
  return found;
}

/** Credential formats worth recognising, with the vendor that issues them. */
const SHAPES = [
  { name: "OpenAI key", pattern: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { name: "LlamaCloud key", pattern: /\bllx-[A-Za-z0-9]{20,}/g },
  { name: "AWS or R2 access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Slack token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "Private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    name: "JSON web token",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
];

/**
 * Values that are public by design and would otherwise be reported forever.
 *
 * The development secrets in wrangler.toml are in this list because they are
 * published in the repository on purpose: they exist so a fresh clone runs with
 * no setup, they are documented as worthless, and no deployment uses them.
 */
const ALLOWED = [
  "development-only-secret-not-used-in-any-deployment",
  "development-only-admin-token",
];

const sources = files(dist).filter((f) => /\.(js|mjs|css|html|json|map)$/.test(f));
const findings = [];

for (const file of sources) {
  const text = readFileSync(file, "utf8");
  for (const { name, pattern } of SHAPES) {
    for (const match of text.matchAll(pattern)) {
      if (ALLOWED.some((allowed) => match[0].includes(allowed))) continue;
      findings.push({ file, name, sample: `${match[0].slice(0, 8)}…` });
    }
  }
}

// Exact-value pass. Only runs where an env file exists, which is a developer
// machine rather than CI.
let checkedExact = 0;
if (envFile) {
  let contents = "";
  try {
    contents = readFileSync(envFile, "utf8");
  } catch {
    console.log(`No ${envFile}, skipping the exact-value pass.`);
  }

  // VITE_ values are compiled in deliberately. Names, URLs and limits are not
  // secret either, and searching for them would report the build working.
  const PUBLIC_KEYS =
    /^(VITE_|API_ORIGIN|WEB_ORIGIN|ALLOWED_ORIGIN|CLOUDFLARE_WORKER_URL|WORKER_NAME|PAGES_PROJECT|D1_DATABASE_NAME|VECTORIZE_INDEX_NAME|R2_BUCKET_NAME|R2_S3_ENDPOINT|LLAMA_CLOUD_BASE_URL|OPENAI_BASE_URL|DEEPSEEK_BASE_URL|OLLAMA_BASE_URL|DEMO_|DEFAULT_TIER|VECTOR_|PASSWORD_KDF)/;

  const blob = sources.map((f) => readFileSync(f, "utf8")).join("\n");
  for (const line of contents.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^["']|["']$/g, "");
    if (!value || value.length < 12) continue;
    if (PUBLIC_KEYS.test(key)) continue;
    checkedExact += 1;
    if (blob.includes(value)) {
      findings.push({ file: "(bundle)", name: `value of ${key}`, sample: "exact match" });
    }
  }
}

console.log(
  `Scanned ${sources.length} built files for ${SHAPES.length} credential shapes` +
    (envFile ? ` and ${checkedExact} exact values from ${envFile}` : "") +
    ".",
);

if (findings.length === 0) {
  console.log("No secrets found in the built interface.");
  process.exit(0);
}

console.error(`\n${findings.length} possible secret(s) in the build:\n`);
for (const finding of findings) {
  console.error(`  ${finding.name}  ${finding.sample}`);
  console.error(`      ${finding.file}`);
}
console.error("\nAnything compiled into the interface is public. Move it to a Worker secret.");
process.exit(1);
