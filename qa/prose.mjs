/**
 * Looks for the tics that make writing read as machine-produced.
 *
 * Not a style opinion. Each pattern below is something that shows up far more
 * often in generated text than in writing by a person who knows the subject,
 * and every one of them can be removed without losing meaning. The em dash is
 * included because this project asked for none, and because it is usually
 * standing in for a comma, a colon or a full stop that would read better.
 *
 *   node qa/prose.mjs            check every text file
 *   node qa/prose.mjs --fix      fix what can be fixed safely, report the rest
 *
 * Some findings cannot be fixed automatically. A sentence built on "delve into"
 * needs rewriting by someone who knows what it was trying to say, so those are
 * reported with their location and left alone.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const fix = process.argv.includes("--fix");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".wrangler", "drizzle", "fixtures"]);
const TEXT = /\.(md|txt)$/;
const CODE = /\.(ts|tsx|js|mjs|css|sh|toml|yml|yaml)$/;

/** Replacements that are always safe, because the meaning does not move. */
const MECHANICAL = [
  // An em or en dash between words is nearly always a comma or a full stop.
  { find: /(\w)\s*—\s*(\w)/g, replace: "$1, $2", why: "em dash between words" },
  { find: /(\w)\s*–\s*(\w)/g, replace: "$1, $2", why: "en dash between words" },
  { find: /\s—\s/g, replace: ", ", why: "spaced em dash" },
  { find: /^—\s*/gm, replace: "", why: "leading em dash" },
];

/** Phrases that need a person to rewrite, so they are reported not replaced. */
const PHRASES = [
  [/\bdelve[sd]? into\b/gi, "delve into"],
  [/\bleverage[sd]?\b/gi, "leverage"],
  [/\bseamless(ly)?\b/gi, "seamless"],
  [/\brobust\b/gi, "robust"],
  [/\bcutting[- ]edge\b/gi, "cutting edge"],
  [/\bgame[- ]chang(er|ing)\b/gi, "game changer"],
  [/\bunlock(s|ing)? the\b/gi, "unlock the"],
  [/\bharness(es|ing)?\b/gi, "harness"],
  [/\belevate[sd]?\b/gi, "elevate"],
  [/\bembark on\b/gi, "embark on"],
  [/\bnavigate the\b/gi, "navigate the"],
  [/\bin today'?s\b/gi, "in today's"],
  [/\bit'?s worth noting\b/gi, "it's worth noting"],
  [/\bit is important to note\b/gi, "it is important to note"],
  [/\bfurthermore\b/gi, "furthermore"],
  [/\bmoreover\b/gi, "moreover"],
  [/\badditionally,/gi, "additionally,"],
  [/\bin conclusion\b/gi, "in conclusion"],
  [/\bdive (deep )?into\b/gi, "dive into"],
  [/\ba testament to\b/gi, "a testament to"],
  [/\bpar excellence\b/gi, "par excellence"],
  [/\bwhether you'?re a\b/gi, "whether you're a"],
  [/\bthe world of\b/gi, "the world of"],
  [/\bcrucial\b/gi, "crucial"],
  [/\bvital\b/gi, "vital"],
  [/\bplethora\b/gi, "plethora"],
  [/\bmyriad\b/gi, "myriad"],
  [/\bstreamline[sd]?\b/gi, "streamline"],
  [/\bempower(s|ing|ed)?\b/gi, "empower"],
  [/\bsupercharge[sd]?\b/gi, "supercharge"],
  [/\bblazing(ly)? fast\b/gi, "blazingly fast"],
  [/\beffortless(ly)?\b/gi, "effortless"],
  [/\bboasts?\b/gi, "boasts"],
  [/\bcomprehensive\b/gi, "comprehensive"],
];

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found;
}

// This file lists the very phrases it looks for, so scanning it reports
// itself thirty times and buries anything real.
const SELF = "qa/prose.mjs";
const files = walk(root)
  .filter((f) => TEXT.test(f) || CODE.test(f))
  .filter((f) => !relative(root, f).endsWith(SELF));
let fixedCount = 0;
const reports = [];

for (const file of files) {
  let text = readFileSync(file, "utf8");
  const before = text;
  const shown = relative(root, file);

  for (const rule of MECHANICAL) {
    if (rule.find.test(text)) {
      rule.find.lastIndex = 0;
      if (fix) text = text.replace(rule.find, rule.replace);
      else {
        const count = (before.match(rule.find) ?? []).length;
        reports.push({ file: shown, issue: rule.why, count, fixable: true });
      }
      rule.find.lastIndex = 0;
    }
  }

  if (fix && text !== before) {
    writeFileSync(file, text);
    fixedCount += 1;
  }

  // Phrases are reported against the file as it now stands.
  const current = fix ? text : before;
  for (const [pattern, label] of PHRASES) {
    const matches = current.match(pattern);
    if (!matches) continue;
    const line = current.slice(0, current.search(pattern)).split("\n").length;
    reports.push({ file: `${shown}:${line}`, issue: label, count: matches.length, fixable: false });
  }
}

console.log(`Read ${files.length} files.`);
if (fix) console.log(`Rewrote ${fixedCount}.`);

const manual = reports.filter((r) => !r.fixable);
const mechanical = reports.filter((r) => r.fixable);

if (mechanical.length > 0) {
  console.log(`\n${mechanical.length} mechanical issue(s), fixable with --fix:`);
  for (const r of mechanical.slice(0, 40)) console.log(`  ${r.file}  ${r.issue} x${r.count}`);
}

if (manual.length > 0) {
  console.log(`\n${manual.length} phrase(s) a person should rewrite:`);
  for (const r of manual.slice(0, 60)) console.log(`  ${r.file}  "${r.issue}" x${r.count}`);
}

if (reports.length === 0) console.log("\nNothing flagged.");
process.exit(reports.length === 0 ? 0 : 1);
