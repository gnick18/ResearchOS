// What's-new / developer-announcement release notes (whats-new bot).
//
// This module is the single source of truth for the "What's New" popup
// that greets a user with BeakerBot waving after a curated release. It
// owns two things:
//
//   1. RELEASE_NOTES — a hand-curated ARRAY of releases, NEWEST FIRST.
//      Each entry maps a version string to a date + a list of
//      user-facing highlights. We add a new entry here on each curated
//      release (in lockstep with bumping APP_VERSION in version.ts). It
//      is intentionally NOT per-commit: APP_VERSION only moves on real
//      releases, so the popup only fires on genuine upgrades.
//
//   2. The pure catch-up logic (`computeAnnouncementsToShow`,
//      `compareVersions`) that, given the user's last-seen-announcement
//      version + the release list, decides which releases are "missed"
//      and therefore which to surface. Kept pure (no React, no I/O) so
//      the version-compare + catch-up behavior is unit-testable in
//      isolation — the component layer just renders what this returns.
//
// House style note: highlight copy carries no em-dashes and no emojis,
// matching the rest of the product's user-facing voice.

import { APP_VERSION } from "./version";

/** One curated release's worth of user-facing notes. */
export interface ReleaseNote {
  /** Semantic version string, e.g. "0.1.0". Matches the APP_VERSION the
   *  release shipped under. */
  version: string;
  /** ISO date (YYYY-MM-DD) the release went out. Display-only. */
  date: string;
  /** User-facing highlight lines, rendered as bullets in the popup.
   *  Phrased cleanly: no em-dashes, no emojis. */
  highlights: string[];
}

/**
 * The release log, NEWEST FIRST. Append new entries at the TOP on each
 * curated release, and bump APP_VERSION in `version.ts` to match the new
 * top entry's `version`.
 *
 * Seeded with a single entry at the CURRENT APP_VERSION (0.1.0). We did
 * NOT bump APP_VERSION as part of seeding: this first entry simply
 * documents the recent user-facing work so existing accounts get a
 * proper catch-up the first time the feature ships, while brand-new
 * accounts silently record this version and never see a stale "welcome
 * to features you already have" popup (see the first-load-silent rule in
 * the manager component).
 */
export const RELEASE_NOTES: ReadonlyArray<ReleaseNote> = [
  {
    version: "0.1.0",
    date: "2026-05-29",
    highlights: [
      "One unified dashboard, your projects and tools are now customizable widgets on a single page",
      "Writing Focus Mode in the markdown editor (Cmd/Ctrl+Shift+F) for distraction-free notes",
      "Share links with your whole lab again",
      "Attach screenshots to bug reports and feature requests",
      "Richer project widgets, see active, overdue, and upcoming tasks at a glance",
    ],
  },
];

/**
 * Compare two dotted numeric version strings (e.g. "0.1.0" vs "0.2.0").
 *
 * Returns a negative number when `a < b`, zero when equal, positive when
 * `a > b`. Components are compared left-to-right as integers; a missing
 * component is treated as 0 so "0.1" and "0.1.0" compare equal. Any
 * non-numeric component coerces to 0 (defensive against a hand-edited or
 * malformed version string) rather than throwing.
 *
 * Pure: no side effects, safe to call anywhere.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

/** Split a version string into numeric components, coercing junk to 0. */
function parseVersion(v: string): number[] {
  return String(v)
    .trim()
    .split(".")
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/**
 * Pure catch-up resolver. Given the user's last-seen-announcement version
 * (or `null`/`undefined` when nothing has ever been recorded) and the
 * release list, return the releases the user has NOT yet seen, NEWEST
 * FIRST.
 *
 * Rules:
 *   - `lastSeen == null` → caller treats this as a brand-new account and
 *     should silently record `currentVersion` WITHOUT showing the popup.
 *     For completeness this function still returns the full missed list
 *     so a caller that wants the on-demand "show everything" view can use
 *     `releases` directly; the silent-first-load decision lives in the
 *     manager, not here.
 *   - Otherwise → every release whose version is strictly newer than
 *     `lastSeen` is "missed". An empty array means there is nothing new
 *     and the manager shows nothing.
 *
 * `currentVersion` (defaults to APP_VERSION) caps the result: a release
 * note authored ahead of the shipped APP_VERSION (e.g. a draft entry for
 * the next version committed early) is NOT surfaced until APP_VERSION
 * actually reaches it. This keeps the popup honest about what the running
 * build contains.
 */
export function computeAnnouncementsToShow(params: {
  lastSeen: string | null | undefined;
  releases?: ReadonlyArray<ReleaseNote>;
  currentVersion?: string;
}): ReleaseNote[] {
  const releases = params.releases ?? RELEASE_NOTES;
  const currentVersion = params.currentVersion ?? APP_VERSION;

  // Only releases at or below the running build are eligible.
  const eligible = releases.filter(
    (r) => compareVersions(r.version, currentVersion) <= 0,
  );

  // Always hand back newest-first regardless of how the source array was
  // ordered, so callers never have to re-sort.
  const sorted = [...eligible].sort((a, b) =>
    compareVersions(b.version, a.version),
  );

  if (params.lastSeen == null) {
    // Brand-new account: the manager records and suppresses. Return the
    // full eligible list for the on-demand history view.
    return sorted;
  }

  return sorted.filter(
    (r) => compareVersions(r.version, params.lastSeen as string) > 0,
  );
}

/** The newest eligible release version for a given build, or `null` when
 *  the release list is empty. Used to set last-seen on dismiss / silent
 *  first-load record. */
export function latestReleaseVersion(
  releases: ReadonlyArray<ReleaseNote> = RELEASE_NOTES,
  currentVersion: string = APP_VERSION,
): string | null {
  const eligible = releases.filter(
    (r) => compareVersions(r.version, currentVersion) <= 0,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, r) =>
    compareVersions(r.version, best.version) > 0 ? r : best,
  ).version;
}
