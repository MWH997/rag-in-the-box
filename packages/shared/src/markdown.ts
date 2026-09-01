/**
 * Turning tabular data into markdown.
 *
 * Shared because the browser converts CSV during upload and the Worker does the
 * same on the server-side path. One implementation means both produce byte
 * identical markdown, so a document ingested either way chunks the same.
 */

const MAX_ROWS_PER_TABLE = 200;
const ROW_SPLIT_THRESHOLD = 500;

/** Escapes pipes and newlines so one cell cannot break the table. */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

export function toMarkdownTable(header: string[], rows: string[][]): string {
  const width = header.length;
  const headerLine = `| ${header.map(cell).join(" | ")} |`;
  const separator = `| ${header.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => {
    const padded = [...row.map(cell)];
    while (padded.length < width) padded.push("");
    return `| ${padded.slice(0, width).join(" | ")} |`;
  });
  return [headerLine, separator, ...body].join("\n");
}

/**
 * Renders parsed rows as markdown.
 *
 * A long table is split into sections of at most 200 rows, each with its own
 * header, so the chunker never has to break a table apart and every chunk that
 * contains rows also contains the column names they belong to.
 */
export function rowsToMarkdown(data: string[][], title?: string): string {
  const header = data[0];
  if (!header || header.length === 0) return "";
  const rows = data.slice(1);
  const heading = title ? `# ${title}\n\n` : "";

  if (rows.length <= ROW_SPLIT_THRESHOLD) {
    return `${heading}${toMarkdownTable(header, rows)}`;
  }

  const sections = [
    `${heading}> ${rows.length} rows, split into sections of up to ${MAX_ROWS_PER_TABLE} so each table stays whole.`,
  ];
  for (let index = 0; index < rows.length; index += MAX_ROWS_PER_TABLE) {
    const slice = rows.slice(index, index + MAX_ROWS_PER_TABLE);
    sections.push(`## Rows ${index + 1} to ${index + slice.length}`);
    sections.push(toMarkdownTable(header, slice));
  }
  return sections.join("\n\n");
}
