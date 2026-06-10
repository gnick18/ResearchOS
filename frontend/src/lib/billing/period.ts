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
