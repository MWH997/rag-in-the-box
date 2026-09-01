/**
 * Checks every commit message in the history.
 *
 * A range check only sees what a pull request adds. Work pushed straight to a
 * branch is never in a range, so the rule went unenforced for the whole life of
 * this repository: fifteen inherited subjects and four of our own broke it
 * without anything noticing. Checking the full history costs a few seconds and
 * cannot be sidestepped by how the work arrives.
 */

import { execFileSync } from "node:child_process";

// A ref can be named, which is what makes it possible to check that this
// script actually rejects a history known to be bad rather than only agreeing
// with a history believed to be good.
const ref = process.argv[2] ?? "HEAD";

const commits = execFileSync("git", ["rev-list", ref], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

let failed = 0;

for (const sha of commits) {
  const message = execFileSync("git", ["log", "-1", "--pretty=%B", sha], { encoding: "utf8" });
  try {
    execFileSync("npx", ["--no-install", "commitlint"], { input: message, stdio: "pipe" });
  } catch (error) {
    failed += 1;
    const subject = message.split("\n")[0];
    console.error(`\n${sha.slice(0, 7)}  ${subject}`);
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    for (const line of output.split("\n").filter((l) => l.includes("✖") || l.includes("⚠"))) {
      console.error(`    ${line.trim()}`);
    }
  }
}

console.log(`\nChecked ${commits.length} commit messages, ${failed} failing.`);
process.exit(failed === 0 ? 0 : 1);
