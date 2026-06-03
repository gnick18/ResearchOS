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

/** A block in a release's optional personal `message`. When a release has a
 *  `message`, the popup renders it INSTEAD of the flat `highlights` bullets,
 *  so a big release can carry a from-the-author note with structure:
 *    - `para`    a paragraph of prose
 *    - `feature` a bold lead-in (`title`) + `text`, with optional `items`
 *                rendered as sub-bullets underneath
 *  Phrased cleanly: no em-dashes, no emojis. */
export type ReleaseMessageBlock =
  | { kind: "para"; text: string }
  | { kind: "feature"; title: string; text: string; items?: string[] };

/** One curated release's worth of user-facing notes. */
export interface ReleaseNote {
  /** Semantic version string, e.g. "0.1.0". Matches the APP_VERSION the
   *  release shipped under. */
  version: string;
  /** ISO date (YYYY-MM-DD) the release went out. Display-only. */
  date: string;
  /** User-facing highlight lines, rendered as bullets in the popup.
   *  Phrased cleanly: no em-dashes, no emojis. Used when `message` is absent
   *  (and kept as a concise fallback even when a `message` is present). */
  highlights: string[];
  /** Optional from-the-author note. When present, the popup renders this
   *  structured message in place of `highlights`. Used for big releases that
   *  warrant a personal, change-management framing rather than a bullet list. */
  message?: ReleaseMessageBlock[];
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
    version: "0.3.0",
    date: "2026-06-03",
    highlights: [
      "New Sequence Editor: a built-in molecular-biology workspace for your plasmids and DNA. Import SnapGene .dna, GenBank, and FASTA files, then view and edit with colored annotations and SnapGene-style tabbed navigation that moves smoothly from a whole-plasmid map down to individual bases",
      "Multi-exon genes render the way they should: connected exon boxes with dashed introns and a correctly spliced protein translation",
      "Primer design with melting temperatures and an alignment preview, plus a restriction-enzyme picker that shows exactly where commercial enzymes cut",
      "Annotated copy and paste between sequences, full keyboard and right-click editing, trackpad pinch-to-zoom, and one-click export to GenBank, FASTA, protein, or a map image",
      "A calmer workspace: your home is now a focused, curated dashboard, Projects open by default, and Experiments are laid out as a clean pipeline board",
      "A dedicated Lab Overview page for PIs, and a required lab password at setup and login to keep your workspace private",
      "A general-purpose Scientific calculator, and more accurate nearest-neighbor primer melting temperatures",
      "A Built on open source page crediting the projects ResearchOS is built on, plus quieter, less cluttered chrome throughout the app",
    ],
    message: [
      {
        kind: "para",
        text: "Hi Beta testers! This version you'll see some LARGE changes based on some feedback we had gotten that the website felt a bit bloated. This is a known problem I'm still fighting to improve on. Now that we've added lots of features it's equally important for me to figure out where the redundancies are and how we can make the whole site much more user intuitive.",
      },
      {
        kind: "para",
        text: "In that vein you will notice the home page and widget pages have been fully deprecated. Everything you actually used is still here, it has just moved into a calmer, more focused layout. Your projects now open by default and act as the home base for their notes, tasks, results, and sequences, your experiments live in a cleaner pipeline board, and if you run a lab you get a dedicated Lab Overview page. Nothing was deleted and your data is exactly where you left it, it should just take fewer clicks to get to.",
      },
      {
        kind: "para",
        text: "On top of the cleanup there are some genuinely big new features.",
      },
      {
        kind: "feature",
        title: "Sequence Editor (the headline):",
        text: "a SnapGene and Benchling style molecular biology workspace built right into ResearchOS. With it you can:",
        items: [
          "Import your SnapGene .dna, GenBank, and FASTA files",
          "View and edit sequences with colored annotations",
          "Zoom smoothly from a whole-plasmid map down to individual bases",
          "Design primers with melting temperatures",
          "See exactly where restriction enzymes cut",
          "View multi-exon genes as proper spliced exons with the correctly translated protein",
          "Export to GenBank, FASTA, protein, or a map image",
        ],
      },
      {
        kind: "feature",
        title: "Scientific calculator:",
        text: "a general-purpose calculator alongside the existing lab calculators.",
      },
      {
        kind: "feature",
        title: "More accurate primer Tm:",
        text: "melting temperatures now use the nearest-neighbor model.",
      },
      {
        kind: "feature",
        title: "Built on open source:",
        text: "a new page crediting the projects ResearchOS is built on.",
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-06-01",
    highlights: [
      "Version history on your notes, tasks, and projects: every save is kept, with per-editor diffs, one-click restore, and a 24-hour undo",
      "A prebuilt template library for the major PCR, qPCR, cloning, and prep kits, each bundled with the original vendor insert so you can check any value against the source",
      "Built-in lab calculators for molarity, dilutions, serial dilutions, primer Tm, DNA and RNA, and buffers, reachable from anywhere",
      "Smarter reordering in Purchases: one-tap quick reorder, one-click buy again, and reorder reminders that learn your cadence",
      "Polish: a wider, easier-to-scan widget picker, and long task lists that scroll cleanly instead of overflowing",
    ],
  },
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
