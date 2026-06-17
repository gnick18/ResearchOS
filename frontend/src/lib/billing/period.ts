// The monthly billing period bucket for the per-owner activity tally. Stamped by
// SERVER time so the DO never needs a clock and month rollover is authoritative
// on Vercel. Format YYYY-MM (UTC), e.g. "2026-06". Both the activity report
// endpoint (which increments) and the owner-state check (which sums) call this,
// so they always agree on the current bucket. A new month is simply a new row;
// last month's counters are left in place (the throttle only ever reads the
// current period, so the reset is implicit).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export function currentWritePeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** The YYYY-MM period immediately before the given one, handling year rollover.
 *  Pure string math so it needs no clock. e.g. "2026-01" -> "2025-12". */
export function priorPeriod(period: string): string {
  const [yStr, mStr] = period.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  if (month <= 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** The just-closed billing period (last month), the one the monthly accrual cron
 *  rolls up. */
export function previousWritePeriod(now: Date = new Date()): string {
  return priorPeriod(currentWritePeriod(now));
}
