import { rowsToMarkdown } from "@rag/shared";
import Papa from "papaparse";

/** Converts CSV bytes to markdown using the shared table renderer. */
export function parseCsv(buf: ArrayBuffer): string {
  const text = new TextDecoder("utf-8").decode(buf);
  const { data } = Papa.parse<string[]>(text, { skipEmptyLines: true });
  return rowsToMarkdown(data);
}
