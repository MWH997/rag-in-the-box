/**
 * Cloudflare's own numbers, not ours.
 *
 * Everything in this file is a platform fact with a published source. Product
 * decisions live in tiers.ts. Keeping the two apart matters because these
 * change when Cloudflare changes them, and the only correct response is to
 * update the number and the date below.
 *
 * Sources, checked 1 September 2026:
 *   https://developers.cloudflare.com/d1/platform/limits/
 *   https://developers.cloudflare.com/workers/platform/limits/
 *   https://developers.cloudflare.com/vectorize/platform/limits/
 *   https://developers.cloudflare.com/workers-ai/platform/pricing/
 */

/**
 * D1 rows read per day on the Workers Free plan.
 *
 * Enforced from 1 September 2026. Before that date the limit was published but
 * not applied. Past it, every D1 query fails until midnight UTC.
 */
export const FREE_D1_ROWS_READ_PER_DAY = 5_000_000;

/** D1 rows written per day on the Workers Free plan. Enforced from the same date. */
export const FREE_D1_ROWS_WRITTEN_PER_DAY = 100_000;

/** Bound parameters allowed in a single D1 query. Exceeding this is an error, not a limit. */
export const D1_MAX_BOUND_PARAMETERS = 100;

/** D1 queries allowed per Worker invocation on the free plan. */
export const FREE_D1_QUERIES_PER_INVOCATION = 50;

/** Processor time allowed per Worker invocation on the free plan, in milliseconds. */
export const FREE_WORKER_CPU_MS = 10;

/** Vectorize stored vector dimensions included on the free plan. */
export const FREE_VECTOR_DIMENSIONS_STORED = 5_000_000;

/** Namespaces allowed per Vectorize index, which caps how many tenants one index holds. */
export const VECTORIZE_NAMESPACES_PER_INDEX = 1_000;
