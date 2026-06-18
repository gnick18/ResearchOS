// Date helpers for note running-log entries.
//
// Entry dates are stored as date-only strings ("YYYY-MM-DD"). The trap is that
// `new Date("2026-05-13")` parses as UTC midnight, so `toLocaleDateString` in
// any timezone behind UTC renders the previous calendar day (May 12). These
// helpers build the date from its Y-M-D parts in LOCAL time so the displayed
// day matches the stored day in every timezone.

/** Today as a local "YYYY-MM-DD" string (not UTC, so it is correct near midnight). */
export function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Format an entry date for display. Date-only strings ("YYYY-MM-DD") are read as
 * LOCAL calendar days so the shown day equals the stored day regardless of the
 * viewer's timezone. Full timestamps fall back to normal Date parsing.
 */
export function formatEntryDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    const d = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}
