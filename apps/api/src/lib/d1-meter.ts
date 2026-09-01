/**
 * Counts the rows D1 actually reads and writes for a request.
 *
 * From 1 September 2026 Cloudflare enforces the Workers Free plan's daily D1
 * allowance of 5,000,000 rows read and 100,000 rows written. Past either line
 * every query fails until midnight UTC. A deployment that cannot see its own
 * consumption only finds out when it breaks, so the numbers are measured rather
 * than estimated: D1 reports `rows_read` and `rows_written` in the `meta` of
 * every result, and this wraps the binding to add them up.
 *
 * Only `run`, `all` and `batch` carry meta. `raw` does not, and drizzle only
 * reaches for it through `.values()`, which nothing here calls. If that
 * changes, the reads it performs will be invisible to this counter.
 *
 * Source: https://developers.cloudflare.com/d1/platform/limits/
 */

export interface D1Usage {
  rowsRead: number;
  rowsWritten: number;
  queries: number;
}

export interface MeteredD1 {
  binding: D1Database;
  usage: () => D1Usage;
}

interface MetaCarrier {
  meta?: { rows_read?: number; rows_written?: number };
}

/**
 * True when an error is D1 refusing further queries for the day.
 *
 * Cloudflare returns these as ordinary query errors with a specific message,
 * not as a distinct code, so the message is what there is to match on. The test
 * is deliberately loose about wording either side of the key phrase.
 */
export function isDailyLimitError(error: unknown): false | "read" | "write" {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!/free tier daily row/i.test(message)) return false;
  return /row read/i.test(message) ? "read" : "write";
}

export function createMeter(d1: D1Database): MeteredD1 {
  const totals: D1Usage = { rowsRead: 0, rowsWritten: 0, queries: 0 };

  const record = (result: unknown): void => {
    const meta = (result as MetaCarrier | null)?.meta;
    if (!meta) return;
    totals.rowsRead += meta.rows_read ?? 0;
    totals.rowsWritten += meta.rows_written ?? 0;
    totals.queries += 1;
  };

  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;

        // bind() returns another statement, which must stay wrapped or the
        // meter would miss every parameterised query, meaning nearly all of them.
        if (property === "bind") {
          return (...args: unknown[]) =>
            wrapStatement(
              (value as (...a: unknown[]) => D1PreparedStatement).apply(
                target,
                args,
              ) as D1PreparedStatement,
            );
        }

        if (property === "run" || property === "all") {
          return async (...args: unknown[]) => {
            const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(
              target,
              args,
            );
            record(result);
            return result;
          };
        }

        return (value as (...a: unknown[]) => unknown).bind(target);
      },
    });

  const binding = new Proxy(d1, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;

      if (property === "prepare") {
        return (query: string) =>
          wrapStatement((value as (q: string) => D1PreparedStatement).call(target, query));
      }

      if (property === "batch") {
        return async (statements: unknown[]) => {
          const results = (await (value as (s: unknown[]) => Promise<unknown[]>).call(
            target,
            statements,
          )) as unknown[];
          for (const result of results) record(result);
          return results;
        };
      }

      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });

  return { binding, usage: () => ({ ...totals }) };
}
