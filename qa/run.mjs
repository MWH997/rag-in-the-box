/**
 * Runs every audit against a real build, in a headless browser, and fails the
 * build on any finding.
 *
 *   npm run qa
 *
 * It starts what it needs and stops it again, so it behaves the same on a
 * laptop and in CI:
 *
 *   1. Applies migrations to a scratch database.
 *   2. Starts the Worker with no Cloudflare account: vectors in D1, the
 *      deterministic stand-ins for the models.
 *   3. Builds the interface and serves the built bundle, not the dev server,
 *      because the thing shipped is what should be measured.
 *   4. Checks every API response against the shared schemas.
 *   5. Loads each route at six widths in both themes and runs the layout and
 *      accessibility audits.
 *
 * Ports are deliberately not the defaults. Wrangler and Vite bind loopback,
 * and anything bound to 0.0.0.0 on the same port, a container in particular,
 * wins the race and answers instead. Pinning odd ports keeps a machine that
 * already runs something on 8787 or 5173 from producing a mystery failure.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const API_PORT = Number(process.env.QA_API_PORT ?? 8791);
const WEB_PORT = Number(process.env.QA_WEB_PORT ?? 4191);
// Both on the same host on purpose. "localhost" and "127.0.0.1" are different
// sites to a browser, so a session cookie set by one is never sent to the
// other, and sign-in fails in a way that looks like a wrong password.
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

const WIDTHS = [320, 390, 768, 1024, 1440, 1920];
const PUBLIC_ROUTES = ["/", "/demo", "/login", "/reset-password", "/nonexistent"];
const APP_ROUTES = ["/app", "/app/chat", "/app/usage", "/app/settings"];
const ADMIN_TOKEN = "development-only-admin-token";

const children = [];
let shuttingDown = false;

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  if (!options.inherit) {
    child.stdout?.on("data", (chunk) => options.onOutput?.(String(chunk)));
    child.stderr?.on("data", (chunk) => options.onOutput?.(String(chunk)));
  }
  return child;
}

function once(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = run(command, args, { ...options, inherit: true });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)),
    );
  });
}

async function waitFor(url, what, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${what} never became ready at ${url}`);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
}

process.on("exit", shutdown);
process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

/* -------------------------------------------------------------------------- */

const findings = [];
const record = (scope, list) => {
  for (const finding of list) findings.push({ scope, ...finding });
};

console.log("qa: preparing the database");
await once("npm", ["run", "db:migrate:local"]);

console.log("qa: starting the worker");
// The origins go in as --var, not as process environment. Wrangler reads a
// Worker's vars from its configuration and .dev.vars only, so exporting them
// here would be silently ignored, the browser would be refused by CORS, and the
// interface would report that the API is not responding.
run(
  "npx",
  [
    "wrangler",
    "dev",
    "--local",
    "--port",
    String(API_PORT),
    "--var",
    `ALLOWED_ORIGIN:${WEB_URL}`,
    "--var",
    `BETTER_AUTH_URL:${API_URL}`,
  ],
  { cwd: join(root, "apps", "api") },
);
await waitFor(`${API_URL}/health`, "the worker");

console.log("qa: building the interface");
await once("npm", ["run", "build"], { env: { VITE_API_URL: API_URL } });

console.log("qa: serving the build");
run("npx", ["vite", "preview", "--port", String(WEB_PORT), "--strictPort"], {
  cwd: join(root, "apps", "web"),
});
await waitFor(WEB_URL, "the interface");

/* 1. The API against its own schemas ---------------------------------------- */

console.log("qa: checking the API contract");
await once("node", [join(here, "contract.mjs")], { env: { BASE_URL: API_URL } });

/* 2. The interface, in a browser --------------------------------------------- */

const layoutSource = readFileSync(join(here, "audit.js"), "utf8");
const a11ySource = readFileSync(join(here, "a11y.js"), "utf8");

const browser = await chromium.launch();
const context = await browser.newContext({ colorScheme: "dark" });
const page = await context.newPage();

/**
 * Two separate signals, kept apart because they mean different things.
 *
 * An uncaught exception is always a fault: something threw where nobody was
 * looking. A failed request usually is, but not always. The interface asks who
 * is signed in before it knows, so a 401 on the session endpoints while signed
 * out is the design working, and the browser logs every failed request as a
 * console error regardless. Matching on the response rather than the console
 * line is what lets that one case through while a missing script chunk, which
 * looks identical in the console, still fails the run.
 */
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

