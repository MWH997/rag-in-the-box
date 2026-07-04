import Papa from "papaparse";

const MAX_ROWS_PER_TABLE = 200;
const ROW_SPLIT_THRESHOLD = 500;

function toMarkdownTable(header: string[], rows: string[][]): string {
  const headerLine = `| ${header.join(" | ")} |`;
  const separatorLine = `| ${header.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((row) => `| ${row.join(" | ")} |`);
  return [headerLine, separatorLine, ...rowLines].join("\n");
}

export function parseCsv(buf: ArrayBuffer): string {
  const csvText = new TextDecoder("utf-8").decode(buf);
  const { data } = Papa.parse<string[]>(csvText, { skipEmptyLines: true });

  const header = data[0];
  if (!header) {
    return "";
  }
  const rows = data.slice(1);

  if (rows.length <= ROW_SPLIT_THRESHOLD) {
    return toMarkdownTable(header, rows);
  }

  const sections = [
    `> CSV has ${rows.length} rows; split into sections of up to ${MAX_ROWS_PER_TABLE} rows each so tables stay intact for chunking.`,
  ];
  for (let i = 0; i < rows.length; i += MAX_ROWS_PER_TABLE) {
    const chunk = rows.slice(i, i + MAX_ROWS_PER_TABLE);
    sections.push(`## Rows ${i + 1}-${i + chunk.length}`);
    sections.push(toMarkdownTable(header, chunk));
  }
  return sections.join("\n\n");
}
