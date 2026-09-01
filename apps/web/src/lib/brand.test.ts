import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Keeps one operator's details out of everyone else's build.
 *
 * This is an open source product other people host. A component that writes an
 * address or a domain inline makes that value unremovable without editing the
 * source, so a fork ships it. Branding belongs in lib/brand.ts, where every
 * value can be replaced at build time.
 */

const webSrc = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
      found.push(path);
    }
  }
  return found;
}

describe("branding", () => {
  const files = sourceFiles(webSrc).filter((path) => !path.endsWith("brand.ts"));

  it("appears in no component, only in brand.ts", () => {
    // brand.ts is allowed to name the canonical values, because that is what a
    // fallback is. Nothing else should.
    const offenders: string[] = [];
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      if (/mwhassan|MWH997|Muhammad Hassan/.test(source)) {
        offenders.push(path.slice(webSrc.length + 1));
      }
    }

    expect(
      offenders,
      `These hardcode the operator's own details instead of reading lib/brand.ts: ` +
        `${offenders.join(", ")}. A fork cannot remove them without editing source.`,
    ).toEqual([]);
  });

  it("ships no email address as a fallback", () => {
    // An address compiled in as a default is invisible in the interface but
    // readable by anyone who opens the JavaScript, and sends its owner support
    // requests for installs they have never seen. The setup panel stays hidden
    // until an operator supplies their own address instead.
    const brandSource = readFileSync(join(webSrc, "lib", "brand.ts"), "utf8");
    const fallbackEmails = brandSource.match(/"[^"\s]+@[^"\s]+\.[a-z]{2,}"/gi) ?? [];

    expect(
      fallbackEmails,
      `brand.ts has a hardcoded email fallback: ${fallbackEmails.join(", ")}`,
    ).toEqual([]);
  });

  it("hides the paid offer until someone owns it", () => {
    const brandSource = readFileSync(join(webSrc, "lib", "brand.ts"), "utf8");
    expect(brandSource).toMatch(/VITE_SETUP_EMAIL/);
    // The offer must depend on the address, not only on its own flag, or a
    // build with the flag left at its default would show a mailto to nowhere.
    expect(brandSource).toMatch(/enabled:[\s\S]{0,200}VITE_SETUP_EMAIL/);
  });
});
