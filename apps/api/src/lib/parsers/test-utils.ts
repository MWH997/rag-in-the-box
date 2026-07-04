import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixturesDir = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

export function readFixture(name: string): ArrayBuffer {
  const buf = readFileSync(fixturesDir + name);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
