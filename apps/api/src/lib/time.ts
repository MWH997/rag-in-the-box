/** Calendar day in UTC, matching how Cloudflare resets its daily free limits. */
export function utcDay(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Milliseconds until the next UTC midnight, which is when quotas reset. */
export function nextUtcMidnight(at: number = Date.now()): number {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export function lastNUtcDays(count: number, at: number = Date.now()): string[] {
  const days: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    days.push(utcDay(at - index * 86_400_000));
  }
  return days;
}
