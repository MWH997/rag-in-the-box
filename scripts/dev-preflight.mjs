/**
 * Refuses to start the dev server onto a port something else already answers.
 *
 * Wrangler binds 127.0.0.1 and Vite binds loopback, so neither collides with a
 * container published on 0.0.0.0. Both processes start, report success, and
 * then the container wins the race and answers every request. What you get is
 * another project's JSON with this project's URL in front of it, which reads as
 * a baffling bug in your own code rather than as a port conflict.
 *
 * Binding cannot detect this, because binding succeeds. Asking what is already
 * answering can, so that is what this does.
 *
 *   node scripts/dev-preflight.mjs <port> <label>
 *
 * Exits 0 when the port is free or when the check itself cannot run: a flaky
 * preflight must never be the reason someone cannot start their dev server.
 */

const [, , rawPort, label = "dev server"] = process.argv;
const port = Number(rawPort);
if (!Number.isInteger(port) || port <= 0) process.exit(0);

const url = `http://127.0.0.1:${port}/`;
let answered;
try {
  answered = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(1500),
  });
} catch {
  // Nothing listening, or it refused to speak HTTP. Either way the port is ours
  // to take, and a preflight that guesses wrong here would block a clean start.
  process.exit(0);
}

const body = await answered.text().catch(() => "");
// This project's Worker answers /health with a mode; its interface serves the
// app shell. Anything else on the port belongs to something else.
const health = await fetch(`http://127.0.0.1:${port}/health`, {
  signal: AbortSignal.timeout(1500),
})
  .then((response) => response.text())
  .catch(() => "");
const looksLikeUs =
  /"mode":"(self-host|demo)"/.test(health) || /rag-in-the-box|<div id="root">/i.test(body);

if (looksLikeUs) {
  // A previous run of this same project. Wrangler and Vite report that
  // themselves, so nothing needs saying here.
  process.exit(0);
}

const hint = label.includes("interface") ? "WEB_PORT" : "API_PORT";
process.stderr.write(
  `\nPort ${port} already answers, and not with this project.\n\n` +
    `  first line of what it returned: ${body.trim().split("\n")[0]?.slice(0, 120) || "(empty)"}\n\n` +
    `Starting anyway would look like it worked. Both processes bind loopback,\n` +
    `whatever is on 0.0.0.0 wins, and you would spend the next hour reading\n` +
    `another project's responses as if they were this one's.\n\n` +
    `Pick another port:\n\n` +
    `  ${hint}=${port + 12} npm run dev\n\n` +
    `Or stop whatever holds ${port}. To see what that is:\n\n` +
    `  lsof -nP -iTCP:${port} -sTCP:LISTEN\n\n`,
);
process.exit(1);
