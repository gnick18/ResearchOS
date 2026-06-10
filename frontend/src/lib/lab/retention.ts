// Lab data-retention registry (LAB_ARCHIVE_CONTINUITY.md phase 1a).
//
// The PI-owned record of where each member's lab data is retained for NIH /
// institutional compliance, regardless of where the bytes physically live. This
// module holds the types + pure helpers (labels, the disposal-eligible-date
// computation); the JsonStore wiring lives in local-api as `retentionApi`, and
// the dashboard card reads it from the Lab Head hub.
//
// Phase 1a moves no bytes: a PI records an entry (who, where, how long). The
// SHA-256 manifest + the per-user export that fills it come in phase 2.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** Where a member's data is retained. Only `r2` stores bytes on our servers;
 *  the others are attestations (the bytes live on a drive we never hold). */
export type RetentionTarget = "r2" | "hard_drive" | "institutional_drive";

export interface RetentionEntry {
  id: number;
  /** The member whose data this entry retains (username or label). */
  member: string;
  /** What is retained, e.g. "All data" or a project / scope label. */
  unit: string;
  /** Retention target. */
  target: RetentionTarget;
  /** Human location: a drive name, an institutional path, or "ResearchOS R2". */
  location: string;
  /** When the entry was recorded (ISO). */
  archived_at: string;
  /** The PI who recorded it (username). */
  archived_by: string;
  /** Policy retention period in years (the PI sets it; default below). */
  retention_years: number;
  /** SHA-256 manifest of the retained files. Null until an export computes it. */
  manifest_sha256: string | null;
  /** Free note (custodian, box label, etc.). */
  note: string | null;
}

export type RetentionEntryCreate = Omit<RetentionEntry, "id">;

/** Default retention period. NIH commonly wants 3+ years past grant close and
 *  many institutions require longer, so 7 is a safe, common default the PI can
 *  change per entry. */
export const DEFAULT_RETENTION_YEARS = 7;

export const RETENTION_TARGETS: { value: RetentionTarget; label: string; holdsBytes: boolean }[] = [
  { value: "r2", label: "ResearchOS cloud (R2)", holdsBytes: true },
  { value: "hard_drive", label: "Physical hard drive", holdsBytes: false },
  { value: "institutional_drive", label: "Institutional / network drive", holdsBytes: false },
];

export function retentionTargetLabel(target: RetentionTarget): string {
  return RETENTION_TARGETS.find((t) => t.value === target)?.label ?? target;
}

/** True when we hold the actual bytes (only the R2 target), vs an attestation. */
export function targetHoldsBytes(target: RetentionTarget): boolean {
  return RETENTION_TARGETS.find((t) => t.value === target)?.holdsBytes ?? false;
}

/**
 * The date this entry becomes eligible for disposition: archived_at plus the
 * retention period, as a YYYY-MM-DD string. Returns "" for an unparseable date.
 */
export function disposalEligibleDate(
  archivedAt: string,
  retentionYears: number,
): string {
  const d = new Date(archivedAt);
  if (Number.isNaN(d.getTime())) return "";
  const years = Number.isFinite(retentionYears) ? Math.max(0, retentionYears) : 0;
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}
