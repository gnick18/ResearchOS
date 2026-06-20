// Achievement-badge catalog (badges v1 foundation, flag NEXT_PUBLIC_BADGES_ENABLED).
//
// A GitHub-achievements style system. Every badge is a distinct branded
// medallion earned from a lab or user's real activity, pinnable, and shown on
// the public network profile (solo / lab / dept / inst). This file is the
// single source of truth for the badge MODEL and the STARTER set; earn logic
// lives in earn.ts and the visual lives in components/badges/BadgeMedallion.tsx.
//
// GLYPHS: medallions reuse EXISTING verified registry glyphs only (see
// components/icons/registry.tsx). No new inline svg, no new registry glyph
// (the icon-guard hook blocks both). Where no existing glyph fits, the badge
// ships with a short `text` number/label instead. The companion-site badge
// wanted a globe glyph (none exists yet); it uses `cloud` (the hosted-site
// stand-in) and a new `globe`/`world` glyph is flagged for Grant's sign-off.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import type { IconName } from "@/components/icons/registry";

/** Broad grouping for the bin and for ring-color fallback by category. */
export type BadgeCategory = "status" | "milestone" | "activity" | "community" | "class";

/** The rule that decides whether a badge is earned, evaluated in earn.ts. */
export type BadgeCriteria =
  | { kind: "founding" }
  | { kind: "count"; metric: "experiments"; threshold: number }
  | { kind: "event"; event: "external_share" | "companion_site" }
  | { kind: "tenure"; days: number }
  // Instructor-granted (class mode), NOT computed from metrics. Earned when the
  // badge id appears in the awardedBadgeIds passed to computeEarnedBadges. The
  // grant is an instructor-authored record the holder reads over class mode's
  // relay team-key transport (per-student for v1; class-wide "*" awards and
  // class-aggregate badges keyed by labId are phase 2, that residency substrate
  // is not finished yet). Aligns with the classroom lane: the holder is the
  // account identity, the class id is the labId, and class-ness is read from
  // classConfig.isClass / lab_kind, never from the membership role.
  | { kind: "awarded" };

export interface Badge {
  /** Stable id, also the localStorage pin key and the earn.ts return value. */
  id: string;
  /** Short title shown under the medallion. */
  label: string;
  /** One-line reason this badge exists / how it is earned (the WHY). */
  description: string;
  category: BadgeCategory;
  /** Optional rarity tier. Drives the ring color via BADGE_COLORS. */
  tier?: "bronze" | "silver" | "gold";
  /** Resolved ring color (hex from BADGE_COLORS, the one sanctioned map). */
  ring: string;
  /** Registry glyph drawn in the ring. Omit when `text` is used instead. */
  glyph?: IconName;
  /** Short number/label drawn in the ring when no glyph fits (e.g. "1K"). */
  text?: string;
  criteria: BadgeCriteria;
}

// BADGE_COLORS is the ONE sanctioned hex map for the badge domain, the same
// pattern as the transparency ORACLE_COLOR palette. Ring colors are a small
// deliberate domain palette (rarity tiers + a couple of category accents), so
// they live here as raw hex rather than brand tokens, and NOWHERE ELSE. Do not
// scatter these hex values into components; read them from here.
//
// Values are brand-aligned: founding uses the brand action purple; the tier
// ramp (bronze copper, silver grey, gold amber) reads as a rarity ladder; the
// activity accents (teal, blue) match the wider product palette.
export const BADGE_COLORS = {
  /** Founding status, the brand action purple. */
  founding: "#534AB7",
  /** Gold tier, an amber that reads as the top rarity. */
  gold: "#BA7517",
  /** Silver tier, a neutral steel grey. */
  silver: "#8A8F98",
  /** Bronze tier, a warm copper. */
  bronze: "#D85A30",
  /** Activity accent, teal (e.g. first external share). */
  teal: "#1D9E75",
  /** Activity accent, blue (e.g. companion site live). */
  blue: "#378ADD",
  /** Class / awarded accent, a warm rose for instructor-granted badges. */
  class: "#D4537E",
} as const;

export type BadgeColorKey = keyof typeof BADGE_COLORS;

/**
 * The starter catalog (v1, ~6 badges). Each entry's `ring` is read from the
 * single BADGE_COLORS map above. Order here is the display order in the bin.
 */
export const BADGE_CATALOG: Badge[] = [
  {
    id: "founding-lab",
    label: "Founding lab",
    description: "Joined ResearchOS during the founding period.",
    category: "status",
    ring: BADGE_COLORS.founding,
    glyph: "star",
    criteria: { kind: "founding" },
  },
  {
    id: "experiments-100",
    label: "100 experiments",
    description: "Logged 100 experiments in the lab.",
    category: "milestone",
    tier: "bronze",
    ring: BADGE_COLORS.bronze,
    text: "100",
    criteria: { kind: "count", metric: "experiments", threshold: 100 },
  },
  {
    id: "experiments-1000",
    label: "1,000 experiments",
    description: "Logged 1,000 experiments in the lab.",
    category: "milestone",
    tier: "gold",
    ring: BADGE_COLORS.gold,
    text: "1K",
    criteria: { kind: "count", metric: "experiments", threshold: 1000 },
  },
  {
    id: "first-share",
    label: "First share",
    description: "Shared work with an external collaborator for the first time.",
    category: "activity",
    ring: BADGE_COLORS.teal,
    // Registry has no `send`; `share` carries the same external-sharing meaning.
    glyph: "share",
    criteria: { kind: "event", event: "external_share" },
  },
  {
    id: "companion-site",
    label: "Companion site",
    description: "Published a public companion site for the lab.",
    category: "activity",
    ring: BADGE_COLORS.blue,
    // `globe` (meridian globe), Grant sign-off 2026-06-19.
    glyph: "globe",
    criteria: { kind: "event", event: "companion_site" },
  },
  {
    id: "one-year",
    label: "One year",
    description: "Active on ResearchOS for a full year.",
    category: "status",
    ring: BADGE_COLORS.founding,
    // Registry `today` is the calendar glyph (concept "Calendar / today").
    glyph: "today",
    criteria: { kind: "tenure", days: 365 },
  },
  {
    id: "course-complete",
    label: "Course complete",
    description: "Awarded by the instructor for finishing the course.",
    category: "class",
    ring: BADGE_COLORS.class,
    // Instructor-granted (class mode). `medal` (hanging medal), Grant sign-off
    // 2026-06-19. `rosette` is also approved in the registry for a future
    // first-place / best-poster badge.
    glyph: "medal",
    criteria: { kind: "awarded" },
  },
];

/** Lookup a badge by id (used by the shelf and bin to resolve pinned ids). */
export function getBadge(id: string): Badge | undefined {
  return BADGE_CATALOG.find((b) => b.id === id);
}
