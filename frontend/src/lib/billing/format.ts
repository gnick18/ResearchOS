// Small client-safe formatters shared across the billing UI, so the new billing
// components do not have to import from the large SharingSection file.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export const GB_BYTES = 1024 ** 3;

/** A compact human byte string, e.g. "2.4 GB" or "830 MB". */
export function humanBytes(bytes: number): string {
  const b = Math.max(0, bytes);
  if (b < 1024) return `${b} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = b / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const digits = value < 10 && i > 0 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[i]}`;
}

/** Cents to a dollar string, e.g. "$3.00". */
export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
