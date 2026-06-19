// Demo lab content, pure spec (demo-lab-network Phase 1, social lane).
//
// The single source of truth for the seeded "demo lab" showcase (the FakeYeast /
// Castellanos lab) that appears on the researcher network and publishes both a
// native companion site and a bring your own static site. See
// docs/proposals/2026-06-18-demo-lab-on-network.md.
//
// This module is the PURE, browser-safe content layer (no Neon, no R2, no fs), so
// it can be imported by the directory card and the public page view (client
// components) AND by the deploy seeder (seed-demo-lab.ts, Node) AND by the unit
// tests. The IO seeder consumes these shapes; the view layer reads the card +
// page metadata; the tests validate the shapes against parseByoManifest /
// parseSnapshotBundle.
//
// IDENTITY. The demo lab is a real seeded DB row owned by a NON-BILLING sentinel
// owner key (DEMO_LAB_OWNER_KEY), so it can never be edited through the authed
// dashboard (no real session resolves to this key) and never bills. The slug is
// reserved as kind=lab so no real lab can later claim it.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { buildObjectEmbedHref, objectEmbedMarkdown } from "@/lib/references";
import { normalizeSlug } from "./slug-registry";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** The reserved demo lab slug. Passes normalizeSlug unchanged, is not in
 *  RESERVED_SLUGS, and collides with no @handle (handles are first-name based). */
export const DEMO_LAB_SLUG = "fakeyeast-lab";

/**
 * The NON-BILLING sentinel owner key for the demo lab. It maps to no real billing
 * account, so the demo lab can never be edited through the authed dashboard (no
 * session's ownerKeyForEmail ever equals this) and never bills. Used as the
 * lab_sites.lab_owner_key and the lab_byo_sites.lab_owner_key for the seed.
 */
export const DEMO_LAB_OWNER_KEY = "demo-fakeyeast-lab";

/** The lab display name. */
export const DEMO_LAB_NAME = "The Castellanos Lab";

/** The fabricated verified-domain for the directory badge (consistent with the
 *  fictional framing, never a real institution). */
export const DEMO_VERIFIED_DOMAIN = "fakeyeast.edu";

/** A short, fabricated key fingerprint chip, per the locked positioning that
 *  sharing is verified, not a follower count. */
export const DEMO_KEY_FINGERPRINT = "ab12 cd34 ef56";

/** The BYO ("paper companion") assets host for the demo lab. */
export const DEMO_BYO_HOST = `${DEMO_LAB_SLUG}.research-os.com`;

/** True when a (raw or normalized) slug is the demo lab slug. The view-layer demo
 *  framing is scoped through this so it never affects a real lab's site. */
export function isDemoLabSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return normalizeSlug(slug) === DEMO_LAB_SLUG;
}

// ---------------------------------------------------------------------------
// Directory card content (section 4.1)
// ---------------------------------------------------------------------------

/** One lab member rendered on the directory card and the people page. */
export interface DemoLabMember {
  handle: string;
  name: string;
  role: string;
}

/** The discovery-and-trust card content. No follower counts, no likes, no feed. */
export interface DemoLabCard {
  slug: string;
  name: string;
  tagline: string;
  pi: DemoLabMember;
  members: DemoLabMember[];
  verifiedDomain: string;
  keyFingerprint: string;
}

/** The PI archetype, mirroring the in-tab demo (orange PI color, @mira). */
export const DEMO_LAB_PI: DemoLabMember = {
  handle: "mira",
  name: "Dr. Mira Castellanos",
  role: "Principal investigator",
};

/** The shown members (archived @sam is intentionally omitted). */
export const DEMO_LAB_MEMBERS: DemoLabMember[] = [
  { handle: "alex", name: "Alex Romero", role: "Postdoc" },
  { handle: "ivy", name: "Ivy Chen", role: "Research scientist" },
  { handle: "morgan", name: "Morgan Lee", role: "Graduate student" },
  { handle: "nia", name: "Nia Okafor", role: "Graduate student" },
  { handle: "remy", name: "Remy Dubois", role: "Lab technician" },
  { handle: "theo", name: "Theo Park", role: "Undergraduate researcher" },
];

export const DEMO_LAB_CARD: DemoLabCard = {
  slug: DEMO_LAB_SLUG,
  name: DEMO_LAB_NAME,
  tagline: "FakeYeast synthetic biology",
  pi: DEMO_LAB_PI,
  members: DEMO_LAB_MEMBERS,
  verifiedDomain: DEMO_VERIFIED_DOMAIN,
  keyFingerprint: DEMO_KEY_FINGERPRINT,
};

// ---------------------------------------------------------------------------
// Figure embeds (Phase 3b frozen-snapshot path)
// ---------------------------------------------------------------------------
//
// A public reader has no local workspace, so a block embed renders its FROZEN
// BakedEmbed snapshot, never a live embed. The demo ships two small figures as
// image snapshots so the native pages exercise the real frozen-embed path. The
// figure ARTWORK is checked in as plain .svg files under fixtures/figures/ (NOT
// inlined here, so this module stays free of raw inline SVG and the seeder builds
// the snapshot data URL from the file at seed time). The snapshot is keyed by the
// EXACT embed link href (buildObjectEmbedHref), the key the renderer looks an
// embed up by.

