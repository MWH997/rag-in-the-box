import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * D1 statement limits.
 *
 * D1 allows at most 100 bound parameters in one query. A multi-row insert binds
 * one parameter per column per row, so a batch of 24 rows across 13 columns is
 * 312 parameters and fails outright with "too many SQL variables".
 *
 * The column count is read from the table definition rather than written down
 * here. A hand-maintained number goes stale the first time someone adds a
 * column, and the failure only shows up under a large batch, which is exactly
 * the case a small test never covers.
 *
 * See https://developers.cloudflare.com/d1/platform/limits/
 */

export const MAX_BOUND_PARAMETERS = 100;

/** Rows that fit in one statement, given how many columns each row binds. */
export function rowsPerStatement(columnsPerRow: number): number {
  if (columnsPerRow <= 0) return 1;
  return Math.max(1, Math.floor(MAX_BOUND_PARAMETERS / columnsPerRow));
}

/** Splits rows into groups that each stay inside the parameter limit. */
export function batchRows<T>(rows: readonly T[], columnsPerRow: number): T[][] {
  const size = rowsPerStatement(columnsPerRow);
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    batches.push(rows.slice(index, index + size));
  }
  return batches;
}

/** Columns a table binds per inserted row, including ones filled by defaults. */
export function columnsOf(table: SQLiteTable): number {
  return Object.keys(getTableColumns(table)).length;
}

/**
 * Splits rows for an insert into `table` into statements D1 will accept.
 * Always prefer this over passing a column count by hand.
 */
export function batchForTable<T>(table: SQLiteTable, rows: readonly T[]): T[][] {
  return batchRows(rows, columnsOf(table));
}