const badResponses = [];
const EXPECTED_WHEN_SIGNED_OUT =
  /\/api\/(auth\/get-session|me|usage|documents|settings|demo\/status)/;
page.on("response", (response) => {
  const status = response.status();
  if (status < 400) return;
  const url = response.url();
  if ((status === 401 || status === 403) && EXPECTED_WHEN_SIGNED_OUT.test(url)) return;
  badResponses.push(`${status} ${url.replace(WEB_URL, "").replace(API_URL, "")}`);
});

/** Signs in, so the routes behind auth can be audited too. */
async function signIn() {
  const provision = await fetch(`${API_URL}/api/admin/provision`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ email: `qa-${Date.now()}@example.com`, orgName: "QA workspace" }),
  });
  if (!provision.ok) throw new Error(`provisioning failed: ${provision.status}`);
  const { inviteUrl, email } = await provision.json();
  const token = new URL(inviteUrl).pathname.split("/").pop();
  const password = "QaWorkspace!2026pass";

  await page.goto(`${WEB_URL}/reset-password?token=${token}`, { waitUntil: "networkidle" });
  await page.locator('input[type="password"]').first().fill(password);
  const confirm = page.locator('input[type="password"]').nth(1);
  if (await confirm.count()) await confirm.fill(password);
  await page.locator("form").locator('button[type="submit"]').click();
  await page.waitForTimeout(1500);

  await page.goto(`${WEB_URL}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  // Scoped to the form: "Sign in" is also the label of the tab that chooses
  // between signing in and signing up, so an unscoped match finds two.
  await page.locator("form").locator('button[type="submit"]').click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
}

/** Runs both audits on the current page and keeps whatever they report. */
async function auditHere(scope) {
  const result = await page.evaluate(() => ({
    layout: window.__ragAudit(),
    a11y: window.__ragA11y(),
  }));
  record(scope, result.layout.findings);
  record(scope, result.a11y.findings);
}

async function sweep(routes, label) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 500 ? 800 : 900 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate((wanted) => {
        document.documentElement.classList.toggle("dark", wanted === "dark");
      }, theme);
      for (const route of routes) {
        await page.evaluate((path) => {
          history.pushState({}, "", path);
          dispatchEvent(new PopStateEvent("popstate"));
        }, route);
        // Lazy route chunks have to arrive before anything is measured.
        await page.waitForTimeout(700);
        await auditHere(`${label} ${route} ${width}px ${theme}`);
      }
    }
  }
}

console.log("qa: auditing the public routes");
await page.goto(`${WEB_URL}/`, { waitUntil: "networkidle" });
await page.addScriptTag({ content: layoutSource });
await page.addScriptTag({ content: a11ySource });
await sweep(PUBLIC_ROUTES, "public");

console.log("qa: signing in");
await signIn();
await page.addScriptTag({ content: layoutSource });
await page.addScriptTag({ content: a11ySource });

console.log("qa: auditing the routes behind sign-in");
await sweep(APP_ROUTES, "app");

await browser.close();
shutdown();

/* -------------------------------------------------------------------------- */

let failed = false;

if (pageErrors.length > 0) {
  failed = true;
  console.error(`\n${pageErrors.length} uncaught error(s) while auditing:`);
  for (const error of [...new Set(pageErrors)].slice(0, 10)) {
    console.error(`  ${error.slice(0, 200)}`);
  }
}

if (badResponses.length > 0) {
  failed = true;
  const unique = [...new Set(badResponses)];
  console.error(`\n${unique.length} failed request(s) while auditing:`);
  for (const line of unique.slice(0, 10)) console.error(`  ${line}`);
}

if (findings.length === 0 && !failed) {
  console.log("\nqa: no layout or accessibility findings on any route, width or theme.");
  process.exit(0);
}

if (findings.length === 0) process.exit(1);

console.error(`\n${findings.length} finding(s):\n`);
const grouped = new Map();
for (const finding of findings) {
  const key = `${finding.kind ?? finding.criterion} | ${finding.element} | ${finding.detail}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(finding.scope);
}
for (const [key, scopes] of grouped) {
  console.error(`  ${key}`);
  console.error(`      ${scopes.length} occurrence(s), first: ${scopes[0]}`);
}
process.exit(1);