/** A figure referenced by a native page. The seeder reads `svgFile`, builds the
 *  baked image snapshot, and stores it keyed by `href`. The page body contains a
 *  lone block-embed link with the SAME href, so the public render resolves the
 *  frozen snapshot. type+id+view are arbitrary for a seeded snapshot but kept a
 *  valid block-embed href so the lone link parses as a block. */
export interface DemoFigure {
  href: string;
  caption: string;
  svgFile: string;
  width: number;
  height: number;
}

function demoFigure(id: string, caption: string, svgFile: string): DemoFigure {
  return {
    href: buildObjectEmbedHref("dataset", id, { view: "figure" }),
    caption,
    svgFile,
    width: 520,
    height: 300,
  };
}

const GROWTH_FIGURE = demoFigure(
  "demo-growth",
  "FakeYeast growth curve",
  "growth.svg",
);
const RESULTS_FIGURE = demoFigure(
  "demo-results",
  "fakeGFP output by promoter strength",
  "results.svg",
);

const GROWTH_FIGURE_MD = objectEmbedMarkdown(
  "dataset",
  "demo-growth",
  "FakeYeast growth curve",
  { view: "figure" },
);
const RESULTS_FIGURE_MD = objectEmbedMarkdown(
  "dataset",
  "demo-results",
  "fakeGFP output by promoter strength",
  { view: "figure" },
);

// ---------------------------------------------------------------------------
// Native companion pages (section 4.2)
// ---------------------------------------------------------------------------

/** One seeded native page. `figure` is the frozen figure baked + stored with the
 *  published version (null for a text-only page); the seeder turns it into the
 *  snapshot bundle. */
export interface DemoNativePage {
  path: string;
  title: string;
  bodyMd: string;
  figure: DemoFigure | null;
}

const HOME_BODY = `Welcome to the Castellanos Lab, a synthetic biology group engineering
**FakeYeast** strains with tunable fakeGFP output. We are a fictional lab used to
showcase what a ResearchOS lab site looks like, so every strain, result, and
figure on this site is fabricated for the demo.

## What we work on

We build promoter libraries for FakeYeast and measure how fakeGFP output tracks
promoter strength, with the goal of a predictable, dial-a-level expression system.

${GROWTH_FIGURE_MD}

This figure is a frozen snapshot. A public reader has no connection to our data, so
the chart you see is exactly what we published, baked at publish time.

## Find us

See the [people](/${DEMO_LAB_SLUG}/people) on the team, or read the
[FakeYeast 2026 paper companion](/${DEMO_LAB_SLUG}/papers/fakeyeast-2026).`;

const PEOPLE_BODY = `The people of the Castellanos Lab. Each handle links to that
researcher's public profile on the network.

## Principal investigator

- [@${DEMO_LAB_PI.handle}](/u/${DEMO_LAB_PI.handle}), ${DEMO_LAB_PI.name}, ${DEMO_LAB_PI.role}

## Members

${DEMO_LAB_MEMBERS.map(
  (m) => `- [@${m.handle}](/u/${m.handle}), ${m.name}, ${m.role}`,
).join("\n")}`;

const PAPER_BODY = `# FakeYeast 2026

**Engineering FakeYeast for tunable fakeGFP output.** The Castellanos Lab.
A fabricated paper used to demonstrate a companion page.

## Abstract

We assembled a promoter library for FakeYeast and characterized fakeGFP output
across promoter strengths. Output rose monotonically with strength, giving a
tunable expression dial. All data here is fabricated for the demo.

## Result

${RESULTS_FIGURE_MD}

## Full interactive version

The full, interactive companion (a bring your own static site the lab built and
hosts itself) lives at [${DEMO_BYO_HOST}](https://${DEMO_BYO_HOST}). The figure
above is a frozen snapshot, the interactive version is on the lab's own site.`;

/** The three published native pages (home, people, paper companion). */
export const DEMO_NATIVE_PAGES: DemoNativePage[] = [
  {
    path: "",
    title: "The Castellanos Lab",
    bodyMd: HOME_BODY,
    figure: GROWTH_FIGURE,
  },
  {
    path: "people",
    title: "People",
    bodyMd: PEOPLE_BODY,
    figure: null,
  },
  {
    path: "papers/fakeyeast-2026",
    title: "FakeYeast 2026, paper companion",
    bodyMd: PAPER_BODY,
    figure: RESULTS_FIGURE,
  },
];

// ---------------------------------------------------------------------------
// BYO static-site bundle (section 4.3)
// ---------------------------------------------------------------------------
//
// The checked-in bundle lives under fixtures/demo-byo-site/. The seeder reads the
// real files from disk (Node) and uploads them to R2. This constant is the
// canonical relative-path list of the bundle, so the seeder and the tests agree on
// what the bundle contains without the pure module reading the filesystem.

/** The relative paths in the demo BYO bundle (must mirror the fixture folder). */
export const DEMO_BYO_FILES: readonly string[] = [
  "index.html",
  "assets/style.css",
  "assets/app.js",
];
