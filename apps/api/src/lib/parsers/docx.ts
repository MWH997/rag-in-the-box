import mammoth from "mammoth";
import { UnsupportedLocalParse } from "./errors.js";

// mammoth's shipped .d.ts only declares convertToHtml/extractRawText/
// embedStyleMap even though convertToMarkdown exists at runtime (verified
// against node_modules/mammoth/lib/index.js). Both `buffer` and
// `arrayBuffer` are supplied below since mammoth's own input handling
// differs by environment: Node (this file's vitest run) reads
// `options.buffer` directly, while the "browser" build Wrangler's bundler
// substitutes for Worker code reads `options.arrayBuffer` — each side
// ignores the key it doesn't use, so passing both works in either runtime
// without branching on environment.
interface MammothMarkdownInput {
  buffer?: Uint8Array;
  arrayBuffer?: ArrayBuffer;
}
interface MammothMarkdownResult {
  value: string;
  messages: Array<{ type: string; message: string }>;
}
interface MammothWithMarkdown {
  convertToMarkdown(input: MammothMarkdownInput): Promise<MammothMarkdownResult>;
}

export async function parseDocx(buf: ArrayBuffer): Promise<string> {
  try {
    const withMarkdown = mammoth as unknown as MammothWithMarkdown;
    const result = await withMarkdown.convertToMarkdown({
      buffer: new Uint8Array(buf),
      arrayBuffer: buf,
    });
    return result.value;
  } catch (error) {
    throw new UnsupportedLocalParse("Local DOCX parsing failed", { cause: error });
  }
}
