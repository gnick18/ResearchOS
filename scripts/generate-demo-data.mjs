#!/usr/bin/env node
/**
 * Generates the Demo Lab on-disk tree under `frontend/public/demo-data/`
 * and emits the matching TS fixture at
 * `frontend/src/lib/file-system/wiki-capture-fixture.ts`.
 *
 * Single source of truth: the `buildEntries()` function below. Both outputs
 * are derived from it, so the on-disk demo lab and the wiki-capture fixture
 * never drift.
 *
 * Theme: clearly-fake synthetic biology yeast lab. Two users: alex (PI/postdoc)
 * and morgan (grad student). Every project is prefixed `DEMO:`, every method
 * is prefixed `[Demo protocol]`, and strain names use FakeYeast / DemoStrain.
 * The Telegram inbox image, the gels, the growth curves, etc. all carry a
 * "FAKE DEMO" watermark added by `generate-demo-images.mjs` separately.
 *
 * Run: `node scripts/generate-demo-data.mjs`
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DEMO_DIR = path.join(REPO_ROOT, "frontend", "public", "demo-data");
const FIXTURE_TS = path.join(
  REPO_ROOT,
  "frontend",
  "src",
  "lib",
  "file-system",
  "wiki-capture-fixture.ts",
);

// ─── Anchor dates ─────────────────────────────────────────────────────────────

const TODAY = "2026-05-13";
const YESTERDAY = "2026-05-12";
const TOMORROW = "2026-05-14";
const NEXT_WEEK = "2026-05-20";
const LAST_WEEK = "2026-05-06";
const TWO_WEEKS = "2026-05-27";

// Mira PI R1 fix manager (Fix 8, 2026-05-25): wall-clock today, used
// for the Mira "Today's events" tile seed. The demo data is anchored
// to 2026-05-13 ("the demo lab's snapshot"), but the
// CalendarEventsTodayWidget reads real new Date(), so the tile would
// always be empty without a real-today event. Seeding ONE event whose
// start_date is the real-today string keeps the tile non-empty for
// the verifier walk.
const REAL_TODAY = "2026-05-25";

// Strategic-overdue anchors. Tasks set to these dates ALWAYS appear N days
// overdue regardless of when the demo is opened, because the rebase math
// (in lib/demo/rebase.ts) shifts every date by the same `(today - BASE_DATE)`
// delta — so a task ending 6 days before BASE_DATE stays 6 days before
// today. Used for 2 demo tasks so the user sees the overdue UI state.
const OVERDUE_START = "2026-05-06"; // BASE_DATE - 7 (started a week ago, never finished)
const OVERDUE_END_4D = "2026-05-09"; // BASE_DATE - 4
const OVERDUE_END_6D = "2026-05-07"; // BASE_DATE - 6
const OVERDUE_END_2D = "2026-05-11"; // BASE_DATE - 2

// Workbench Lists-tab fixture anchors — populate the new tab's sections
// without disturbing the experiment fixtures above.
const RECENT_DONE = "2026-05-08";    // BASE_DATE - 5 (Recently done window)
const SCHEDULED_LATER = "2026-06-15"; // BASE_DATE + 33 (past the 14d Upcoming horizon)
const SCHEDULED_LATER_END = "2026-06-17";
const EARLIER_DONE_ALEX = "2026-04-01";   // BASE_DATE - 42 (Earlier accordion)
const EARLIER_DONE_MORGAN = "2026-03-20"; // BASE_DATE - 54 (Earlier accordion)

const ALEX_COLOR = "#3b82f6";   // blue
const MORGAN_COLOR = "#10b981"; // emerald
// PI archetype (Dr. Mira Castellanos) — orange/amber so the PI's LabComments
// pop visually against alex's blue + morgan's emerald. Sits separately from
// the project palette (which uses its own #f59e0b amber for project 3).
const MIRA_COLOR = "#f97316";   // orange
// Lab Head Phase 6 (lab head Phase 6 manager, 2026-05-23): departed
// postdoc archetype. Sam predates alex and morgan in the lab timeline —
// he was the original yeast postdoc, left for industry in mid-March
// 2026, and exists in the fixture purely to showcase the archive
// feature. Gray slate so he reads as visually "retired" against the
// rest of the active palette.
const SAM_COLOR = "#64748b";   // slate
// Check-ins demo seed (checkins-demo bot, 2026-06-12): Remy Okafor, an
// undergraduate rotation student. The newest, most junior active lab member,
// the leaf of the 3-level mentorship tree (Mira -> Alex -> Remy). Violet so
// the rotation student reads as distinct from blue/emerald/orange.
const REMY_COLOR = "#8b5cf6";  // violet

// ─── Markdown bodies (broken out for legibility) ─────────────────────────────

const DEMO_BANNER_MD =
  "> :information_source: **This is fake demo data.** All strains, plasmids, and results below are fictional and exist only to demonstrate ResearchOS features. Do not use as a real protocol.\n\n";

const METHOD_TRANSFORMATION_MD =
  DEMO_BANNER_MD +
  "# [Demo protocol] Yeast transformation (LiAc)\n\n" +
  "Lithium acetate transformation, scaled for one 50 mL culture and ten reactions.\n\n" +
  "## Reagents\n\n" +
  "- 50% PEG-3350 (sterile)\n" +
  "- 1 M LiAc (sterile)\n" +
  "- Salmon-sperm DNA carrier, 10 mg/mL\n" +
  "- TE buffer\n" +
  "- SD selection plates (SD-Ura for `pYES-GAL1::flbA`, SD-His for `pDEMO-fluo`)\n\n" +
  "## Steps\n\n" +
  "1. Grow `FakeYeast-001` overnight in 5 mL YPD at 30 °C.\n" +
  "2. Dilute into 50 mL fresh YPD, OD600 ~0.2. Grow to OD600 ~0.8 (~4 h).\n" +
  "3. Spin 3 min at 3,000 g. Wash pellet with 25 mL sterile water, then 1 mL 100 mM LiAc.\n" +
  "4. Resuspend in 1 mL 100 mM LiAc → 50 µL aliquots.\n" +
  "5. Per reaction: 240 µL PEG, 36 µL 1 M LiAc, 50 µL boiled carrier DNA, 1–5 µL plasmid (~100 ng).\n" +
  "6. Vortex hard, heat-shock 42 °C, 40 min.\n" +
  "7. Spin gently, resuspend in 200 µL water, plate on SD selection.\n\n" +
  "## Common gotchas\n\n" +
  "- Skip the heat-shock step if the strain is heat-sensitive (e.g., `DemoStrain ΔADE2`). Substitute 30 °C, 90 min.\n" +
  "- Always run a no-DNA control on the same SD plate.\n";

const METHOD_MINIPREP_MD =
  DEMO_BANNER_MD +
  "# [Demo protocol] Plasmid mini-prep\n\n" +
  "Quick alkaline-lysis mini-prep tuned for the lab's plate-format work.\n\n" +
  "## Reagents\n\n" +
  "- Resuspension buffer (P1) with RNase A\n" +
  "- Lysis buffer (P2): 0.2 M NaOH, 1% SDS\n" +
  "- Neutralization buffer (P3): 3 M KOAc pH 5.5\n" +
  "- 70% ethanol, ice cold\n\n" +
  "## Steps\n\n" +
  "1. Spin 1.5 mL overnight culture at 13,000 rpm, 1 min. Decant.\n" +
  "2. Resuspend pellet in 250 µL P1, vortex.\n" +
  "3. Add 250 µL P2, invert 6×, incubate 3 min RT.\n" +
  "4. Add 350 µL P3, invert 6×, spin 10 min at 13,000 rpm.\n" +
  "5. Transfer supernatant to spin column, wash with 70% EtOH, elute in 50 µL TE.\n\n" +
  "Expected yield for the demo strain library: 80–150 ng/µL.\n";

const METHOD_GROWTH_CURVE_MD =
  DEMO_BANNER_MD +
  "# [Demo protocol] Growth curve in 96-well\n\n" +
  "Reads OD600 every 15 min for 18 h to compare strain doubling times.\n\n" +
  "## Layout\n\n" +
  "- Rows A–D: wild-type `FakeYeast-001`, 4 biological replicates.\n" +
  "- Rows E–H: engineered `FY-Δgal80`, 4 biological replicates.\n" +
  "- Each row gets four glucose concentrations across columns 1–12.\n\n" +
  "## Steps\n\n" +
  "1. Inoculate overnight cultures in YPD; back-dilute to OD600 ~0.05.\n" +
  "2. Load 200 µL per well, cover with breathable seal.\n" +
  "3. Plate reader: 30 °C, double-orbital shaking, OD600 every 15 min, 18 h.\n" +
  "4. Export the kinetic dataset as CSV; the `Growth curve` template at `users/public` parses it directly.\n\n" +
  "## Common gotchas\n\n" +
  "- Use clear-bottom black-walled plates; edge wells dehydrate first, so leave A1 and H12 empty if you can.\n" +
  "- Subtract the well's t=0 reading before fitting doubling time.\n";

const METHOD_FLUO_SCREEN_MD =
  DEMO_BANNER_MD +
  "# [Demo protocol] Fluorescence screen (96-well)\n\n" +
  "Endpoint GFP read for screening `FY-Δgal80` transformants.\n\n" +
  "## Reader settings\n\n" +
  "- Excitation: 485 nm.\n" +
  "- Emission: 528 nm.\n" +
  "- Gain: 60 (adjust if positive control saturates).\n\n" +
  "## Layout\n\n" +
  "- Column 1: WT (no GFP)\n" +
  "- Column 12: positive control (pDEMO-fluo+)\n" +
  "- Columns 2–11: candidate transformants, one per well.\n\n" +
  "## Steps\n\n" +
  "1. Pick colonies into 200 µL SD-His + 2% galactose, grow 16 h at 30 °C.\n" +
  "2. Read OD600 *and* GFP.\n" +
  "3. Normalize per-well GFP by OD600, then divide by column-12 mean.\n" +
  "4. Anything ≥0.6× of the positive control is a hit.\n";

const METHOD_QPCR_MD =
  DEMO_BANNER_MD +
  "# [Demo protocol] qPCR setup\n\n" +
  "Two-step RT-qPCR for `fakeGFP` transcripts with ACT1 reference.\n\n" +
  "## Reagents\n\n" +
  "- SYBR Master Mix (2x)\n" +
  "- 10 µM `fakeGFP-fwd` / `fakeGFP-rev`\n" +
  "- 10 µM `ACT1-fwd` / `ACT1-rev`\n" +
  "- cDNA, diluted 1:5 in nuclease-free water\n\n" +
  "## Cycling\n\n" +
  "- 95 °C, 3 min initial denaturation\n" +
  "- 40 cycles: 95 °C 15 s → 60 °C 60 s (anneal + extend)\n" +
  "- Default melt-curve\n\n" +
  "## Layout\n\n" +
  "- Run targets and reference in adjacent wells per sample to keep block-position noise paired.\n" +
  "- Always include a no-RT control per template; if anything amplifies before cycle 35 the sample is contaminated.\n";

const METHOD_HEATSHOCK_MD =
  DEMO_BANNER_MD +
  "# [Demo protocol] Heat-shock survival assay\n\n" +
  "Plate-based survival measurement after a sub-lethal heat shock.\n\n" +
  "## Steps\n\n" +
  "1. Grow strains to OD600 ~0.6 in YPD.\n" +
  "2. Split each culture into two: one at 30 °C (control), one at 50 °C (heat shock), 30 min.\n" +
  "3. Serial dilute 10-fold five times.\n" +
  "4. Spot 5 µL of each dilution on YPD plates. Two technical replicates per condition.\n" +
  "5. Grow 48 h at 30 °C. Photograph plates; count colonies at the dilution with 10–100 colonies.\n\n" +
  "Survival = (CFU heat shock) / (CFU control) × 100%.\n";

// ─── Demo user onboarding sidecar ─────────────────────────────────────────────
//
// Each demo user (alex, morgan, mira) ships with a `_onboarding.json` that
// marks the v4 walkthrough as already completed. Without this, TourBootstrap
// treats demo users as fresh signups and auto-fires the welcome prompt the
// moment the user navigates anywhere outside the /demo URL gate (e.g. the
// help icon → /wiki → wiki layout falls through Providers' normal flow and
// mounts V4MountForUser). Setting wizard_completed_at short-circuits the
// bootstrap before any auto-start path runs.
//
// Date is anchored to mid-Jan 2026 so the rebase math (which shifts ALL
// dates forward by `today - BASE_DATE`) keeps it in the user's recent past
// regardless of when the demo is opened.
//
// SCHEMA_VERSION must stay in sync with lib/onboarding/sidecar.ts.
//
// demo fixture manager 2026-05-23: feature_picks is no longer null. The
// previous shape (null) predates Lab Head Phase 1 / 3 and meant that
// member-role users (alex, morgan) failed the lab-workspace gate
// `featurePicks?.account_type === "lab"`, hiding Lab Overview from the
// top-nav and the Settings > Lab Mode tab. The demo lab is a lab
// workspace by design, so every demo user is configured as a completed
// Phase 1 lab pick with the default tour answers (yes / full across
// the board, local storage). mira (lab_head) and alex/morgan (members)
// all clear the gate via the shared shape; sam gets the same picks for
// consistency even though he's archived and hidden from pickers anyway.
const DEMO_ONBOARDING_SIDECAR = {
  version: 5,
  first_seen_at: "2026-01-01T00:00:00.000Z",
  active_seconds: 0,
  feature_picks: {
    account_type: "lab",
    lab_storage: "local",
    purchases: "yes",
    calendar: "yes",
    goals: "yes",
    telegram: "yes",
    ai_helper: "full",
    links: "yes",
  },
  wizard_completed_at: "2026-01-15T12:00:00.000Z",
  wizard_skipped_at: null,
  wizard_force_show: false,
  wizard_resume_state: null,
  lab_tour_pending: false,
  lab_tour_dismissed_at: null,
  lab_mode_tour_choice: null,
  archived: false,
  archived_at: null,
  archived_by: null,
};

// ─── Build entries (single source of truth) ───────────────────────────────────

/**
 * @returns {Array<[string, unknown]>}  Path/content pairs. JSON values are
 * serialized at write time; raw strings (markdown bodies) are written verbatim.
 */
function buildEntries() {
  /** @type {Array<[string, unknown]>} */
  const out = [];

  // ── Demo marker ───────────────────────────────────────────────────────────
  // `last_rebased_at` anchors the demo's date axis. On boot the app
  // computes `today - last_rebased_at` and shifts every
  // task/goal/event/project/shared date forward by that many days, so
  // a stale demo lab (generated months ago) opens with fresh dates.
  // See `frontend/src/lib/demo/rebase.ts`.
  out.push([
    "_demo_marker.json",
    {
      is_demo: true,
      version: "1.0",
      lab_title: "Demo Synthetic Biology Lab",
      generated_at: "2026-05-13T00:00:00Z",
      last_rebased_at: TODAY,
      notice:
        "This folder is the ResearchOS demo lab. All projects, strains, and results are fabricated for tutorial purposes.",
    },
  ]);

  // ── Global / public / lab roots ───────────────────────────────────────────
  out.push(["users/_global_counters.json", {}]);
  out.push([
    "users/_user_metadata.json",
    {
      // `orcid` on alex powers the Deposit dialog's metadata-review step
      // (read via getUserMetadata in lib/deposit/prefill.ts). A checksum-
      // valid demo iD keeps the soft-validation icon green in the
      // deposit-metadata-review screenshot. Fictional, like everything here.
      alex: {
        color: ALEX_COLOR,
        created_at: "2026-01-15T00:00:00Z",
        orcid: "0000-0002-1825-0097",
      },
      morgan: { color: MORGAN_COLOR, created_at: "2026-01-20T00:00:00Z" },
      // Demo PI (Dr. Mira Castellanos) — the lab's principal investigator
      // archetype. Created earliest so the metadata mirrors a real lab
      // (PI predates trainees). She doesn't own her own projects/tasks/
      // notes in the demo fixture; her presence is the LabComment thread
      // showing PI-style oversight across alex + morgan's shared content.
      mira: { color: MIRA_COLOR, created_at: "2026-01-05T00:00:00Z" },
      // Lab Head Phase 6 (lab head Phase 6 manager, 2026-05-23): departed
      // postdoc Dr. Sam Whitley — predates alex/morgan, left for industry
      // mid-March 2026, archived by Mira shortly after. Showcases the
      // Lab Roster archive feature: hidden from the login picker by
      // default, surfaced via "Show archived"; absent from the @mention
      // / share / assignee pickers; his 2 historical comments below
      // continue to render with gray missing-user fallback.
      sam: { color: SAM_COLOR, created_at: "2025-09-01T00:00:00Z" },
      // Check-ins demo seed (checkins-demo bot, 2026-06-12): Remy Okafor, the
      // undergrad rotation student. Joined most recently (May 2026), the leaf
      // of the Mira -> Alex -> Remy mentorship tree. Minimal presence: a valid
      // lab member who appears in the roster and the tree, with no projects or
      // tasks of their own.
      remy: { color: REMY_COLOR, created_at: "2026-05-01T00:00:00Z" },
    },
  ]);

  // Public methods + PCR — cross-user resources
  out.push([
    "users/public/_counters.json",
    { methods: 2, pcr_protocols: 1 },
  ]);
  out.push([
    "users/public/methods/1.json",
    {
      id: 1,
      name: "[Demo protocol] Plasmid mini-prep",
      source_path: "users/public/methods/1.md",
      method_type: "markdown",
      folder_path: "DNA",
      parent_method_id: null,
      tags: ["DNA", "plasmid", "demo"],
      is_public: true,
      created_by: "alex",
      owner: "public",
      shared_with: [],
    },
  ]);
  out.push(["users/public/methods/1.md", METHOD_MINIPREP_MD]);

  // PCR-typed method entry surfacing the public DemoCheck PCR protocol in
  // the methods list. Without this, the pcr_protocols/1.json file exists
  // but no /methods row points at it — tasks can't attach the protocol
  // because method_attachments references method id+owner, not pcr_protocol
  // directly. The source_path uses the canonical pcr://protocol/{id}
  // convention from the upload UI in app/methods/page.tsx.
  out.push([
    "users/public/methods/2.json",
    {
      id: 2,
      name: "[Demo protocol] DemoCheck PCR — pYES integration",
      source_path: "pcr://protocol/1",
      method_type: "pcr",
      folder_path: "qPCR",
      parent_method_id: null,
      tags: ["PCR", "demo", "screen"],
      attachments: [],
      is_public: true,
      created_by: "alex",
      owner: "public",
      shared_with: [],
    },
  ]);

  out.push([
    "users/public/pcr_protocols/1.json",
    {
      id: 1,
      name: "[Demo protocol] DemoCheck PCR — pYES integration",
      gradient: {
        initial: [
          { name: "Initial denaturation", temperature: 98, duration: "30 sec" },
        ],
        cycles: [
          {
            repeats: 30,
            steps: [
              { name: "Denaturation", temperature: 98, duration: "10 sec" },
              { name: "Annealing", temperature: 58, duration: "30 sec" },
              { name: "Extension", temperature: 72, duration: "45 sec" },
            ],
          },
        ],
        final: [{ name: "Final extension", temperature: 72, duration: "5 min" }],
        hold: { name: "Hold", temperature: 12, duration: "Indef." },
      },
      ingredients: [
        { id: "i1", name: "5x HF Buffer", concentration: "5x", amount_per_reaction: "5.0" },
        { id: "i2", name: "dNTPs", concentration: "10 mM", amount_per_reaction: "0.5" },
        { id: "i3", name: "pYES-fwd", concentration: "10 µM", amount_per_reaction: "1.25" },
        { id: "i4", name: "pYES-rev", concentration: "10 µM", amount_per_reaction: "1.25" },
        { id: "i5", name: "Phusion polymerase", concentration: "2 U/µL", amount_per_reaction: "0.25" },
        { id: "i6", name: "gDNA template", concentration: "~50 ng/µL", amount_per_reaction: "1.0" },
        { id: "i7", name: "Nuclease-free H2O", concentration: "—", amount_per_reaction: "15.75" },
        { id: "i8", name: "Total", concentration: "", amount_per_reaction: "25.0" },
      ],
      notes:
        "Demo protocol — verifies integration of the `pYES-GAL1::flbA` cassette at the URA3 locus. Expected band: ~1.4 kb.",
      tags: ["demo", "screen"],
      is_public: true,
      created_by: "alex",
      owner: "public",
      shared_with: [],
    },
  ]);

  // Lab-wide funding accounts
  out.push([
    "users/lab/funding_accounts/1.json",
    {
      id: 1,
      name: "DEMO-NIH-GM999999",
      description: "Fake NIH grant for FakeYeast biofuel engineering.",
      total_budget: 80000,
      spent: 14250,
      remaining: 65750,
    },
  ]);
  out.push([
    "users/lab/funding_accounts/2.json",
    {
      id: 2,
      name: "DEMO-DOE-EERE",
      description: "Fake DOE bioenergy supplement.",
      total_budget: 25000,
      spent: 5310,
      remaining: 19690,
    },
  ]);
  out.push([
    "users/lab/funding_accounts/3.json",
    {
      id: 3,
      name: "DEMO-Internal-Bridge",
      description: "Demo internal bridge funds for consumables.",
      total_budget: 5000,
      spent: 980,
      remaining: 4020,
    },
  ]);
  out.push(["users/lab/_counters.json", { funding_accounts: 3 }]);

  // ── User: alex ────────────────────────────────────────────────────────────
  out.push([
    "users/alex/_counters.json",
    {
      projects: 4,
      tasks: 30,
      // Methods Expansion v2 Phase 0b: counter advanced to 12 so the
      // compound-method fixture (id 12) lives above the Phase-1-reserved
      // id range (9 = coding workflows, 10 = mass spec, 11 = qPCR
      // analysis — see proposal §6.2 pre-assigned id ranges).
      methods: 12,
      events: 4,
      // 3rd goal added below so the lab-mode-roadmaps tour step (Phase 2c)
      // shows a personal-goal example (project_id: null) alongside the two
      // project-bound ones.
      goals: 3,
      pcr_protocols: 1,
      lc_gradients: 1,
      plate_layouts: 1,
      cell_culture_schedules: 1,
      // Methods Expansion v2 Phase 1b: alex's mass spec fixture lives at
      // protocol id 1 (see users/alex/mass_spec_methods/1.json below).
      // The parallel Method row is id 10 per proposal §6.2.
      mass_spec_methods: 1,
      // Methods Expansion v2 Phase 1a: alex's coding workflow fixture
      // lives at protocol id 1 (see users/alex/coding_workflows/1.json
      // below). The parallel Method row is id 9 per proposal §6.2.
      coding_workflows: 1,
      // Methods Expansion v2 Phase 1c: alex's qPCR analysis fixture lives
      // at protocol id 1 (see users/alex/qpcr_analyses/1.json below).
      // The parallel Method row is id 11 per proposal §6.2.
      qpcr_analyses: 1,
      purchase_items: 20,
      lab_links: 6,
      // Notes bumped to 7 for the Lab Mode notes-tab fixture (Onboarding v4
      // Phase 2c). 5 new shared notes added below so the lab-mode-notes tour
      // step has realistic content to walk through. Mix: meeting notes,
      // running logs, and lab-recipe-style single-shot notes.
      notes: 7,
      dependencies: 8,
      // 1:1 revamp (notes-revamp bot, 2026-06-07): 1 weekly goal seeded below
      // for the mira<->alex 1:1 (alex adds his own goal to the shared list).
      weekly_goals: 1,
      // Inventory fixture (behind INVENTORY_ENABLED). alex owns the demo
      // storage tree + 7 catalog items / 8 stocks. Counters set to the max
      // seeded id so a new create in the demo does not collide.
      inventory_items: 7,
      inventory_stocks: 8,
      storage_nodes: 3,
      // Cloning-demo substrates (ids 1-9). The /demo + ?wikiCapture=1
      // Cloning Workspace heroes (restriction, Gibson, Golden Gate,
      // Gateway) read these .gb/.meta.json files. Counter set to the max
      // seeded id so a new create in the demo does not collide. Restored
      // 2026-06-07 (HR) after a generator regen dropped the hand-added
      // fixture sequences — they now live in buildEntries() below.
      sequences: 9,
      // Data Hub demo workbooks (ids 1-3) and Chemistry molecules (ids 1-4),
      // seeded so /datahub and /chemistry are populated in demo mode. The
      // counters are set to each store's max seeded id so a create in the
      // demo does not collide. The binary .loro snapshots + the computed
      // analysis mirrors are NOT emitted by this .mjs (they need the TS Loro
      // doc + analysis engine); they are generated by the re-runnable vitest
      // seed at src/lib/datahub/__seed__/seed-datahub-demo.test.ts (run with
      // SEED_DEMO=1) and committed alongside the static fixture entries below.
      datahub: 3,
      molecules: 4,
    },
  ]);
  out.push([
    "users/alex/settings.json",
    {
      // Display name surfaces as the creator on the Deposit dialog's
      // metadata-review step (resolveOwnerDisplayName in lib/deposit/prefill.ts),
      // falling back to the username when absent. Fictional demo name.
      displayName: "Alex Rivera",
      animationType: "celebration",
      defaultGanttViewMode: "3-months",
      defaultCalendarViewMode: "month",
      showSharedByDefault: true,
      visibleTabs: [
        "/experiments",
        "/gantt",
        "/methods",
        "/purchases",
        "/results",
        "/calendar",
        "/search",
        "/links",
      ],
      defaultLandingTab: "/",
      sidebarShowTasks: true,
      sidebarShowCalendarEvents: true,
      sidebarEventsHorizonDays: 7,
      coloredHeader: false,
      // Lab Head Phase 1 (lab head Phase 1 manager, 2026-05-23): alex is a
      // postdoc, not the PI — explicit `member` so the demo's PI/member
      // contrast is visible side-by-side with mira's `lab_head`. The
      // normalize() pass in user-settings.ts defaults missing values to
      // `member` so this is equivalent to omitting the field, but
      // emitting it explicitly makes the fixture self-documenting.
      account_type: "member",
    },
  ]);
  out.push(["users/alex/_onboarding.json", DEMO_ONBOARDING_SIDECAR]);
  // Alex receives one shared task and one shared project from morgan.
  // This unlocks the receiver-side fixture coverage for shared sharing
  // surfaces (hide-Share-button on receiver, listByProject threading for
  // shared projects, fetchAllTasksIncludingShared shared-project path).
  out.push([
    "users/alex/_shared_with_me.json",
    {
      version: 1,
      projects: [
        { id: 1, owner: "morgan", permission: "view", shared_at: "2026-05-12T00:00:00Z" },
      ],
      tasks: [
        { id: 3, owner: "morgan", permission: "edit", shared_at: "2026-05-16T00:00:00Z" },
        // Workbench Lists-tab fixture: a recently-done list task shared by
        // morgan that lands in alex's "Recently done" section with the
        // SharedFromPill amber chip.
        { id: 9, owner: "morgan", permission: "view", shared_at: "2026-05-08T00:00:00Z" },
      ],
      methods: [],
    },
  ]);

  // Projects
  out.push(...projects("alex", [
    { id: 1, name: "DEMO: Engineer FakeYeast for biofuel", color: "#3b82f6", tags: ["demo", "strains"], sort_order: 0, funding_account_id: 1 },
    { id: 2, name: "DEMO: Plasmid library construction", color: "#8b5cf6", tags: ["demo", "cloning"], sort_order: 1 },
    { id: 3, name: "DEMO: Stress tolerance screening", color: "#f59e0b", tags: ["demo", "screening"], sort_order: 2 },
    { id: 4, name: "DEMO: Lab admin & onboarding", color: "#ec4899", tags: ["demo", "admin"], sort_order: 3 },
  ]));

  // Tasks for alex
  out.push(...tasks("alex", [
    { id: 1, project_id: 1, name: "Design pYES-GAL1::flbA construct", start_date: LAST_WEEK, duration_days: 1, end_date: LAST_WEEK, task_type: "list", is_complete: true,
      sub_tasks: [
        { id: "st1", text: "Pull flbA CDS from FakeYeast genome", is_complete: true },
        { id: "st2", text: "Design Gibson overlaps for pYES2", is_complete: true },
        { id: "st3", text: "Order gBlocks", is_complete: true },
        { id: "st4", text: "Run IDT codon optimizer on flbA ORF", is_complete: true },
      ] },
    { id: 2, project_id: 1, name: "Yeast transformation: pYES-GAL1::flbA", start_date: "2026-05-08", duration_days: 1, end_date: "2026-05-08", task_type: "experiment", is_complete: true, experiment_color: "#3b82f6",
      sub_tasks: [
        { id: "st1", text: "Grow overnight FakeYeast-001 culture", is_complete: true },
        { id: "st2", text: "Prep PEG/LiAc mix fresh", is_complete: true },
        { id: "st3", text: "Heat shock 40 min @ 42°C", is_complete: true },
        { id: "st4", text: "Plate on SD-Ura", is_complete: true },
      ],
      deviation_log: "Demo: heat-shock ran 38 min instead of 40 (interrupted by timer reset). Noted for the colony count.",
      method_attachments: [{ method_id: 1, owner: "alex", snapshot_at: "2026-05-08T09:00:00Z" }] },
    { id: 3, project_id: 1, name: "Patch positives on SD-Ura", start_date: "2026-05-11", duration_days: 1, end_date: "2026-05-11", task_type: "experiment", is_complete: true, experiment_color: "#3b82f6",
      sub_tasks: [
        { id: "st1", text: "Pick 8 well-isolated colonies from primary plate", is_complete: true },
        { id: "st2", text: "Streak onto fresh SD-Ura grid plate", is_complete: true },
        { id: "st3", text: "Incubate 30 °C, 48 h", is_complete: true },
        { id: "st4", text: "Photograph patch plate", is_complete: true },
      ] },
    { id: 4, project_id: 1, name: "Genomic DNA prep — top 8 transformants", start_date: YESTERDAY, duration_days: 1, end_date: YESTERDAY, task_type: "experiment", is_complete: true, experiment_color: "#3b82f6",
      sub_tasks: [
        { id: "st1", text: "Resuspend cells in 200 µL lysis buffer", is_complete: true },
        { id: "st2", text: "Add glass beads + bead-beat 5 min", is_complete: true },
        { id: "st3", text: "Phenol-chloroform extract + EtOH precipitate", is_complete: true },
        { id: "st4", text: "Nanodrop quant — confirm A260/280 ≥ 1.8", is_complete: true },
      ] },
    // Completed today — has both a results.md write-up and a gel image,
    // so the outcome gallery renders it in the "Fresh results" section
    // with a hero thumbnail.
    { id: 5, project_id: 1, name: "PCR-screen integrants", start_date: TODAY, duration_days: 1, end_date: TODAY, task_type: "experiment", is_complete: true, experiment_color: "#3b82f6",
      sub_tasks: [
        { id: "st1", text: "Run DemoCheck PCR — 16 rxns", is_complete: true },
        { id: "st2", text: "Pour 1% agarose gel", is_complete: true },
        { id: "st3", text: "Photograph + annotate gel", is_complete: true },
      ],
      method_attachments: [{ method_id: 2, owner: "public", snapshot_at: "2026-05-13T07:00:00Z" }],
      comments: [
        // Lab Head Phase 2 (lab head Phase 2 manager, 2026-05-23): @-mention
        // demo — mira loops alex into the lead-candidate decision.
        { id: "cmt-mira-alex-t5-1", author: "mira", text: "75% integration is solid for a LiAc transformation, @alex — and the gel bands look clean by eye. Pick T1 and T6 as the lead candidates for the qPCR follow-up; both have the strongest signal in the screen.", created_at: "2026-05-13T16:40:00Z", mentions: ["alex"] },
        // Lab Head Phase 2: reply thread anchored at the root comment.
        // Alex acks the call and morgan chimes in to confirm the qPCR
        // primer pair lines up. Two replies under one root exercises both
        // the threading renderer + the "1 level deep" cap.
        { id: "cmt-alex-reply-t5-1", author: "alex", text: "Acknowledged — running the qPCR on T1 and T6 tomorrow morning.", created_at: "2026-05-13T17:05:00Z", parent_id: "cmt-mira-alex-t5-1" },
        { id: "cmt-morgan-reply-t5-1", author: "morgan", text: "I'll have the ACT1 primer aliquot ready on the bench so you don't have to thaw a fresh tube.", created_at: "2026-05-13T17:42:00Z", parent_id: "cmt-mira-alex-t5-1" },
      ] },
    { id: 6, project_id: 1, name: "Send sequencing — top 4", start_date: TOMORROW, duration_days: 1, end_date: TOMORROW, task_type: "list", is_complete: false,
      sub_tasks: [
        { id: "st1", text: "Mini-prep top 4 candidate colonies", is_complete: true },
        { id: "st2", text: "NanoDrop concentrations, log >100 ng/uL", is_complete: true },
        { id: "st3", text: "Fill out Genewiz sample sheet - primer pYES-F + pYES-R", is_complete: true },
        { id: "st4", text: "Drop off samples at sequencing dropbox before 4pm", is_complete: false },
        { id: "st5", text: "Pull chromatograms + run SnapGene alignment", is_complete: false },
      ] },
    { id: 7, project_id: 2, name: "Order DemoStrain ΔADE2 reagents", start_date: LAST_WEEK, duration_days: 1, end_date: LAST_WEEK, task_type: "purchase", is_complete: true },
    // Completed 4 days ago but no results.md write-up and no images on
    // disk yet — populates the "Awaiting results" fixture for the outcome
    // gallery (and the future Workbench's "Awaiting writeup" section).
    // results.md is intentionally an empty file (created, not missing) —
    // a real lab user would `touch results.md` before forgetting to write
    // it up. See the alex/results/task-8/results.md entry below.
    { id: 8, project_id: 2, name: "Mini-prep candidate plasmids", start_date: "2026-05-09", duration_days: 1, end_date: "2026-05-09", task_type: "experiment", is_complete: true, experiment_color: "#8b5cf6" },
    { id: 9, project_id: 2, name: "Build pDEMO-fluo plasmid library", start_date: NEXT_WEEK, duration_days: 4, end_date: "2026-05-23", task_type: "experiment", is_complete: false, experiment_color: "#8b5cf6" },
    // Workbench "Running" fixture: spans yesterday → tomorrow so today
    // falls inside [start, end] regardless of when the demo opens (rebase
    // shifts both anchors by the same delta). 3-day growth curve, currently
    // on Day 2 of 3.
    { id: 10, project_id: 3, name: "Set up growth curves in YPD/glucose", start_date: YESTERDAY, duration_days: 3, end_date: TOMORROW, task_type: "experiment", is_complete: false, experiment_color: "#f59e0b",
      method_attachments: [
        { method_id: 2, owner: "alex", snapshot_at: "2026-05-13T08:00:00Z" },
        // Attach the LC gradient method so the LcMethodTabContent path is
        // exercised in fixture mode (Phase 1a live-smoke chip). The PCR
        // demo at task 5 already covers PcrMethodTabContent.
        { method_id: 6, owner: "alex", snapshot_at: "2026-05-13T08:00:00Z" },
        // Plate-layout method — drives PlateMethodTabContent in fixture
        // mode (Methods Expansion Phase 2C). 96-well bacterial growth curve.
        { method_id: 7, owner: "alex", snapshot_at: "2026-05-13T08:00:00Z" },
        // Phase 2D: cell culture passaging schedule attached so the
        // CellCultureMethodTabContent path renders in fixture mode. The
        // pre-seeded actual_events snapshot below demonstrates the
        // "Modified from source" diff chip + actual-events log surface.
        {
          method_id: 8,
          owner: "alex",
          snapshot_at: "2026-05-13T08:00:00Z",
          cell_culture_schedule: JSON.stringify({
            planned_events: [
              { day_offset: 0, event_type: "observe", notes: "Seed plate; record initial confluence" },
              { day_offset: 2, event_type: "feed" },
              { day_offset: 4, event_type: "feed" },
              { day_offset: 6, event_type: "observe", notes: "Check confluence before split" },
              { day_offset: 7, event_type: "split", split_ratio: "1:5" },
            ],
            actual_events: [
              {
                timestamp: "2026-05-11T09:15:00Z",
                event_type: "observe",
                observation_text: "Plated 5e5 cells per dish. Confluence ~30% post-attachment.",
                confluence_percent: 30,
              },
              {
                timestamp: "2026-05-13T09:00:00Z",
                event_type: "feed",
                observation_text: "Cells looking healthy, ~70% confluent.",
                confluence_percent: 70,
              },
            ],
          }),
        },
        // Methods Expansion v2 Phase 0b: compound method "Growth-curve
        // full kit" bundling alex's 96-well plate (id 7) + the growth-
        // curve markdown protocol (id 2). Demonstrates a kit that pairs
        // a structured plate template with reusable prose instructions.
        { method_id: 12, owner: "alex", snapshot_at: "2026-05-13T08:00:00Z" },
        // Methods Expansion v2 Phase 1b: mass spec method attached so the
        // MassSpecMethodTabContent path renders in fixture mode. Pairs with
        // the LC gradient (method id 6) above to demonstrate the LC-MS
        // workflow story per proposal §4.6 (LC-MS = LC + MS via compound).
        { method_id: 10, owner: "alex", snapshot_at: "2026-05-13T08:00:00Z" },
        // Methods Expansion v2 Phase 1a: coding workflow attached so the
        // CodingWorkflowMethodTabContent path renders in fixture mode.
        // Static reference template per Q-B4 lock — no per-task snapshot
        // field, the tab content simply reads the source protocol.
        { method_id: 9, owner: "alex", snapshot_at: "2026-05-13T08:00:00Z" },
      ],
      comments: [
        // Lab Head Phase 2: @-mention demo — mira pings alex by name and
        // tags morgan as the cross-check on the writeup.
        { id: "cmt-mira-alex-t10-1", author: "mira", text: "@alex — are you logging the condensation event in the task deviation log too, not just the running-log note? I want a paper trail in case the 4% glucose plateau looks weird in the writeup later. @morgan, can you double-check this on Friday?", created_at: "2026-05-13T11:20:00Z", mentions: ["alex", "morgan"] },
      ] },
    { id: 11, project_id: 3, name: "Heat-shock survival assay", start_date: "2026-05-18", duration_days: 1, end_date: "2026-05-18", task_type: "experiment", is_complete: false, experiment_color: "#f59e0b",
      sub_tasks: [
        { id: "st1", text: "Grow strains to OD600 ~0.6 in YPD", is_complete: false },
        { id: "st2", text: "Split cultures: 30 °C control vs 50 °C heat shock (30 min)", is_complete: false },
        { id: "st3", text: "Serial dilute 10-fold × 5", is_complete: false },
        { id: "st4", text: "Spot on YPD plates, incubate 48 h", is_complete: false },
        { id: "st5", text: "Count colonies + compute survival %", is_complete: false },
      ],
      method_attachments: [{ method_id: 4, owner: "alex", snapshot_at: "2026-05-13T08:00:00Z" }] },
    { id: 12, project_id: 3, name: "Compile growth-curve results", start_date: "2026-05-19", duration_days: 1, end_date: "2026-05-19", task_type: "list", is_complete: false,
      sub_tasks: [
        { id: "st1", text: "Export plate reader CSVs from Tuesday + Thursday runs", is_complete: false },
        { id: "st2", text: "Subtract YPD blank wells in pandas", is_complete: false },
        { id: "st3", text: "Fit logistic growth + extract doubling times", is_complete: false },
        { id: "st4", text: "Send rough OD600 plot to morgan for sanity check", is_complete: false },
      ] },
    // Strategically-overdue: started a week ago, kept slipping. Stays
    // 6 days overdue regardless of when the demo is opened (see
    // OVERDUE_* anchors). Demonstrates the overdue UI state to users.
    { id: 13, project_id: 4, name: "Update lab onboarding doc", start_date: OVERDUE_START, duration_days: 2, end_date: OVERDUE_END_6D, task_type: "list", is_complete: false,
      sub_tasks: [
        { id: "st1", text: "Refresh the autoclave SOP - new run-time defaults", is_complete: true },
        { id: "st2", text: "Add waste stream diagram for the −80 freezer area", is_complete: true },
        { id: "st3", text: "Rewrite the pipette calibration section", is_complete: false },
        { id: "st4", text: "Add ResearchOS quick-start screenshots", is_complete: false },
        { id: "st5", text: "Ask morgan to proof the imaging room walkthrough", is_complete: false },
      ] },
    // alex's task 14 is HOSTED into morgan's dissertation project (Option
    // C / cross-owner sharing). Both sides — `external_project` here and
    // `users/morgan/projects/2-hosted.json` below — must agree or the
    // read-time normalizer drops the orphan entry.
    //
    // Workbench Lists-tab "Doing" fixture: spans yesterday → tomorrow so
    // today falls inside [start, end] regardless of when the demo opens
    // (rebase shifts both anchors by the same delta). 1/3 sub-tasks done
    // exercises the partial-progress dot-cell visual.
    { id: 14, project_id: 4, name: "Review morgan's draft figures", start_date: YESTERDAY, duration_days: 3, end_date: TOMORROW, task_type: "list", is_complete: false, external_project: { owner: "morgan", id: 2, sharedAt: "2026-05-13T16:00:00Z" },
      sub_tasks: [
        { id: "st1", text: "Read intro + methods sections", is_complete: true },
        { id: "st2", text: "Annotate figures 1–3 with margin comments", is_complete: false },
        { id: "st3", text: "Cross-check stats - n values + error bar definitions", is_complete: true },
        { id: "st4", text: "Flag any panels that need re-rendering at 300dpi", is_complete: false },
        { id: "st5", text: "Send consolidated feedback to morgan", is_complete: false },
      ] },
    { id: 15, project_id: 4, name: "Order LC-MS solvents", start_date: TODAY, duration_days: 1, end_date: TODAY, task_type: "purchase", is_complete: false },
    // Workbench "Ready" fixture: an experiment that kept slipping while the
    // main integration chain ran. Pre-rebase start is BASE-2, so the rebase
    // math keeps it ~2 days overdue regardless of when the demo opens.
    { id: 16, project_id: 1, name: "Re-streak top 4 transformants to single colonies", start_date: "2026-05-11", duration_days: 1, end_date: "2026-05-11", task_type: "experiment", is_complete: false, experiment_color: "#3b82f6" },
    // Workbench "Earlier results" fixture: completed experiments more than
    // 30 days ago across multiple projects, so the Earlier section's flat
    // and By-project layouts both have multi-project content. Anchored at
    // historical dates that stay > 30 days old after rebase.
    { id: 17, project_id: 1, name: "Pilot transformation — strain choice", start_date: "2026-02-10", duration_days: 1, end_date: "2026-02-10", task_type: "experiment", is_complete: true, experiment_color: "#3b82f6",
      // Lab Head Phase 6 (lab head Phase 6 manager, 2026-05-23): historical
      // comment from sam (the departed postdoc archetype) made BEFORE
      // his archive date. Renders with gray missing-user fallback once
      // sam is archived — the comment renderer doesn't gate on archive
      // state, but the missing-user-lookup path catches departed
      // authors. Demonstrates that existing references stay intact
      // even after the author is hidden from new pickers.
      comments: [
        { id: "cmt-sam-alex-t17-1", author: "sam", text: "FakeYeast-001 vs FakeYeast-002 — pick 001. The mating-type stability is way better in our hands. I have a frozen stock at -80 box 3 row D.", created_at: "2026-02-09T14:20:00Z" },
        { id: "cmt-alex-reply-t17-1", author: "alex", text: "Thanks @sam — pulled the 001 aliquot this morning, growing the overnight now.", created_at: "2026-02-09T15:05:00Z", parent_id: "cmt-sam-alex-t17-1", mentions: ["sam"] },
      ] },
    { id: 18, project_id: 2, name: "Pilot Gibson assembly — backbone test", start_date: "2026-02-18", duration_days: 1, end_date: "2026-02-18", task_type: "experiment", is_complete: true, experiment_color: "#8b5cf6",
      // Lab Head Phase 6: second historical sam comment, on morgan's
      // project surface (the brief asked for sam comments on alex AND
      // morgan content). Placed on an alex-owned task that's shared
      // into morgan's Gibson workflow so both surfaces see it.
      comments: [
        { id: "cmt-sam-alex-t18-1", author: "sam", text: "If you're using NEB Gibson mix, warm it slowly on the bench — straight 50 °C out of -20 kills the polymerase activity. Lost a week to that one when I started.", created_at: "2026-02-17T11:30:00Z" },
      ] },
    { id: 19, project_id: 3, name: "Baseline growth profile in YPD", start_date: "2026-03-05", duration_days: 1, end_date: "2026-03-05", task_type: "experiment", is_complete: true, experiment_color: "#f59e0b" },
    // Workbench "Completed list tasks" fixture: a second completed list
    // task so the bottom accordion has more than one row to expand.
    { id: 20, project_id: 4, name: "Set up demo lab onboarding doc skeleton", start_date: "2026-02-01", duration_days: 1, end_date: "2026-02-01", task_type: "list", is_complete: true,
      sub_tasks: [
        { id: "st1", text: "Choose hosting (Notion vs internal wiki)", is_complete: true },
        { id: "st2", text: "Draft initial outline", is_complete: true },
        { id: "st3", text: "Stub out sections - bench, safety, IT, software", is_complete: true },
        { id: "st4", text: "Share read-only link with Lab Head for sign-off", is_complete: true },
      ] },
    // Workbench Lists-tab fixtures (chip: Lists-tab landing). Each one
    // populates a specific section of the new tab. Anchored at BASE_DATE
    // offsets so the section assignment stays stable after rebase.
    // ── Overdue (alex/21): a different overdue archetype than task 13
    //    (admin paperwork, ~2 days overdue, partially worked through).
    { id: 21, project_id: 4, name: "Send compliance paperwork — quarterly renewal", start_date: OVERDUE_START, duration_days: 4, end_date: OVERDUE_END_2D, task_type: "list", is_complete: false,
      sub_tasks: [
        { id: "st1", text: "Pull approval form template from compliance portal", is_complete: true },
        { id: "st2", text: "Update reagent list (added pYES2 + Gibson kit since last quarter)", is_complete: true },
        { id: "st3", text: "Get Lab Head signature", is_complete: false },
        { id: "st4", text: "Scan + upload signed PDF to compliance portal", is_complete: false },
        { id: "st5", text: "Submit to compliance office + log confirmation", is_complete: false },
      ] },
    // ── Scheduled later (alex/22): a list task that lives past the 14d
    //    Upcoming horizon, demonstrating the "+ N scheduled later" footer.
    { id: 22, project_id: 4, name: "Plan grant renewal milestone outline", start_date: SCHEDULED_LATER, duration_days: 3, end_date: SCHEDULED_LATER_END, task_type: "list", is_complete: false,
      sub_tasks: [
        { id: "st1", text: "Sketch aims 1–3", is_complete: false },
        { id: "st2", text: "Draft preliminary-data list", is_complete: false },
        { id: "st3", text: "Pull figures from FakeYeast biofuel project (Fig 2 + 4)", is_complete: false },
        { id: "st4", text: "Book 1hr with Lab Head to align on timeline", is_complete: false },
      ] },
    // ── Earlier (alex/23): completed > 30 days ago, lands in the
    //    collapsed-by-default Earlier accordion at the bottom of the panel.
    { id: 23, project_id: 4, name: "Lab orientation — onboard rotation student", start_date: EARLIER_DONE_ALEX, duration_days: 1, end_date: EARLIER_DONE_ALEX, task_type: "list", is_complete: true,
      sub_tasks: [
        { id: "st1", text: "Walk through bench safety + waste protocol", is_complete: true },
        { id: "st2", text: "Set up server account + lab notebook template", is_complete: true },
        { id: "st3", text: "Demo Gibson assembly on a throwaway construct", is_complete: true },
        { id: "st4", text: "Pair them with morgan for first imaging session", is_complete: true },
      ] },
    // ── /purchases dashboard fixtures (Chip B). Four historical purchase
    //    tasks span Nov 2025 → Apr 2026 so the new analytics dashboard
    //    has ~6 months of data to plot. Anchored at fixed historical dates
    //    (the rebase math shifts both ends by the same delta, so the
    //    Nov-to-now window stays consistent).
    { id: 24, project_id: 1, name: "Order Q4 transformation supplies", start_date: "2025-11-15", duration_days: 1, end_date: "2025-11-15", task_type: "purchase", is_complete: true },
    { id: 25, project_id: 2, name: "Order plasmid library construction kit", start_date: "2025-12-12", duration_days: 1, end_date: "2025-12-12", task_type: "purchase", is_complete: true },
    { id: 26, project_id: 3, name: "Order stress-tolerance assay reagents", start_date: "2026-02-05", duration_days: 1, end_date: "2026-02-05", task_type: "purchase", is_complete: true },
    { id: 27, project_id: 1, name: "Order Spring resupply — primers + buffers", start_date: "2026-04-20", duration_days: 1, end_date: "2026-04-20", task_type: "purchase", is_complete: false },
    // Workbench Lists-tab follow-up fixtures (PUSH_REPORT_2026-05-15 issue #3):
    // populate the Recently-done and Earlier sections so workbench-lists.png
    // shows all five stages. Anchored at fixed offsets from BASE_DATE so the
    // section assignment stays stable after rebase.
    // ── Recently done (alex/28): completed 4 days before BASE_DATE — lands in
    //    the Recently-done section (within the 30-day window).
    { id: 28, project_id: 4, name: "Wrap up Q4 lab safety review", start_date: "2026-05-07", duration_days: 1, end_date: "2026-05-09", task_type: "list", is_complete: true,
      sub_tasks: [
        { id: "st1", text: "Walk benches with safety officer", is_complete: true },
        { id: "st2", text: "File quarterly chemical inventory report", is_complete: true },
        { id: "st3", text: "Replace expired EtBr waste container", is_complete: true },
        { id: "st4", text: "Email summary to Lab Head + safety office", is_complete: true },
      ] },
    // ── Earlier (alex/29): completed > 30 days before BASE_DATE — gives the
    //    Earlier accordion a second alex row beside alex/20 + alex/23.
    { id: 29, project_id: 4, name: "Archive 2025 inventory log", start_date: "2026-03-10", duration_days: 1, end_date: "2026-03-10", task_type: "list", is_complete: true,
      sub_tasks: [
        { id: "st1", text: "Export 2025 reagent ledger from shared sheet", is_complete: true },
        { id: "st2", text: "Move CSV into lab archive folder", is_complete: true },
        { id: "st3", text: "Snapshot −80 freezer map (Dec 31 layout)", is_complete: true },
        { id: "st4", text: "Reset running tally for 2026", is_complete: true },
      ] },
    // PCR diff-display retrofit (Phase 2A) live-smoke fixture: alex-owned
    // PCR method attached to an alex task in project 1. Mirrors the LC
    // demo at task 10 (alex's private LC gradient via method 6) but for
    // PCR. Pairs with task 5 — which attaches the PUBLIC PCR method —
    // so the routing-fix chip can verify both code paths land on the
    // correct protocol (alex's private vs public, despite the id-2
    // collision between alex/methods/2 and public/methods/2).
    //
    // Anchored at TODAY so it lands inside the Workbench "Doing" /
    // experiment-page demo window regardless of when the demo opens.
    { id: 30, project_id: 1, name: "qPCR — fakeGFP expression vs control", start_date: TODAY, duration_days: 1, end_date: TODAY, task_type: "experiment", is_complete: false, experiment_color: "#3b82f6",
      sub_tasks: [
        { id: "st1", text: "Extract RNA from 6 colonies + DNase treat", is_complete: false },
        { id: "st2", text: "Reverse-transcribe to cDNA (1:5 dilution)", is_complete: false },
        { id: "st3", text: "Run qPCR — triplicates per colony", is_complete: false },
        { id: "st4", text: "ΔΔCt vs ACT1 reference, plot fold-change", is_complete: false },
      ],
      method_attachments: [
        { method_id: 5, owner: "alex", snapshot_at: TODAY + "T08:00:00Z" },
        // Methods Expansion v2 Phase 1: qPCR-analysis method attached so the
        // QpcrAnalysisMethodTabContent path is reachable in fixture mode.
        // Pre-seeded Cq readouts demonstrate the ΔΔCq fold-change table and
        // the bar-chart visualization without requiring user input.
        {
          method_id: 11,
          owner: "alex",
          snapshot_at: TODAY + "T08:00:00Z",
          qpcr_analysis: JSON.stringify({
            cqs: {
              "flbA-1": { cq: 24.3, notes: "induced, biological triplicate mean" },
              "ref-act1": { cq: 21.7, notes: "housekeeping baseline" },
            },
            notes: "Demo readouts — induced cultures show ~6× upregulation of flbA vs ACT1.",
          }),
        },
      ] },
  ]));

  // alex methods
  out.push(["users/alex/methods/1.json", methodJson("alex", 1, "[Demo protocol] Yeast transformation (LiAc)", "Strains")]);
  out.push(["users/alex/methods/1.md", METHOD_TRANSFORMATION_MD]);
  out.push(["users/alex/methods/2.json", methodJson("alex", 2, "[Demo protocol] Growth curve in 96-well", "Screening")]);
  out.push(["users/alex/methods/2.md", METHOD_GROWTH_CURVE_MD]);
  out.push(["users/alex/methods/3.json", methodJson("alex", 3, "[Demo protocol] Plasmid mini-prep (private fork)", "Cloning")]);
  out.push(["users/alex/methods/3.md", METHOD_MINIPREP_MD]);
  out.push(["users/alex/methods/4.json", methodJson("alex", 4, "[Demo protocol] Heat-shock survival assay", "Screening")]);
  out.push(["users/alex/methods/4.md", METHOD_HEATSHOCK_MD]);
  // PCR-typed method entry — surfaces the existing pcr_protocols/1.json in
  // the /methods list. Clicking opens the InteractiveGradientEditor view,
  // which is the only way to reach that code path in fixture mode.
  out.push([
    "users/alex/methods/5.json",
    {
      id: 5,
      name: "[Demo protocol] qPCR fakeGFP expression",
      source_path: "pcr://protocol/1",
      method_type: "pcr",
      folder_path: "qPCR",
      parent_method_id: null,
      tags: ["demo", "qPCR"],
      attachments: [],
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // LC-typed method entry surfacing alex's private LC gradient protocol in
  // the methods list. Clicking opens the LcViewer (recharts gradient chart +
  // step/column/ingredient editors) — the only way to reach that code path
  // in fixture mode. source_path uses the canonical lc_gradient://protocol/{id}
  // scheme from the methods upload UI in app/methods/page.tsx.
  out.push([
    "users/alex/methods/6.json",
    {
      id: 6,
      name: "[Demo protocol] Reverse-phase HPLC — flbA peptide quantification",
      source_path: "lc_gradient://protocol/1",
      method_type: "lc_gradient",
      folder_path: "LC-MS",
      parent_method_id: null,
      tags: ["demo", "LC-MS", "peptides"],
      attachments: [],
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // alex LC gradient (private). Realistic-but-fake reverse-phase HPLC for
  // peptide separation — 5%→95% acetonitrile + 0.1% formic acid over 25 min
  // at 0.3 mL/min on a 1.7 µm C18 column, 214 nm detection. The numbers are
  // plausible for a proteomics workflow targeting flbA cleavage products
  // (consistent with the wider DEMO: FakeYeast biofuel narrative).
  out.push([
    "users/alex/lc_gradients/1.json",
    {
      id: 1,
      name: "[Demo protocol] Reverse-phase HPLC — flbA peptide quantification",
      description:
        "Demo HPLC method — separates fake-flbA tryptic peptides on a C18 column. Expected retention for the target peptide: 12.4 min (demo number).",
      gradient_steps: [
        { time_min: 0, percent_a: 95, percent_b: 5, flow_ml_min: 0.3 },
        { time_min: 2, percent_a: 95, percent_b: 5, flow_ml_min: 0.3 },
        { time_min: 22, percent_a: 5, percent_b: 95, flow_ml_min: 0.3 },
        { time_min: 25, percent_a: 5, percent_b: 95, flow_ml_min: 0.3 },
        { time_min: 26, percent_a: 95, percent_b: 5, flow_ml_min: 0.3 },
        { time_min: 30, percent_a: 95, percent_b: 5, flow_ml_min: 0.3 },
      ],
      column: {
        manufacturer: "Waters",
        model: "ACQUITY UPLC BEH C18 (demo)",
        length_mm: 150,
        inner_diameter_mm: 2.1,
        particle_size_um: 1.7,
      },
      detection_wavelength_nm: 214,
      ingredients: [
        {
          id: "a",
          name: "Water + 0.1% formic acid",
          role: "solvent_a",
          concentration: "0.1% FA",
        },
        {
          id: "b",
          name: "Acetonitrile + 0.1% formic acid",
          role: "solvent_b",
          concentration: "0.1% FA",
        },
        {
          id: "fa",
          name: "Formic acid (LC-MS grade)",
          role: "additive",
          concentration: "neat",
          notes: "Spike both A and B to 0.1% (v/v).",
        },
      ],
      created_at: "2026-04-12T00:00:00Z",
      updated_at: "2026-04-12T00:00:00Z",
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // Plate-typed method entry surfacing alex's private plate layout in the
  // methods list. Clicking opens the PlateViewer (click-paint grid editor).
  // source_path uses the canonical plate://protocol/{id} scheme used
  // throughout the app (methods/page.tsx, MethodTabs.tsx).
  out.push([
    "users/alex/methods/7.json",
    {
      id: 7,
      name: "[Demo protocol] 96-well bacterial growth curve (DemoStrain inducer titration)",
      source_path: "plate://protocol/1",
      method_type: "plate",
      folder_path: "Screening",
      parent_method_id: null,
      tags: ["demo", "plate", "growth-curve"],
      attachments: [],
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // alex plate layout (private). Realistic-but-fake 96-well plate template
  // for a bacterial growth curve in YPD/glucose. Column 1 = blanks (media
  // only), columns 2-7 = inducer concentration series, columns 8-12 =
  // negative controls. The numbers are plausible for the wider DEMO:
  // FakeYeast biofuel narrative tied to task 10 (the growth-curve experiment
  // that this layout is attached to).
  out.push([
    "users/alex/plate_layouts/1.json",
    {
      id: 1,
      name: "[Demo protocol] 96-well bacterial growth curve (DemoStrain inducer titration)",
      description:
        "Demo plate template — DemoStrain ΔADE2 growth curve in YPD vs. fake-inducer concentration series. Column 1 = media blanks, columns 2-7 = sample wells (5 inducer concentrations + carrier control), columns 8-12 = negative controls.",
      plate_size: 96,
      region_labels: [
        // Column 1: media-only blanks
        { row_start: 0, row_end: 7, col_start: 0, col_end: 0, role: "blank", notes: "YPD media only (no cells)" },
        // Columns 2-7: sample wells (6 columns × 8 rows = 48 sample wells)
        { row_start: 0, row_end: 7, col_start: 1, col_end: 6, role: "sample", notes: "DemoStrain ΔADE2 + fake-inducer titration" },
        // Columns 8-12: negative controls (5 columns × 8 rows = 40 wells)
        { row_start: 0, row_end: 7, col_start: 7, col_end: 11, role: "control", notes: "Wild-type DemoStrain (no inducer)" },
      ],
      created_at: "2026-04-22T00:00:00Z",
      updated_at: "2026-04-22T00:00:00Z",
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // Cell-culture-typed method entry — Phase 2D. Clicking opens the
  // CellCultureViewer (planned schedule + media composition + cell line).
  // source_path uses the canonical cell_culture://protocol/{id} scheme.
  out.push([
    "users/alex/methods/8.json",
    {
      id: 8,
      name: "[Demo protocol] HeLa passaging — weekly 1:5 split",
      source_path: "cell_culture://protocol/1",
      method_type: "cell_culture",
      folder_path: "Cell culture",
      parent_method_id: null,
      tags: ["demo", "cell culture", "HeLa"],
      attachments: [],
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // Methods Expansion v2 Phase 1b: mass-spec-typed method surfacing alex's
  // private mass spec protocol (id 1) in the methods list. Clicking opens
  // the MassSpecViewer (smart-per-mode editor + calibration + scan params).
  // source_path uses the canonical mass_spec://protocol/{id} scheme.
  // Id 10 is reserved for mass spec in the proposal's pre-assigned id ranges
  // (Phase 1 chips: 9 coding workflows, 10 mass spec, 11 qPCR analysis).
  out.push([
    "users/alex/methods/10.json",
    {
      id: 10,
      name: "[Demo protocol] LC-MS detection — flbA peptides (ESI+ Q-Exactive)",
      source_path: "mass_spec://protocol/1",
      method_type: "mass_spec",
      folder_path: "LC-MS",
      parent_method_id: null,
      tags: ["demo", "LC-MS", "mass-spec", "peptides"],
      attachments: [],
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // alex mass spec method (private). Realistic-but-fake LC-MS detection
  // method matched to the LC gradient at id 6 — ESI+ on a Thermo Q-Exactive
  // HF-X-style instrument, scan 200-2000 m/z, MS/MS isolation 1.2 Da @ 27 eV
  // NCE, sodium formate calibration. Pairs naturally with the existing LC
  // gradient method to demonstrate the LC-MS composition story per
  // proposal §4.6 (LC-MS = LC + MS via the compound primitive).
  out.push([
    "users/alex/mass_spec_methods/1.json",
    {
      id: 1,
      name: "[Demo protocol] LC-MS detection — flbA peptides (ESI+ Q-Exactive)",
      description:
        "Demo LC-MS detection method paired with the alex LC gradient (method id 6). Targeted MS/MS for tryptic flbA peptides — retention window 10-16 min, scan range covers singly/doubly charged peptide ions.",
      ionization_mode: "esi_pos",
      ionization_label: null,
      instrument: "Thermo Q-Exactive HF-X (demo)",
      source: {
        source_temp_c: 250,
        capillary_kv: 3.5,
        nebulizer_gas_lpm: 1.2,
        drying_gas_lpm: 10,
        drying_gas_temp_c: 350,
        ei_energy_ev: null,
        maldi_laser_nm: null,
        maldi_laser_energy: null,
        maldi_matrix: null,
        other_notes: null,
      },
      scan: {
        scan_mz_low: 200,
        scan_mz_high: 2000,
        scan_rate_hz: 2,
        resolution_r: 60000,
        is_msms: true,
        msms_isolation_window_mz: 1.2,
        msms_collision_energy_ev: 27,
      },
      calibration: {
        reference_standard: "Sodium formate (demo)",
        calibration_date: "2026-05-01",
        expected_accuracy_ppm: 2,
        notes: "Calibration verified weekly; lock-mass on m/z 445.1200.",
      },
      created_at: "2026-05-02T00:00:00Z",
      updated_at: "2026-05-02T00:00:00Z",
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // Methods Expansion v2 Phase 1a: coding-workflow-typed method surfacing
  // alex's private growth-curve QC script in the methods list. Clicking
  // opens the CodingWorkflowViewer. source_path uses the canonical
  // coding_workflow://protocol/{id} scheme; the protocol record lives at
  // users/alex/coding_workflows/1.json below.
  out.push([
    "users/alex/methods/9.json",
    {
      id: 9,
      name: "[Demo protocol] Growth-curve QC analysis",
      source_path: "coding_workflow://protocol/1",
      method_type: "coding_workflow",
      folder_path: "Analysis",
      parent_method_id: null,
      tags: ["demo", "analysis", "python"],
      attachments: [],
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // Methods Expansion v2 Phase 1c: qPCR-analysis-typed method (id 11 per
  // proposal §6.2 pre-assigned id ranges). Surfaces the per-target Cq
  // readouts + ΔΔCq fold-change calculation on the experiment page; pairs
  // with the existing PCR method (id 5 = "qPCR fakeGFP expression") via a
  // future compound to give the full qPCR workflow.
  out.push([
    "users/alex/methods/11.json",
    {
      id: 11,
      name: "[Demo protocol] flbA expression vs control (ΔΔCq)",
      source_path: "qpcr_analysis://protocol/1",
      method_type: "qpcr_analysis",
      folder_path: "qPCR",
      parent_method_id: null,
      tags: ["demo", "qPCR", "ΔΔCq"],
      attachments: [],
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // alex coding workflow (private). Realistic-but-fake Python QC script —
  // loads OD600 readings from a plate reader CSV, fits an exponential
  // growth model, plots curves per well. The fake-inducer titration and
  // DemoStrain reference tie back to the wider DEMO: FakeYeast narrative
  // and to the 96-well plate fixture (alex methods id 7) attached to the
  // same task 10. external_path is a believable-looking path to demo the
  // "open in your editor" handoff; the path itself does not exist.
  out.push([
    "users/alex/coding_workflows/1.json",
    {
      id: 1,
      name: "[Demo protocol] Growth-curve QC analysis",
      description:
        "Demo script — loads the plate reader OD600 dump, fits exp. growth per well, and renders QC plots. Designed for the 96-well DemoStrain inducer titration (alex plate template id 7).",
      language: "python",
      language_label: null,
      embedded_code:
        "\"\"\"Demo growth-curve QC script.\n\nReads a plate reader CSV (one row per well, one column per timepoint)\nand fits an exponential growth model for the log-phase window.\n\"\"\"\nimport numpy as np\nimport pandas as pd\nimport matplotlib.pyplot as plt\n\n# --- Config ---\nINPUT_CSV = \"demo-strain-inducer-titration.csv\"  # exported from the plate reader\nLOG_PHASE_HOURS = (2.0, 6.0)\nBLANK_COLUMNS = [\"A1\"]  # see plate template (alex methods id 7)\n\n\ndef fit_exp_growth(times_h: np.ndarray, od: np.ndarray) -> float:\n    \"\"\"Linear fit on log(OD); returns specific growth rate (1/h).\"\"\"\n    mask = (times_h >= LOG_PHASE_HOURS[0]) & (times_h <= LOG_PHASE_HOURS[1])\n    slope, _ = np.polyfit(times_h[mask], np.log(od[mask]), 1)\n    return float(slope)\n\n\ndef main() -> None:\n    df = pd.read_csv(INPUT_CSV)\n    time_h = df[\"time_h\"].to_numpy()\n    blanks = df[BLANK_COLUMNS].mean(axis=1).to_numpy()\n\n    sample_cols = [c for c in df.columns if c not in (\"time_h\", *BLANK_COLUMNS)]\n    rates = {}\n    for well in sample_cols:\n        od_corrected = df[well].to_numpy() - blanks\n        rates[well] = fit_exp_growth(time_h, np.clip(od_corrected, 1e-3, None))\n\n    rates_series = pd.Series(rates).sort_values(ascending=False)\n    print(\"Top 8 wells by growth rate:\")\n    print(rates_series.head(8).to_string())\n\n    # Quick visual — log-OD vs time, all wells.\n    fig, ax = plt.subplots(figsize=(6, 4))\n    for well in sample_cols:\n        ax.plot(time_h, np.log(np.clip(df[well] - blanks, 1e-3, None)), alpha=0.4)\n    ax.set_xlabel(\"Time (h)\")\n    ax.set_ylabel(\"log(OD600 - blank)\")\n    ax.set_title(\"Demo growth curves\")\n    fig.tight_layout()\n    fig.savefig(\"growth-curves-qc.png\", dpi=150)\n\n\nif __name__ == \"__main__\":\n    main()\n",
      external_path: "analysis/growth-curve-qc.py",
      output_renderer: "syntax-highlight",
      created_at: "2026-04-29T00:00:00Z",
      updated_at: "2026-04-29T00:00:00Z",
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // alex qPCR analysis (private). Realistic-but-fake SYBR Green protocol
  // measuring fake-flbA expression in FakeYeast strains, with ACT1 as the
  // housekeeping reference for ΔΔCq fold-change. Standard curve omitted at
  // the template level (per-run efficiency calc is optional); melt curve
  // configured 60→95 °C @ 0.1 °C/sec. Per-task Cq readouts live on task 30's
  // attachment snapshot (seeded above) so the bar chart + fold-change table
  // render in fixture mode without user input.
  out.push([
    "users/alex/qpcr_analyses/1.json",
    {
      id: 1,
      name: "[Demo protocol] flbA expression vs control (ΔΔCq)",
      description:
        "Demo qPCR analysis — measures fake-flbA mRNA in induced vs uninduced FakeYeast cultures, normalized to ACT1 housekeeping. Pair with PCR method 5 (qPCR fakeGFP expression) via a compound for the full cycling + analysis kit.",
      chemistry: "sybr",
      chemistry_label: null,
      references: [
        { id: "flbA-1", target: "flbA", channel: "FAM", is_reference: false, expected_cq: 24 },
        { id: "ref-act1", target: "ACT1", channel: "FAM", is_reference: true, expected_cq: 22 },
      ],
      standard_curve: [],
      melt_curve: { start_c: 60, end_c: 95, ramp_rate_c_per_sec: 0.1 },
      use_delta_delta_cq: true,
      created_at: "2026-04-29T00:00:00Z",
      updated_at: "2026-04-29T00:00:00Z",
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // Methods Expansion v2 Phase 0b: compound-typed method bundling alex's
  // 96-well plate (id 7) + the growth-curve markdown protocol (id 2) into
  // one attachable kit. source_path is null per proposal §2.1.1 — compounds
  // carry their `components` array inline, with no parallel protocol record.
  // Id 12 is reserved for compound in the proposal's pre-assigned id ranges
  // (Phase 1 chips: 9 coding workflows, 10 mass spec, 11 qPCR analysis).
  out.push([
    "users/alex/methods/12.json",
    {
      id: 12,
      name: "[Demo kit] Yeast growth-curve full kit",
      source_path: null,
      method_type: "compound",
      folder_path: "Screening",
      parent_method_id: null,
      tags: ["demo", "compound", "growth-curve"],
      attachments: [],
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
      components: [
        {
          method_id: 7,
          owner: null,
          ordering: 0,
          label: "Plate layout (96-well DemoStrain titration)",
        },
        {
          method_id: 2,
          owner: null,
          ordering: 1,
          label: "Growth-curve protocol notes",
        },
      ],
    },
  ]);

  // alex cell culture passaging schedule (private). Realistic-but-fake HeLa
  // weekly passaging cadence — DMEM + 10% FBS + PenStrep/L-Gln, feed M/W,
  // observe before split, split 1:5 on day 7. Cell line metadata mirrors
  // ATCC's HeLa entry (CCL-2) without claiming any real reagent provenance.
  // This is the source-side template; the per-task snapshot on alex/task 10
  // overlays actual_events to demonstrate the diff display.
  out.push([
    "users/alex/cell_culture_schedules/1.json",
    {
      id: 1,
      name: "[Demo protocol] HeLa passaging — weekly 1:5 split",
      description:
        "Demo passaging schedule for HeLa cells. Feed every 2 days, observe day 6, split 1:5 on day 7. Mid-execution actual events logged per experiment.",
      cell_line: {
        name: "HeLa (demo)",
        species: "Homo sapiens",
        tissue: "Cervix (adenocarcinoma)",
        notes: "Demo strain — fake ATCC ref. Mycoplasma-negative.",
      },
      media: {
        base_medium: "DMEM (high glucose, 4.5 g/L)",
        serum_percent: 10,
        supplements: [
          { name: "PenStrep", concentration: "1", units: "%" },
          { name: "L-Glutamine", concentration: "2", units: "mM" },
        ],
      },
      planned_events: [
        { day_offset: 0, event_type: "observe", notes: "Seed plate; record initial confluence" },
        { day_offset: 2, event_type: "feed" },
        { day_offset: 4, event_type: "feed" },
        { day_offset: 6, event_type: "observe", notes: "Check confluence before split" },
        { day_offset: 7, event_type: "split", split_ratio: "1:5", notes: "Trypsinize, re-seed 1:5" },
      ],
      created_at: "2026-04-08T00:00:00Z",
      updated_at: "2026-04-08T00:00:00Z",
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // alex PCR (private)
  out.push([
    "users/alex/pcr_protocols/1.json",
    {
      id: 1,
      name: "[Demo protocol] qPCR fakeGFP expression",
      gradient: {
        initial: [{ name: "Initial denaturation", temperature: 95, duration: "3 min" }],
        cycles: [
          {
            repeats: 35,
            steps: [
              { name: "Denaturation", temperature: 95, duration: "15 sec" },
              { name: "Anneal/Extend", temperature: 60, duration: "60 sec" },
            ],
          },
        ],
        final: [],
        hold: null,
      },
      ingredients: [
        { id: "i1", name: "SYBR Master Mix (2x)", concentration: "2x", amount_per_reaction: "10" },
        { id: "i2", name: "fakeGFP-fwd", concentration: "10 µM", amount_per_reaction: "0.5" },
        { id: "i3", name: "fakeGFP-rev", concentration: "10 µM", amount_per_reaction: "0.5" },
        { id: "i4", name: "cDNA template (1:5)", concentration: "—", amount_per_reaction: "2" },
        { id: "i5", name: "Nuclease-free H2O", concentration: "—", amount_per_reaction: "7" },
        { id: "i6", name: "Total", concentration: "", amount_per_reaction: "20" },
      ],
      notes: "Demo qPCR — use ACT1 as housekeeping reference. Public version available at users/public.",
      tags: ["demo", "qPCR", "fakeGFP"],
      is_public: false,
      created_by: "alex",
      owner: "alex",
      shared_with: [],
    },
  ]);

  // alex events
  out.push(["users/alex/events/1.json", { id: 1, title: "Demo lab meeting — strain design review", event_type: "meeting", start_date: "2026-05-18", end_date: "2026-05-18", start_time: "11:00", end_time: "12:00", location: "Bio 4203 (demo)", url: null, notes: "Bring transformation gel images.", color: "#3b82f6" }]);
  out.push(["users/alex/events/2.json", { id: 2, title: "DEMO-DOE renewal abstract deadline", event_type: "deadline", start_date: "2026-05-29", end_date: "2026-05-29", start_time: null, end_time: null, location: null, url: null, notes: "Fake DOE grant renewal — demo task.", color: "#ef4444" }]);
  out.push(["users/alex/events/3.json", { id: 3, title: "Demo Synthetic Biology Conference 2026", event_type: "conference", start_date: "2026-06-15", end_date: "2026-06-17", start_time: null, end_time: null, location: "Demo Convention Center", url: "https://example.org/demo-sb-2026", notes: null, color: "#8b5cf6" }]);
  out.push(["users/alex/events/4.json", { id: 4, title: "1:1 with morgan", event_type: "meeting", start_date: TOMORROW, end_date: TOMORROW, start_time: "14:00", end_time: "14:30", location: "alex's office (demo)", url: null, notes: null, color: "#10b981" }]);

  // alex goals
  out.push(["users/alex/goals/1.json", { id: 1, project_id: 1, name: "DEMO: Publish FakeYeast biofuel paper", start_date: "2026-04-01", end_date: "2026-08-31", color: "#3b82f6",
    smart_goals: [
      { id: "sg1", text: "Verify pYES-GAL1::flbA integration", is_complete: true },
      { id: "sg2", text: "Demonstrate biofuel yield improvement", is_complete: false },
      { id: "sg3", text: "Draft methods + results", is_complete: false },
    ], is_complete: false, created_at: "2026-04-01T00:00:00Z" }]);
  out.push(["users/alex/goals/2.json", { id: 2, project_id: 2, name: "DEMO: Finish plasmid library", start_date: "2026-04-01", end_date: "2026-06-30", color: "#8b5cf6",
    smart_goals: [
      { id: "sg1", text: "10 candidate plasmids assembled", is_complete: false },
      { id: "sg2", text: "All sequenced + validated", is_complete: false },
    ], is_complete: false, created_at: "2026-04-01T00:00:00Z" }]);
  // Personal (project_id: null) goal so the lab-mode-roadmaps tour can
  // demo the "Personal" bucket alongside project-bound goals.
  out.push(["users/alex/goals/3.json", { id: 3, project_id: null, name: "DEMO: Submit DOE renewal abstract", start_date: "2026-05-01", end_date: "2026-05-29", color: "#ef4444",
    smart_goals: [
      { id: "sg1", text: "Outline + specific aims drafted", is_complete: true },
      { id: "sg2", text: "Preliminary data figures finalized", is_complete: true },
      { id: "sg3", text: "Internal review with co-PIs", is_complete: false },
      { id: "sg4", text: "Submit through demo portal", is_complete: false },
    ], is_complete: false, created_at: "2026-05-01T00:00:00Z" }]);

  // alex purchases (20 — Chip B fixture expansion).
  //
  // Distributed across 6 purchase tasks (7, 15, 24, 25, 26, 27) plus
  // one item on experiment task 11 — the latent-bug coverage from
  // PURCHASES_PAGE_PROPOSAL.md §5 ("items on non-purchase tasks").
  //
  // Vendor + category fields populated per Chip A (a1771a8b). A few
  // items leave one or both null so the dashboard's Uncategorized
  // affordances render. Distribution intentionally non-uniform so chart
  // shapes are interesting.
  //
  //   Vendor counts:    IDT=3 Sigma-Aldrich=6 NEB=3 Thermo=4 Internal=1 null=3
  //   Category counts:  Reagents=11 Plasticware=3 Consumables=4 Service=1 null=1
  //   Funding counts:   NIH=8 DOE=5 Internal-Bridge=4 null=3
  out.push(["users/alex/purchase_items/1.json", { id: 1, task_id: 7, item_name: "DemoStrain ΔADE2 (fake yeast collection)", quantity: 1, link: "https://example.org/demo-strain-catalog", cas: null, price_per_unit: 220, shipping_fees: 25, total_price: 245, notes: "Demo strain — replaces nothing real.", funding_string: "DEMO-DOE-EERE", vendor: null, category: null }]);
  out.push(["users/alex/purchase_items/2.json", { id: 2, task_id: 7, item_name: "FakeYeast genotyping primers (IDT)", quantity: 4, link: "https://example.org/demo-idt", cas: null, price_per_unit: 14, shipping_fees: 5, total_price: 61, notes: null, funding_string: "DEMO-NIH-GM999999", vendor: "IDT", category: "Reagents" }]);
  out.push(["users/alex/purchase_items/3.json", { id: 3, task_id: 7, item_name: "Phusion polymerase (demo)", quantity: 1, link: "https://example.org/demo-neb", cas: null, price_per_unit: 285, shipping_fees: 0, total_price: 285, notes: "For DemoCheck PCR.", funding_string: "DEMO-NIH-GM999999", vendor: "NEB", category: "Reagents" }]);
  out.push(["users/alex/purchase_items/4.json", { id: 4, task_id: 15, item_name: "LC-MS grade acetonitrile (demo)", quantity: 2, link: "https://example.org/demo-sigma", cas: "75-05-8", price_per_unit: 95, shipping_fees: 10, total_price: 200, notes: "Demo solvent for fake-metabolite quantification.", funding_string: "DEMO-Internal-Bridge", vendor: "Sigma-Aldrich", category: "Reagents" }]);
  // Task 24 — Q4 transformation supplies (2025-11-15)
  out.push(["users/alex/purchase_items/5.json", { id: 5, task_id: 24, item_name: "SD-Ura selection plates (pre-poured, sleeve of 20)", quantity: 5, link: null, cas: null, price_per_unit: 40, shipping_fees: 0, total_price: 200, notes: "Demo internal media-prep order.", funding_string: "DEMO-NIH-GM999999", vendor: "Internal supply", category: "Plasticware" }]);
  out.push(["users/alex/purchase_items/6.json", { id: 6, task_id: 24, item_name: "Restriction enzyme set (BsmBI, EcoRI, NotI)", quantity: 1, link: "https://example.org/demo-neb", cas: null, price_per_unit: 295, shipping_fees: 20, total_price: 315, notes: null, funding_string: "DEMO-NIH-GM999999", vendor: "NEB", category: "Reagents" }]);
  out.push(["users/alex/purchase_items/7.json", { id: 7, task_id: 24, item_name: "pYES2 backbone vector (demo)", quantity: 1, link: null, cas: null, price_per_unit: 180, shipping_fees: 0, total_price: 180, notes: "Demo plasmid — fake catalog entry.", funding_string: "DEMO-NIH-GM999999", vendor: null, category: "Reagents" }]);
  // Task 25 — Plasmid library construction kit (2025-12-12)
  out.push(["users/alex/purchase_items/8.json", { id: 8, task_id: 25, item_name: "Gibson assembly master mix", quantity: 2, link: "https://example.org/demo-neb", cas: null, price_per_unit: 245, shipping_fees: 20, total_price: 510, notes: null, funding_string: "DEMO-NIH-GM999999", vendor: "NEB", category: "Reagents" }]);
  out.push(["users/alex/purchase_items/9.json", { id: 9, task_id: 25, item_name: "96-well PCR plates (skirted)", quantity: 5, link: "https://example.org/demo-thermo", cas: null, price_per_unit: 48, shipping_fees: 15, total_price: 255, notes: null, funding_string: "DEMO-DOE-EERE", vendor: "Thermo", category: "Plasticware" }]);
  out.push(["users/alex/purchase_items/10.json", { id: 10, task_id: 25, item_name: "Filter pipette tips (P200, racked)", quantity: 10, link: "https://example.org/demo-sigma", cas: null, price_per_unit: 32, shipping_fees: 0, total_price: 320, notes: null, funding_string: "DEMO-DOE-EERE", vendor: "Sigma-Aldrich", category: "Consumables" }]);
  // Task 26 — Stress-tolerance assay reagents (2026-02-05)
  out.push(["users/alex/purchase_items/11.json", { id: 11, task_id: 26, item_name: "Sorbitol (1 kg, biology-grade)", quantity: 2, link: "https://example.org/demo-sigma", cas: "50-70-4", price_per_unit: 58, shipping_fees: 0, total_price: 116, notes: "Osmotic stress assay reagent (demo).", funding_string: "DEMO-Internal-Bridge", vendor: "Sigma-Aldrich", category: "Reagents" }]);
  out.push(["users/alex/purchase_items/12.json", { id: 12, task_id: 26, item_name: "NaCl (1 kg, ACS-grade)", quantity: 1, link: "https://example.org/demo-sigma", cas: "7647-14-5", price_per_unit: 32, shipping_fees: 0, total_price: 32, notes: null, funding_string: "DEMO-Internal-Bridge", vendor: "Sigma-Aldrich", category: "Reagents" }]);
  out.push(["users/alex/purchase_items/13.json", { id: 13, task_id: 26, item_name: "384-well clear-bottom assay plates", quantity: 4, link: "https://example.org/demo-thermo", cas: null, price_per_unit: 76, shipping_fees: 12, total_price: 316, notes: null, funding_string: "DEMO-DOE-EERE", vendor: "Thermo", category: "Plasticware" }]);
  out.push(["users/alex/purchase_items/14.json", { id: 14, task_id: 26, item_name: "gBlocks for stress-response reporters (8 fragments)", quantity: 8, link: "https://example.org/demo-idt", cas: null, price_per_unit: 32, shipping_fees: 0, total_price: 256, notes: null, funding_string: "DEMO-NIH-GM999999", vendor: "IDT", category: "Reagents" }]);
  // Task 27 — Spring resupply, primers + buffers (active, 2026-04-20)
  out.push(["users/alex/purchase_items/15.json", { id: 15, task_id: 27, item_name: "Sequencing-screen primer set (pYES f/r + 4 internal)", quantity: 6, link: "https://example.org/demo-idt", cas: null, price_per_unit: 14, shipping_fees: 5, total_price: 89, notes: null, funding_string: "DEMO-NIH-GM999999", vendor: "IDT", category: "Reagents" }]);
  out.push(["users/alex/purchase_items/16.json", { id: 16, task_id: 27, item_name: "T7 RNA polymerase (demo)", quantity: 1, link: "https://example.org/demo-thermo", cas: null, price_per_unit: 172, shipping_fees: 0, total_price: 172, notes: null, funding_string: "DEMO-DOE-EERE", vendor: "Thermo", category: "Reagents" }]);
  out.push(["users/alex/purchase_items/17.json", { id: 17, task_id: 27, item_name: "50 mL conical tubes (sleeve)", quantity: 4, link: "https://example.org/demo-sigma", cas: null, price_per_unit: 24, shipping_fees: 0, total_price: 96, notes: null, funding_string: "DEMO-Internal-Bridge", vendor: "Sigma-Aldrich", category: "Consumables" }]);
  // Task 15 (existing — Order LC-MS solvents) — two more items.
  // funding_string null = uncategorized tail (proposal §7 + §4 dashboard).
  out.push(["users/alex/purchase_items/18.json", { id: 18, task_id: 15, item_name: "LC-MS column hardware service kit", quantity: 1, link: "https://example.org/demo-thermo", cas: null, price_per_unit: 450, shipping_fees: 25, total_price: 475, notes: "Awaiting Lab Head sign-off on funding source.", funding_string: null, vendor: "Thermo", category: "Service" }]);
  out.push(["users/alex/purchase_items/19.json", { id: 19, task_id: 15, item_name: "Solvent waste disposal bottles (4 L)", quantity: 6, link: "https://example.org/demo-sigma", cas: null, price_per_unit: 18, shipping_fees: 0, total_price: 108, notes: null, funding_string: null, vendor: "Sigma-Aldrich", category: "Consumables" }]);
  // Item 20 hangs off experiment task 11 ("Heat-shock survival assay")
  // — exercises the §5 latent-bug surface ("items on non-purchase tasks")
  // for the dashboard's Uncategorized panel, complementing morgan's
  // existing items 1+2 on her experiment tasks.
  out.push(["users/alex/purchase_items/20.json", { id: 20, task_id: 11, item_name: "Pipette tip refills (P1000)", quantity: 2, link: null, cas: null, price_per_unit: 48, shipping_fees: 0, total_price: 96, notes: "Demo: ordered against experiment task by mistake.", funding_string: null, vendor: null, category: "Consumables" }]);

  // alex lab links (6)
  out.push(["users/alex/lab_links/1.json", { id: 1, title: "Benchling (demo workspace)", url: "https://example.org/demo-benchling", description: "Cloning notebook for the demo lab.", category: "Bioinformatics tools", color: "#3b82f6", preview_image_url: null, sort_order: 0, created_at: "2026-02-01T00:00:00Z" }]);
  out.push(["users/alex/lab_links/2.json", { id: 2, title: "SnapGene", url: "https://example.org/demo-snapgene", description: "Plasmid map viewer.", category: "Bioinformatics tools", color: "#3b82f6", preview_image_url: null, sort_order: 1, created_at: "2026-02-01T00:00:00Z" }]);
  out.push(["users/alex/lab_links/3.json", { id: 3, title: "AddGene (demo)", url: "https://example.org/demo-addgene", description: "Plasmid repository — demo links only.", category: "Bioinformatics tools", color: "#3b82f6", preview_image_url: null, sort_order: 2, created_at: "2026-02-01T00:00:00Z" }]);
  out.push(["users/alex/lab_links/4.json", { id: 4, title: "IDT ordering portal (demo)", url: "https://example.org/demo-idt-order", description: null, category: "Ordering portals", color: "#10b981", preview_image_url: null, sort_order: 0, created_at: "2026-02-01T00:00:00Z" }]);
  out.push(["users/alex/lab_links/5.json", { id: 5, title: "Sigma-Aldrich (demo)", url: "https://example.org/demo-sigma", description: "Reagents.", category: "Ordering portals", color: "#10b981", preview_image_url: null, sort_order: 1, created_at: "2026-02-01T00:00:00Z" }]);
  out.push(["users/alex/lab_links/6.json", { id: 6, title: "Nature Biotechnology", url: "https://example.org/demo-natbiotech", description: "Target journal for the FakeYeast biofuel paper.", category: "Journals", color: "#f59e0b", preview_image_url: null, sort_order: 0, created_at: "2026-02-01T00:00:00Z" }]);

  // alex notes — all `is_shared: true` so the Lab Mode notes tab (which
  // filters on shared_only) has realistic content. Mix of single-shot
  // observations, lab-recipe-style protocol notes, meeting notes, and
  // multi-entry running logs.
  out.push(["users/alex/notes/1.json", { id: 1, title: "Run 2026-05-08: pYES-GAL1::flbA transformation", description:
      "Transformed FakeYeast-001 with pYES-GAL1::flbA using the LiAc protocol. Heat shock ran short (38 min, see deviation_log). Plated on SD-Ura. 40 colonies after 48 h, eight patched for downstream work.",
    is_running_log: false, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [], comments: [
      { id: "cmt-mira-alex-note1-1", author: "mira", text: "Good catch logging the heat-shock interruption. 38 min is well within tolerance for this strain — and documenting the timer drift will save us the next time efficiency unexpectedly dips. Keep that habit.", created_at: "2026-05-09T10:15:00Z" },
    ], created_at: "2026-05-08T14:00:00Z", updated_at: "2026-05-11T09:00:00Z", username: "alex" }]);
  out.push(["users/alex/notes/2.json", { id: 2, title: "Lab observations (running log)", description:
      "Weekly bench log for the FakeYeast biofuel project. See dated entries below for transformation efficiencies, gel reads, and any deviations that don't fit in a task's deviation_log field.",
    is_running_log: true, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [
      { id: "rl-alex-2-e1", title: "2026-05-01: running log opened", date: "2026-05-01", content: "Starting a weekly bench log for the FakeYeast biofuel project. Goal: capture transformation efficiencies, gel reads, and any deviations that don't fit in a task's deviation_log field.", created_at: "2026-05-01T09:00:00Z", updated_at: "2026-05-01T09:00:00Z" },
      { id: "rl-alex-2-e2", title: "2026-05-10: patch plates", date: "2026-05-10", content: "Patched 8 colonies onto fresh SD-Ura. All grew clean, no satellite colonies. Picking the top 4 (rows A1 to A4) for sequencing on Monday.", created_at: "2026-05-10T11:30:00Z", updated_at: "2026-05-10T11:30:00Z" },
      { id: "rl-alex-2-e3", title: "2026-05-13: PCR screen", date: "2026-05-13", content: "Ran DemoCheck PCR on 16 transformants. Expecting ~50% positive based on the patch results. Gel image goes into the task-3 results folder once it's run this afternoon.", created_at: "2026-05-13T09:00:00Z", updated_at: "2026-05-13T09:00:00Z" },
    ], comments: [
      { id: "cmt-mira-alex-note2-1", author: "mira", text: "Glad you opened a weekly log for this project. Much easier for me to follow than reading every task one-by-one. Can we make this the default format for everyone on the FakeYeast side going forward?", created_at: "2026-05-04T16:20:00Z" },
      // Lab Head Phase 2: reply thread under mira's root comment, showing
      // the new threading UI in the running-log context.
      { id: "cmt-alex-reply-note2-1", author: "alex", text: "Happy to standardize on it. I'll write up a one-pager template and share it on the lab links section by Friday.", created_at: "2026-05-04T17:10:00Z", parent_id: "cmt-mira-alex-note2-1" },
    ], created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-13T09:00:00Z", username: "alex" }]);

  // Note 3: lab-recipe-style. Pure reagent table + steps, no prose.
  out.push(["users/alex/notes/3.json", { id: 3, title: "Plasmid mini-prep recipe v3 (column-based)", description:
      "Bench card for the column mini-prep.\n\nReagents per 5 mL overnight:\n- P1 resuspension: 250 µL (4 °C, w/ RNase A)\n- P2 lysis: 250 µL (RT, fresh)\n- N3 neutralization: 350 µL (RT)\n- PB wash: 500 µL\n- PE wash: 750 µL (with ethanol)\n- EB elution: 30 µL (pre-warm to 50 °C)\n\nSteps:\n1. Pellet 5 mL overnight @ 3000 g, 5 min, RT. Decant.\n2. Resuspend in P1, transfer to 1.5 mL tube.\n3. Add P2, invert 4 to 6×, incubate 3 min.\n4. Add N3, invert 4 to 6×, spin 13k rpm, 10 min.\n5. Load supernatant onto column, spin 60 sec.\n6. Wash PB (60 sec), wash PE (60 sec), dry-spin 60 sec.\n7. Elute in 30 µL EB, sit 1 min, spin 60 sec.\n\nExpected yield: 80 to 150 ng/µL for FakeYeast-001 strains.\nLowercase ID: alex_mp_v3.",
    is_running_log: false, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [], comments: [], created_at: "2026-03-15T10:00:00Z", updated_at: "2026-04-02T14:00:00Z", username: "alex" }]);

  // Note 4: meeting note, prose-style.
  out.push(["users/alex/notes/4.json", { id: 4, title: "Lab meeting 2026-05-11: strain design review", description:
      "Attendees: alex, morgan.\n\nAgenda:\n1. Walk through pYES-GAL1::flbA integration data\n2. Plan for the 96-well fluorescence screen (morgan's project 1)\n3. Review purchase pipeline for the stress-tolerance project\n\nNotes:\nMorgan presented the patch-plate photos from 2026-05-09. Eight clean colonies, no satellites. Plan is to send the top 4 for Sanger sequencing on Monday. Decision: pick rows A1, A2, A3, A4 (per the running log). If 3 of 4 come back clean we move to the qPCR expression check on the same colonies.\n\nFor the 96-well screen, morgan will use the public DemoCheck PCR protocol but with the fakeGFP primer pair (alex protocol 1). Plate map already drafted (morgan note 1). Reader booked for Thursday.\n\nAction items:\n- alex: place IDT order for the fakeGFP primers by Wednesday\n- morgan: finalize plate map and share via the lab notes panel\n- both: review the gel image from PCR screen 2026-05-13 once it's posted",
    is_running_log: false, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [], comments: [
      { id: "cmt-mira-alex-note4-1", author: "mira", text: "Quick follow-up on the IDT order — please loop me in on the funding split before placing it. Want to keep DEMO-DOE-EERE balanced for the renewal package due next month.", created_at: "2026-05-11T17:42:00Z" },
    ], created_at: "2026-05-11T13:00:00Z", updated_at: "2026-05-11T15:30:00Z", username: "alex" }]);

  // Note 5: qPCR optimization, running log with measurement tables.
  out.push(["users/alex/notes/5.json", { id: 5, title: "qPCR optimization log (fakeGFP vs ACT1)", description:
      "Optimizing the SYBR-based qPCR for fakeGFP expression. Reference: alex pcr_protocol 1.\n\nDoc tracks Cq values per primer-anneal sweep so we lock in conditions before the full triplicate run.",
    is_running_log: true, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [
      { id: "rl-alex-5-e1", title: "2026-04-22: anneal temp sweep 56, 58, 60, 62 °C", date: "2026-04-22", content: "fakeGFP-fwd/rev at 200 nM, cDNA 1:5. Cq means (n=2):\n- 56 °C: 22.9\n- 58 °C: 22.4\n- 60 °C: 21.7 (sharp melt peak)\n- 62 °C: 22.1\n\nLocking in 60 °C anneal. Melt curve confirms single product.", created_at: "2026-04-22T16:00:00Z", updated_at: "2026-04-22T16:00:00Z" },
      { id: "rl-alex-5-e2", title: "2026-04-29: primer concentration check (100 vs 200 nM)", date: "2026-04-29", content: "100 nM: Cq 22.1, lower fluorescence plateau. 200 nM: Cq 21.7, plateau ~2× higher. Sticking with 200 nM for the demo runs.", created_at: "2026-04-29T11:00:00Z", updated_at: "2026-04-29T11:00:00Z" },
      { id: "rl-alex-5-e3", title: "2026-05-06: reference gene comparison ACT1 vs PDA1", date: "2026-05-06", content: "ACT1 Cq spread across 8 wells: 21.6 to 21.9 (SD 0.10). PDA1 Cq spread: 24.1 to 24.7 (SD 0.22). ACT1 is the tighter reference, using it as the housekeeping baseline.", created_at: "2026-05-06T10:30:00Z", updated_at: "2026-05-06T10:30:00Z" },
    ], comments: [
      { id: "cmt-mira-alex-note5-1", author: "mira", text: "Nice tight ACT1 spread (SD 0.10) — that's a keeper reference. Let's discuss the 200 nM primer choice in Friday meeting; curious whether 150 nM still gives the same plateau and saves reagent burn over the long screen runs.", created_at: "2026-05-07T11:30:00Z" },
    ], created_at: "2026-04-22T16:00:00Z", updated_at: "2026-05-06T10:30:00Z", username: "alex" }]);

  // Note 6: terse list-style single-shot, freezer cleanout.
  out.push(["users/alex/notes/6.json", { id: 6, title: "Freezer 3 cleanout 2026-05-05", description:
      "Reorganizing -80 freezer 3 (shelf 2).\n\nKept:\n- pYES-GAL1::flbA glycerols (8 tubes, FakeYeast-001 background)\n- pDEMO-fluo stocks (4 tubes)\n- Backup gDNA from the 2026-03 transformation batch\n\nDiscarded (logged in the chemical waste book):\n- 12 unlabeled tubes, gray caps, no date (assumed >2 years old)\n- Half a box of FakeYeast WT glycerols from 2024 (have fresher stock)\n- Two leaking SOC aliquots\n\nAction: morgan to back up the pYES glycerols into freezer 5 before any future cleanout.",
    is_running_log: false, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [], comments: [], created_at: "2026-05-05T15:00:00Z", updated_at: "2026-05-05T15:00:00Z", username: "alex" }]);

  // Note 7: 1:1 meeting note, prose.
  out.push(["users/alex/notes/7.json", { id: 7, title: "Lab Head 1:1 with morgan: 2026-05-14 prep", description:
      "Prep card for the 1:1 calendar event.\n\nTopics to cover:\n1. Dissertation timeline check, especially chapter 2 figure plan\n2. 96-well screen prep status (project 1 shared task)\n3. Conference travel: Demo Synthetic Biology Conference 2026 in June\n4. Anything blocking the qPCR run?\n\nNotes I want to give:\n- Patch-plate photos looked clean, good documentation.\n- Plate-map note (morgan #1) is exactly the format I want going forward; can we make that the template for future screens?\n- Encourage morgan to flip more of her notes to shared so the lab-mode feed reflects her actual output.\n\nFollow-up tasks (to convert into actual tasks afterward):\n- Draft chapter 2 outline by 2026-05-30\n- Book the plate reader for the full screen replicate, 2026-05-22",
    is_running_log: false, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [], comments: [], created_at: "2026-05-13T17:00:00Z", updated_at: "2026-05-13T17:30:00Z", username: "alex" }]);

  // 1:1 revamp (notes-revamp bot, 2026-06-07): alex adds his own weekly goal
  // to the shared mira<->alex 1:1. UUID matches the OneOnOne record seeded
  // in the mira section below.
  out.push([
    "users/alex/weekly_goals/1.json",
    {
      id: 1,
      owner: "alex",
      text: "Draft chapter 2 outline (due May 30)",
      week_of: "2026-05-25",
      is_complete: false,
      created_at: "2026-05-25T11:00:00Z",
      created_by: "alex",
      is_shared: true,
      shared_with: [
        { username: "mira", level: "edit" },
        { username: "alex", level: "edit" },
      ],
      one_on_one_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    },
  ]);

  // alex dependencies (chain: 1→2→3→4→5→6, plus 7→2, 8→9, and 10→11)
  out.push(["users/alex/dependencies/1.json", { id: 1, parent_id: 1, child_id: 2, dep_type: "FS" }]);
  out.push(["users/alex/dependencies/2.json", { id: 2, parent_id: 2, child_id: 3, dep_type: "FS" }]);
  out.push(["users/alex/dependencies/3.json", { id: 3, parent_id: 3, child_id: 4, dep_type: "FS" }]);
  out.push(["users/alex/dependencies/4.json", { id: 4, parent_id: 4, child_id: 5, dep_type: "FS" }]);
  out.push(["users/alex/dependencies/5.json", { id: 5, parent_id: 5, child_id: 6, dep_type: "FS" }]);
  out.push(["users/alex/dependencies/6.json", { id: 6, parent_id: 7, child_id: 2, dep_type: "FS" }]);
  out.push(["users/alex/dependencies/7.json", { id: 7, parent_id: 8, child_id: 9, dep_type: "FS" }]);
  // Workbench "Blocked" fixture: growth curves (10, incomplete + running)
  // blocks heat-shock (11). The cascade returns "blocked" before the date
  // check, so task 11 lands in Blocked even though its start_date is in
  // the future.
  out.push(["users/alex/dependencies/8.json", { id: 8, parent_id: 10, child_id: 11, dep_type: "FS" }]);

  // alex result task notes/results markdown bodies.
  //
  // Narrative: alex is engineering FakeYeast-001 to express the fungal
  // developmental regulator flbA under a GAL1-inducible promoter, with a
  // fakeGFP reporter tracking expression and downstream stress-tolerance
  // assays measuring phenotypic impact for biofuel fermentation. Content
  // mixes lab-recipe style (reagent lists, cycle conditions, sample IDs)
  // with running-log dated entries and the occasional human aside.
  //
  // task-2 notes.md is intentionally prepended with a stamp header (the
  // canonical HTML-comment format from `lib/stamp-utils.ts`) so the export
  // pipeline's `extractUserContent` → `parseContent` strip path has a
  // realistic fixture to exercise. Other tasks' notes/results stay
  // stamp-free to mirror older legacy content.

  // ── task-17 (2026-02-10, complete): pilot transformation, strain choice ──
  out.push(["users/alex/results/task-17/notes.md",
    DEMO_BANNER_MD +
    "## Pilot transformation — strain choice\n\n" +
    "Goal: pick between FakeYeast-001 and DemoStrain-ΔADE2 as the chassis for the GAL1::flbA work. Need >100 transformants/µg with the empty pYES2 backbone before committing.\n\n" +
    "### Reagents (per rxn, ×8)\n\n" +
    "- 50% PEG-3350 (sterile): 240 µL\n" +
    "- 1 M LiAc: 36 µL\n" +
    "- ssDNA carrier (boiled 5 min, snap-chilled): 25 µL\n" +
    "- pYES2 backbone (linearized, EcoRI/XhoI): ~100 ng\n" +
    "- Yeast pellet from 5 mL OD600 0.6 culture\n\n" +
    "### Conditions\n\n" +
    "- Heat shock: 42 °C × 40 min\n" +
    "- Recovery: 1 h in YPD at 30 °C, no shaking\n" +
    "- Plate 200 µL on SD-Ura\n\n" +
    "### Notes\n\n" +
    "Ran 4 reactions per strain. DemoStrain-ΔADE2 pellet was much pinker than expected (ade2 phenotype), color held overnight.\n\n" +
    "Backbone was a fresh prep from morgan (concentration 142 ng/µL via Nanodrop on 2026-02-09).\n\n" +
    "![Pilot transformation plate — SD-Ura selection](Images/pilot-transformation-plate.png)\n"]);
  out.push(["users/alex/results/task-17/results.md",
    DEMO_BANNER_MD +
    "## Pilot transformation — results\n\n" +
    "**Conclusion: locking in FakeYeast-001 as the chassis strain.**\n\n" +
    "| Strain | Colonies / plate (mean ± SD, n=4) | Est. transformants/µg |\n" +
    "|---|---|---|\n" +
    "| FakeYeast-001 | 78 ± 11 | ~390 |\n" +
    "| DemoStrain-ΔADE2 | 19 ± 6 | ~95 |\n\n" +
    "FakeYeast-001 cleared the >100 transformants/µg bar comfortably; the ΔADE2 strain dropped efficiency ~4× under the same conditions. Cassette QC: 6 / 6 picked colonies grew on SD-Ura replica and confirmed `URA3` marker.\n\n" +
    "![Pilot plate — FakeYeast-001 lawn](Images/pilot-transformation-plate.png)\n\n" +
    "Next step: pilot Gibson assembly to validate the cloning workflow on the backbone (task-18).\n"]);

  // ── task-18 (2026-02-18, complete): pilot Gibson backbone test ──
  out.push(["users/alex/results/task-18/notes.md",
    DEMO_BANNER_MD +
    "## Pilot Gibson — backbone test\n\n" +
    "Testing the Gibson workflow before committing to the full pDEMO-fluo library build (task-9). 4 mock backbones, single insert (200 bp filler with 25 bp overlaps).\n\n" +
    "### Linearization\n\n" +
    "- pYES2 (5.86 kb) digested with EcoRI + XhoI, 37 °C, 60 min\n" +
    "- Gel-purified the 5.86 kb band (QIAquick column)\n" +
    "- Eluted in 30 µL EB → 48 ng/µL\n\n" +
    "### Gibson assembly mix (per rxn, 10 µL final)\n\n" +
    "| Reagent | Amount |\n" +
    "|---|---|\n" +
    "| 2× Gibson master mix | 5.0 µL |\n" +
    "| Linearized backbone (50 fmol) | 1.5 µL |\n" +
    "| Insert (100 fmol filler) | 0.8 µL |\n" +
    "| Nuclease-free H2O | 2.7 µL |\n\n" +
    "Incubate 50 °C × 60 min, then transform 2 µL into NEB 5-alpha competent cells.\n\n" +
    "### Notes\n\n" +
    "Backbone 4 looked smeary on the post-digest gel, kept it anyway as a negative control. Ran out of fresh Gibson mix mid-run — borrowed two aliquots from morgan's -20 box (label `GIB-2026-02-15`).\n\n" +
    "![Gibson backbone gel — linearization check](Images/gel-gibson-pilot.png)\n"]);
  out.push(["users/alex/results/task-18/results.md",
    DEMO_BANNER_MD +
    "## Gibson backbone test — results\n\n" +
    "**Conclusion: locking in pYES2 (backbone 1) for the pDEMO-fluo library work.**\n\n" +
    "3 / 4 backbones gave the expected 5.86 kb linearized band with clean stoichiometry; backbone 4 (smeary, see notes) failed assembly QC as expected. Transformation efficiency for backbones 1-3: 12, 8, 14 colonies per 50 µL plated (avg ~220 cfu/µg DNA after correction).\n\n" +
    "![Gibson pilot gel — lanes 1-3 hit, lane 4 fails](Images/gel-gibson-pilot.png)\n\n" +
    "Sequenced 2 colonies per backbone, junctions clean. Locking in backbone 1 (pYES2 fresh-digest stock) for downstream library work.\n"]);

  // ── task-19 (2026-03-05, complete): baseline growth profile ──
  out.push(["users/alex/results/task-19/notes.md",
    DEMO_BANNER_MD +
    "## Baseline growth profile — FakeYeast-001 in YPD\n\n" +
    "No-stress reference for the stress-tolerance project. Need a clean doubling-time number before we layer on heat / glucose perturbations.\n\n" +
    "### Setup\n\n" +
    "- Strain: `FakeYeast-001` (fresh streak from -80 glycerol, 2 days old)\n" +
    "- Media: YPD + 2% glucose, filter-sterilized\n" +
    "- Reader: BioTek Synergy H1, 30 °C, double-orbital shake 425 cpm\n" +
    "- Plate: Corning 96-well, flat-bottom, lid-on\n" +
    "- Sample IDs: `FY-BG-001` through `FY-BG-003` (biological triplicates from 3 independent overnight cultures)\n" +
    "- 200 µL volume per well, seeded at OD600 = 0.05\n" +
    "- Read interval: 15 min for 18 h\n\n" +
    "### Observations during run\n\n" +
    "- t=0 h: OD600 0.05 ± 0.01 across all wells (good seeding consistency)\n" +
    "- t=4 h: OD600 = 0.42 (mid-log, end of lag phase)\n" +
    "- t=8 h: OD600 = 1.18 (entering early stationary)\n" +
    "- t=14 h: plateau at OD600 ≈ 1.45\n\n" +
    "### Deviations\n\n" +
    "Reader gave a single spurious read at t=6.25 h (one well, edge of plate, OD600 = 0.001). Probably condensation under the lid. Excluded from the fit.\n\n" +
    "![Baseline growth curves — 3 biological reps](Images/growth-curve-baseline.png)\n"]);
  out.push(["users/alex/results/task-19/results.md",
    DEMO_BANNER_MD +
    "## Baseline growth — results\n\n" +
    "**Doubling time = 95 ± 4 min** for FakeYeast-001 in YPD/2% glucose at 30 °C (mean ± SD across 3 biological replicates).\n\n" +
    "Logistic fit parameters:\n\n" +
    "- µmax = 0.44 h⁻¹\n" +
    "- Lag = 2.1 h\n" +
    "- Plateau OD600 = 1.45\n\n" +
    "![Baseline growth curves — 3 biological reps in YPD/glucose](Images/growth-curve-baseline.png)\n\n" +
    "Locked in as the no-stress reference for the stress-tolerance project. Heat-shock (task-11) and high-glucose curves (task-10) will be normalized to this baseline.\n"]);

  // ── task-2 (2026-05-08, complete): pYES-GAL1::flbA transformation ──
  // (Kept stamp header so the export-strip fixture still exercises that path.)
  out.push(["users/alex/results/task-2/notes.md",
    "<!-- stamp:start -->\n" +
    "2026-05-08  \n" +
    "9:42 AM  \n" +
    "experiment: Yeast transformation: pYES-GAL1::flbA  \n" +
    "project folder: DEMO: Engineer FakeYeast for biofuel  \n" +
    "<!-- stamp:end -->\n" +
    "___\n" +
    "[last-access]: # (2026-05-08T14:30:00Z)\n\n" +
    DEMO_BANNER_MD +
    "## Transformation notes — 2026-05-08\n\n" +
    "Integrating `pYES-GAL1::flbA` into FakeYeast-001 at the URA3 locus.\n\n" +
    "### Reagents (per rxn, ×10)\n\n" +
    "- 50% PEG-3350: 240 µL\n" +
    "- 1 M LiAc: 36 µL\n" +
    "- ssDNA carrier (10 mg/mL, boiled fresh): 25 µL\n" +
    "- `pYES-GAL1::flbA` linearized w/ AatII: ~120 ng/rxn\n" +
    "- Yeast pellet from 5 mL OD600 = 0.6 mid-log culture\n\n" +
    "### Conditions\n\n" +
    "| Step | Temp | Time |\n" +
    "|---|---|---|\n" +
    "| Mix + 30 min ramp | 30 °C | 30 min |\n" +
    "| Heat shock | 42 °C | **38 min** (interrupted, see deviation log) |\n" +
    "| Recovery in YPD | 30 °C | 1 h |\n" +
    "| Plate on SD-Ura | 30 °C | 48 h |\n\n" +
    "### Sample IDs\n\n" +
    "- `FY-pYESflbA-T1` through `FY-pYESflbA-T10`\n" +
    "- WT control (no DNA): `FY-NEG-1`\n" +
    "- Backbone-only (pYES2 empty): `FY-EV-1`\n\n" +
    "### Observations\n\n" +
    "Timer reset at minute 38 of heat shock (someone bumped the heat block). Restarted immediately but only managed 38 min total. Logged in the task deviation log.\n\n" +
    "Plated 200 µL out of the 1 mL recovery; saving the rest at 4 °C in case efficiency tanks.\n\n" +
    "After 48 h: counted **40 colonies** on the experimental plate. WT control: 0 colonies (good). EV control: 38 colonies (expected).\n\n" +
    "![Transformation plate — SD-Ura selection, 48 h](Images/transformation-plate.png)\n\n" +
    // A Files/ attachment alongside the inline image so the Lab Notes editor's
    // attachment strip shows BOTH the Images tab (the plate thumbnail) and a
    // populated Files tab (the colony-count CSV) for the editor-attachment-strip
    // screenshot. FileStrip scans the body for [label](Files/<name>) refs.
    "Raw colony counts: [colony-counts.csv](Files/colony-counts.csv)\n"]);
  out.push([
    "users/alex/results/task-2/Files/colony-counts.csv",
    "plate,colonies,note\nexperimental,40,SD-Ura 48h\nWT_control,0,no DNA\nEV_control,38,pYES2 empty\n",
  ]);
  out.push(["users/alex/results/task-2/results.md",
    DEMO_BANNER_MD +
    "## Yeast transformation — results\n\n" +
    "**40 colonies / 200 µL plated → ~200 transformants/µg DNA** (demo numbers). Heat-shock interruption did not visibly tank efficiency vs the pilot (task-17).\n\n" +
    "- Negative control (no DNA): 0 colonies\n" +
    "- Empty-vector control (pYES2): 38 colonies — efficiency ~matches experimental, consistent with URA3 marker working as expected\n" +
    "- Experimental (`pYES-GAL1::flbA`): 40 colonies\n\n" +
    "![SD-Ura selection plate, 48 h](Images/transformation-plate.png)\n\n" +
    "Picking 8 colonies for patch-plating + downstream screen (task-3). Glycerol stocks for all 40 banked in freezer 3, box `pYES-flbA-2026-05`.\n"]);

  // ── task-8 (2026-05-09, complete): mini-prep candidate plasmids ──
  // notes.md is rich (recipe-style); results.md stays EMPTY so the gallery's
  // "Awaiting results" section keeps its fixture (forgot-to-write-up state).
  out.push(["users/alex/results/task-8/notes.md",
    DEMO_BANNER_MD +
    "## Mini-prep notes — 2026-05-09\n\n" +
    "Mini-prepping 8 candidate plasmid colonies pulled from the Gibson assembly plate (post task-18 follow-up batch). Want clean DNA for restriction-digest QC before sequencing.\n\n" +
    "### Reagents (per 5 mL overnight)\n\n" +
    "- P1 resuspension (4 °C, w/ RNase A): 250 µL\n" +
    "- P2 lysis (RT, fresh): 250 µL\n" +
    "- N3 neutralization (RT): 350 µL\n" +
    "- PB wash: 500 µL\n" +
    "- PE wash (with ethanol): 750 µL\n" +
    "- EB elution (pre-warm 50 °C): 30 µL\n\n" +
    "### Steps\n\n" +
    "1. Pellet 5 mL overnight @ 3000 × g, 5 min, RT. Decant.\n" +
    "2. Resuspend in P1, transfer to 1.5 mL tube.\n" +
    "3. Add P2, invert 4-6×, incubate 3 min RT.\n" +
    "4. Add N3, invert 4-6×, spin 13k rpm × 10 min.\n" +
    "5. Load supernatant onto column, spin 60 s.\n" +
    "6. Wash PB (60 s), wash PE (60 s), dry-spin 60 s.\n" +
    "7. Elute in 30 µL EB, sit 1 min RT, spin 60 s.\n\n" +
    "### Samples\n\n" +
    "- `pDEMO-cand-01` through `pDEMO-cand-08`\n\n" +
    "### Nanodrop readouts\n\n" +
    "| Sample | ng/µL | A260/280 | A260/230 |\n" +
    "|---|---|---|---|\n" +
    "| cand-01 | 142 | 1.88 | 2.12 |\n" +
    "| cand-02 | 118 | 1.85 | 2.05 |\n" +
    "| cand-03 | 96  | 1.84 | 1.95 |\n" +
    "| cand-04 | 134 | 1.89 | 2.18 |\n" +
    "| cand-05 | 88  | 1.79 | 1.62 (a bit low) |\n" +
    "| cand-06 | 121 | 1.86 | 2.08 |\n" +
    "| cand-07 | 107 | 1.83 | 2.00 |\n" +
    "| cand-08 | 145 | 1.90 | 2.21 |\n\n" +
    "All within the expected 80-150 ng/µL range. Cand-05 has a slightly low A260/230 — probably residual PE, re-elute if it gives a weird digest pattern.\n\n" +
    "TODO: write up the restriction-digest QC results in the results tab (still need to run the digest gel).\n"]);
  out.push(["users/alex/results/task-8/results.md", ""]);

  // ── task-3 (2026-05-11, complete): patch positives on SD-Ura ──
  out.push(["users/alex/results/task-3/notes.md",
    DEMO_BANNER_MD +
    "## Patch plate — 2026-05-11\n\n" +
    "Patching 8 colonies picked off the transformation plate (task-2) onto a fresh SD-Ura plate. Want clean single-colony-derived material for the PCR screen on Monday.\n\n" +
    "### Protocol\n\n" +
    "- Pre-warm SD-Ura plate to 30 °C, 30 min\n" +
    "- 8 patches in a 2×4 grid, ~5 mm spacing\n" +
    "- Streak from single isolated colony per pick using sterile toothpicks\n" +
    "- Incubate 30 °C, 48 h\n\n" +
    "### Layout\n\n" +
    "```\n" +
    "A1  A2  A3  A4\n" +
    "B1  B2  B3  B4\n" +
    "```\n\n" +
    "Sample IDs `FY-pYESflbA-T1` through `T8` map row-major to grid positions A1-B4.\n\n" +
    "### Observations\n\n" +
    "All 8 patches grew cleanly. No satellite colonies on or around any patch — confirms URA3 selection is holding.\n\n" +
    "Patch B3 is slightly smaller than the others (maybe 70% area) but still uniform growth. Picking top 4 by visual eye: A1, A2, A3, A4 — sending for Sanger sequencing tomorrow.\n\n" +
    "![Patch plate — 8 candidate transformants, 48 h SD-Ura](Images/patch-plate.png)\n"]);
  out.push(["users/alex/results/task-3/results.md",
    DEMO_BANNER_MD +
    "## Patch plate — results\n\n" +
    "**8 / 8 patches grew on SD-Ura.** All transformants retain the URA3 selection marker; ready for genotyping.\n\n" +
    "![Clean patch plate — top 4 picked for sequencing](Images/patch-plate.png)\n\n" +
    "Next: top 4 (A1-A4) → Sanger sequencing of the GAL1::flbA junction (turnaround ~2 days). All 8 → gDNA prep + DemoCheck PCR screen (task-4, task-5).\n"]);

  // ── task-16 (2026-05-11, NOT complete): re-streak top 4 transformants ──
  // notes only, no results yet (re-streak hasn't been picked up after the
  // patch plate succeeded — it's the next step but alex went straight to
  // gDNA prep on the patches instead). Intentionally a small "in-flight"
  // experiment to make the gallery feel real.
  out.push(["users/alex/results/task-16/notes.md",
    DEMO_BANNER_MD +
    "## Re-streak plan — top 4 transformants\n\n" +
    "Re-streaking T1, T2, T3, T4 (the four sequenced positives from task-3) onto fresh SD-Ura to get well-isolated single colonies. Need this before we bank long-term glycerols.\n\n" +
    "### Plan\n\n" +
    "- 4 plates, one strain per plate\n" +
    "- Three-zone streak (loop-flame between zones)\n" +
    "- Label with strain ID + date + initials on the bottom\n" +
    "- 48 h @ 30 °C\n\n" +
    "Plates pre-poured 2026-05-10, stored at 4 °C overnight, dried 30 min in the hood before streaking.\n\n" +
    "### Status\n\n" +
    "Not done yet — bumped this when the gDNA prep results (task-4) came back clean and we went straight to the PCR screen. Will come back to this once I have the final sequence confirmation in hand. Low risk because the patch plate (task-3) already gave us isolated material.\n"]);

  // ── task-4 (2026-05-12, complete): gDNA prep — top 8 ──
  out.push(["users/alex/results/task-4/notes.md",
    DEMO_BANNER_MD +
    "## gDNA prep — 8 transformants — 2026-05-12\n\n" +
    "Pulling genomic DNA from all 8 patched transformants for the DemoCheck PCR screen tomorrow.\n\n" +
    "### Reagents (per sample)\n\n" +
    "- Breaking buffer (2% Triton X-100, 1% SDS, 100 mM NaCl, 10 mM Tris pH 8, 1 mM EDTA): 200 µL\n" +
    "- Acid-washed glass beads (0.5 mm): ~200 µL bed volume\n" +
    "- Phenol:chloroform:IAA (25:24:1): 200 µL\n" +
    "- Ethanol (100%, ice-cold): 1 mL\n" +
    "- TE buffer: 50 µL\n\n" +
    "### Steps (Hoffman-Winston, condensed)\n\n" +
    "1. Pellet 1.5 mL overnight, decant.\n" +
    "2. Resuspend in 200 µL breaking buffer + beads + 200 µL phenol mix.\n" +
    "3. Vortex 3 min, top speed.\n" +
    "4. Spin 13k rpm × 5 min. Take ~150 µL upper phase.\n" +
    "5. Add 1 mL EtOH, mix, spin 13k rpm × 2 min.\n" +
    "6. Wash pellet with 500 µL 70% EtOH, spin 2 min, decant, air-dry.\n" +
    "7. Resuspend in 50 µL TE.\n\n" +
    "### Sample IDs + Nanodrop\n\n" +
    "| Sample | ng/µL | A260/280 | A260/230 |\n" +
    "|---|---|---|---|\n" +
    "| T1 | 245 | 1.86 | 2.05 |\n" +
    "| T2 | 198 | 1.84 | 2.02 |\n" +
    "| T3 | 312 | 1.88 | 2.11 |\n" +
    "| T4 | 224 | 1.85 | 2.04 |\n" +
    "| T5 | 178 | 1.82 | 1.98 |\n" +
    "| T6 | 261 | 1.87 | 2.08 |\n" +
    "| T7 | 295 | 1.86 | 2.07 |\n" +
    "| T8 | 209 | 1.83 | 2.01 |\n\n" +
    "### Quality gel\n\n" +
    "Ran 5 µL of each on a 0.8% agarose gel, ethidium-stained. All 8 lanes show a tight high-MW band (>20 kb) with minimal RNA shadow at the bottom — good prep quality.\n\n" +
    "![gDNA quality check — 8 transformants on 0.8% agarose](Images/gel-gdna-quality.png)\n"]);
  out.push(["users/alex/results/task-4/results.md",
    DEMO_BANNER_MD +
    "## gDNA prep — results\n\n" +
    "**All 8 preps passed quality gate** (A260/280 ≥ 1.80, A260/230 ≥ 1.95). Ready for PCR screen.\n\n" +
    "| Pass criterion | Threshold | Result |\n" +
    "|---|---|---|\n" +
    "| A260/280 | ≥ 1.80 | 8 / 8 |\n" +
    "| A260/230 | ≥ 1.95 | 8 / 8 |\n" +
    "| High-MW band on gel | clean ≥ 20 kb | 8 / 8 |\n" +
    "| Concentration | ≥ 100 ng/µL | 8 / 8 (range 178-312) |\n\n" +
    "![Quality gel — all 8 lanes show tight HMW bands](Images/gel-gdna-quality.png)\n\n" +
    "Diluting all to 50 ng/µL working stocks for the DemoCheck PCR (task-5).\n"]);

  // ── task-10 (2026-05-12 → 14, NOT complete, running): growth curves YPD/glucose ──
  // Running-log style — three dated entries spanning the multi-day run, no
  // results yet (still mid-experiment). Heat-shock (task-11) is blocked on
  // this completing.
  out.push(["users/alex/results/task-10/notes.md",
    DEMO_BANNER_MD +
    "## Growth curves — running log\n\n" +
    "Two strains (`FakeYeast-001` WT vs `FY-pYESflbA-T1` with flbA cassette) × 4 glucose levels (0.5%, 1%, 2%, 4%). Want to see if flbA expression alters the dose-response in YPD before we layer on heat stress.\n\n" +
    "### 2026-05-12 — plate setup + reader booking\n\n" +
    "Seeded the 96-well plate this morning. Layout: rows A-D = WT, rows E-H = T1. Columns 1-3 = 0.5%, 4-6 = 1%, 7-9 = 2%, 10-12 = 4%. 200 µL per well, OD600 seed = 0.05 from fresh overnights.\n\n" +
    "Reader (Synergy H1) booked for 48 h continuous starting 11:00. 30 °C, 425 cpm double-orbital, 15 min reads.\n\n" +
    "Sample IDs: `GR-WT-{0.5,1,2,4}` and `GR-T1-{0.5,1,2,4}`, biological triplicates each (n=24 conditions total, 96 wells with 4 wells/condition).\n\n" +
    "### 2026-05-13 — mid-run check\n\n" +
    "Mid-log readings look as expected. WT vs T1 traces are visually overlapping at 2% glucose (no penalty from the cassette under uninduced conditions — good news). 4% glucose plateau a hair lower for both strains, probably osmotic pressure starting to bite.\n\n" +
    "OD600 at t=14h, T1 + 4% glucose: 1.31 (vs WT same condition: 1.36).\n\n" +
    "Caught condensation forming on the lid at hour ~30, breath-fogged the lid edge and reseated. No data dropout but worth noting.\n\n" +
    "### 2026-05-14 — run complete, exporting\n\n" +
    "Run finished overnight. Exporting the .xlsx now, will pull the OD600 traces into a Gompertz fit in python. Plotting all 24 conditions per strain × glucose.\n\n" +
    "Note: well H12 (T1 + 4% glucose, biological rep 3) flatlined at OD600 ≈ 0.08 the whole run — never came out of lag. Looks like a seeding failure (forgot to mix the overnight before pipetting?). Excluding it from the final analysis, will mention in the writeup.\n\n" +
    "![Growth curves — preview from the reader export](Images/growth-curve-YPD.png)\n\n" +
    "Results writeup pending — should land in the results tab once the Gompertz fits are done.\n"]);

  // ── task-5 (2026-05-13, complete): PCR-screen integrants ──
  out.push(["users/alex/results/task-5/notes.md",
    DEMO_BANNER_MD +
    "## DemoCheck PCR screen — 2026-05-13\n\n" +
    "Screening all 8 transformants (T1-T8) + WT + empty-vector + water for the GAL1::flbA integration cassette. Expected band: **~1.4 kb** (URA3 5'UTR primer + flbA-internal primer).\n\n" +
    "### Reagents (per 25 µL rxn, ×16 incl. controls)\n\n" +
    "| Reagent | Stock | Per rxn |\n" +
    "|---|---|---|\n" +
    "| 5× HF Buffer | 5× | 5.0 µL |\n" +
    "| dNTPs | 10 mM | 0.5 µL |\n" +
    "| DemoCheck-fwd (URA3 5'UTR) | 10 µM | 1.25 µL |\n" +
    "| DemoCheck-rev (flbA-internal) | 10 µM | 1.25 µL |\n" +
    "| Phusion polymerase | 2 U/µL | 0.25 µL |\n" +
    "| gDNA template (50 ng/µL) | — | 1.0 µL |\n" +
    "| Nuclease-free H2O | — | 15.75 µL |\n" +
    "| **Total** |   | **25.0 µL** |\n\n" +
    "### Cycle conditions\n\n" +
    "| Step | Temp | Time | Cycles |\n" +
    "|---|---|---|---|\n" +
    "| Initial denaturation | 98 °C | 30 s | 1 |\n" +
    "| Denaturation | 98 °C | 10 s | 30 |\n" +
    "| Annealing | 58 °C | 20 s | 30 |\n" +
    "| Extension | 72 °C | 45 s | 30 |\n" +
    "| Final extension | 72 °C | 5 min | 1 |\n" +
    "| Hold | 12 °C | ∞ | — |\n\n" +
    "### Gel\n\n" +
    "1.5% agarose, 1× TAE, 100 V × 35 min. Loaded 10 µL/lane + 2 µL 6× loading dye. Ladder: NEB 1 kb plus.\n\n" +
    "Lane order: L | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | WT | EV | H2O.\n\n" +
    "![DemoCheck PCR screen — 1.5% agarose, expected band at ~1.4 kb](Images/gel-pcr-screen.png)\n"]);
  out.push(["users/alex/results/task-5/results.md",
    DEMO_BANNER_MD +
    "## PCR-screen results\n\n" +
    "**6 / 8 transformants positive for the GAL1::flbA cassette** (~75% integration rate, in line with the LiAc + linearized-plasmid expectation).\n\n" +
    "| Lane | Sample | ~1.4 kb band | Verdict |\n" +
    "|---|---|---|---|\n" +
    "| 2 | T1 | clean, strong | **positive** |\n" +
    "| 3 | T2 | clean, strong | **positive** |\n" +
    "| 4 | T3 | faint | negative (likely background) |\n" +
    "| 5 | T4 | clean, strong | **positive** |\n" +
    "| 6 | T5 | none | negative |\n" +
    "| 7 | T6 | clean, strong | **positive** |\n" +
    "| 8 | T7 | clean, strong | **positive** |\n" +
    "| 9 | T8 | clean, strong | **positive** |\n" +
    "| 10 | WT | none | (control as expected) |\n" +
    "| 11 | EV | none | (control as expected) |\n" +
    "| 12 | H2O | none | (control as expected) |\n\n" +
    "![PCR screen gel — 6 of 8 transformants show the expected band](Images/gel-pcr-screen.png)\n\n" +
    "**Conclusion:** moving T1, T2, T4, T6, T7, T8 forward to the qPCR expression check (task-30). T3 and T5 archived but flagged as suspect.\n"]);

  // ── task-30 (2026-05-13, NOT complete): qPCR fakeGFP expression vs control ──
  // notes only, in-progress — running-log style with prep + planning.
  out.push(["users/alex/results/task-30/notes.md",
    DEMO_BANNER_MD +
    "## qPCR — fakeGFP expression vs control (in-progress)\n\n" +
    "Measuring `flbA` transcript abundance in the 6 positive transformants (T1, T2, T4, T6, T7, T8 from task-5) ± galactose induction, vs WT and empty-vector controls. Reference gene: `ACT1`.\n\n" +
    "Primer pair locked in from earlier qPCR optimization (lab notes #5, run 2026-04-22): 60 °C anneal, 200 nM primers, melt curve clean.\n\n" +
    "### 2026-05-13 — RNA extraction kickoff\n\n" +
    "Pulling 6 colonies × 2 conditions (uninduced 2% glucose vs induced 2% galactose, 4 h post-shift) + 2 controls (WT, EV) = 16 samples.\n\n" +
    "Reagents per sample:\n\n" +
    "- TRIzol: 1 mL\n" +
    "- Chloroform: 200 µL\n" +
    "- Isopropanol: 500 µL\n" +
    "- 75% EtOH wash: 1 mL × 2\n" +
    "- DEPC-H2O: 30 µL final\n\n" +
    "Cultures harvested at OD600 = 0.6 (mid-log), pellet snap-frozen in LN2 before TRIzol step. DNase treatment with DNase I (Thermo, 2 U) for 30 min @ 37 °C, then cleanup column.\n\n" +
    "Nanodrop check:\n\n" +
    "- All 16 samples between 480-820 ng/µL, A260/280 = 1.94-2.05 (RNA-clean), A260/230 ≥ 2.0\n" +
    "- Spike-in dilution: 1 µg total RNA → 20 µL cDNA via SuperScript IV, random hexamers\n\n" +
    "### 2026-05-14 — RT done, qPCR plate prep tomorrow\n\n" +
    "All 16 cDNAs synthesized cleanly. Diluting 1:5 for the qPCR template tomorrow.\n\n" +
    "**Plate layout** (96-well, 384-well reader booked for Friday backup):\n\n" +
    "- Each cDNA × 2 genes (flbA + ACT1) × 3 technical reps = 6 wells per sample\n" +
    "- 16 samples × 6 = 96 wells — fits exactly on one plate, no minus-RT control space. Adding -RT controls only for samples T1, T6, WT (3 representative).\n\n" +
    "### TODO\n\n" +
    "- [ ] Pour qPCR plate Friday AM\n" +
    "- [ ] Run on QuantStudio 5, 40 cycles, melt curve enabled\n" +
    "- [ ] ΔΔCt vs ACT1, normalize to WT-uninduced\n" +
    "- [ ] Plot fold-change with biological triplicate error bars\n\n" +
    "Results writeup will land in the results tab post-run.\n"]);

  // ── task-11 (2026-05-18, NOT complete, blocked on task-10): heat-shock ──
  // notes only — not run yet, blocked on growth curves (task-10) completing.
  // The existing heat-shock image is referenced but lives in Images/ for
  // when the experiment actually runs.
  out.push(["users/alex/results/task-11/notes.md",
    DEMO_BANNER_MD +
    "## Heat-shock survival assay — protocol prep\n\n" +
    "Pending: blocked on the growth-curve baseline (task-10) finishing so we can normalize survival to per-strain doubling rate.\n\n" +
    "### Plan\n\n" +
    "Three strains × three heat-shock temperatures (37 °C, 42 °C, 50 °C × 30 min):\n\n" +
    "1. `FakeYeast-001` (WT, baseline reference from task-19)\n" +
    "2. `FY-Δgal80` (constitutive GAL1 — used as positive expression control)\n" +
    "3. `DemoStrain-ΔADE2` (stress-sensitive reference)\n\n" +
    "Plus the 4 confirmed integrants (T1, T2, T6, T7) once task-30 says they're actually expressing flbA — currently they're just genotypically positive, we need transcript-level confirmation before they make sense in this assay.\n\n" +
    "### Reagents\n\n" +
    "- YPD pre-warmed to each shock temp (water bath, NOT incubator — needs to hit temp fast)\n" +
    "- SD-Ura plates × 24 (3 strains × 3 temps × biological triplicate × 1 spot dilution series each)\n" +
    "- 10-fold serial dilution series: 10⁰ to 10⁻⁵ in sterile water\n\n" +
    "### Steps\n\n" +
    "1. Grow each strain to mid-log (OD600 ≈ 0.6) in YPD.\n" +
    "2. Aliquot 100 µL into pre-warmed tubes at each temp.\n" +
    "3. Shock 30 min, then immediately ice 2 min.\n" +
    "4. Serial-dilute, spot 5 µL of each dilution on SD-Ura.\n" +
    "5. Incubate 30 °C, count CFUs at 48 h.\n\n" +
    "Expected demo readout for the bar plot (% survival vs 30 °C control):\n\n" +
    "- FakeYeast-001 baseline: ~78%\n" +
    "- FY-Δgal80 (constitutive cassette stress): ~64%\n" +
    "- DemoStrain-ΔADE2: ~41% (known sensitive)\n\n" +
    "![Expected output style — heat-shock survival bar plot](Images/heatshock-survival.png)\n\n" +
    "*Image above is a placeholder showing the expected output format from a previous demo run — the actual data is not yet collected. Will be replaced once the assay runs.*\n"]);

  // ── task-9 (2026-05-20 → 23, NOT complete): build pDEMO-fluo library ──
  // notes only, in-progress, no results yet. Library construction protocol.
  out.push(["users/alex/results/task-9/notes.md",
    DEMO_BANNER_MD +
    "## pDEMO-fluo plasmid library build (in-progress)\n\n" +
    "Building a fluorescent-reporter library: pYES2 backbone + GAL1 promoter + 12 candidate insertion sites (5'UTR variants) + fakeGFP. Library size target: ~12 variants × 3 codon-usage variants = 36 plasmids.\n\n" +
    "### 2026-05-20 — backbone prep\n\n" +
    "Re-digesting pYES2 stock (from task-18 lock-in) with EcoRI + XhoI. Gel-purifying the 5.86 kb linearized band. Yield 52 ng/µL × 30 µL = 1.56 µg total.\n\n" +
    "Fresh aliquot to morgan for her parallel screening prep — she has been short on backbone since the freezer cleanout (lab note #6).\n\n" +
    "### 2026-05-21 — insert PCRs\n\n" +
    "PCR-amplifying the 36 fakeGFP+5'UTR variant inserts from the IDT-ordered gene fragments. All 36 reactions use the same conditions (annealing 60 °C, extension 30 s for 750 bp inserts).\n\n" +
    "**Insert IDs:** `pDF-ins-001` through `pDF-ins-036`.\n\n" +
    "Ran a QC gel on 12 / 36 (every 3rd). All 12 show the expected 750 bp band, clean, no primer-dimer above background. Cleaning up all 36 with PCR purification columns tomorrow.\n\n" +
    "### TODO (rest of week)\n\n" +
    "- [ ] Wed: PCR cleanup all 36 inserts\n" +
    "- [ ] Wed: Gibson assembly, 36 reactions in 96-well format\n" +
    "- [ ] Thu: Transform into NEB 5-alpha, plate on LB + Amp\n" +
    "- [ ] Fri: Pick 4 colonies per variant (144 total), grow overnights in 96-well, glycerol bank\n" +
    "- [ ] Following week: mini-prep + Sanger sequencing all 144 — keep 2 sequence-perfect per variant for the final library\n\n" +
    "### Notes / human asides\n\n" +
    "Ran out of T4 ligase mid-cleanup — borrowed two aliquots from morgan's bench (label `T4-2026-05-09`). Need to add to next purchase order.\n\n" +
    "Will write up the full library QC + sequence-verification results once we hit the end-of-week milestone. For now this is just the bench-side build log.\n"]);

  // ── alex inventory (Inventory feature, behind INVENTORY_ENABLED) ───────────
  //
  // Catalog items (`inventory_items`), physical stocks (`inventory_stocks`),
  // and a small storage tree (`storage_nodes`) for the demo lab. Whole-lab
  // EDIT sharing per design §6.1 (the `*` sentinel). All dates are HARDCODED
  // relative to the demo anchor TODAY (2026-05-13) so the expiring / expired
  // signals fire deterministically; the demo rebase preserves those offsets.
  //
  // Signal coverage across alex's stocks:
  //   - EXPIRING soon (2026-05-30, 17 d out, inside the 30-day window): dNTP mix
  //   - EXPIRED (2026-04-20, before TODAY): Taq stock
  //   - LOW (summed count 1 < low_at_count 2): Q5 enzyme
  //   - EMPTY (container_count 0): Ampicillin
  //   - in_stock: the rest
  out.push(...inventory("alex", ALEX_COLOR));

  // ─── Cloning-demo sequences (alex, ids 1-9) ───────────────────────────────
  //
  // Purpose-built GenBank substrates so the /demo + ?wikiCapture=1 Cloning
  // Workspace can drive all four review heroes live, not empty-stated:
  //   1-3  reference plasmids (pEGFP-N1, pGEX-3X, pEGFP-N1-TRAP1)
  //   4-5  linear pEGFP-N1 fragments for the Overlap (Gibson) assemble
  //   6-7  BsaI Golden Gate cassette pair (two linear parts -> one circle)
  //   8-9  Gateway LR pair (attL entry clone x attR destination vector)
  //
  // The .gb values are STRINGS, so writeFixtureTs keeps them in the wiki
  // fixture (it drops only .md bodies). Restored 2026-06-07 (HR) after a
  // generator regen wiped the previously hand-added fixture sequences;
  // demo-cloning-substrates / gateway-picker-group / pick-readouts tests
  // read these exact entries.
  out.push(["users/alex/sequences/1.gb", "LOCUS       CVU55762                4733 bp    DNA     circular SYN 22-AUG-2003\r\nDEFINITION  Cloning vector pEGFP-N1, complete sequence, enhanced green\r\n            fluorescent protein (egfp) and neomycin phosphotransferase genes,\r\n            complete cds.\r\nACCESSION   U55762\r\nVERSION     U55762.1\r\nKEYWORDS    .\r\nSOURCE      Cloning vector pEGFP-N1\r\n  ORGANISM  Cloning vector pEGFP-N1\r\n            other sequences; artificial sequences; vectors.\r\nREFERENCE   1  (bases 1 to 4733)\r\n  AUTHORS   Cormack,B.P., Valdivia,R.H. and Falkow,S.\r\n  TITLE     FACS-optimized mutants of the green fluorescent protein (GFP)\r\n  JOURNAL   Gene 173 (1 SPEC NO), 33-38 (1996)\r\n   PUBMED   8707053\r\nREFERENCE   2  (bases 1 to 4733)\r\n  AUTHORS   Kitts,P.A.\r\n  TITLE     pEGFP-N1 complete sequence\r\n  JOURNAL   Unpublished\r\nREFERENCE   3  (bases 1 to 4733)\r\n  AUTHORS   Kitts,P.A.\r\n  TITLE     Direct Submission\r\n  JOURNAL   Submitted (17-APR-1996) Paul A. Kitts, CLONTECH Laboratories, Inc.,\r\n            1020 East Meadow Circle, Palo Alto, CA 94303-4230, USA\r\nCOMMENT     This vector can be obtained from CLONTECH Laboratories, Inc., 1020\r\n            East  Meadow Circle, Palo Alto, CA 94303-4230, USA. To place an\r\n            order call  (415) 424-8222 or (800) 662-2566, extension 1.\r\n            International customers,  please contact your local distributor.\r\n            For technical information, call  (415) 424-8222 or (800) 662-2566,\r\n            extension 3.\r\n            This sequence has been compiled from information in the sequence\r\n            databases,  published literature and other sources, together with\r\n            partial sequences  obtained by CLONTECH. If you suspect there is an\r\n            error in this sequence,  please contact CLONTECH's Technical\r\n            Service Department at (415) 424-8222 or  (800) 662-2566, extension\r\n            3 or E-mail TECH@CLONTECH.COM.\r\nFEATURES             Location/Qualifiers\r\n     source          1..4733\r\n                     /organism=\"Cloning vector pEGFP-N1\"\r\n                     /mol_type=\"genomic DNA\"\r\n                     /db_xref=\"taxon:47945\"\r\n     gene            679..1398\r\n                     /gene=\"egfp\"\r\n     CDS             679..1398\r\n                     /gene=\"egfp\"\r\n                     /codon_start=1\r\n                     /transl_table=11\r\n                     /product=\"enhanced green fluorescent protein\"\r\n                     /protein_id=\"AAB02574.1\"\r\n                     /translation=\"MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLT\r\n                     LKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFK\r\n                     DDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKN\r\n                     GIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDH\r\n                     MVLLEFVTAAGITLGMDELYK\"\r\n     CDS             2629..3423\r\n                     /codon_start=1\r\n                     /transl_table=11\r\n                     /product=\"neomycin phosphotransferase\"\r\n                     /protein_id=\"AAB02575.1\"\r\n                     /translation=\"MIEQDGLHAGSPAAWVERLFGYDWAQQTIGCSDAAVFRLSAQGR\r\n                     PVLFVKTDLSGALNELQDEAARLSWLATTGVPCAAVLDVVTEAGRDWLLLGEVPGQDL\r\n                     LSSHLAPAEKVSIMADAMRRLHTLDPATCPFDHQAKHRIERARTRMEAGLVDQDDLDE\r\n                     EHQGLAPAELFARLKASMPDGEDLVVTHGDACLPNIMVENGRFSGFIDCGRLGVADRY\r\n                     QDIALATRDIAEELGGEWADRFLVLYGIAAPDSQRIAFYRLLDEFF\"\r\nORIGIN      \r\n        1 tagttattaa tagtaatcaa ttacggggtc attagttcat agcccatata tggagttccg\r\n       61 cgttacataa cttacggtaa atggcccgcc tggctgaccg cccaacgacc cccgcccatt\r\n      121 gacgtcaata atgacgtatg ttcccatagt aacgccaata gggactttcc attgacgtca\r\n      181 atgggtggag tatttacggt aaactgccca cttggcagta catcaagtgt atcatatgcc\r\n      241 aagtacgccc cctattgacg tcaatgacgg taaatggccc gcctggcatt atgcccagta\r\n      301 catgacctta tgggactttc ctacttggca gtacatctac gtattagtca tcgctattac\r\n      361 catggtgatg cggttttggc agtacatcaa tgggcgtgga tagcggtttg actcacgggg\r\n      421 atttccaagt ctccacccca ttgacgtcaa tgggagtttg ttttggcacc aaaatcaacg\r\n      481 ggactttcca aaatgtcgta acaactccgc cccattgacg caaatgggcg gtaggcgtgt\r\n      541 acggtgggag gtctatataa gcagagctgg tttagtgaac cgtcagatcc gctagcgcta\r\n      601 ccggactcag atctcgagct caagcttcga attctgcagt cgacggtacc gcgggcccgg\r\n      661 gatccaccgg tcgccaccat ggtgagcaag ggcgaggagc tgttcaccgg ggtggtgccc\r\n      721 atcctggtcg agctggacgg cgacgtaaac ggccacaagt tcagcgtgtc cggcgagggc\r\n      781 gagggcgatg ccacctacgg caagctgacc ctgaagttca tctgcaccac cggcaagctg\r\n      841 cccgtgccct ggcccaccct cgtgaccacc ctgacctacg gcgtgcagtg cttcagccgc\r\n      901 taccccgacc acatgaagca gcacgacttc ttcaagtccg ccatgcccga aggctacgtc\r\n      961 caggagcgca ccatcttctt caaggacgac ggcaactaca agacccgcgc cgaggtgaag\r\n     1021 ttcgagggcg acaccctggt gaaccgcatc gagctgaagg gcatcgactt caaggaggac\r\n     1081 ggcaacatcc tggggcacaa gctggagtac aactacaaca gccacaacgt ctatatcatg\r\n     1141 gccgacaagc agaagaacgg catcaaggtg aacttcaaga tccgccacaa catcgaggac\r\n     1201 ggcagcgtgc agctcgccga ccactaccag cagaacaccc ccatcggcga cggccccgtg\r\n     1261 ctgctgcccg acaaccacta cctgagcacc cagtccgccc tgagcaaaga ccccaacgag\r\n     1321 aagcgcgatc acatggtcct gctggagttc gtgaccgccg ccgggatcac tctcggcatg\r\n     1381 gacgagctgt acaagtaaag cggccgcgac tctagatcat aatcagccat accacatttg\r\n     1441 tagaggtttt acttgcttta aaaaacctcc cacacctccc cctgaacctg aaacataaaa\r\n     1501 tgaatgcaat tgttgttgtt aacttgttta ttgcagctta taatggttac aaataaagca\r\n     1561 atagcatcac aaatttcaca aataaagcat ttttttcact gcattctagt tgtggtttgt\r\n     1621 ccaaactcat caatgtatct taaggcgtaa attgtaagcg ttaatatttt gttaaaattc\r\n     1681 gcgttaaatt tttgttaaat cagctcattt tttaaccaat aggccgaaat cggcaaaatc\r\n     1741 ccttataaat caaaagaata gaccgagata gggttgagtg ttgttccagt ttggaacaag\r\n     1801 agtccactat taaagaacgt ggactccaac gtcaaagggc gaaaaaccgt ctatcagggc\r\n     1861 gatggcccac tacgtgaacc atcaccctaa tcaagttttt tggggtcgag gtgccgtaaa\r\n     1921 gcactaaatc ggaaccctaa agggagcccc cgatttagag cttgacgggg aaagccggcg\r\n     1981 aacgtggcga gaaaggaagg gaagaaagcg aaaggagcgg gcgctagggc gctggcaagt\r\n     2041 gtagcggtca cgctgcgcgt aaccaccaca cccgccgcgc ttaatgcgcc gctacagggc\r\n     2101 gcgtcaggtg gcacttttcg gggaaatgtg cgcggaaccc ctatttgttt atttttctaa\r\n     2161 atacattcaa atatgtatcc gctcatgaga caataaccct gataaatgct tcaataatat\r\n     2221 tgaaaaagga agagtcctga ggcggaaaga accagctgtg gaatgtgtgt cagttagggt\r\n     2281 gtggaaagtc cccaggctcc ccagcaggca gaagtatgca aagcatgcat ctcaattagt\r\n     2341 cagcaaccag gtgtggaaag tccccaggct ccccagcagg cagaagtatg caaagcatgc\r\n     2401 atctcaatta gtcagcaacc atagtcccgc ccctaactcc gcccatcccg cccctaactc\r\n     2461 cgcccagttc cgcccattct ccgccccatg gctgactaat tttttttatt tatgcagagg\r\n     2521 ccgaggccgc ctcggcctct gagctattcc agaagtagtg aggaggcttt tttggaggcc\r\n     2581 taggcttttg caaagatcga tcaagagaca ggatgaggat cgtttcgcat gattgaacaa\r\n     2641 gatggattgc acgcaggttc tccggccgct tgggtggaga ggctattcgg ctatgactgg\r\n     2701 gcacaacaga caatcggctg ctctgatgcc gccgtgttcc ggctgtcagc gcaggggcgc\r\n     2761 ccggttcttt ttgtcaagac cgacctgtcc ggtgccctga atgaactgca agacgaggca\r\n     2821 gcgcggctat cgtggctggc cacgacgggc gttccttgcg cagctgtgct cgacgttgtc\r\n     2881 actgaagcgg gaagggactg gctgctattg ggcgaagtgc cggggcagga tctcctgtca\r\n     2941 tctcaccttg ctcctgccga gaaagtatcc atcatggctg atgcaatgcg gcggctgcat\r\n     3001 acgcttgatc cggctacctg cccattcgac caccaagcga aacatcgcat cgagcgagca\r\n     3061 cgtactcgga tggaagccgg tcttgtcgat caggatgatc tggacgaaga gcatcagggg\r\n     3121 ctcgcgccag ccgaactgtt cgccaggctc aaggcgagca tgcccgacgg cgaggatctc\r\n     3181 gtcgtgaccc atggcgatgc ctgcttgccg aatatcatgg tggaaaatgg ccgcttttct\r\n     3241 ggattcatcg actgtggccg gctgggtgtg gcggaccgct atcaggacat agcgttggct\r\n     3301 acccgtgata ttgctgaaga gcttggcggc gaatgggctg accgcttcct cgtgctttac\r\n     3361 ggtatcgccg ctcccgattc gcagcgcatc gccttctatc gccttcttga cgagttcttc\r\n     3421 tgagcgggac tctggggttc gaaatgaccg accaagcgac gcccaacctg ccatcacgag\r\n     3481 atttcgattc caccgccgcc ttctatgaaa ggttgggctt cggaatcgtt ttccgggacg\r\n     3541 ccggctggat gatcctccag cgcggggatc tcatgctgga gttcttcgcc caccctaggg\r\n     3601 ggaggctaac tgaaacacgg aaggagacaa taccggaagg aacccgcgct atgacggcaa\r\n     3661 taaaaagaca gaataaaacg cacggtgttg ggtcgtttgt tcataaacgc ggggttcggt\r\n     3721 cccagggctg gcactctgtc gataccccac cgagacccca ttggggccaa tacgcccgcg\r\n     3781 tttcttcctt ttccccaccc caccccccaa gttcgggtga aggcccaggg ctcgcagcca\r\n     3841 acgtcggggc ggcaggccct gccatagcct caggttactc atatatactt tagattgatt\r\n     3901 taaaacttca tttttaattt aaaaggatct aggtgaagat cctttttgat aatctcatga\r\n     3961 ccaaaatccc ttaacgtgag ttttcgttcc actgagcgtc agaccccgta gaaaagatca\r\n     4021 aaggatcttc ttgagatcct ttttttctgc gcgtaatctg ctgcttgcaa acaaaaaaac\r\n     4081 caccgctacc agcggtggtt tgtttgccgg atcaagagct accaactctt tttccgaagg\r\n     4141 taactggctt cagcagagcg cagataccaa atactgtcct tctagtgtag ccgtagttag\r\n     4201 gccaccactt caagaactct gtagcaccgc ctacatacct cgctctgcta atcctgttac\r\n     4261 cagtggctgc tgccagtggc gataagtcgt gtcttaccgg gttggactca agacgatagt\r\n     4321 taccggataa ggcgcagcgg tcgggctgaa cggggggttc gtgcacacag cccagcttgg\r\n     4381 agcgaacgac ctacaccgaa ctgagatacc tacagcgtga gctatgagaa agcgccacgc\r\n     4441 ttcccgaagg gagaaaggcg gacaggtatc cggtaagcgg cagggtcgga acaggagagc\r\n     4501 gcacgaggga gcttccaggg ggaaacgcct ggtatcttta tagtcctgtc gggtttcgcc\r\n     4561 acctctgact tgagcgtcga tttttgtgat gctcgtcagg ggggcggagc ctatggaaaa\r\n     4621 acgccagcaa cgcggccttt ttacggttcc tggccttttg ctggcctttt gctcacatgt\r\n     4681 tctttcctgc gttatcccct gattctgtgg ataaccgtat taccgccatg cat\r\n//\r\n\r\n"]);
  out.push(["users/alex/sequences/1.meta.json", {"id":1,"display_name":"pEGFP-N1 (U55762)","project_ids":["2"],"added_at":"2026-05-20T00:00:00Z","seq_type":"dna"}]);
  out.push(["users/alex/sequences/2.gb", "LOCUS       XXU13852                4952 bp    DNA     circular SYN 13-DEC-1994\r\nDEFINITION  pGEX-3X cloning vector, complete sequence.\r\nACCESSION   U13852\r\nVERSION     U13852.1\r\nKEYWORDS    glutathione S-transferase; beta-lactamase; lac repressor.\r\nSOURCE      unidentified cloning vector\r\n  ORGANISM  unidentified cloning vector\r\n            other sequences; artificial sequences; vectors.\r\nREFERENCE   1  (bases 1 to 4952)\r\n  AUTHORS   Malone,J.A.\r\n  TITLE     pGEX-3X: A cloning vector for the inducible expression of genes as\r\n            glutathione S-transferase fusion proteins containing a factor Xa\r\n            cleavage site\r\n  JOURNAL   Unpublished\r\nREFERENCE   2  (bases 1 to 4952)\r\n  AUTHORS   Smith,D.B. and Johnson,K.S.\r\n  TITLE     Single-step purification of polypeptides expressed in Escherichia\r\n            coli as fusions with glutathione S-transferase\r\n  JOURNAL   Gene 67 (1), 31-40 (1988)\r\n   PUBMED   3047011\r\nREFERENCE   3  (bases 264 to 911)\r\n  AUTHORS   Smith,D.B., Davern,K.M., Board,P.G., Tiu,W.U., Garcia,E.G. and\r\n            Mitchell,G.F.\r\n  TITLE     Mr 26,000 antigen of Schistosoma japonicum recognized by resistant\r\n            WEHI 129/J mice is a parasite glutathione S-transferase\r\n  JOURNAL   Proc. Natl. Acad. Sci. U.S.A. 83 (22), 8703-8707 (1986)\r\n   PUBMED   3095841\r\n  REMARK    Erratum:[Proc Natl Acad Sci U S A 1987 Sep;84(18):6541]\r\nREFERENCE   4  (bases 881 to 911)\r\n  AUTHORS   Smith,D.B., Davern,K.M., Board,P.G., Tiu,W.U., Garcia,E.G. and\r\n            Mitchell,G.F.\r\n  TITLE     Correction: Mr 26,000 antigen of Schistosoma japonicum recognized\r\n            by resistant WEHI 129/J mice is a parasite glutathione\r\n            S-transferase\r\n  JOURNAL   Proc. Natl. Acad. Sci. U.S.A. 84, 6541-6541 (1987)\r\nREFERENCE   5  (bases 1 to 4952)\r\n  AUTHORS   Malone,J.A.\r\n  TITLE     Direct Submission\r\n  JOURNAL   Submitted (19-AUG-1994) James A. Malone, International Technical\r\n            Services, Molecular Biology Reagents Division, Pharmacia Biotech\r\n            Inc., 2202 N. Bartlett Ave., Milwaukee, WI 53202-1009, USA\r\nFEATURES             Location/Qualifiers\r\n     source          1..4952\r\n                     /organism=\"unidentified cloning vector\"\r\n                     /mol_type=\"genomic DNA\"\r\n                     /db_xref=\"taxon:45196\"\r\n                     /lab_host=\"Escherichia coli\"\r\n     regulatory      183..211\r\n                     /regulatory_class=\"promoter\"\r\n                     /standard_name=\"tac\"\r\n                     /note=\"tac promoter for inducible expression of\r\n                     glutathione S-transferase\"\r\n     protein_bind    217..237\r\n                     /bound_moiety=\"lac repressor protein\"\r\n     CDS             258..956\r\n                     /citation=[3]\r\n                     /citation=[4]\r\n                     /codon_start=1\r\n                     /transl_table=11\r\n                     /organism=\"Schistosoma japonicum\"\r\n                     /product=\"glutathione S-transferase\"\r\n                     /protein_id=\"AAA57095.1\"\r\n                     /translation=\"MSPILGYWKIKGLVQPTRLLLEYLEEKYEEHLYERDEGDKWRNK\r\n                     KFELGLEFPNLPYYIDGDVKLTQSMAIIRYIADKHNMLGGCPKERAEISMLEGAVLDI\r\n                     RYGVSRIAYSKDFETLKVDFLSKLPEMLKMFEDRLCHKTYLNGDHVTHPDFMLYDALD\r\n                     VVLYMDPMCLDAFPKLVCFKKRIEAIPQIDKYLKSSKYIAWPLQGWQATFGGGDHPPK\r\n                     SDLIEGRGIPGNSS\"\r\n     misc_feature    921..932\r\n                     /note=\"encodes factor Xa recognition site\"\r\n     misc_feature    934..949\r\n                     /note=\"Multiple Cloning Site (MCS); contains the unique\r\n                     restriction sites BamHI, SmaI and EcoR I\"\r\n     gene            1290..2220\r\n                     /gene=\"bla\"\r\n     regulatory      1290..1318\r\n                     /regulatory_class=\"promoter\"\r\n                     /gene=\"bla\"\r\n     CDS             1360..2220\r\n                     /gene=\"bla\"\r\n                     /codon_start=1\r\n                     /transl_table=11\r\n                     /product=\"beta-lactamase\"\r\n                     /protein_id=\"AAA57096.1\"\r\n                     /translation=\"MSIQHFRVALIPFFAAFCLPVFAHPETLVKVKDAEDQLGARVGY\r\n                     IELDLNSGKILESFRPEERFPMMSTFKVLLCGAVLSRVDAGQEQLGRRIHYSQNDLVE\r\n                     YSPVTEKHLTDGMTVRELCSAAITMSDNTAANLLLTTIGGPKELTAFLHNMGDHVTRL\r\n                     DRWEPELNEAIPNDERDTTMPAAMATTLRKLLTGELLTLASRQQLIDWMEADKVAGPL\r\n                     LRSALPAGWFIADKSGAGERGSRGIIAALGPDGKPSRIVVIYTTGSQATMDERNRQIA\r\n                     EIGASLIKHW\"\r\n     rep_origin      2978\r\n                     /note=\"base 2978 represents the first base of the newly\r\n                     synthesized single strand\"\r\n                     /direction=right\r\n     gene            3301..4383\r\n                     /gene=\"lacIq\"\r\n     CDS             3301..4383\r\n                     /gene=\"lacIq\"\r\n                     /codon_start=1\r\n                     /transl_table=11\r\n                     /product=\"lac repressor\"\r\n                     /protein_id=\"AAA57097.1\"\r\n                     /translation=\"MKPVTLYDVAEYAGVSYQTVSRVVNQASHVSAKTREKVEAAMAE\r\n                     LNYIPNRVAQQLAGKQSLLIGVATSSLALHAPSQIVAAIKSRADQLGASVVVSMVERS\r\n                     GVEACKAAVHNLLAQRVSGLIINYPLDDQDAIAVEAACTNVPALFLDVSDQTPINSII\r\n                     FSHEDGTRLGVEHLVALGHQQIALLAGPLSSVSARLRLAGWHKYLTRNQIQPIAEREG\r\n                     DWSAMSGFQQTMQMLNEGIVPTAMLVANDQMALGAMRAITESGLRVGADISVVGYDDT\r\n                     EDSSCYIPPLTTIKQDFRLLGQTSVDRLLQLSQGQAVKGNQLLPVSLVKRKTTLAPNT\r\n                     QTASPRALADSLMQLARQVSRLESGQ\"\r\nORIGIN      \r\n        1 agcttatcga ctgcacggtg caccaatgct tctggcgtca ggcagccatc ggaagctgtg\r\n       61 gtatggctgt gcaggtcgta aatcactgca taattcgtgt cgctcaaggc gcactcccgt\r\n      121 tctggataat gttttttgcg ccgacatcat aacggttctg gcaaatattc tgaaatgagc\r\n      181 tgttgacaat taatcatcgg ctcgtataat gtgtggaatt gtgagcggat aacaatttca\r\n      241 cacaggaaac agtattcatg tcccctatac taggttattg gaaaattaag ggccttgtgc\r\n      301 aacccactcg acttcttttg gaatatcttg aagaaaaata tgaagagcat ttgtatgagc\r\n      361 gcgatgaagg tgataaatgg cgaaacaaaa agtttgaatt gggtttggag tttcccaatc\r\n      421 ttccttatta tattgatggt gatgttaaat taacacagtc tatggccatc atacgttata\r\n      481 tagctgacaa gcacaacatg ttgggtggtt gtccaaaaga gcgtgcagag atttcaatgc\r\n      541 ttgaaggagc ggttttggat attagatacg gtgtttcgag aattgcatat agtaaagact\r\n      601 ttgaaactct caaagttgat tttcttagca agctacctga aatgctgaaa atgttcgaag\r\n      661 atcgtttatg tcataaaaca tatttaaatg gtgatcatgt aacccatcct gacttcatgt\r\n      721 tgtatgacgc tcttgatgtt gttttataca tggacccaat gtgcctggat gcgttcccaa\r\n      781 aattagtttg ttttaaaaaa cgtattgaag ctatcccaca aattgataag tacttgaaat\r\n      841 ccagcaagta tatagcatgg cctttgcagg gctggcaagc cacgtttggt ggtggcgacc\r\n      901 atcctccaaa atcggatctg atcgaaggtc gtgggatccc cgggaattca tcgtgactga\r\n      961 ctgacgatct gcctcgcgcg tttcggtgat gacggtgaaa acctctgaca catgcagctc\r\n     1021 ccggagacgg tcacagcttg tctgtaagcg gatgccggga gcagacaagc ccgtcagggc\r\n     1081 gcgtcagcgg gtgttggcgg gtgtcggggc gcagccatga cccagtcacg tagcgatagc\r\n     1141 ggagtgtata attcttgaag acgaaagggc ctcgtgatac gcctattttt ataggttaat\r\n     1201 gtcatgataa taatggtttc ttagacgtca ggtggcactt ttcggggaaa tgtgcgcgga\r\n     1261 acccctattt gtttattttt ctaaatacat tcaaatatgt atccgctcat gagacaataa\r\n     1321 ccctgataaa tgcttcaata atattgaaaa aggaagagta tgagtattca acatttccgt\r\n     1381 gtcgccctta ttcccttttt tgcggcattt tgccttcctg tttttgctca cccagaaacg\r\n     1441 ctggtgaaag taaaagatgc tgaagatcag ttgggtgcac gagtgggtta catcgaactg\r\n     1501 gatctcaaca gcggtaagat ccttgagagt tttcgccccg aagaacgttt tccaatgatg\r\n     1561 agcactttta aagttctgct atgtggcgcg gtattatccc gtgttgacgc cgggcaagag\r\n     1621 caactcggtc gccgcataca ctattctcag aatgacttgg ttgagtactc accagtcaca\r\n     1681 gaaaagcatc ttacggatgg catgacagta agagaattat gcagtgctgc cataaccatg\r\n     1741 agtgataaca ctgcggccaa cttacttctg acaacgatcg gaggaccgaa ggagctaacc\r\n     1801 gcttttttgc acaacatggg ggatcatgta actcgccttg atcgttggga accggagctg\r\n     1861 aatgaagcca taccaaacga cgagcgtgac accacgatgc ctgcagcaat ggcaacaacg\r\n     1921 ttgcgcaaac tattaactgg cgaactactt actctagctt cccggcaaca attaatagac\r\n     1981 tggatggagg cggataaagt tgcaggacca cttctgcgct cggcccttcc ggctggctgg\r\n     2041 tttattgctg ataaatctgg agccggtgag cgtgggtctc gcggtatcat tgcagcactg\r\n     2101 gggccagatg gtaagccctc ccgtatcgta gttatctaca cgacggggag tcaggcaact\r\n     2161 atggatgaac gaaatagaca gatcgctgag ataggtgcct cactgattaa gcattggtaa\r\n     2221 ctgtcagacc aagtttactc atatatactt tagattgatt taaaacttca tttttaattt\r\n     2281 aaaaggatct aggtgaagat cctttttgat aatctcatga ccaaaatccc ttaacgtgag\r\n     2341 ttttcgttcc actgagcgtc agaccccgta gaaaagatca aaggatcttc ttgagatcct\r\n     2401 ttttttctgc gcgtaatctg ctgcttgcaa acaaaaaaac caccgctacc agcggtggtt\r\n     2461 tgtttgccgg atcaagagct accaactctt tttccgaagg taactggctt cagcagagcg\r\n     2521 cagataccaa atactgtcct tctagtgtag ccgtagttag gccaccactt caagaactct\r\n     2581 gtagcaccgc ctacatacct cgctctgcta atcctgttac cagtggctgc tgccagtggc\r\n     2641 gataagtcgt gtcttaccgg gttggactca agacgatagt taccggataa ggcgcagcgg\r\n     2701 tcgggctgaa cggggggttc gtgcacacag cccagcttgg agcgaacgac ctacaccgaa\r\n     2761 ctgagatacc tacagcgtga gctatgagaa agcgccacgc ttcccgaagg gagaaaggcg\r\n     2821 gacaggtatc cggtaagcgg cagggtcgga acaggagagc gcacgaggga gcttccaggg\r\n     2881 ggaaacgcct ggtatcttta tagtcctgtc gggtttcgcc acctctgact tgagcgtcga\r\n     2941 tttttgtgat gctcgtcagg ggggcggagc ctatggaaaa acgccagcaa cgcggccttt\r\n     3001 ttacggttcc tggccttttg ctggcctttt gctcacatgt tctttcctgc gttatcccct\r\n     3061 gattctgtgg ataaccgtat taccgccttt gagtgagctg ataccgctcg ccgcagccga\r\n     3121 acgaccgagc gcagcgagtc agtgagcgag gaagcggaag agcgcctgat gcggtatttt\r\n     3181 ctccttacgc atctgtgcgg tatttcacac cgcataaatt ccgacaccat cgaatggtgc\r\n     3241 aaaacctttc gcggtatggc atgatagcgc ccggaagaga gtcaattcag ggtggtgaat\r\n     3301 gtgaaaccag taacgttata cgatgtcgca gagtatgccg gtgtctctta tcagaccgtt\r\n     3361 tcccgcgtgg tgaaccaggc cagccacgtt tctgcgaaaa cgcgggaaaa agtggaagcg\r\n     3421 gcgatggcgg agctgaatta cattcccaac cgcgtggcac aacaactggc gggcaaacag\r\n     3481 tcgttgctga ttggcgttgc cacctccagt ctggccctgc acgcgccgtc gcaaattgtc\r\n     3541 gcggcgatta aatctcgcgc cgatcaactg ggtgccagcg tggtggtgtc gatggtagaa\r\n     3601 cgaagcggcg tcgaagcctg taaagcggcg gtgcacaatc ttctcgcgca acgcgtcagt\r\n     3661 gggctgatca ttaactatcc gctggatgac caggatgcca ttgctgtgga agctgcctgc\r\n     3721 actaatgttc cggcgttatt tcttgatgtc tctgaccaga cacccatcaa cagtattatt\r\n     3781 ttctcccatg aagacggtac gcgactgggc gtggagcatc tggtcgcatt gggtcaccag\r\n     3841 caaatcgcgc tgttagcggg cccattaagt tctgtctcgg cgcgtctgcg tctggctggc\r\n     3901 tggcataaat atctcactcg caatcaaatt cagccgatag cggaacggga aggcgactgg\r\n     3961 agtgccatgt ccggttttca acaaaccatg caaatgctga atgagggcat cgttcccact\r\n     4021 gcgatgctgg ttgccaacga tcagatggcg ctgggcgcaa tgcgcgccat taccgagtcc\r\n     4081 gggctgcgcg ttggtgcgga tatctcggta gtgggatacg acgataccga agacagctca\r\n     4141 tgttatatcc cgccgttaac caccatcaaa caggattttc gcctgctggg gcaaaccagc\r\n     4201 gtggaccgct tgctgcaact ctctcagggc caggcggtga agggcaatca gctgttgccc\r\n     4261 gtctcactgg tgaaaagaaa aaccaccctg gcgcccaata cgcaaaccgc ctctccccgc\r\n     4321 gcgttggccg attcattaat gcagctggca cgacaggttt cccgactgga aagcgggcag\r\n     4381 tgagcgcaac gcaattaatg tgagttagct cactcattag gcaccccagg ctttacactt\r\n     4441 tatgcttccg gctcgtatgt tgtgtggaat tgtgagcgga taacaatttc acacaggaaa\r\n     4501 cagctatgac catgattacg gattcactgg ccgtcgtttt acaacgtcgt gactgggaaa\r\n     4561 accctggcgt tacccaactt aatcgccttg cagcacatcc ccctttcgcc agctggcgta\r\n     4621 atagcgaaga ggcccgcacc gatcgccctt cccaacagtt gcgcagcctg aatggcgaat\r\n     4681 ggcgctttgc ctggtttccg gcaccagaag cggtgccgga aagctggctg gagtgcgatc\r\n     4741 ttcctgaggc cgatactgtc gtcgtcccct caaactggca gatgcacggt tacgatgcgc\r\n     4801 ccatctacac caacgtaacc tatcccatta cggtcaatcc gccgtttgtt cccacggaga\r\n     4861 atccgacggg ttgttactcg ctcacattta atgttgatga aagctggcta caggaaggcc\r\n     4921 agacgcgaat tatttttgat ggcgttggaa tt\r\n//\r\n\r\n"]);
  out.push(["users/alex/sequences/2.meta.json", {"id":2,"display_name":"pGEX-3X (U13852)","project_ids":["1","2"],"added_at":"2026-05-22T00:00:00Z","seq_type":"dna"}]);
  out.push(["users/alex/sequences/3.gb", "LOCUS       LT726828                6654 bp    DNA     circular SYN 06-FEB-2017\r\nDEFINITION  Mammalian expression vector pEGFP-N1-TRAP1, complete sequence.\r\nACCESSION   LT726828\r\nVERSION     LT726828.1\r\nKEYWORDS    .\r\nSOURCE      Mammalian expression vector pEGFP-N1-TRAP1\r\n  ORGANISM  Mammalian expression vector pEGFP-N1-TRAP1\r\n            other sequences; artificial sequences; vectors.\r\nREFERENCE   1\r\n  AUTHORS   De Schamphelaire,W., Olbrechts,A., Meert,J., Verhelst,K., Roggeman\r\n            Fonseca,M., Vanhoucke,M. and Beyaert,R.\r\n  TITLE     BCCM/LMBP Plasmid collection\r\n  JOURNAL   Unpublished\r\nREFERENCE   2  (bases 1 to 6654)\r\n  AUTHORS   De Schamphelaire,W.\r\n  TITLE     Direct Submission\r\n  JOURNAL   Submitted (02-FEB-2017) BCCM/LMBP, Universiteit Gent,\r\n            Technologiepark 927, 9052, BELGIUM\r\nFEATURES             Location/Qualifiers\r\n     source          1..6654\r\n                     /organism=\"Mammalian expression vector pEGFP-N1-TRAP1\"\r\n                     /mol_type=\"other DNA\"\r\n                     /db_xref=\"taxon:1945021\"\r\n                     /note=\"BCCM/LMBP Plasmid collection (Ghent\r\n                     University,Belgium) accession number LMBP 6239.\"\r\n     regulatory      1..568\r\n                     /regulatory_class=\"promoter\"\r\n                     /note=\"hCMV-IE promoter and enhancer\"\r\n     CDS             641..>2578\r\n                     /note=\"unnamed protein product; mature hTRAP1\"\r\n                     /codon_start=1\r\n                     /transl_table=11\r\n                     /protein_id=\"SJL86614.1\"\r\n                     /translation=\"MSTQTAEDKEEPLHSIISSTESVQGSTSKHEFQAETKKLLDIVA\r\n                     RSLYSEKEVFIRELISNASDALEKLRHKLVSDGQALPEMEIHLQTNAEKGTITIQDTG\r\n                     IGMTQEELVSNLGTIARSGSKAFLDALQNQAEASSKIIGQFGVGFYSAFMVADRVEVY\r\n                     SRSAAPGSLGYQWLSDGSGVFEIAEASGVRTGTKIIIHLKSDCKEFSSEARVRDVVTK\r\n                     YSNFVSFPLYLNGRRMNTLQAIWMMDPKDVGEWQHEEFYRYVAQAHDKPRYTLHYKTD\r\n                     APLNIRSIFYVPDMKPSMFDVSRELGSSVALYSRKVLIQTKATDILPKWLRFIRGVVD\r\n                     SEDIPLNLSRELLQESALIRKLRDVLQQRLIKFFIDQSKKDAEKYAKFFEDYGLFMRE\r\n                     GIVTATEQEVKEDIAKLLRYESSALPSGQLTSLSEYASRMRAGTRNIYYLCAPNRHLA\r\n                     EHSPYYEAMKKKDTEVLFCFEQFDELTLLHLREFDKKKLISVETDIVVDHYKEEKFED\r\n                     RSPAAECLSEKETEELMAWMRNVLGSRVTNVKVTLRLDTHPAMVTVLEMGAARHFLRM\r\n                     QQLAKTQEERAQLLQPTLEINPRHALIKKLNQLRASEPGLAQLLVDQIYENAMIAAGL\r\n                     VDDPRAMVGRLNELLVKALERH\"\r\n     CDS             2600..3319\r\n                     /note=\"unnamed protein product; EGFP\"\r\n                     /codon_start=1\r\n                     /transl_table=11\r\n                     /protein_id=\"SJL86615.1\"\r\n                     /translation=\"MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLT\r\n                     LKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFK\r\n                     DDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKN\r\n                     GIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDH\r\n                     MVLLEFVTAAGITLGMDELYK\"\r\n     regulatory      3420..3516\r\n                     /regulatory_class=\"terminator\"\r\n                     /note=\"SV40 polyA early\"\r\n     regulatory      complement(3420..3516)\r\n                     /regulatory_class=\"terminator\"\r\n                     /note=\"SV40 polyA late\"\r\n     rep_origin      complement(3570..4025)\r\n                     /note=\"f1 ori\"\r\n     regulatory      4026..4121\r\n                     /regulatory_class=\"promoter\"\r\n                     /note=\"ampicillin promoter\"\r\n     misc_feature    4122..4156\r\n                     /note=\"5' UTR of amp, incl. RBS\"\r\n     regulatory      4177..4458\r\n                     /regulatory_class=\"promoter\"\r\n                     /note=\"SV40 early promoter\"\r\n     rep_origin      4415..4490\r\n                     /note=\"SV40 ori\"\r\n     CDS             4550..5344\r\n                     /note=\"unnamed protein product; Tn5 neomycin resistance\"\r\n                     /codon_start=1\r\n                     /transl_table=11\r\n                     /protein_id=\"SJL86616.1\"\r\n                     /translation=\"MIEQDGLHAGSPAAWVERLFGYDWAQQTIGCSDAAVFRLSAQGR\r\n                     PVLFVKTDLSGALNELQDEAARLSWLATTGVPCAAVLDVVTEAGRDWLLLGEVPGQDL\r\n                     LSSHLAPAEKVSIMADAMRRLHTLDPATCPFDHQAKHRIERARTRMEAGLVDQDDLDE\r\n                     EHQGLAPAELFARLKASMPDGEDLVVTHGDACLPNIMVENGRFSGFIDCGRLGVADRY\r\n                     QDIALATRDIAEELGGEWADRFLVLYGIAAPDSQRIAFYRLLDEFF\"\r\n     regulatory      5535..5604\r\n                     /regulatory_class=\"terminator\"\r\n                     /note=\"HSV-TK polyA\"\r\n     rep_origin      6322..6648\r\n                     /note=\"pMB1 ori\"\r\nORIGIN      \r\n        1 tagttattaa tagtaatcaa ttacggggtc attagttcat agcccatata tggagttccg\r\n       61 cgttacataa cttacggtaa atggcccgcc tggctgaccg cccaacgacc cccgcccatt\r\n      121 gacgtcaata atgacgtatg ttcccatagt aacgccaata gggactttcc attgacgtca\r\n      181 atgggtggag tatttacggt aaactgccca cttggcagta catcaagtgt atcatatgcc\r\n      241 aagtacgccc cctattgacg tcaatgacgg taaatggccc gcctggcatt atgcccagta\r\n      301 catgacctta tgggactttc ctacttggca gtacatctac gtattagtca tcgctattac\r\n      361 catggtgatg cggttttggc agtacatcaa tgggcgtgga tagcggtttg actcacgggg\r\n      421 atttccaagt ctccacccca ttgacgtcaa tgggagtttg ttttggcacc aaaatcaacg\r\n      481 ggactttcca aaatgtcgta acaactccgc cccattgacg caaatgggcg gtaggcgtgt\r\n      541 acggtgggag gtctatataa gcagagctgg tttagtgaac cgtcagatcc gctagcgcta\r\n      601 ccggactcag atctcgagct caagcttcga attcgccgcc atgagcacgc agaccgccga\r\n      661 ggacaaggag gaacccctgc actcgattat cagcagcaca gagagcgtgc agggttccac\r\n      721 ttccaaacat gagttccagg ccgagacaaa gaagcttttg gacattgttg cccggtccct\r\n      781 gtactcagaa aaagaggtgt ttatacggga gctgatctcc aatgccagcg atgccttgga\r\n      841 aaaactgcgt cacaaactgg tgtctgacgg ccaagcactg ccagaaatgg agattcactt\r\n      901 gcagaccaat gccgagaaag gcaccatcac catccaggat actggtatcg ggatgacaca\r\n      961 ggaagagctg gtgtccaacc tggggacgat tgccagatcg gggtcaaagg ccttcctgga\r\n     1021 tgctctgcag aaccaggctg aggccagcag caagatcatc ggccagtttg gagtgggttt\r\n     1081 ctactcagct ttcatggtgg ctgacagagt ggaggtctat tcccgctcgg cagccccggg\r\n     1141 gagcctgggt taccagtggc tttcagatgg ttctggagtg tttgaaatcg ccgaagcttc\r\n     1201 gggagttaga accgggacaa aaatcatcat ccacctgaaa tccgactgca aggagttttc\r\n     1261 cagcgaggcc cgggtgcgag atgtggtaac gaagtacagc aacttcgtca gcttcccctt\r\n     1321 gtacttgaat ggaaggcgga tgaacacctt gcaggccatc tggatgatgg accccaagga\r\n     1381 tgtcggtgag tggcaacatg aggagttcta ccgctacgtc gcgcaggctc acgacaagcc\r\n     1441 ccgctacacc ctgcactata agacggacgc accgctcaac atccgcagca tcttctacgt\r\n     1501 gcccgacatg aaaccgtcca tgtttgatgt gagccgggag ctgggctcca gcgttgcact\r\n     1561 gtacagccgc aaagtcctca tccagaccaa ggccacggac atcctgccca agtggctgcg\r\n     1621 cttcatccga ggtgtggtgg acagtgagga cattcccctg aacctcagcc gggagctgct\r\n     1681 gcaggagagc gcactcatca ggaaactccg ggacgtttta cagcagaggc tgatcaaatt\r\n     1741 cttcattgac cagagtaaaa aagatgctga gaagtatgca aagttttttg aagattacgg\r\n     1801 cctgttcatg cgggagggca ttgtgaccgc caccgagcag gaggtcaagg aggacatagc\r\n     1861 aaagctgctg cgctacgagt cctcggcgct gccctccggg cagctaacca gcctctcaga\r\n     1921 atacgccagc cgcatgcggg ccggcacccg caacatctac tacctgtgcg cccccaaccg\r\n     1981 tcacctggca gagcactcac cctactatga ggccatgaag aagaaagaca cagaggttct\r\n     2041 cttctgcttt gagcagtttg atgagctcac cctgctgcac cttcgtgagt ttgacaagaa\r\n     2101 gaagctgatc tctgtggaga cggacatagt cgtggatcac tacaaggagg agaagtttga\r\n     2161 ggacaggtcc ccagccgccg agtgcctatc agagaaggag acggaggagc tcatggcctg\r\n     2221 gatgagaaat gtgctggggt cgcgtgtcac caacgtgaag gtgaccctcc gactggacac\r\n     2281 ccaccctgcc atggtcaccg tgctggagat gggggctgcc cgccacttcc tgcgcatgca\r\n     2341 gcagctggcc aagacccagg aggagcgcgc acagctcctg cagcccacgc tggagatcaa\r\n     2401 ccccaggcac gcgctcatca agaagctgaa tcagctgcgc gcaagcgagc ctggcctggc\r\n     2461 tcagctgctg gtggatcaga tatacgagaa cgccatgatt gctgctggac ttgttgacga\r\n     2521 ccctagggcc atggtgggcc gcttgaatga gctgcttgtc aaggccctgg agcgacaccg\r\n     2581 ggatccaccg gtcgccacca tggtgagcaa gggcgaggag ctgttcaccg gggtggtgcc\r\n     2641 catcctggtc gagctggacg gcgacgtaaa cggccacaag ttcagcgtgt ccggcgaggg\r\n     2701 cgagggcgat gccacctacg gcaagctgac cctgaagttc atctgcacca ccggcaagct\r\n     2761 gcccgtgccc tggcccaccc tcgtgaccac cctgacctac ggcgtgcagt gcttcagccg\r\n     2821 ctaccccgac cacatgaagc agcacgactt cttcaagtcc gccatgcccg aaggctacgt\r\n     2881 ccaggagcgc accatcttct tcaaggacga cggcaactac aagacccgcg ccgaggtgaa\r\n     2941 gttcgagggc gacaccctgg tgaaccgcat cgagctgaag ggcatcgact tcaaggagga\r\n     3001 cggcaacatc ctggggcaca agctggagta caactacaac agccacaacg tctatatcat\r\n     3061 ggccgacaag cagaagaacg gcatcaaggt gaacttcaag atccgccaca acatcgagga\r\n     3121 cggcagcgtg cagctcgccg accactacca gcagaacacc cccatcggcg acggccccgt\r\n     3181 gctgctgccc gacaaccact acctgagcac ccagtccgcc ctgagcaaag accccaacga\r\n     3241 gaagcgcgat cacatggtcc tgctggagtt cgtgaccgcc gccgggatca ctctcggcat\r\n     3301 ggacgagctg tacaagtaaa gcggccgcga ctctagatca taatcagcca taccacattt\r\n     3361 gtagaggttt tacttgcttt aaaaaacctc ccacacctcc ccctgaacct gaaacataaa\r\n     3421 atgaatgcaa ttgttgttgt taacttgttt attgcagctt ataatggtta caaataaagc\r\n     3481 aatagcatca caaatttcac aaataaagca tttttttcac tgcattctag ttgtggtttg\r\n     3541 tccaaactca tcaatgtatc ttaaggcgta aattgtaagc gttaatattt tgttaaaatt\r\n     3601 cgcgttaaat ttttgttaaa tcagctcatt ttttaaccaa taggccgaaa tcggcaaaat\r\n     3661 cccttataaa tcaaaagaat agaccgagat agggttgagt gttgttccag tttggaacaa\r\n     3721 gagtccacta ttaaagaacg tggactccaa cgtcaaaggg cgaaaaaccg tctatcaggg\r\n     3781 cgatggccca ctacgtgaac catcacccta atcaagtttt ttggggtcga ggtgccgtaa\r\n     3841 agcactaaat cggaacccta aagggagccc ccgatttaga gcttgacggg gaaagccggc\r\n     3901 gaacgtggcg agaaaggaag ggaagaaagc gaaaggagcg ggcgctaggg cgctggcaag\r\n     3961 tgtagcggtc acgctgcgcg taaccaccac acccgccgcg cttaatgcgc cgctacaggg\r\n     4021 cgcgtcaggt ggcacttttc ggggaaatgt gcgcggaacc cctatttgtt tatttttcta\r\n     4081 aatacattca aatatgtatc cgctcatgag acaataaccc tgataaatgc ttcaataata\r\n     4141 ttgaaaaagg aagagtcctg aggcggaaag aaccagctgt ggaatgtgtg tcagttaggg\r\n     4201 tgtggaaagt ccccaggctc cccagcaggc agaagtatgc aaagcatgca tctcaattag\r\n     4261 tcagcaacca ggtgtggaaa gtccccaggc tccccagcag gcagaagtat gcaaagcatg\r\n     4321 catctcaatt agtcagcaac catagtcccg cccctaactc cgcccatccc gcccctaact\r\n     4381 ccgcccagtt ccgcccattc tccgccccat ggctgactaa ttttttttat ttatgcagag\r\n     4441 gccgaggccg cctcggcctc tgagctattc cagaagtagt gaggaggctt ttttggaggc\r\n     4501 ctaggctttt gcaaagatcg atcaagagac aggatgagga tcgtttcgca tgattgaaca\r\n     4561 agatggattg cacgcaggtt ctccggccgc ttgggtggag aggctattcg gctatgactg\r\n     4621 ggcacaacag acaatcggct gctctgatgc cgccgtgttc cggctgtcag cgcaggggcg\r\n     4681 cccggttctt tttgtcaaga ccgacctgtc cggtgccctg aatgaactgc aagacgaggc\r\n     4741 agcgcggcta tcgtggctgg ccacgacggg cgttccttgc gcagctgtgc tcgacgttgt\r\n     4801 cactgaagcg ggaagggact ggctgctatt gggcgaagtg ccggggcagg atctcctgtc\r\n     4861 atctcacctt gctcctgccg agaaagtatc catcatggct gatgcaatgc ggcggctgca\r\n     4921 tacgcttgat ccggctacct gcccattcga ccaccaagcg aaacatcgca tcgagcgagc\r\n     4981 acgtactcgg atggaagccg gtcttgtcga tcaggatgat ctggacgaag agcatcaggg\r\n     5041 gctcgcgcca gccgaactgt tcgccaggct caaggcgagc atgcccgacg gcgaggatct\r\n     5101 cgtcgtgacc catggcgatg cctgcttgcc gaatatcatg gtggaaaatg gccgcttttc\r\n     5161 tggattcatc gactgtggcc ggctgggtgt ggcggaccgc tatcaggaca tagcgttggc\r\n     5221 tacccgtgat attgctgaag agcttggcgg cgaatgggct gaccgcttcc tcgtgcttta\r\n     5281 cggtatcgcc gctcccgatt cgcagcgcat cgccttctat cgccttcttg acgagttctt\r\n     5341 ctgagcggga ctctggggtt cgaaatgacc gaccaagcga cgcccaacct gccatcacga\r\n     5401 gatttcgatt ccaccgccgc cttctatgaa aggttgggct tcggaatcgt tttccgggac\r\n     5461 gccggctgga tgatcctcca gcgcggggat ctcatgctgg agttcttcgc ccaccctagg\r\n     5521 gggaggctaa ctgaaacacg gaaggagaca ataccggaag gaacccgcgc tatgacggca\r\n     5581 ataaaaagac agaataaaac gcacggtgtt gggtcgtttg ttcataaacg cggggttcgg\r\n     5641 tcccagggct ggcactctgt cgatacccca ccgagacccc attggggcca atacgcccgc\r\n     5701 gtttcttcct tttccccacc ccacccccca agttcgggtg aaggcccagg gctcgcagcc\r\n     5761 aacgtcgggg cggcaggccc tgccatagcc tcaggttact catatatact ttagattgat\r\n     5821 ttaaaacttc atttttaatt taaaaggatc taggtgaaga tcctttttga taatctcatg\r\n     5881 accaaaatcc cttaacgtga gttttcgttc cactgagcgt cagaccccgt agaaaagatc\r\n     5941 aaaggatctt cttgagatcc tttttttctg cgcgtaatct gctgcttgca aacaaaaaaa\r\n     6001 ccaccgctac cagcggtggt ttgtttgccg gatcaagagc taccaactct ttttccgaag\r\n     6061 gtaactggct tcagcagagc gcagatacca aatactgtcc ttctagtgta gccgtagtta\r\n     6121 ggccaccact tcaagaactc tgtagcaccg cctacatacc tcgctctgct aatcctgtta\r\n     6181 ccagtggctg ctgccagtgg cgataagtcg tgtcttaccg ggttggactc aagacgatag\r\n     6241 ttaccggata aggcgcagcg gtcgggctga acggggggtt cgtgcacaca gcccagcttg\r\n     6301 gagcgaacga cctacaccga actgagatac ctacagcgtg agctatgaga aagcgccacg\r\n     6361 cttcccgaag ggagaaaggc ggacaggtat ccggtaagcg gcagggtcgg aacaggagag\r\n     6421 cgcacgaggg agcttccagg gggaaacgcc tggtatcttt atagtcctgt cgggtttcgc\r\n     6481 cacctctgac ttgagcgtcg atttttgtga tgctcgtcag gggggcggag cctatggaaa\r\n     6541 aacgccagca acgcggcctt tttacggttc ctggcctttt gctggccttt tgctcacatg\r\n     6601 ttctttcctg cgttatcccc tgattctgtg gataaccgta ttaccgccat gcat\r\n//\r\n\r\n"]);
  out.push(["users/alex/sequences/3.meta.json", {"id":3,"display_name":"pEGFP-N1-TRAP1 (LT726828)","project_ids":["1"],"added_at":"2026-06-03T00:00:00Z","seq_type":"dna"}]);
  out.push(["users/alex/sequences/4.gb", "LOCUS       pEGFP_N1_fragA      2360 bp    DNA     linear   SYN 04-JUN-2026\r\nDEFINITION  pEGFP-N1 fragment A, linear PCR product (Gibson assembly demo).\r\nACCESSION   .\r\nVERSION     .\r\nKEYWORDS    .\r\nSOURCE      synthetic DNA construct\r\n  ORGANISM  synthetic DNA construct\r\nFEATURES             Location/Qualifiers\r\n     source          1..2360\r\nORIGIN      \r\n        1 tagttattaa tagtaatcaa ttacggggtc attagttcat agcccatata tggagttccg\r\n       61 cgttacataa cttacggtaa atggcccgcc tggctgaccg cccaacgacc cccgcccatt\r\n      121 gacgtcaata atgacgtatg ttcccatagt aacgccaata gggactttcc attgacgtca\r\n      181 atgggtggag tatttacggt aaactgccca cttggcagta catcaagtgt atcatatgcc\r\n      241 aagtacgccc cctattgacg tcaatgacgg taaatggccc gcctggcatt atgcccagta\r\n      301 catgacctta tgggactttc ctacttggca gtacatctac gtattagtca tcgctattac\r\n      361 catggtgatg cggttttggc agtacatcaa tgggcgtgga tagcggtttg actcacgggg\r\n      421 atttccaagt ctccacccca ttgacgtcaa tgggagtttg ttttggcacc aaaatcaacg\r\n      481 ggactttcca aaatgtcgta acaactccgc cccattgacg caaatgggcg gtaggcgtgt\r\n      541 acggtgggag gtctatataa gcagagctgg tttagtgaac cgtcagatcc gctagcgcta\r\n      601 ccggactcag atctcgagct caagcttcga attctgcagt cgacggtacc gcgggcccgg\r\n      661 gatccaccgg tcgccaccat ggtgagcaag ggcgaggagc tgttcaccgg ggtggtgccc\r\n      721 atcctggtcg agctggacgg cgacgtaaac ggccacaagt tcagcgtgtc cggcgagggc\r\n      781 gagggcgatg ccacctacgg caagctgacc ctgaagttca tctgcaccac cggcaagctg\r\n      841 cccgtgccct ggcccaccct cgtgaccacc ctgacctacg gcgtgcagtg cttcagccgc\r\n      901 taccccgacc acatgaagca gcacgacttc ttcaagtccg ccatgcccga aggctacgtc\r\n      961 caggagcgca ccatcttctt caaggacgac ggcaactaca agacccgcgc cgaggtgaag\r\n     1021 ttcgagggcg acaccctggt gaaccgcatc gagctgaagg gcatcgactt caaggaggac\r\n     1081 ggcaacatcc tggggcacaa gctggagtac aactacaaca gccacaacgt ctatatcatg\r\n     1141 gccgacaagc agaagaacgg catcaaggtg aacttcaaga tccgccacaa catcgaggac\r\n     1201 ggcagcgtgc agctcgccga ccactaccag cagaacaccc ccatcggcga cggccccgtg\r\n     1261 ctgctgcccg acaaccacta cctgagcacc cagtccgccc tgagcaaaga ccccaacgag\r\n     1321 aagcgcgatc acatggtcct gctggagttc gtgaccgccg ccgggatcac tctcggcatg\r\n     1381 gacgagctgt acaagtaaag cggccgcgac tctagatcat aatcagccat accacatttg\r\n     1441 tagaggtttt acttgcttta aaaaacctcc cacacctccc cctgaacctg aaacataaaa\r\n     1501 tgaatgcaat tgttgttgtt aacttgttta ttgcagctta taatggttac aaataaagca\r\n     1561 atagcatcac aaatttcaca aataaagcat ttttttcact gcattctagt tgtggtttgt\r\n     1621 ccaaactcat caatgtatct taaggcgtaa attgtaagcg ttaatatttt gttaaaattc\r\n     1681 gcgttaaatt tttgttaaat cagctcattt tttaaccaat aggccgaaat cggcaaaatc\r\n     1741 ccttataaat caaaagaata gaccgagata gggttgagtg ttgttccagt ttggaacaag\r\n     1801 agtccactat taaagaacgt ggactccaac gtcaaagggc gaaaaaccgt ctatcagggc\r\n     1861 gatggcccac tacgtgaacc atcaccctaa tcaagttttt tggggtcgag gtgccgtaaa\r\n     1921 gcactaaatc ggaaccctaa agggagcccc cgatttagag cttgacgggg aaagccggcg\r\n     1981 aacgtggcga gaaaggaagg gaagaaagcg aaaggagcgg gcgctagggc gctggcaagt\r\n     2041 gtagcggtca cgctgcgcgt aaccaccaca cccgccgcgc ttaatgcgcc gctacagggc\r\n     2101 gcgtcaggtg gcacttttcg gggaaatgtg cgcggaaccc ctatttgttt atttttctaa\r\n     2161 atacattcaa atatgtatcc gctcatgaga caataaccct gataaatgct tcaataatat\r\n     2221 tgaaaaagga agagtcctga ggcggaaaga accagctgtg gaatgtgtgt cagttagggt\r\n     2281 gtggaaagtc cccaggctcc ccagcaggca gaagtatgca aagcatgcat ctcaattagt\r\n     2341 cagcaaccag gtgtggaaag\r\n//\r\n"]);
  out.push(["users/alex/sequences/4.meta.json", {"id":4,"display_name":"pEGFP-N1 fragment A (linear PCR)","project_ids":["2"],"added_at":"2026-06-04T00:00:00Z","seq_type":"dna"}]);
  out.push(["users/alex/sequences/5.gb", "LOCUS       pEGFP_N1_fragB      2373 bp    DNA     linear   SYN 04-JUN-2026\r\nDEFINITION  pEGFP-N1 fragment B, linear PCR product (Gibson assembly demo).\r\nACCESSION   .\r\nVERSION     .\r\nKEYWORDS    .\r\nSOURCE      synthetic DNA construct\r\n  ORGANISM  synthetic DNA construct\r\nFEATURES             Location/Qualifiers\r\n     source          1..2373\r\nORIGIN      \r\n        1 tccccaggct ccccagcagg cagaagtatg caaagcatgc atctcaatta gtcagcaacc\r\n       61 atagtcccgc ccctaactcc gcccatcccg cccctaactc cgcccagttc cgcccattct\r\n      121 ccgccccatg gctgactaat tttttttatt tatgcagagg ccgaggccgc ctcggcctct\r\n      181 gagctattcc agaagtagtg aggaggcttt tttggaggcc taggcttttg caaagatcga\r\n      241 tcaagagaca ggatgaggat cgtttcgcat gattgaacaa gatggattgc acgcaggttc\r\n      301 tccggccgct tgggtggaga ggctattcgg ctatgactgg gcacaacaga caatcggctg\r\n      361 ctctgatgcc gccgtgttcc ggctgtcagc gcaggggcgc ccggttcttt ttgtcaagac\r\n      421 cgacctgtcc ggtgccctga atgaactgca agacgaggca gcgcggctat cgtggctggc\r\n      481 cacgacgggc gttccttgcg cagctgtgct cgacgttgtc actgaagcgg gaagggactg\r\n      541 gctgctattg ggcgaagtgc cggggcagga tctcctgtca tctcaccttg ctcctgccga\r\n      601 gaaagtatcc atcatggctg atgcaatgcg gcggctgcat acgcttgatc cggctacctg\r\n      661 cccattcgac caccaagcga aacatcgcat cgagcgagca cgtactcgga tggaagccgg\r\n      721 tcttgtcgat caggatgatc tggacgaaga gcatcagggg ctcgcgccag ccgaactgtt\r\n      781 cgccaggctc aaggcgagca tgcccgacgg cgaggatctc gtcgtgaccc atggcgatgc\r\n      841 ctgcttgccg aatatcatgg tggaaaatgg ccgcttttct ggattcatcg actgtggccg\r\n      901 gctgggtgtg gcggaccgct atcaggacat agcgttggct acccgtgata ttgctgaaga\r\n      961 gcttggcggc gaatgggctg accgcttcct cgtgctttac ggtatcgccg ctcccgattc\r\n     1021 gcagcgcatc gccttctatc gccttcttga cgagttcttc tgagcgggac tctggggttc\r\n     1081 gaaatgaccg accaagcgac gcccaacctg ccatcacgag atttcgattc caccgccgcc\r\n     1141 ttctatgaaa ggttgggctt cggaatcgtt ttccgggacg ccggctggat gatcctccag\r\n     1201 cgcggggatc tcatgctgga gttcttcgcc caccctaggg ggaggctaac tgaaacacgg\r\n     1261 aaggagacaa taccggaagg aacccgcgct atgacggcaa taaaaagaca gaataaaacg\r\n     1321 cacggtgttg ggtcgtttgt tcataaacgc ggggttcggt cccagggctg gcactctgtc\r\n     1381 gataccccac cgagacccca ttggggccaa tacgcccgcg tttcttcctt ttccccaccc\r\n     1441 caccccccaa gttcgggtga aggcccaggg ctcgcagcca acgtcggggc ggcaggccct\r\n     1501 gccatagcct caggttactc atatatactt tagattgatt taaaacttca tttttaattt\r\n     1561 aaaaggatct aggtgaagat cctttttgat aatctcatga ccaaaatccc ttaacgtgag\r\n     1621 ttttcgttcc actgagcgtc agaccccgta gaaaagatca aaggatcttc ttgagatcct\r\n     1681 ttttttctgc gcgtaatctg ctgcttgcaa acaaaaaaac caccgctacc agcggtggtt\r\n     1741 tgtttgccgg atcaagagct accaactctt tttccgaagg taactggctt cagcagagcg\r\n     1801 cagataccaa atactgtcct tctagtgtag ccgtagttag gccaccactt caagaactct\r\n     1861 gtagcaccgc ctacatacct cgctctgcta atcctgttac cagtggctgc tgccagtggc\r\n     1921 gataagtcgt gtcttaccgg gttggactca agacgatagt taccggataa ggcgcagcgg\r\n     1981 tcgggctgaa cggggggttc gtgcacacag cccagcttgg agcgaacgac ctacaccgaa\r\n     2041 ctgagatacc tacagcgtga gctatgagaa agcgccacgc ttcccgaagg gagaaaggcg\r\n     2101 gacaggtatc cggtaagcgg cagggtcgga acaggagagc gcacgaggga gcttccaggg\r\n     2161 ggaaacgcct ggtatcttta tagtcctgtc gggtttcgcc acctctgact tgagcgtcga\r\n     2221 tttttgtgat gctcgtcagg ggggcggagc ctatggaaaa acgccagcaa cgcggccttt\r\n     2281 ttacggttcc tggccttttg ctggcctttt gctcacatgt tctttcctgc gttatcccct\r\n     2341 gattctgtgg ataaccgtat taccgccatg cat\r\n//\r\n"]);
  out.push(["users/alex/sequences/5.meta.json", {"id":5,"display_name":"pEGFP-N1 fragment B (linear PCR)","project_ids":["2"],"added_at":"2026-06-04T00:00:00Z","seq_type":"dna"}]);
  out.push(["users/alex/sequences/6.gb", "LOCUS       GG_cassette1       338 bp    DNA     linear   SYN 04-JUN-2026\r\nDEFINITION  Golden Gate cassette 1, BsaI-flanked linear part (demo).\r\nACCESSION   .\r\nVERSION     .\r\nKEYWORDS    .\r\nSOURCE      synthetic DNA construct\r\n  ORGANISM  synthetic DNA construct\r\nFEATURES             Location/Qualifiers\r\n     source          1..338\r\n     misc_feature     20..319\r\n                     /label=\"GG part 1 body\"\r\nORIGIN      \r\n        1 agctagctgg tctcaaatgg gtgcggcacc ataagcggca ccataatgtt gcggctgaaa\r\n       61 cgaagcagaa ctccgaggtc ttagaactcc gaggtggact gacgtggatc gtattcacgc\r\n      121 catcgatcta gcgttttgaa aagtgatttt cgctgcctcg gccaggttgg acgtgtgtgg\r\n      181 tttcgctggg gacagcccct atcaaaagtg attttcgctg taaccggtta accggttaca\r\n      241 gaggctgttg gacgtgagaa tccggcctac gctcttgaac caagtacagt gtggggatgc\r\n      301 gataactatt ttcatgtcag caaagagacc tcgatcga\r\n//\r\n"]);
  out.push(["users/alex/sequences/6.meta.json", {"id":6,"display_name":"GG cassette 1 (BsaI demo)","project_ids":["2"],"added_at":"2026-06-04T00:00:00Z","seq_type":"dna"}]);
  out.push(["users/alex/sequences/7.gb", "LOCUS       GG_cassette2       338 bp    DNA     linear   SYN 04-JUN-2026\r\nDEFINITION  Golden Gate cassette 2, BsaI-flanked linear part (demo).\r\nACCESSION   .\r\nVERSION     .\r\nKEYWORDS    .\r\nSOURCE      synthetic DNA construct\r\n  ORGANISM  synthetic DNA construct\r\nFEATURES             Location/Qualifiers\r\n     source          1..338\r\n     misc_feature     20..319\r\n                     /label=\"GG part 2 body\"\r\nORIGIN      \r\n        1 agctagctgg tctcagcaaa ccataatggg caccataatg gacgtgagaa gtattcagta\r\n       61 caagcatgtc accgacaaaa gcggcaccat aatgttcccc gcaatgactg gagagagact\r\n      121 ctctctctct ctctctctct ctctctctct ctcttggtac gctaggctta atcccatata\r\n      181 ctgcttgcga taactccaag tacagagggg acagccccta tcaaaagtga ttttcgctgc\r\n      241 accgacaaaa gcataaaaaa aaaatcggac agcgaatgtt gcggcaccat aatgttgcgg\r\n      301 caccttaacc ggttaacaaa atgagagacc tcgatcga\r\n//\r\n"]);
  out.push(["users/alex/sequences/7.meta.json", {"id":7,"display_name":"GG cassette 2 (BsaI demo)","project_ids":["2"],"added_at":"2026-06-04T00:00:00Z","seq_type":"dna"}]);
  out.push(["users/alex/sequences/8.gb", "LOCUS       attL_entry         910 bp    DNA     circular   SYN 04-JUN-2026\r\nDEFINITION  Gateway attL entry clone, gene of interest flanked by attL1/attL2 (demo).\r\nACCESSION   .\r\nVERSION     .\r\nKEYWORDS    .\r\nSOURCE      synthetic DNA construct\r\n  ORGANISM  synthetic DNA construct\r\nFEATURES             Location/Qualifiers\r\n     source          1..910\r\n     CDS             251..610\r\n                     /label=\"gene of interest\"\r\nORIGIN      \r\n        1 cagaggaggt tggacgtgac ctatcaaatc gctgccctat caaaaggctg aacctcattg\r\n       61 cttaattcgt atcgagacga atccctatca aaagtgatgg gacagcccct atcaaaagtg\r\n      121 attttcgctg gggacagccc tgcactgtta gtgggctatg aaccaagtac agttcgctgg\r\n      181 ggacagctgc tagcgtttgt tgatgagcaa tgctttttta taatgccaac tttgtacaaa\r\n      241 aaagcaggct gcgtcctttg cccggcacca taatgttaat tcgtacaagc tacgcctgac\r\n      301 cgcctgcata gaccgacaaa agcatagcgg tcgaaaagca tagaccgaca aaagcatccg\r\n      361 aggtaggtct acgcaatatg atcgttctag tttgaaacga taatgttgcc tagataacta\r\n      421 ttttcaccaa tccgctacgc ctgacgtgga tcgtattcag taactattta acaatttagc\r\n      481 gcttaattcg tatggggctc tctctctctc tctctctctc tctctctcgg ggatgcgata\r\n      541 acgccaattg cggaagcctc tgtgcgtaca gaggcttaat tcgatagagt cgggcagccc\r\n      601 gcaatgactg acccagcttt cttgtacaaa gttggcatta taagaaagca ttgcttatca\r\n      661 atttgttgca acgaacaggt cactatcagt caaaataaaa tcattatttg tttacctcga\r\n      721 caacaggttg gacgtgagaa tccggcctag ctacgcctga cgtggatcgt attcatgcga\r\n      781 tagaaggttg gacgtgagaa tccggctggg gatgcgtttc gaactatttg ataaccattt\r\n      841 caaaagttag tgggccgagg tcttagatgg gctgcacaac ccgacaaaag catagaccga\r\n      901 ggcagtacag\r\n//\r\n"]);
  out.push(["users/alex/sequences/8.meta.json", {"id":8,"display_name":"attL entry clone (Gateway demo)","project_ids":["2"],"added_at":"2026-06-04T00:00:00Z","seq_type":"dna"}]);
  out.push(["users/alex/sequences/9.gb", "LOCUS       attR_dest          964 bp    DNA     circular   SYN 04-JUN-2026\r\nDEFINITION  Gateway attR destination vector, ccdB-style stuffer flanked by attR1/attR2 (demo).\r\nACCESSION   .\r\nVERSION     .\r\nKEYWORDS    .\r\nSOURCE      synthetic DNA construct\r\n  ORGANISM  synthetic DNA construct\r\nFEATURES             Location/Qualifiers\r\n     source          1..964\r\n     misc_feature     358..657\r\n                     /label=\"ccdB stuffer\"\r\nORIGIN      \r\n        1 cagaggaggt tggacgtgac ctatcaaatc gctgccctat caaaaggctg aacctcattg\r\n       61 cttaattcgt atcgagacga atccctatca aaagtgatgg gacagcccct atcaaaagtg\r\n      121 attttcgctg gggacagccc tgcactgtta gtgggctatg aaccaagtac agttcgctgg\r\n      181 ggacagctgc tagcgtttgt caagtttgta caaaaaagtt gaacgagaaa cgtaaaatga\r\n      241 tataaatatc aatatattaa attagatttt gcataaaaaa cagactacat aatactgtaa\r\n      301 aacacaacat atgcagtcac tatgaatcaa ctacttagat ggtattagtg acctgtaaag\r\n      361 aatccggcct acgctacagc tacctcgacg agttcctcag atatgatcgt tctagtacta\r\n      421 ttttcatgtc accgactctc tctctctctc tctctctcac cacacgagtt cctcaggaag\r\n      481 gccgcgcagc tacctcgacc cagggtagga aatggtgtaa aatcctcagc ccgctcgtac\r\n      541 ctgacctctc caggttgcta cgctcttgaa ccaagtacag aggcttatca gggtatgcct\r\n      601 gttactgttc cgtaaccgtg attctcgtat tttgatgcga taacggttat ctccaggttg\r\n      661 tgttttacag tattatgtag tctgtttttt atgcaaaatc taatttaata tattgatatt\r\n      721 tatatcattt tacgtttctc gttcaacttt cttgtacaaa gtggtttacc tcgacaacag\r\n      781 gttggacgtg agaatccggc ctagctacgc ctgacgtgga tcgtattcat gcgatagaag\r\n      841 gttggacgtg agaatccggc tggggatgcg tttcgaacta tttgataacc atttcaaaag\r\n      901 ttagtgggcc gaggtcttag atgggctgca caacccgaca aaagcataga ccgaggcagt\r\n      961 acag\r\n//\r\n"]);
  out.push(["users/alex/sequences/9.meta.json", {"id":9,"display_name":"attR destination (Gateway demo)","project_ids":["2"],"added_at":"2026-06-04T00:00:00Z","seq_type":"dna"}]);

  // ── User: morgan ──────────────────────────────────────────────────────────
  out.push([
    "users/morgan/_counters.json",
    {
      projects: 2,
      tasks: 13,
      methods: 2,
      events: 0,
      // 2 personal/project SMART goals added below so the lab-mode-roadmaps
      // tour step (Phase 2c) shows progress trackers across both demo users
      // instead of only alex.
      goals: 2,
      pcr_protocols: 0,
      purchase_items: 20,
      lab_links: 4,
      // Notes bumped to 6 for the Lab Mode notes-tab fixture (Onboarding v4
      // Phase 2c). 5 new shared notes added below — mix of plate-prep
      // recipes, meeting notes, and a calibration running log.
      notes: 6,
      dependencies: 2,
      // Inventory fixture (behind INVENTORY_ENABLED). morgan owns 4 catalog
      // items / 5 stocks; she uses free-text locations (alex owns the demo
      // storage tree). Counters set to the max seeded id.
      inventory_items: 4,
      inventory_stocks: 5,
    },
  ]);
  out.push([
    "users/morgan/settings.json",
    {
      animationType: "celebration",
      defaultGanttViewMode: "1-month",
      defaultCalendarViewMode: "week",
      showSharedByDefault: true,
      visibleTabs: ["/experiments", "/gantt", "/methods", "/purchases", "/results", "/calendar", "/links"],
      defaultLandingTab: "/",
      sidebarShowTasks: true,
      sidebarShowCalendarEvents: true,
      sidebarEventsHorizonDays: 7,
      coloredHeader: false,
      // Lab Head Phase 1: morgan is a grad student — explicit `member`.
      account_type: "member",
    },
  ]);
  out.push(["users/morgan/_onboarding.json", DEMO_ONBOARDING_SIDECAR]);

  out.push(...projects("morgan", [
    // Project 1 is shared with alex (view) so the fixture covers the
    // shared-project surface area: listByProject threading, hide-Share-button
    // on receiver-side project popup, and the fetchAllTasksIncludingShared
    // shared-project path. Counterpart entry lives in
    // users/alex/_shared_with_me.json above.
    { id: 1, name: "DEMO: 96-well fluorescence screen", color: "#10b981", tags: ["demo", "screening"], sort_order: 0, shared_with: [{ username: "alex", level: "edit", permission: "edit" }] },
    { id: 2, name: "DEMO: Morgan dissertation milestones", color: "#06b6d4", tags: ["demo", "thesis"], sort_order: 1 },
  ]));

  out.push(...tasks("morgan", [
    // Completed today — has a fluorescence plate image AND a results.md
    // write-up, so the gallery renders it in "Fresh results."
    { id: 1, project_id: 1, name: "Plate FY-Δgal80 transformants on 96-well", start_date: TODAY, duration_days: 1, end_date: TODAY, task_type: "experiment", is_complete: true, experiment_color: "#10b981",
      method_attachments: [{ method_id: 1, owner: "morgan", snapshot_at: "2026-05-13T08:00:00Z" }],
      comments: [
        { id: "cmt-mira-morgan-t1-1", author: "mira", text: "Plate photos look clean. When you do the reader scan tomorrow, please send me the column-12 positive control read as soon as it exports — I want to confirm we are in the linear range before you scale up.", created_at: "2026-05-13T18:05:00Z" },
      ] },
    { id: 2, project_id: 1, name: "Run fluorescence reader scan", start_date: TOMORROW, duration_days: 1, end_date: TOMORROW, task_type: "experiment", is_complete: false, experiment_color: "#10b981",
      sub_tasks: [
        { id: "st1", text: "Pre-warm plate reader to 30 °C", is_complete: false },
        { id: "st2", text: "Read OD600 baseline (no shake)", is_complete: false },
        { id: "st3", text: "Read GFP — ex 485 / em 528, gain 60", is_complete: false },
        { id: "st4", text: "Export CSV + push to analysis notebook", is_complete: false },
      ],
      method_attachments: [{ method_id: 1, owner: "morgan", snapshot_at: "2026-05-13T08:00:00Z" }] },
    { id: 3, project_id: 1, name: "qPCR setup — verify GFP transcripts", start_date: "2026-05-16", duration_days: 1, end_date: "2026-05-16", task_type: "experiment", is_complete: false, experiment_color: "#10b981",
      method_attachments: [{ method_id: 2, owner: "morgan", snapshot_at: "2026-05-13T08:00:00Z" }], shared_with: [{ username: "alex", level: "edit", permission: "edit" }],
      comments: [
        // Lab Head Phase 2: @-mention demo — mira hooks morgan into alex's
        // prior optimization (referenced inline), so both end up in the
        // mention list.
        { id: "cmt-mira-morgan-t3-1", author: "mira", text: "@morgan — make sure you're using the same ACT1 reference primer pair as @alex's optimization (alex's lab note #5). I want our two qPCR datasets directly comparable for the paper figures downstream.", created_at: "2026-05-14T09:15:00Z", mentions: ["morgan", "alex"] },
        // Lab Head Phase 2: reply from morgan acks the call.
        { id: "cmt-morgan-reply-t3-1", author: "morgan", text: "Confirmed — pulling the ACT1 aliquot from alex's freezer 5 shelf tomorrow morning.", created_at: "2026-05-14T10:30:00Z", parent_id: "cmt-mira-morgan-t3-1" },
      ] },
    // Strategically-overdue: writing tasks slip. Stays 4 days overdue
    // regardless of when the demo is opened (see OVERDUE_* anchors).
    { id: 4, project_id: 2, name: "Draft Chapter 2 outline", start_date: OVERDUE_START, duration_days: 3, end_date: OVERDUE_END_4D, task_type: "list", is_complete: false,
      sub_tasks: [
        { id: "st1", text: "Pull figures + key results from the 96-well screen project", is_complete: false },
        { id: "st2", text: "Sketch section headers - intro, methods, results, discussion", is_complete: false },
        { id: "st3", text: "List open questions to bring up with advisor", is_complete: false },
        { id: "st4", text: "Draft figure list with target panels (Fig 2.1 - 2.6)", is_complete: false },
        { id: "st5", text: "Block 2 mornings on calendar for first writing pass", is_complete: false },
      ] },
    // Task 5 is shared with alex (view) independently of any shared project,
    // so the fixture covers the individually-shared task path too.
    { id: 5, project_id: 2, name: "Send draft figures to alex", start_date: TOMORROW, duration_days: 1, end_date: TOMORROW, task_type: "list", is_complete: false,
      sub_tasks: [
        { id: "st1", text: "Re-render Fig 1 at 300dpi in Illustrator", is_complete: true },
        { id: "st2", text: "Pull updated fluorescence heatmap from notebook", is_complete: true },
        { id: "st3", text: "Combine into a single annotated PDF", is_complete: false },
        { id: "st4", text: "Email PDF to alex with comment thread on Fig 3", is_complete: false },
      ] },
    // Task 6 is a PURCHASE task in morgan's shared project 1. Surfaces on
    // alex's /purchases page via the shared-project surface in
    // `fetchAllTasksIncludingShared`, and its items are visible to alex via
    // `purchasesApi.listAllIncludingShared` — exercises the merged-view
    // purchase loader.
    { id: 6, project_id: 1, name: "Order fluorescent reagents for screen", start_date: TODAY, duration_days: 1, end_date: TODAY, task_type: "purchase", is_complete: false },
    // Workbench "Earlier results" fixture (morgan side): completed > 30
    // days ago. Lives in morgan's project 1 which is shared with alex
    // (view), so it appears in alex's Workbench Earlier section.
    { id: 7, project_id: 1, name: "Sanity check — fluorescence reader baseline", start_date: "2026-03-12", duration_days: 1, end_date: "2026-03-12", task_type: "experiment", is_complete: true, experiment_color: "#10b981" },
    // Workbench Lists-tab fixtures (chip: Lists-tab landing).
    // ── Earlier (morgan/8): completed > 30 days ago, populates the Earlier
    //    accordion alongside alex/23 so the section has multi-project content.
    { id: 8, project_id: 2, name: "Audit shared bench reagent inventory", start_date: EARLIER_DONE_MORGAN, duration_days: 1, end_date: EARLIER_DONE_MORGAN, task_type: "list", is_complete: true,
      sub_tasks: [
        { id: "st1", text: "Tally remaining stocks in the −80 freezer", is_complete: true },
        { id: "st2", text: "Flag low items for the next purchase round", is_complete: true },
        { id: "st3", text: "Check antibody fridge - note expiry dates", is_complete: true },
        { id: "st4", text: "Update shared inventory sheet + ping alex", is_complete: true },
      ] },
    // ── Recent-done + shared (morgan/9): completed in the last 30 days,
    //    shared into alex via _shared_with_me.json above. On alex's Lists
    //    tab the row renders in "Recently done" with the SharedFromPill.
    //    On morgan's view it just renders as a standard recent-done row.
    { id: 9, project_id: 1, name: "Set up shared screening template", start_date: RECENT_DONE, duration_days: 1, end_date: RECENT_DONE, task_type: "list", is_complete: true, shared_with: [{ username: "alex", level: "read", permission: "view" }],
      sub_tasks: [
        { id: "st1", text: "Draft 96-well plate map for the joint screen", is_complete: true },
        { id: "st2", text: "Wire fixture column for alex's pYES library positives", is_complete: true },
        { id: "st3", text: "Add blank + positive control well annotations", is_complete: true },
        { id: "st4", text: "Push template to the lab notebook", is_complete: true },
      ] },
    // ── /purchases dashboard fixtures (Chip B). Four historical purchase
    //    tasks on morgan's side, spanning Nov 2025 → Apr 2026 so the
    //    dashboard time-series has enough morgan-side data to plot.
    { id: 10, project_id: 1, name: "Order Q4 fluorescence stock-up", start_date: "2025-11-22", duration_days: 1, end_date: "2025-11-22", task_type: "purchase", is_complete: true },
    { id: 11, project_id: 2, name: "Order dissertation imaging supplies", start_date: "2026-01-15", duration_days: 1, end_date: "2026-01-15", task_type: "purchase", is_complete: true },
    { id: 12, project_id: 1, name: "Order qPCR validation batch", start_date: "2026-02-25", duration_days: 1, end_date: "2026-02-25", task_type: "purchase", is_complete: true },
    { id: 13, project_id: 2, name: "Order Chapter 2 figure reagents", start_date: "2026-04-25", duration_days: 1, end_date: "2026-04-25", task_type: "purchase", is_complete: true },
  ]));

  // morgan methods
  out.push(["users/morgan/methods/1.json", methodJson("morgan", 1, "[Demo protocol] Fluorescence screen (96-well)", "Screening")]);
  out.push(["users/morgan/methods/1.md", METHOD_FLUO_SCREEN_MD]);
  out.push(["users/morgan/methods/2.json", methodJson("morgan", 2, "[Demo protocol] qPCR setup", "qPCR")]);
  out.push(["users/morgan/methods/2.md", METHOD_QPCR_MD]);

  // morgan purchases (20 — Chip B fixture expansion).
  //
  // Items 1+2 stay on EXPERIMENT tasks (1, 2) per the §5 latent-bug
  // preservation requirement — the dashboard's "Items on non-purchase
  // tasks" Uncategorized panel needs morgan-side coverage.
  // Item 3 stays on shared purchase task 6 (project 1, shared with alex)
  // so the cross-owner `purchasesApi.listAllIncludingShared` path
  // continues to surface a shared-task item to alex's dashboard.
  //
  //   Vendor counts:    IDT=3 Sigma-Aldrich=5 NEB=2 Thermo=6 Internal=1 null=3
  //   Category counts:  Reagents=9 Plasticware=5 Consumables=4 Service=1 null=1
  //   Funding counts:   NIH=7 DOE=5 Internal-Bridge=5 null=3
  out.push(["users/morgan/purchase_items/1.json", { id: 1, task_id: 1, item_name: "96-well black-walled plates (demo)", quantity: 2, link: "https://example.org/demo-platesupply", cas: null, price_per_unit: 48, shipping_fees: 8, total_price: 104, notes: null, funding_string: "DEMO-Internal-Bridge", vendor: "Thermo", category: "Plasticware" }]);
  out.push(["users/morgan/purchase_items/2.json", { id: 2, task_id: 2, item_name: "GFP recombinant standard (demo)", quantity: 1, link: "https://example.org/demo-gfp-std", cas: null, price_per_unit: 175, shipping_fees: 0, total_price: 175, notes: "For absolute quantification.", funding_string: "DEMO-DOE-EERE", vendor: "Sigma-Aldrich", category: "Reagents" }]);
  out.push(["users/morgan/purchase_items/3.json", { id: 3, task_id: 6, item_name: "GFP fluorescence calibration kit (demo)", quantity: 1, link: "https://example.org/demo-fluo-kit", cas: null, price_per_unit: 320, shipping_fees: 12, total_price: 332, notes: "Demo reagents for the shared screen.", funding_string: "DEMO-DOE-EERE", vendor: "Thermo", category: "Reagents" }]);
  // Task 6 (existing) — two more items so the active purchase task isn't a singleton.
  out.push(["users/morgan/purchase_items/4.json", { id: 4, task_id: 6, item_name: "384-well black-walled plates (small batch)", quantity: 1, link: "https://example.org/demo-sigma", cas: null, price_per_unit: 98, shipping_fees: 0, total_price: 98, notes: null, funding_string: "DEMO-Internal-Bridge", vendor: "Sigma-Aldrich", category: "Plasticware" }]);
  out.push(["users/morgan/purchase_items/5.json", { id: 5, task_id: 6, item_name: "HEPES buffer (1 L, lab-prepared)", quantity: 2, link: null, cas: "7365-45-9", price_per_unit: 42, shipping_fees: 0, total_price: 84, notes: "Demo internal stock.", funding_string: null, vendor: "Internal supply", category: "Reagents" }]);
  // Task 10 — Q4 fluorescence stock-up (2025-11-22)
  out.push(["users/morgan/purchase_items/6.json", { id: 6, task_id: 10, item_name: "Reading-buffer custom mix (250 mL)", quantity: 2, link: null, cas: null, price_per_unit: 58, shipping_fees: 0, total_price: 116, notes: "Custom recipe — vendor TBD on next reorder.", funding_string: "DEMO-DOE-EERE", vendor: null, category: null }]);
  out.push(["users/morgan/purchase_items/7.json", { id: 7, task_id: 10, item_name: "Sterile reservoir basins (sleeve of 25)", quantity: 6, link: "https://example.org/demo-sigma", cas: null, price_per_unit: 14, shipping_fees: 0, total_price: 84, notes: null, funding_string: "DEMO-Internal-Bridge", vendor: "Sigma-Aldrich", category: "Plasticware" }]);
  out.push(["users/morgan/purchase_items/8.json", { id: 8, task_id: 10, item_name: "Multichannel pipette calibration service", quantity: 1, link: null, cas: null, price_per_unit: 215, shipping_fees: 0, total_price: 215, notes: "Annual calibration — demo.", funding_string: "DEMO-NIH-GM999999", vendor: null, category: "Service" }]);
  out.push(["users/morgan/purchase_items/9.json", { id: 9, task_id: 10, item_name: "Filter pipette tips (P10, racked)", quantity: 6, link: "https://example.org/demo-thermo", cas: null, price_per_unit: 34, shipping_fees: 0, total_price: 204, notes: null, funding_string: "DEMO-NIH-GM999999", vendor: "Thermo", category: "Consumables" }]);
  // Task 11 — Dissertation imaging supplies (2026-01-15)
  out.push(["users/morgan/purchase_items/10.json", { id: 10, task_id: 11, item_name: "Microscope lens-cleaning kit", quantity: 1, link: "https://example.org/demo-thermo", cas: null, price_per_unit: 65, shipping_fees: 0, total_price: 65, notes: null, funding_string: "DEMO-Internal-Bridge", vendor: "Thermo", category: "Consumables" }]);
  out.push(["users/morgan/purchase_items/11.json", { id: 11, task_id: 11, item_name: "SDS-PAGE running buffer (10x, 1 L)", quantity: 2, link: "https://example.org/demo-neb", cas: null, price_per_unit: 48, shipping_fees: 5, total_price: 101, notes: null, funding_string: "DEMO-NIH-GM999999", vendor: "NEB", category: "Reagents" }]);
  out.push(["users/morgan/purchase_items/12.json", { id: 12, task_id: 11, item_name: "Cuvette pack (UV-grade, box of 100)", quantity: 2, link: "https://example.org/demo-sigma", cas: null, price_per_unit: 58, shipping_fees: 0, total_price: 116, notes: null, funding_string: "DEMO-NIH-GM999999", vendor: "Sigma-Aldrich", category: "Plasticware" }]);
  // Task 12 — qPCR validation batch (2026-02-25, large order)
  out.push(["users/morgan/purchase_items/13.json", { id: 13, task_id: 12, item_name: "PCR primers — gal80 verification set (8 oligos)", quantity: 8, link: "https://example.org/demo-idt", cas: null, price_per_unit: 14, shipping_fees: 5, total_price: 117, notes: null, funding_string: "DEMO-NIH-GM999999", vendor: "IDT", category: "Reagents" }]);
  out.push(["users/morgan/purchase_items/14.json", { id: 14, task_id: 12, item_name: "Reverse-transcription kit (24 rxns)", quantity: 1, link: "https://example.org/demo-neb", cas: null, price_per_unit: 185, shipping_fees: 0, total_price: 185, notes: null, funding_string: "DEMO-NIH-GM999999", vendor: "NEB", category: "Reagents" }]);
  out.push(["users/morgan/purchase_items/15.json", { id: 15, task_id: 12, item_name: "SYBR qPCR master mix (2x, 5 mL)", quantity: 1, link: "https://example.org/demo-thermo", cas: null, price_per_unit: 245, shipping_fees: 0, total_price: 245, notes: null, funding_string: "DEMO-DOE-EERE", vendor: "Thermo", category: "Reagents" }]);
  out.push(["users/morgan/purchase_items/16.json", { id: 16, task_id: 12, item_name: "Falcon tubes (15 mL, sleeve of 50)", quantity: 4, link: "https://example.org/demo-thermo", cas: null, price_per_unit: 22, shipping_fees: 0, total_price: 88, notes: null, funding_string: "DEMO-Internal-Bridge", vendor: "Thermo", category: "Consumables" }]);
  out.push(["users/morgan/purchase_items/17.json", { id: 17, task_id: 12, item_name: "96-well qPCR plates (skirted)", quantity: 2, link: "https://example.org/demo-idt", cas: null, price_per_unit: 52, shipping_fees: 0, total_price: 104, notes: null, funding_string: "DEMO-DOE-EERE", vendor: "IDT", category: "Plasticware" }]);
  // Task 13 — Chapter 2 figure reagents (2026-04-25)
  out.push(["users/morgan/purchase_items/18.json", { id: 18, task_id: 13, item_name: "Antibody reference standard (demo)", quantity: 1, link: "https://example.org/demo-sigma", cas: null, price_per_unit: 325, shipping_fees: 15, total_price: 340, notes: "Awaiting funding source — likely DOE renewal.", funding_string: null, vendor: "Sigma-Aldrich", category: "Reagents" }]);
  out.push(["users/morgan/purchase_items/19.json", { id: 19, task_id: 13, item_name: "Custom oligo set — Chapter 2 figures (6 primers)", quantity: 6, link: "https://example.org/demo-idt", cas: null, price_per_unit: 14, shipping_fees: 5, total_price: 89, notes: null, funding_string: "DEMO-NIH-GM999999", vendor: "IDT", category: "Reagents" }]);
  out.push(["users/morgan/purchase_items/20.json", { id: 20, task_id: 13, item_name: "Cryo storage labels (waterproof, sleeve)", quantity: 4, link: null, cas: null, price_per_unit: 18, shipping_fees: 0, total_price: 72, notes: null, funding_string: null, vendor: null, category: "Consumables" }]);

  // morgan lab links (4)
  out.push(["users/morgan/lab_links/1.json", { id: 1, title: "Demo plate-reader software docs", url: "https://example.org/demo-reader-docs", description: "Manual for the demo BioTek H1.", category: "Bioinformatics tools", color: "#10b981", preview_image_url: null, sort_order: 0, created_at: "2026-02-01T00:00:00Z" }]);
  out.push(["users/morgan/lab_links/2.json", { id: 2, title: "ACS Synthetic Biology", url: "https://example.org/demo-acssb", description: "Methods journal.", category: "Journals", color: "#f59e0b", preview_image_url: null, sort_order: 0, created_at: "2026-02-01T00:00:00Z" }]);
  out.push(["users/morgan/lab_links/3.json", { id: 3, title: "Demo lab GitHub fake repo", url: "https://example.org/demo-github", description: "Analysis scripts for the screen.", category: "Bioinformatics tools", color: "#10b981", preview_image_url: null, sort_order: 1, created_at: "2026-02-01T00:00:00Z" }]);
  out.push(["users/morgan/lab_links/4.json", { id: 4, title: "Sigma-Aldrich (demo)", url: "https://example.org/demo-sigma", description: null, category: "Ordering portals", color: "#10b981", preview_image_url: null, sort_order: 2, created_at: "2026-02-01T00:00:00Z" }]);

  // morgan goals — added for the lab-mode-roadmaps tour step (Phase 2c) so
  // the roadmaps panel shows progress trackers for both demo users instead
  // of only alex. Goal 1 is the dissertation milestone (long-running, sub-
  // goals partially complete). Goal 2 is the immediate 96-well screen.
  out.push(["users/morgan/goals/1.json", { id: 1, project_id: 2, name: "DEMO: Complete dissertation chapter 2 (heat-stress screen)", start_date: "2026-03-01", end_date: "2026-10-31", color: "#06b6d4",
    smart_goals: [
      { id: "sg1", text: "96-well screen data collection complete", is_complete: false },
      { id: "sg2", text: "Statistical analysis (R script, dose-response)", is_complete: false },
      { id: "sg3", text: "Figures rendered (viridis colorblind-safe)", is_complete: false },
      { id: "sg4", text: "Chapter draft v1 to committee", is_complete: false },
    ], is_complete: false, created_at: "2026-03-01T00:00:00Z" }]);
  out.push(["users/morgan/goals/2.json", { id: 2, project_id: 1, name: "DEMO: Validate fakeGFP screening pipeline", start_date: "2026-04-01", end_date: "2026-06-15", color: "#10b981",
    smart_goals: [
      { id: "sg1", text: "Plate reader calibration log (4 weekly checks)", is_complete: true },
      { id: "sg2", text: "Run 3 control plates with known positives", is_complete: true },
      { id: "sg3", text: "Variance under 5% across biological triplicates", is_complete: false },
      { id: "sg4", text: "Present pipeline at lab meeting", is_complete: false },
    ], is_complete: false, created_at: "2026-04-01T00:00:00Z" }]);

  // morgan notes — all `is_shared: true` so the Lab Mode notes tab has
  // grad-student output too. Mix of recipe-style plate cards, meeting
  // notes, and a calibration running log.
  out.push(["users/morgan/notes/1.json", { id: 1, title: "96-well plate layout notes", description:
    "Column 1 = WT negative, column 12 = pDEMO-fluo+ positive. Columns 2–11 are candidate FY-Δgal80 transformants from alex's library.",
    is_running_log: false, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [], comments: [], created_at: "2026-05-12T00:00:00Z", updated_at: "2026-05-13T08:00:00Z", username: "morgan" }]);

  // Note 2: plate-prep checklist, lab-recipe style.
  out.push(["users/morgan/notes/2.json", { id: 2, title: "96-well screen prep checklist", description:
      "Bench card for setting up the 96-well fluorescence screen.\n\nThe night before:\n- Pick 80 candidate colonies into 200 µL SD-Ura in deep-well plate\n- Pick 8 WT colonies into the same plate (column 1)\n- Pick 8 pDEMO-fluo+ positive control colonies (column 12)\n- 30 °C, shaking 200 rpm, 16 to 18 h\n\nMorning of:\n1. Pre-warm SD-Ura + 2% galactose (induction media) to 30 °C\n2. Spin deep-well plate 3000 g, 5 min\n3. Wash pellets 1× with sterile water\n4. Resuspend in 200 µL induction media\n5. Transfer 50 µL to clear-bottom 96-well reader plate\n6. Reader settings: 485/528 nm, every 15 min, 6 h, 30 °C\n\nDouble-check before starting the reader:\n- [ ] Plate lid clean (no condensation = no scatter)\n- [ ] Empty wells have water (corner evaporation correction)\n- [ ] BioTek H1 calibrated this week (see note 6)",
    is_running_log: false, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [], comments: [
      { id: "cmt-mira-morgan-note2-1", author: "mira", text: "Walk me through this one in our next 1:1 — I want to make sure the corner-evaporation control is set up correctly before the full screen runs. The water-only wells should be in the same column as your positive control, not opposite it.", created_at: "2026-05-13T09:50:00Z" },
    ], created_at: "2026-04-18T11:00:00Z", updated_at: "2026-05-12T17:00:00Z", username: "morgan" }]);

  // Note 3: meeting note, prose.
  out.push(["users/morgan/notes/3.json", { id: 3, title: "Lab meeting 2026-04-15: my notes", description:
      "Lab meeting recap, taken from my seat.\n\nWalk-throughs:\n- alex: transformation efficiency update. Heat-shock time matters more than I thought (38 vs 40 min produced a 2-fold colony drop in the 2026-04 batch).\n- Me: chapter 2 figure brainstorm. Got useful pushback on the heatmap color scale (use viridis, not the default red/green which is colorblind-unfriendly).\n\nGroup decisions:\n- Standardize on the public DemoCheck PCR protocol for all integration checks (was previously split between two slightly different copies)\n- New lab convention: every PCR has a no-template control on the same plate, no exceptions\n- The Lab Head will write a 1-page bench-safety refresher and post it in the lab links section\n\nWhat I want to remember for me:\nThe colorblind point also applies to my pYES-vs-pDEMO figure. Re-render with viridis before the next dissertation committee check-in.",
    is_running_log: false, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [], comments: [], created_at: "2026-04-15T13:00:00Z", updated_at: "2026-04-15T16:00:00Z", username: "morgan" }]);

  // Note 4: group brainstorm meeting, prose.
  out.push(["users/morgan/notes/4.json", { id: 4, title: "Group brainstorm: GFP heat-stress assay", description:
      "Whiteboard session 2026-05-07. Goal: design an assay that lets us screen the FY-Δgal80 library for heat-stress survival without losing the fakeGFP reporter signal.\n\nWhat we agreed on:\n- Pre-grow at 30 °C, then shift to 37 °C for 0, 30, 60, 120 min\n- Read fakeGFP at every timepoint plus a recovery read at 4 h post-shift\n- Use the 384-well plates we already ordered for the stress project (purchase item 13) so we don't have to wait\n\nOpen questions:\n- Does fakeGFP itself misfold above 35 °C? Need a quick mScarlet control to separate \"reporter killed\" from \"cell dead\".\n- Reader cycles long enough on 384-well? Morgan to check the reader docs link.\n\nAction items:\n- alex: order 2 plates of mScarlet+ positive control (demo)\n- morgan: schedule a calibration run on 384-well format this week\n- both: convert this brainstorm into a real experiment design by 2026-05-21.",
    is_running_log: false, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [], comments: [
      { id: "cmt-mira-morgan-note4-1", author: "mira", text: "Big +1 on the mScarlet positive control. Without it we can't separate reporter misfolding from cell death and the whole story falls apart in review. Approve charging this to DEMO-DOE-EERE.", created_at: "2026-05-07T17:05:00Z" },
      // Lab Head Phase 2: reply thread under mira's approval — alex
      // acknowledges and morgan confirms the dry-run will happen.
      { id: "cmt-alex-reply-morgan-note4-1", author: "alex", text: "Ordering the mScarlet plates tomorrow morning. Will tag the funding line in the purchase notes so it's easy to audit.", created_at: "2026-05-07T18:30:00Z", parent_id: "cmt-mira-morgan-note4-1" },
      { id: "cmt-morgan-reply-morgan-note4-1", author: "morgan", text: "Reader is on the calendar for Tuesday 9am — empty-plate cycle test goes first.", created_at: "2026-05-07T19:02:00Z", parent_id: "cmt-mira-morgan-note4-1" },
      { id: "cmt-mira-morgan-note4-2", author: "mira", text: "On the 384-well question — please pre-book the reader for at least one dry run before committing. Last grad student lost a week on cycle-time issues we could have caught with an empty plate.", created_at: "2026-05-08T09:12:00Z" },
    ], created_at: "2026-05-07T14:00:00Z", updated_at: "2026-05-07T15:30:00Z", username: "morgan" }]);

  // Note 5: terse tracker, lab-recipe-adjacent style.
  out.push(["users/morgan/notes/5.json", { id: 5, title: "Reagent A expiration tracker", description:
      "Tracking the reagents I'm responsible for on shelf 2.\n\n- SYBR Master Mix (lot DEMO-2025-04): opened 2026-04-12, expires 2026-07-12\n- fakeGFP-fwd primer (10 µM aliquot): opened 2026-03-22, use by 2026-09-22\n- fakeGFP-rev primer (10 µM aliquot): opened 2026-03-22, use by 2026-09-22\n- ACT1-fwd / ACT1-rev (10 µM aliquots): made fresh 2026-05-01, use by 2026-11-01\n- 50% PEG-3350 (autoclaved stock): made 2026-04-30, replace by 2026-07-30\n- 1 M LiAc stock: made 2026-05-01, replace by 2026-08-01\n- DEMO mScarlet plasmid prep: 2026-05-04, stored in freezer 5, OK indefinitely\n\nReminder: re-aliquot the SYBR master mix on 2026-06-12 before opening a fresh tube.",
    is_running_log: false, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [], comments: [], created_at: "2026-05-04T16:00:00Z", updated_at: "2026-05-12T09:00:00Z", username: "morgan" }]);

  // Note 6: reader calibration running log.
  out.push(["users/morgan/notes/6.json", { id: 6, title: "BioTek H1 calibration log", description:
      "Weekly calibration check on the BioTek H1 plate reader (demo unit). I run a 6-well standard curve every Monday before any GFP screen.",
    is_running_log: true, is_shared: true, shared_with: [{ username: "*", level: "read", permission: "view" }], entries: [
      { id: "rl-morgan-6-e1", title: "2026-04-21: first weekly check", date: "2026-04-21", content: "Standard curve (fluorescein, 0 to 500 nM). R² = 0.997, slope within 5% of last month's. PASS.", created_at: "2026-04-21T08:30:00Z", updated_at: "2026-04-21T08:30:00Z" },
      { id: "rl-morgan-6-e2", title: "2026-04-28: weekly check", date: "2026-04-28", content: "R² = 0.995, slope drift +2.1%. PASS. Noted slight bubble in well A1, repeated the row to be safe (within tolerance the second time).", created_at: "2026-04-28T08:45:00Z", updated_at: "2026-04-28T08:45:00Z" },
      { id: "rl-morgan-6-e3", title: "2026-05-05: weekly check", date: "2026-05-05", content: "R² = 0.998. PASS. Cleaned the lamp housing per the docs link, run-to-run noise dropped from 1.4% CV to 0.9% CV.", created_at: "2026-05-05T08:30:00Z", updated_at: "2026-05-05T08:30:00Z" },
      { id: "rl-morgan-6-e4", title: "2026-05-12: weekly check", date: "2026-05-12", content: "R² = 0.996. PASS. Ready for the full 96-well screen on Thursday.", created_at: "2026-05-12T08:30:00Z", updated_at: "2026-05-12T08:30:00Z" },
    ], comments: [
      { id: "cmt-mira-morgan-note6-1", author: "mira", text: "Excellent discipline keeping this log weekly. I'm going to point any new rotation students at this exact format as the calibration-log template. Thank you for setting that bar.", created_at: "2026-05-13T07:55:00Z" },
    ], created_at: "2026-04-21T08:30:00Z", updated_at: "2026-05-12T08:30:00Z", username: "morgan" }]);

  // morgan dependencies
  out.push(["users/morgan/dependencies/1.json", { id: 1, parent_id: 1, child_id: 2, dep_type: "FS" }]);
  out.push(["users/morgan/dependencies/2.json", { id: 2, parent_id: 2, child_id: 3, dep_type: "FS" }]);

  // Cross-owner hosted manifest. alex's task 14 ("Review morgan's draft
  // figures") is hosted INTO morgan's dissertation project so it shows up
  // on morgan's project view + Gantt alongside her own tasks. Both sides
  // (task.external_project + this manifest) must agree or the read-time
  // normalizer drops the orphan. See `lib/sharing/project-hosting.ts`.
  out.push([
    "users/morgan/projects/2-hosted.json",
    {
      version: 1,
      hostedTasks: [
        { owner: "alex", taskId: 14, sharedAt: "2026-05-13T16:00:00Z", sharedBy: "alex" },
      ],
    },
  ]);

  // morgan result task markdown stubs
  out.push(["users/morgan/results/task-1/notes.md", DEMO_BANNER_MD + "## 96-well plate setup\n\nPlated 80 candidate transformants + 8 WT + 8 positive controls. See `plate-96-fluo.png`.\n"]);
  out.push(["users/morgan/results/task-1/results.md", DEMO_BANNER_MD + "## Plate prep results\n\n80 / 80 wells inoculated cleanly — no cross-well contamination visible at 4× (demo data).\n"]);
  out.push(["users/morgan/results/task-2/notes.md", DEMO_BANNER_MD + "## Fluorescence scan\n\nReader run with default GFP settings (485/528). See `fluo-scan-results.png` for the heat-map.\n"]);
  out.push(["users/morgan/results/task-3/notes.md", DEMO_BANNER_MD + "## qPCR products\n\nProducts run on a 1.5% agarose gel — see `gel-qpcr-products.png`.\n"]);
  // task-7: short results.md so the older completed sanity check lands in
  // alex's Workbench "Earlier results" archive (it's in morgan's project 1
  // which is shared into alex's view) instead of "Awaiting writeup."
  out.push(["users/morgan/results/task-7/results.md", DEMO_BANNER_MD + "## Reader baseline\n\nFluorescence reader passed the calibration check — variance under 3% across replicates (demo data).\n"]);

  // morgan result task markdown — rich lab-recipe writeups. Three companion
  // files alongside the stubs above: task-2 + task-3 get full results.md
  // analyses (figures, tables, conclusions) and task-7 gets a full notes.md
  // (reagents, dilution series, reader settings). Each references PNGs
  // under its Images/ dir; the full SoT pair (this script +
  // generate-demo-images.mjs) regenerates every image deterministically,
  // including the seven morgan custom plots (colony-picking, gfp-kinetics,
  // od-vs-gfp-scatter, melt-curves, qpcr-amplification-curves, cv-baseline,
  // standard-curve) that used to require a manual `git checkout` after
  // each full regen. Keeping the markdown in the SoT prevents the regen
  // drift that happened during commit 18e32de7 (rich content was wiped
  // and had to be manually `git checkout`-ed back).
  out.push(["users/morgan/results/task-2/results.md", DEMO_BANNER_MD +
    "## Fluorescence scan — Plate M-T7-A-R (2026-05-14)\n" +
    "\n" +
    "### Endpoint heat-map (t=360 min)\n" +
    "\n" +
    "Reader heat-map at the final timepoint, GFP normalized per well (gain 60).\n" +
    "\n" +
    "![96-well fluorescence heat-map at t=360 min, hits cluster in cols 2-6](Images/fluo-scan-results.png)\n" +
    "\n" +
    "- Visible spread between candidates, WT (orange), and positive control (bright green)\n" +
    "- Hit clusters in **cols 3, 5, 7, 9** — consistent with the eye-tinted greens I pre-flagged during the pick\n" +
    "\n" +
    "### GFP / OD600 vs final OD600\n" +
    "\n" +
    "After normalizing per-well GFP by OD600 and dividing by the column-12 positive-control mean.\n" +
    "\n" +
    "![Scatter of GFP/OD600 vs OD600, hit threshold at 0.6× positive ctrl](Images/od-vs-gfp-scatter.png)\n" +
    "\n" +
    "- Positive control (col 12, n=6) clusters at GFP/OD = **0.92 to 1.08** of itself — tight, gain choice was correct\n" +
    "- WT (col 1, n=6): GFP/OD = **0.01 to 0.04** — essentially zero, as expected\n" +
    "- **Hits: 8 candidates** above the 0.6× threshold (well IDs: B7, C3, D11, E2, F8, G5, H1, A4 → all originally eye-tinted on the SD-Ura plate)\n" +
    "- 17 more candidates above the WT floor but below the 0.6× cutoff — possible weak expressors, parking for now\n" +
    "\n" +
    "### Kinetic curves\n" +
    "\n" +
    "How fast each group climbs from 0 to 6 h post-induction.\n" +
    "\n" +
    "![Kinetic GFP read, 0-6 h, positive ~9000 a.u., hits ~5500, WT flat](Images/gfp-kinetics.png)\n" +
    "\n" +
    "- Positive control plateau ~8800 a.u. by 4 h\n" +
    "- Hit average climbs slower, reaches ~5500 a.u. by 6 h (still climbing slightly — would need an 8 h read for true plateau)\n" +
    "- Candidate median plateaus ~1400 a.u. (mostly the weak-expressor pool)\n" +
    "- WT essentially flat (~350 a.u., baseline autofluorescence)\n" +
    "\n" +
    "### Key numbers\n" +
    "\n" +
    "| Group              | n  | GFP/OD600 (rel.)  | OD600 final      |\n" +
    "|--------------------|----|-------------------|------------------|\n" +
    "| Positive (col 12)  | 6  | 1.00 ± 0.05       | 0.71 ± 0.08      |\n" +
    "| WT (col 1)         | 6  | 0.02 ± 0.01       | 0.78 ± 0.06      |\n" +
    "| Hits (≥0.6× pos)   | 8  | 0.77 ± 0.11       | 0.65 ± 0.10      |\n" +
    "| Candidates (<0.6×) | 52 | 0.11 ± 0.06       | 0.62 ± 0.12      |\n" +
    "\n" +
    "### Conclusions\n" +
    "\n" +
    "- **8 hits** out of 60 candidates → 13.3% hit rate, in line with what alex predicted for the T7 library (10-15%)\n" +
    "- All 8 hits were also eye-tinted on the SD-Ura plate. The dissecting-scope tint screen is a real signal at this gain (would not bet on it alone, but it tracks)\n" +
    "- Mean GFP/OD600 for hits = **3.2× WT** in the kinetic plateau (rough number, want to confirm via qPCR)\n" +
    "- Reader CV on the positive-control wells stayed under 6% across the whole 6 h run — gain 60 is the right choice for this plasmid\n" +
    "\n" +
    "### Next\n" +
    "\n" +
    "- Pick the top 3 hits (B7, D11, G5 — highest GFP/OD) for qPCR transcript confirmation (task 3, Sat morning)\n" +
    "- Glycerol stock all 8 hits today, freezer 7, box \"M-T7-hits\"\n" +
    "- Send the CSV + figures to alex by EOD so he can rotate the plate for the second-round T7-B picks next week\n"]);

  out.push(["users/morgan/results/task-3/results.md", DEMO_BANNER_MD +
    "## qPCR results — fakeGFP transcript in 3 top hits\n" +
    "\n" +
    "### Amplification curves\n" +
    "\n" +
    "![qPCR amplification — hits Ct 22-23, ACT1 Ct 18.5, WT Ct 36.8, NTC clean](Images/qpcr-amplification-curves.png)\n" +
    "\n" +
    "- **Hits (B7, D11, G5)**: fakeGFP Ct = **22.1, 22.7, 23.4** (mean 22.7)\n" +
    "- **WT FY**: fakeGFP Ct = **36.8** — essentially background, late and shallow\n" +
    "- **NTC**: no amplification before cycle 40 — clean\n" +
    "- **ACT1 reference**: Ct = 18.5 across all samples (pooled curve shown)\n" +
    "\n" +
    "### Melt curves\n" +
    "\n" +
    "![qPCR melt curves — fakeGFP Tm 82.4 °C, ACT1 Tm 79.8 °C, single sharp peaks](Images/melt-curves.png)\n" +
    "\n" +
    "- fakeGFP: single sharp peak at **Tm 82.4 °C** — matches predicted 82 °C, no primer-dimer or non-specific product\n" +
    "- ACT1: single sharp peak at **Tm 79.8 °C** — matches\n" +
    "- NTC: small broad bump at ~70 °C (primer-dimer, well below the amplicon Tm — does not affect quantification)\n" +
    "- WT signal: same Tm as hits (82.4) but tiny height — real fakeGFP transcript, just baseline-level (probably autofluorescence-paired leaky transcription)\n" +
    "\n" +
    "### Gel (sanity check)\n" +
    "\n" +
    "![1.5% agarose gel of qPCR products, single bands at expected size](Images/gel-qpcr-products.png)\n" +
    "\n" +
    "- 5 µL of each qPCR product on a 1.5% gel after the melt curve completed\n" +
    "- All hit lanes show a single clean band at ~145 bp (fakeGFP) and ~120 bp (ACT1)\n" +
    "- WT lane: faint band at 145 bp, consistent with the Ct 36.8 signal\n" +
    "- No primer-dimer products visible at the size cutoff\n" +
    "\n" +
    "### ΔΔCt vs WT (relative fakeGFP transcript)\n" +
    "\n" +
    "| Sample   | fakeGFP Ct | ACT1 Ct | ΔCt   | ΔΔCt vs WT | Fold-change |\n" +
    "|----------|------------|---------|-------|------------|-------------|\n" +
    "| WT       | 36.8       | 18.5    | 18.3  | 0          | 1.0×        |\n" +
    "| Hit-B7   | 22.1       | 18.5    | 3.6   | −14.7      | **~26,500×** |\n" +
    "| Hit-D11  | 22.7       | 18.5    | 4.2   | −14.1      | **~17,500×** |\n" +
    "| Hit-G5   | 23.4       | 18.5    | 4.9   | −13.4      | **~10,800×** |\n" +
    "\n" +
    "### Conclusions\n" +
    "\n" +
    "- All 3 top hits show massive fakeGFP transcript over WT — 4 to 5 orders of magnitude — clean confirmation that the fluorescence signal in task 2 is bona fide transcript, not background or autofluorescence.\n" +
    "- Hit ranking by transcript matches the ranking by GFP/OD600 from task 2 (B7 > D11 > G5).\n" +
    "- ACT1 reference is stable across samples (Ct 18.4 to 18.6) — normalization is solid.\n" +
    "- Single sharp melt peaks on the target Tm confirm specificity. No need to re-design primers.\n" +
    "- Sending the amplification + melt + gel figures to alex tonight so he can green-light the T7-B library construction Monday morning.\n"]);

  out.push(["users/morgan/results/task-7/notes.md", DEMO_BANNER_MD +
    "# BioTek H1 baseline + standard curve\n" +
    "\n" +
    "Pre-flight check before any GFP screening this quarter. Reader has been sitting since the holiday shutdown; running fluorescein standard + empty-plate noise before alex hands over the first transformant batch.\n" +
    "\n" +
    "## Reagents\n" +
    "\n" +
    "- Fluorescein sodium salt stock — 10 µM in PBS (made 2026-03-10, stored 4 °C, foil-wrapped). Aliquot in freezer 3, rack B, slot 4.\n" +
    "- PBS (1×, sterile) — shared bench stock\n" +
    "- Black-wall clear-bottom 96-well plate (Greiner 655096) — box on shelf 1\n" +
    "\n" +
    "## Dilution series\n" +
    "\n" +
    "Fresh per run. 7 concentrations, 3 reps each:\n" +
    "\n" +
    "| nM   | µL 10 µM stock | µL PBS  |\n" +
    "|------|----------------|---------|\n" +
    "| 0    | 0              | 200     |\n" +
    "| 25   | 0.5            | 199.5   |\n" +
    "| 50   | 1              | 199     |\n" +
    "| 100  | 2              | 198     |\n" +
    "| 200  | 4              | 196     |\n" +
    "| 350  | 7              | 193     |\n" +
    "| 500  | 10             | 190     |\n" +
    "\n" +
    "Pipette in subdued bench light — fluorescein bleaches faster than I keep remembering.\n" +
    "\n" +
    "## Reader settings\n" +
    "\n" +
    "- BioTek H1 (lab unit, demo serial DEMO-H1-A)\n" +
    "- Mode: top-read fluorescence\n" +
    "- Ex 485 / Em 528, bandwidth 20/20\n" +
    "- Gain: 60 (matches the screen we'll run on the FY-Δgal80 transformants)\n" +
    "- 4 reads / well, 100 ms each, no shake\n" +
    "- Plate type: Greiner 655096\n" +
    "\n" +
    "## Empty-plate noise\n" +
    "\n" +
    "Same plate, all 96 wells filled with 60 nM fluorescein in PBS, 3 reads/well, no other changes. Goal: characterize well-to-well CV before we start interpreting differences in actual samples.\n" +
    "\n" +
    "## Quirks\n" +
    "\n" +
    "- Lamp on for 20 min before any reads (warmup curve is real, learned the hard way 2025-Q3).\n" +
    "- Lid OFF for fluorescence (condensation = scatter = bad).\n" +
    "- Door fully closed even between reads — ambient bench fluorescence bleeds in if it's cracked.\n" +
    "\n" +
    "## Notes for me\n" +
    "\n" +
    "- Scope booked Tue 9-noon for the dissection scope (transformant pick prep).\n" +
    "- Cleaned lamp housing per the BioTek docs link before the run, dust film was visible.\n" +
    "- If R² drops below 0.99 the lamp is on its way out — order replacement now, do not wait.\n"]);

  // ── morgan inventory (Inventory feature, behind INVENTORY_ENABLED) ────────
  // Mirrors alex's inventory shape for the second demo user. Whole-lab EDIT
  // sharing, dates hardcoded relative to TODAY (2026-05-13). Adds qPCR / assay
  // reagents that fit morgan's fluorescence-screening + qPCR work.
  out.push(...inventory("morgan", MORGAN_COLOR));

  // ── User: mira (Dr. Mira Castellanos, demo PI) ───────────────────────────
  //
  // The principal-investigator archetype. Oversees alex (postdoc) + morgan
  // (grad student) and leaves guidance / questions / praise on their shared
  // content as LabComments. Intentionally minimal: she has no projects,
  // tasks, methods, goals, purchases, or notes of her own — the demo's
  // story is that her engagement with the lab IS the comment thread layer
  // showing up across alex/morgan's surfaces.
  //
  // The empty counters ensure the lab-demo-data aggregator iterates her
  // directory cleanly without contributing any rows to the Gantt /
  // Methods / Notes panels (matches a real PI's data shape — comments
  // and meetings, not bench work).
  out.push([
    "users/mira/_counters.json",
    {
      projects: 0,
      tasks: 0,
      methods: 0,
      // Mira PI R1 fix manager (Fix 8, 2026-05-25): bumped from 0 to
      // 1 for the seeded Mira "Lab meeting (today)" event below. The
      // CalendarEventsTodayWidget reads the PI's own events folder, so
      // without this seed the tile reads empty on every Mira walk.
      events: 1,
      goals: 0,
      // 1:1 revamp (notes-revamp bot, 2026-06-07): 1 meeting note seeded
      // below for the mira<->alex 1:1 fixture.
      notes: 1,
      // 2 weekly goals seeded below (one checked, one open) for the same 1:1.
      weekly_goals: 2,
      purchase_items: 0,
      lab_links: 0,
      dependencies: 0,
    },
  ]);
  // Mira PI R1 fix manager (Fix 8, 2026-05-25): a single "Lab meeting"
  // event anchored at REAL_TODAY so the Today's events tile on
  // /lab-overview surfaces at least one row when Mira logs in. Generic
  // lab-meeting content (no real research, no PI), matches the
  // believable-but-fake demo rule.
  out.push([
    "users/mira/events/1.json",
    {
      id: 1,
      title: "Weekly lab meeting (demo)",
      event_type: "meeting",
      start_date: REAL_TODAY,
      end_date: REAL_TODAY,
      start_time: "10:00",
      end_time: "11:00",
      location: "Bio 4203 (demo)",
      url: null,
      notes: "Standing weekly. Member project updates + open issues.",
      color: "#3b82f6",
    },
  ]);
  out.push([
    "users/mira/settings.json",
    {
      animationType: "celebration",
      defaultGanttViewMode: "3-months",
      defaultCalendarViewMode: "month",
      showSharedByDefault: true,
      visibleTabs: [
        "/experiments",
        "/gantt",
        "/methods",
        "/purchases",
        "/results",
        "/calendar",
        "/links",
      ],
      defaultLandingTab: "/",
      sidebarShowTasks: true,
      sidebarShowCalendarEvents: true,
      sidebarEventsHorizonDays: 7,
      coloredHeader: false,
      // Lab Head Phase 1 (lab head Phase 1 manager, 2026-05-23): mira is
      // the demo lab's principal investigator. Setting `lab_head` reveals
      // the Lab Overview top-nav entry (renamed from "Lab Inbox" +
      // promoted to top-nav 2026-05-23) when this fixture is loaded as
      // the active user, and lights up the "PI" badge on her comments
      // across alex + morgan's shared content.
      displayName: "Dr. Mira Castellanos",
      account_type: "lab_head",
    },
  ]);
  out.push(["users/mira/_onboarding.json", DEMO_ONBOARDING_SIDECAR]);

  // Lab Head Phase 5 (lab head Phase 5 manager, 2026-05-23): demo
  // `_lab_head_auth.json` for Mira. Mirrors the on-disk PBKDF2 hash that
  // `setLabHeadPassword` would produce. Demo password is `demo-pi` —
  // hardcoded for the fixture; this is the demo, not production.
  //
  // The PBKDF2 spec (600k iters, SHA-256, 16-byte salt → 32-byte output)
  // matches `frontend/src/lib/lab/lab-head-auth.ts` exactly so the demo
  // file actually verifies through the real verifyLabHeadPassword path.
  const DEMO_PI_PASSWORD = "demo-pi";
  const PBKDF2_ITERATIONS = 600_000;
  const miraSalt = Buffer.from([
    0x4d, 0x69, 0x72, 0x61, 0x44, 0x65, 0x6d, 0x6f,
    0x53, 0x61, 0x6c, 0x74, 0x21, 0x32, 0x36, 0x21,
  ]); // deterministic 16-byte salt so the fixture is reproducible
  const miraHash = crypto.pbkdf2Sync(
    DEMO_PI_PASSWORD,
    miraSalt,
    PBKDF2_ITERATIONS,
    32,
    "sha256",
  );
  out.push([
    "users/mira/_lab_head_auth.json",
    {
      version: 1,
      kdf: "PBKDF2-SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: miraSalt.toString("base64"),
      hash: miraHash.toString("base64"),
      created_at: "2026-04-01T09:00:00Z",
      updated_at: "2026-04-01T09:00:00Z",
    },
  ]);

  // ── 1:1 revamp (notes-revamp bot, 2026-06-07): mira<->alex Mentoring ──────
  //
  // Deterministic fixture for the wiki-capture screenshot + Demo Mode. Seeds:
  //   - OneOnOne record (owned by mira, the lab head)
  //   - 2 weekly goals created by mira (1 checked, 1 open; current week)
  //   - 1 meeting note created by mira (one_on_one_id scoped; note_kind "meeting")
  //   - 1 action item owned by mira's folder
  // Alex gets 1 weekly goal too (to show the bidirectional add). His counter
  // is bumped further down at his _counters entry.
  const OO_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
  const OO_AI_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const OO_SHARED_WITH = [
    { username: "mira", level: "edit" },
    { username: "alex", level: "edit" },
  ];
  out.push([
    `users/mira/one_on_ones/${OO_ID}.json`,
    {
      id: OO_ID,
      labHead: "mira",
      member: "alex",
      created_by: "mira",
      owner: "mira",
      created_at: "2026-04-01T09:00:00Z",
      shared_with: OO_SHARED_WITH,
    },
  ]);
  out.push([
    "users/mira/weekly_goals/1.json",
    {
      id: 1,
      owner: "mira",
      text: "Review chapter 2 outline",
      week_of: "2026-05-25",
      is_complete: true,
      created_at: "2026-05-25T09:00:00Z",
      created_by: "mira",
      is_shared: true,
      shared_with: OO_SHARED_WITH,
      one_on_one_id: OO_ID,
    },
  ]);
  out.push([
    "users/mira/weekly_goals/2.json",
    {
      id: 2,
      owner: "mira",
      text: "Send feedback on fakeGFP expression data",
      week_of: "2026-05-25",
      is_complete: false,
      created_at: "2026-05-25T10:00:00Z",
      created_by: "mira",
      is_shared: true,
      shared_with: OO_SHARED_WITH,
      one_on_one_id: OO_ID,
    },
  ]);
  out.push([
    "users/mira/notes/1.json",
    {
      id: 1,
      title: "Check-in 2026-05-21: dissertation timeline",
      description:
        "Attendees: Dr. Castellanos, alex.\n\nAgenda:\n1. Chapter 2 figure plan + submission timeline\n2. fakeGFP expression data review\n3. Conference travel: Demo Synthetic Biology Conference June 2026\n\nNotes:\nAlex is on track for a chapter 2 draft by May 30. Mira to review within 72 h. fakeGFP Cq looks tight (ACT1 SD 0.10) — discuss 150 nM primer trial next meeting to cut reagent burn.\n\nAction items logged below.",
      is_running_log: false,
      is_shared: true,
      shared_with: OO_SHARED_WITH,
      entries: [],
      comments: [],
      created_at: "2026-05-21T14:00:00Z",
      updated_at: "2026-05-21T14:30:00Z",
      username: "mira",
      one_on_one_id: OO_ID,
      note_kind: "meeting",
    },
  ]);
  out.push([
    `users/mira/one_on_one_action_items/${OO_AI_ID}.json`,
    {
      id: OO_AI_ID,
      one_on_one_id: OO_ID,
      text: "Send chapter 2 outline draft to Mira by May 30",
      is_done: false,
      created_by: "alex",
      created_at: "2026-05-21T14:00:00Z",
      owner: "mira",
      shared_with: OO_SHARED_WITH,
    },
  ]);

  // ── Check-ins demo seed (checkins-demo bot, 2026-06-12) ─────────────────────
  //
  // Extends the single Mira<->Alex pair above into the full check-ins feature
  // set for the marketing demo clip, ADDITIVELY. Nothing above changes. Seeds:
  //
  //   1. A 3-level mentorship tree with a top-level branch and a skip-level:
  //        Mira -> Alex (existing pair, kept)
  //        Mira -> Morgan (new pair)            -> top-level branch
  //        Alex -> Remy   (new pair)            -> depth, 3 levels
  //        Mira <-> Remy  (new pair, skip-level since Remy reports through Alex)
  //      Each new space writes the post-revamp fields (members/mentor/kind) plus
  //      the legacy labHead/member back-compat pair (it is a mentored pair).
  //      The mentorship tree (lib/checkins/mentorship-tree.ts) is derived purely
  //      from the `mentor` edge across the spaces a viewer can read, so:
  //        - Mira's view: Mira -> {Alex, Morgan, Remy} (the branch).
  //        - Alex's view: Mira -> Alex -> Remy (the 3-level depth).
  //        - Remy's view: the Mira<->Remy space fires the skip-level badge,
  //          because Remy also reports through Alex via the Alex<->Remy space
  //          (isSkipLevel sees the closer mentor edge in the readable set).
  //
  //   2. A populated IDP owned by Alex (grad-stage career plan), reviewed by
  //      Mira. Four shareable sections shared with the mentor, the values
  //      reflection kept private. Lives in Alex's folder (idps/<uuid>.json).
  //
  //   3. A group space ("FakeYeast group meeting") with Mira mentor and members
  //      [mira, alex, morgan, remy], carrying a task board (4 assigned action
  //      items) and a presenter rotation (2 tracks).
  //
  // Skip-level + tree edges are validated against the pure helpers in
  // lib/checkins/mentorship-tree.ts; the IDP shape against lib/idp and the
  // rotation against lib/checkins/rotation-store.ts.

  // Stable space + record ids (deterministic so the fixture is reproducible).
  const OO_MIRA_MORGAN_ID = "b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f";
  const OO_ALEX_REMY_ID = "c2d3e4f5-a6b7-4c8d-9e0a-1b2c3d4e5f60";
  const OO_MIRA_REMY_ID = "d3e4f5a6-b7c8-4d9e-0a1b-2c3d4e5f6071";
  const OO_GROUP_ID = "e4f5a6b7-c8d9-4e0a-1b2c-3d4e5f607182";
  const ALEX_IDP_ID = "f5a6b7c8-d9e0-4a1b-2c3d-4e5f60718293";
  const GROUP_ROTATION_ID = "a6b7c8d9-e0a1-4b2c-3d4e-5f60718293a4";

  const sharedEdit = (...usernames) =>
    usernames.map((username) => ({ username, level: "edit" }));

  // --- Pair: Mira mentors Morgan (the top-level branch) ---------------------
  out.push([
    `users/mira/one_on_ones/${OO_MIRA_MORGAN_ID}.json`,
    {
      id: OO_MIRA_MORGAN_ID,
      members: ["mira", "morgan"],
      mentor: "mira",
      kind: "pair",
      title: null,
      labHead: "mira",
      member: "morgan",
      created_by: "mira",
      owner: "mira",
      created_at: "2026-04-02T09:00:00Z",
      cadence: { every: "week" },
      shared_with: sharedEdit("mira", "morgan"),
    },
  ]);

  // --- Pair: Alex mentors Remy (depth, the 3rd level) -----------------------
  out.push([
    `users/alex/one_on_ones/${OO_ALEX_REMY_ID}.json`,
    {
      id: OO_ALEX_REMY_ID,
      members: ["alex", "remy"],
      mentor: "alex",
      kind: "pair",
      title: null,
      labHead: "alex",
      member: "remy",
      created_by: "alex",
      owner: "alex",
      created_at: "2026-05-04T10:00:00Z",
      cadence: { every: "week" },
      shared_with: sharedEdit("alex", "remy"),
    },
  ]);

  // --- Pair: Mira <-> Remy (skip-level, Remy reports through Alex) ----------
  out.push([
    `users/mira/one_on_ones/${OO_MIRA_REMY_ID}.json`,
    {
      id: OO_MIRA_REMY_ID,
      members: ["mira", "remy"],
      mentor: "mira",
      kind: "pair",
      title: "Skip-level with Remy",
      labHead: "mira",
      member: "remy",
      created_by: "mira",
      owner: "mira",
      created_at: "2026-05-06T11:00:00Z",
      cadence: { every: "month" },
      shared_with: sharedEdit("mira", "remy"),
    },
  ]);

  // --- IDP: Alex's grad-stage development plan, reviewed by Mira ------------
  // Skill rating keys come from lib/idp/competencies.ts (group::slug). Self
  // (proficiency) vs importance (for the target career). The gap drives the
  // growth-area summary; high self ratings drive strengths.
  out.push([
    `users/alex/idps/${ALEX_IDP_ID}.json`,
    {
      id: ALEX_IDP_ID,
      owner: "alex",
      career_stage: "grad",
      self_assessment: {
        ratings: {
          "research::experimental-design": { self: 4, importance: 5 },
          "research::data-analysis-and-statistics": { self: 3, importance: 5 },
          "research::reproducibility-and-data-management": { self: 4, importance: 4 },
          "comm::scientific-writing": { self: 2, importance: 5 },
          "comm::presenting-and-talks": { self: 3, importance: 4 },
          "comm::grant-and-proposal-writing": { self: 2, importance: 4 },
          "pdm::planning-and-prioritizing": { self: 3, importance: 4 },
          "lead::mentoring-others": { self: 3, importance: 4 },
          "lead::collaboration-and-teamwork": { self: 4, importance: 4 },
          "rcr::research-ethics-and-integrity": { self: 4, importance: 5 },
          "rcr::data-ownership-and-sharing-norms": { self: 3, importance: 4 },
          "career::networking": { self: 2, importance: 4 },
        },
        responsibilities:
          "Lead the fakeGFP expression project (cloning, yeast transformation, qPCR validation). Maintain the lab's shared qPCR primer inventory and the fluorescence reader SOP. Mentor Remy on basic yeast culture during their rotation.",
      },
      career_exploration: {
        aspirations:
          "Stay at the bench but move toward a role where I design the experiments and own the data story end to end. I am drawn to an industry scientist track at a synthetic-biology or therapeutics company, with a PI track as the open alternative if a strong postdoc fit appears.",
        target_path: "Industry research scientist (synthetic biology), PI track as alternative",
      },
      goals: [
        {
          id: "alex-idp-goal-1",
          text: "Submit the fakeGFP expression manuscript as first author by Q1 2027",
          term: "long",
          priority: "high",
        },
        {
          id: "alex-idp-goal-2",
          text: "Draft Chapter 2 of the dissertation and pass the committee meeting this fall",
          term: "short",
          priority: "high",
        },
        {
          id: "alex-idp-goal-3",
          text: "Strengthen scientific writing by drafting one figure-and-legend per week",
          term: "short",
          priority: "low",
        },
        {
          id: "alex-idp-goal-4",
          text: "Build an industry network through two informational interviews and one conference",
          term: "long",
          priority: "low",
        },
      ],
      action_plan: [
        {
          id: "alex-idp-action-1",
          objective: "Complete the fakeGFP qPCR validation dataset",
          approach: "Run the 150 nM primer trial, lock the ACT1 reference, and finalize the three biological replicates",
          target_date: "2026-07-15",
          outcome: "Clean Cq dataset with SD under 0.15 across replicates, ready for the figure",
          status: "in_progress",
        },
        {
          id: "alex-idp-action-2",
          objective: "Draft the manuscript methods and results sections",
          approach: "Write one subsection per week, review each with Mira at the weekly check-in",
          target_date: "2026-09-30",
          outcome: "A complete methods and results draft circulated to coauthors",
          status: "not_started",
        },
        {
          id: "alex-idp-action-3",
          objective: "Run two informational interviews with industry scientists",
          approach: "Reach out through the department alumni list and a conference contact",
          target_date: "2026-10-31",
          outcome: "Two interviews completed with notes on the day-to-day and hiring path",
          status: "not_started",
        },
      ],
      mentor_review: {
        comment:
          "Strong technical footing and the project ownership is exactly where I want a third-year to be. The honest read on writing is right, so we will make the weekly figure-and-legend habit the priority and I will turn around feedback within 72 hours. Let us revisit the industry-versus-PI question after the committee meeting, no need to decide now.",
        reviewed_by: "mira",
        reviewed_at: "2026-05-22T15:00:00Z",
        revisit_date: "2027-05-22",
      },
      values_reflection: {
        note:
          "What keeps me here is building something real that other people can use, not the title. I want a group small enough that I still touch the data. I worry about whether I am fast enough at writing, and I do not want a job that is all grant deadlines and no bench.",
      },
      shared_sections: {
        self_assessment: true,
        career_exploration: true,
        goals: true,
        action_plan: true,
      },
      mentor: "mira",
      shared_with: [{ username: "mira", level: "view" }],
      created_at: "2026-05-10T09:00:00Z",
      updated_at: "2026-05-22T15:00:00Z",
      last_edited_by: "mira",
    },
  ]);

  // --- Group space: FakeYeast group meeting --------------------------------
  // kind "group", Mira mentor, all four active members. Owned by Mira; every
  // member at edit. Carries the task board and the presenter rotation below.
  const GROUP_MEMBERS = ["mira", "alex", "morgan", "remy"];
  out.push([
    `users/mira/one_on_ones/${OO_GROUP_ID}.json`,
    {
      id: OO_GROUP_ID,
      members: GROUP_MEMBERS,
      mentor: "mira",
      kind: "group",
      title: "FakeYeast group meeting",
      created_by: "mira",
      owner: "mira",
      created_at: "2026-04-03T09:00:00Z",
      cadence: { every: "week", weekday: 2 },
      shared_with: sharedEdit(...GROUP_MEMBERS),
    },
  ]);

  // Task board: 4 action items scoped to the group, assigned across members so
  // the per-assignee bands populate. Owned by the space owner (Mira).
  const groupBoardItems = [
    {
      id: "ai-group-1",
      text: "Present the fakeGFP expression results at next group meeting",
      assignee: "alex",
      due_date: "2026-05-26",
      created_by: "mira",
      created_at: "2026-05-19T09:00:00Z",
    },
    {
      id: "ai-group-2",
      text: "Finish the 96-well fluorescence reader scan and post the CSV",
      assignee: "morgan",
      due_date: "2026-05-22",
      created_by: "morgan",
      created_at: "2026-05-19T09:05:00Z",
    },
    {
      id: "ai-group-3",
      text: "Restock the ACT1 reference primer aliquots in freezer 5",
      assignee: "remy",
      due_date: "2026-05-23",
      created_by: "alex",
      created_at: "2026-05-19T09:10:00Z",
    },
    {
      id: "ai-group-4",
      text: "Circulate the journal-club paper two days before the meeting",
      assignee: "morgan",
      due_date: null,
      is_done: true,
      created_by: "mira",
      created_at: "2026-05-12T09:00:00Z",
    },
  ];
  for (const item of groupBoardItems) {
    out.push([
      `users/mira/one_on_one_action_items/${item.id}.json`,
      {
        id: item.id,
        one_on_one_id: OO_GROUP_ID,
        text: item.text,
        is_done: item.is_done ?? false,
        created_by: item.created_by,
        created_at: item.created_at,
        owner: "mira",
        assignee: item.assignee,
        due_date: item.due_date,
        shared_with: sharedEdit(...GROUP_MEMBERS),
      },
    ]);
  }

  // Presenter rotation: two tracks over the group members, each with a current
  // pointer so the Rotation tab shows "Up next" / "On deck". Lives in the space
  // owner's folder (checkin_rotations/<uuid>.json).
  out.push([
    `users/mira/checkin_rotations/${GROUP_ROTATION_ID}.json`,
    {
      id: GROUP_ROTATION_ID,
      space_id: OO_GROUP_ID,
      owner: "mira",
      tracks: [
        {
          id: "rot-track-data",
          name: "Data presentation",
          order: ["alex", "morgan", "remy"],
          current_index: 1,
        },
        {
          id: "rot-track-jc",
          name: "Journal club",
          order: ["morgan", "alex", "mira", "remy"],
          current_index: 0,
        },
      ],
      shared_with: sharedEdit(...GROUP_MEMBERS),
      created_at: "2026-04-03T09:00:00Z",
      updated_at: "2026-05-19T09:00:00Z",
    },
  ]);

  // Two group meeting notes for richness (note_kind "meeting", scoped to the
  // group space). Owned by Mira; shared with every member.
  out.push([
    "users/mira/notes/2.json",
    {
      id: 2,
      title: "Group meeting 2026-05-19: fakeGFP results dry run",
      description:
        "Attendees: Dr. Castellanos, alex, morgan, remy.\n\nAgenda:\n1. Alex dry-runs the fakeGFP expression figures before the manuscript draft\n2. Morgan reader-scan status on the 96-well screen\n3. Journal club paper assignment\n\nNotes:\nAlex's Cq spread is tightening with the locked ACT1 reference. Morgan to post the reader CSV by Thursday. Remy is up to speed on yeast culture and takes the freezer-5 primer restock. Next data presenter is Morgan, journal club lead is Morgan.",
      is_running_log: false,
      is_shared: true,
      shared_with: sharedEdit(...GROUP_MEMBERS),
      entries: [],
      comments: [],
      created_at: "2026-05-19T15:00:00Z",
      updated_at: "2026-05-19T15:30:00Z",
      username: "mira",
      one_on_one_id: OO_GROUP_ID,
      note_kind: "meeting",
    },
  ]);

  // --- Remy: minimal valid lab-member folder -------------------------------
  // Just enough to be discovered (user-discovery scans users/* dirs) and to
  // appear in the roster + mentorship tree. No projects, tasks, or methods.
  out.push([
    "users/remy/_counters.json",
    {
      projects: 0,
      tasks: 0,
      methods: 0,
      events: 0,
      goals: 0,
      notes: 0,
      purchase_items: 0,
      lab_links: 0,
      dependencies: 0,
    },
  ]);
  out.push([
    "users/remy/settings.json",
    {
      displayName: "Remy Okafor",
      animationType: "celebration",
      defaultGanttViewMode: "1-month",
      defaultCalendarViewMode: "week",
      showSharedByDefault: true,
      visibleTabs: ["/experiments", "/gantt", "/methods", "/results", "/calendar"],
      defaultLandingTab: "/",
      sidebarShowTasks: true,
      sidebarShowCalendarEvents: true,
      sidebarEventsHorizonDays: 7,
      coloredHeader: false,
      // Remy is an undergraduate rotation student, a regular lab member.
      account_type: "member",
    },
  ]);
  out.push(["users/remy/_onboarding.json", DEMO_ONBOARDING_SIDECAR]);

  // Demo PI audit entries — showcase Mira having edited fields on
  // alex/morgan's records via Phase 5's session edit mode. The entries
  // live in the TARGET user's folder per the per-user audit-log
  // convention (proposal section 2c). Three entries split across two
  // users illustrates both the per-user file and the per-field append
  // pattern.
  const DEMO_SESSION_A = "demo-sess-2026-05-15-alex";
  const DEMO_SESSION_B = "demo-sess-2026-05-17-morgan";
  out.push([
    "users/alex/_pi_audit.json",
    {
      version: 1,
      entries: [
        {
          id: "audit-mira-alex-1",
          session_id: DEMO_SESSION_A,
          actor: "mira",
          target_user: "alex",
          record_type: "task",
          record_id: 5,
          field_path: "name",
          old_value: "Yeast transformation screen",
          new_value: "Yeast transformation screen (LiAc)",
          timestamp: "2026-05-15T14:32:18Z",
        },
        {
          id: "audit-mira-alex-2",
          session_id: DEMO_SESSION_A,
          actor: "mira",
          target_user: "alex",
          record_type: "task",
          record_id: 5,
          field_path: "duration_days",
          old_value: 3,
          new_value: 4,
          timestamp: "2026-05-15T14:32:45Z",
        },
      ],
    },
  ]);
  out.push([
    "users/morgan/_pi_audit.json",
    {
      version: 1,
      entries: [
        {
          id: "audit-mira-morgan-1",
          session_id: DEMO_SESSION_B,
          actor: "mira",
          target_user: "morgan",
          record_type: "note",
          record_id: 2,
          field_path: "description",
          old_value:
            "Plate layouts for the 96-well growth-curve screen.",
          new_value:
            "Plate layouts for the 96-well growth-curve screen. Includes corner-evaporation controls per Lab Head request.",
          timestamp: "2026-05-17T10:08:22Z",
        },
      ],
    },
  ]);

  // ── User: sam (Dr. Sam Whitley, departed postdoc — Lab Head Phase 6) ───
  //
  // Showcases the user-archiving feature added in Lab Head Phase 6. Sam
  // joined the lab earlier than alex/morgan (Sept 2025), left for an
  // industry role in mid-March 2026, and was archived by Mira shortly
  // after. He shows up in three places across the demo:
  //
  //   1. Hidden by default from the login picker (`archived: true` in
  //      `_onboarding.json`). Toggling "Show archived" reveals him with
  //      a gray "Archived" badge.
  //   2. Filtered out of the @mention picker, share dialog, and
  //      assignee dropdown.
  //   3. His historical comments on alex's task 5 (transformation
  //      screen) still render — the comment renderer doesn't gate on
  //      archive state, and the missing-user-lookup fallback (gray
  //      attribution) handles the departed-author case.
  //
  // Intentionally minimal: no projects, methods, or notes of his own
  // — Sam's purpose is to demonstrate archive UX. The departure date
  // (2026-03-15) is consistent across his settings, onboarding, and
  // the audit entry below.
  out.push([
    "users/sam/_counters.json",
    {
      projects: 0,
      tasks: 0,
      methods: 0,
      events: 0,
      goals: 0,
      notes: 0,
      purchase_items: 0,
      lab_links: 0,
      dependencies: 0,
    },
  ]);
  out.push([
    "users/sam/settings.json",
    {
      animationType: "celebration",
      defaultGanttViewMode: "2week",
      defaultCalendarViewMode: "month",
      showSharedByDefault: true,
      visibleTabs: ["/gantt", "/methods", "/results", "/calendar"],
      defaultLandingTab: "/",
      sidebarShowTasks: true,
      sidebarShowCalendarEvents: false,
      sidebarEventsHorizonDays: 7,
      coloredHeader: true,
      displayName: "Dr. Sam Whitley",
      // Sam was a regular postdoc, not the PI. account_type stays
      // "member" — archive state is on the onboarding sidecar, not
      // here.
      account_type: "member",
    },
  ]);
  // Sam's onboarding sidecar carries the v5 archive flags. archived_at
  // matches the departure date; archived_by is mira (the lab head who
  // triggered the action). schemaVersion 5 to match the Phase 6 bump
  // in lib/onboarding/sidecar.ts.
  out.push([
    "users/sam/_onboarding.json",
    {
      version: 5,
      first_seen_at: "2025-09-01T00:00:00.000Z",
      active_seconds: 0,
      // demo fixture manager 2026-05-23: sam was a member in the demo
      // lab before departing, so his picks mirror the shared
      // DEMO_ONBOARDING_SIDECAR shape. Doesn't change picker
      // visibility (archived: true keeps him hidden by default), but
      // keeps the Phase 1 / 3 lab-workspace gate consistent if he's
      // ever surfaced via Show archived.
      feature_picks: {
        account_type: "lab",
        lab_storage: "local",
        purchases: "yes",
        calendar: "yes",
        goals: "yes",
        telegram: "yes",
        ai_helper: "full",
        links: "yes",
      },
      wizard_completed_at: "2025-09-15T12:00:00.000Z",
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
      lab_mode_tour_choice: null,
      archived: true,
      archived_at: "2026-03-15T10:00:00.000Z",
      archived_by: "mira",
    },
  ]);
  // Audit entry on sam's `_pi_audit.json` showing the archive action.
  // Per Phase 6 user-archive helper, archive emits one entry per
  // transition with record_type "user", field_path "archived",
  // boolean old/new values. Demo session id is a fixture string;
  // production code passes the live session id from edit-session.
  out.push([
    "users/sam/_pi_audit.json",
    {
      version: 1,
      entries: [
        {
          id: "audit-mira-sam-archive",
          session_id: "demo-sess-2026-03-15-sam-archive",
          actor: "mira",
          target_user: "sam",
          record_type: "user",
          record_id: "sam",
          field_path: "archived",
          old_value: false,
          new_value: true,
          timestamp: "2026-03-15T10:00:00.000Z",
        },
      ],
    },
  ]);

  // ── Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23) ──────────
  //
  // Adds the four soft-write action surfaces to the demo lab. Each piece
  // is a small override at the end of buildEntries so the existing
  // records earlier in the file stay readable — the demo writer + the
  // fixture mock both use a key-based map, so later out.push entries
  // overwrite earlier ones for the same path.
  //
  // Showcase plan:
  //   - 3 announcements (one pinned about a lab meeting)
  //   - 1 task assignment (Mira → morgan on alex's task 14, "Review
  //     morgan's draft figures") which is already shared into morgan's
  //     project 2, giving a natural cross-owner story
  //   - 1 approved purchase (alex item 3, Phusion polymerase)
  //   - 1 flagged record (morgan task 4, Draft Chapter 2 outline)
  //     with reason text per the brief example
  //
  // The audit log appendings mirror what Phase 5 R1's owner-scoped
  // wrappers would write; we slot them into the same _pi_audit.json
  // files already declared above by appending entries client-side.

  const DEMO_SESSION_C = "demo-sess-2026-05-19-phase3";
  const ANN_NOW = "2026-05-19T09:30:00Z";
  const ANN_EARLIER = "2026-05-12T17:30:00Z";
  // Lab Overview PI fixture-seed manager (Chip C, 2026-05-25): pinned
  // welcome announcement is the newest item so it sits at the top of
  // both the canvas Announcements tile and the sidebar TodaysAnnouncements
  // tile. Mira-voice (lab coordination, NOT meta copy about the feature).
  const ANN_WELCOME = "2026-05-20T08:15:00Z";

  out.push([
    "_announcements.json",
    {
      version: 1,
      announcements: [
        {
          // Pinned welcome. Sets the lab-coordination tone in Mira's
          // voice: a concrete change (reagent ordering channel),
          // an explicit ack request ("reply yes"), and the lab-head
          // sign-off rhythm. NOT meta copy ("this is where you talk
          // to the lab") which would read as a tutorial overlay
          // rather than a real announcement.
          id: "ann-mira-welcome",
          author: "mira",
          text:
            "Welcome to the new lab dashboard! A few housekeeping " +
            "items before the week kicks off: reagent orders go " +
            "through the lab purchases tab now (not Slack), check " +
            "the pending column before Friday so I can approve in " +
            "one pass. Reply with a yes when you've seen this so I " +
            "know it landed.",
          created_at: ANN_WELCOME,
          pinned: true,
        },
        {
          id: "ann-mira-lab-meeting",
          author: "mira",
          text:
            "Lab meeting this Friday 2pm in Bio 4203. Bring strain " +
            "design notes and any qPCR data from this week.",
          created_at: ANN_NOW,
          pinned: false,
        },
        {
          id: "ann-mira-doe-renewal",
          author: "mira",
          text:
            "DOE renewal abstract is due May 29. Please flag any " +
            "preliminary-data figures you want me to include — " +
            "I'm anchoring on the FakeYeast biofuel results plus " +
            "morgan's 96-well screen.",
          created_at: ANN_EARLIER,
          pinned: false,
        },
        {
          id: "ann-mira-freezer-cleanout",
          author: "mira",
          text:
            "Reminder: freezer 5 cleanout this Saturday. Label any " +
            "tubes you want kept by Friday EOD. Unlabeled tubes go " +
            "into the discard bin per lab SOP.",
          created_at: "2026-05-15T11:00:00Z",
          pinned: false,
        },
      ],
    },
  ]);

  // Lab-wide audit log alongside `_announcements.json` — captures Mira
  // posting the pinned announcement. Lab-level audit (target_user
  // "_lab") is distinct from the per-user `users/<u>/_pi_audit.json`
  // entries created above.
  out.push([
    "_pi_audit.json",
    {
      version: 1,
      entries: [
        {
          id: "audit-mira-ann-welcome",
          session_id: DEMO_SESSION_C,
          actor: "mira",
          target_user: "_lab",
          record_type: "announcement",
          record_id: "ann-mira-welcome",
          field_path: "text",
          old_value: null,
          new_value:
            "Welcome to the new lab dashboard! A few housekeeping " +
            "items before the week kicks off: reagent orders go " +
            "through the lab purchases tab now (not Slack), check " +
            "the pending column before Friday so I can approve in " +
            "one pass. Reply with a yes when you've seen this so I " +
            "know it landed.",
          timestamp: ANN_WELCOME,
        },
        {
          id: "audit-mira-ann-1",
          session_id: DEMO_SESSION_C,
          actor: "mira",
          target_user: "_lab",
          record_type: "announcement",
          record_id: "ann-mira-lab-meeting",
          field_path: "text",
          old_value: null,
          new_value:
            "Lab meeting this Friday 2pm in Bio 4203. Bring strain " +
            "design notes and any qPCR data from this week.",
          timestamp: ANN_NOW,
        },
      ],
    },
  ]);

  // ── Task assignment override: alex task 14 (Review morgan's draft
  // figures) gets reassigned to morgan. Alex still owns the task; the
  // brief asked for owner !== assignee so the chip story reads:
  // "Assigned to morgan · Owner: alex".
  out.push([
    "users/alex/tasks/14.json",
    {
      id: 14,
      project_id: 4,
      name: "Review morgan's draft figures",
      start_date: "2026-05-12",
      duration_days: 3,
      end_date: "2026-05-14",
      is_high_level: false,
      is_complete: false,
      task_type: "list",
      weekend_override: null,
      method_id: null,
      method_ids: [],
      deviation_log: null,
      tags: null,
      sort_order: 14,
      experiment_color: null,
      sub_tasks: [
        { id: "st1", text: "Read intro + methods sections", is_complete: true },
        { id: "st2", text: "Annotate figures 1–3 with margin comments", is_complete: false },
        { id: "st3", text: "Cross-check stats - n values + error bar definitions", is_complete: true },
        { id: "st4", text: "Flag any panels that need re-rendering at 300dpi", is_complete: false },
        { id: "st5", text: "Send consolidated feedback to morgan", is_complete: false },
      ],
      pcr_gradient: null,
      pcr_ingredients: null,
      method_attachments: [],
      owner: "alex",
      shared_with: [],
      external_project: { owner: "morgan", id: 2, sharedAt: "2026-05-13T16:00:00Z" },
      comments: [],
      // Lab Head Phase 3 — Mira reassigns this list to morgan herself
      // since she's been doing the figure rework.
      assignee: "morgan",
    },
  ]);

  // ── Approved purchase override: alex item 3 (Phusion polymerase) gets
  // a green PI-approved badge.
  out.push([
    "users/alex/purchase_items/3.json",
    {
      id: 3,
      task_id: 7,
      item_name: "Phusion polymerase (demo)",
      quantity: 1,
      link: "https://example.org/demo-neb",
      cas: null,
      price_per_unit: 285,
      shipping_fees: 0,
      total_price: 285,
      notes: "For DemoCheck PCR.",
      funding_string: "DEMO-NIH-GM999999",
      vendor: "NEB",
      category: "Reagents",
      // Lab Head Phase 3 — Mira approved this purchase during the
      // 2026-05-19 review session.
      approved: true,
      approved_by: "mira",
      approved_at: "2026-05-19T09:42:11Z",
    },
  ]);

  // ── Flagged record: morgan's task 4 (Draft Chapter 2 outline).
  out.push([
    "users/morgan/tasks/4.json",
    {
      id: 4,
      project_id: 2,
      name: "Draft Chapter 2 outline",
      start_date: "2026-05-06",
      duration_days: 3,
      end_date: "2026-05-09",
      is_high_level: false,
      is_complete: false,
      task_type: "list",
      weekend_override: null,
      method_id: null,
      method_ids: [],
      deviation_log: null,
      tags: null,
      sort_order: 4,
      experiment_color: null,
      sub_tasks: [
        { id: "st1", text: "Pull figures + key results from the 96-well screen project", is_complete: false },
        { id: "st2", text: "Sketch section headers - intro, methods, results, discussion", is_complete: false },
        { id: "st3", text: "List open questions to bring up with advisor", is_complete: false },
        { id: "st4", text: "Draft figure list with target panels (Fig 2.1 - 2.6)", is_complete: false },
        { id: "st5", text: "Block 2 mornings on calendar for first writing pass", is_complete: false },
      ],
      pcr_gradient: null,
      pcr_ingredients: null,
      method_attachments: [],
      owner: "morgan",
      shared_with: [],
      external_project: null,
      comments: [],
      // Lab Head Phase 3 — Mira flagged this for review during 1:1 prep.
      flagged: {
        by: "mira",
        at: "2026-05-19T09:48:30Z",
        reason: "Let's chat about this in our 1:1 — I want the chapter outline scoped tighter before you start the writing pass.",
      },
    },
  ]);

  // ── Phase 3 audit appendings: extend the per-user audit files with
  // entries for the assignment, approval, and flag actions.
  out.push([
    "users/alex/_pi_audit.json",
    {
      version: 1,
      entries: [
        {
          id: "audit-mira-alex-1",
          session_id: DEMO_SESSION_A,
          actor: "mira",
          target_user: "alex",
          record_type: "task",
          record_id: 5,
          field_path: "name",
          old_value: "Yeast transformation screen",
          new_value: "Yeast transformation screen (LiAc)",
          timestamp: "2026-05-15T14:32:18Z",
        },
        {
          id: "audit-mira-alex-2",
          session_id: DEMO_SESSION_A,
          actor: "mira",
          target_user: "alex",
          record_type: "task",
          record_id: 5,
          field_path: "duration_days",
          old_value: 3,
          new_value: 4,
          timestamp: "2026-05-15T14:32:45Z",
        },
        {
          id: "audit-mira-alex-3",
          session_id: DEMO_SESSION_C,
          actor: "mira",
          target_user: "alex",
          record_type: "task",
          record_id: 14,
          field_path: "assignee",
          old_value: null,
          new_value: "morgan",
          timestamp: "2026-05-19T09:45:01Z",
        },
        {
          id: "audit-mira-alex-4",
          session_id: DEMO_SESSION_C,
          actor: "mira",
          target_user: "alex",
          record_type: "purchase_item",
          record_id: 3,
          field_path: "approved",
          old_value: false,
          new_value: true,
          timestamp: "2026-05-19T09:42:11Z",
        },
      ],
    },
  ]);
  out.push([
    "users/morgan/_pi_audit.json",
    {
      version: 1,
      entries: [
        {
          id: "audit-mira-morgan-1",
          session_id: DEMO_SESSION_B,
          actor: "mira",
          target_user: "morgan",
          record_type: "note",
          record_id: 2,
          field_path: "description",
          old_value:
            "Plate layouts for the 96-well growth-curve screen.",
          new_value:
            "Plate layouts for the 96-well growth-curve screen. Includes corner-evaporation controls per Lab Head request.",
          timestamp: "2026-05-17T10:08:22Z",
        },
        {
          id: "audit-mira-morgan-2",
          session_id: DEMO_SESSION_C,
          actor: "mira",
          target_user: "morgan",
          record_type: "task",
          record_id: 4,
          field_path: "flagged",
          old_value: null,
          new_value: {
            by: "mira",
            at: "2026-05-19T09:48:30Z",
            reason:
              "Let's chat about this in our 1:1 — I want the chapter outline scoped tighter before you start the writing pass.",
          },
          timestamp: "2026-05-19T09:48:30Z",
        },
      ],
    },
  ]);

  // ── Bell notifications for the assignment / approval / flag. The
  // recipients are the users impacted (assignee, owner, owner). One
  // announcement notification per non-author lab member.
  out.push([
    "users/alex/_notifications.json",
    {
      version: 1,
      notifications: [
        {
          id: "notif-alex-announcement-welcome",
          type: "lab_announcement",
          from_user: "mira",
          announcement_id: "ann-mira-welcome",
          preview:
            "Welcome to the new lab dashboard! A few housekeeping " +
            "items before the week kicks off…",
          created_at: ANN_WELCOME,
          read: false,
        },
        {
          id: "notif-alex-announcement-1",
          type: "lab_announcement",
          from_user: "mira",
          announcement_id: "ann-mira-lab-meeting",
          preview:
            "Lab meeting this Friday 2pm in Bio 4203. Bring strain " +
            "design notes and any qPCR data from this week.",
          created_at: ANN_NOW,
          read: false,
        },
        {
          id: "notif-alex-purchase-approval-1",
          type: "lab_purchase_approval",
          from_user: "mira",
          owner_username: "alex",
          purchase_item_id: 3,
          item_name: "Phusion polymerase (demo)",
          created_at: "2026-05-19T09:42:11Z",
          read: false,
        },
      ],
    },
  ]);
  out.push([
    "users/morgan/_notifications.json",
    {
      version: 1,
      notifications: [
        {
          // Shift alert: alex pushed a shared experiment 3 days later, so
          // morgan (a downstream collaborator) gets a bell row. Drives the
          // notifications-shift-alert screenshot via ?fixtureUser=morgan.
          // item_id / task_key point at a real alex experiment so "View task"
          // resolves; item_name is the denormalized label the row renders.
          id: "notif-morgan-shift-alert-1",
          type: "shift_alert",
          from_user: "alex",
          item_id: 5,
          task_key: "alex:5",
          item_name: "PCR optimization",
          source_alert_id: "demo-shift-alert-0001",
          start_delta_days: 3,
          end_delta_days: 3,
          old_start: "2026-05-10",
          old_end: "2026-05-10",
          new_start: "2026-05-13",
          new_end: "2026-05-13",
          created_at: "2026-05-21T09:00:00Z",
          read: false,
        },
        {
          id: "notif-morgan-announcement-welcome",
          type: "lab_announcement",
          from_user: "mira",
          announcement_id: "ann-mira-welcome",
          preview:
            "Welcome to the new lab dashboard! A few housekeeping " +
            "items before the week kicks off…",
          created_at: ANN_WELCOME,
          read: false,
        },
        {
          id: "notif-morgan-announcement-1",
          type: "lab_announcement",
          from_user: "mira",
          announcement_id: "ann-mira-lab-meeting",
          preview:
            "Lab meeting this Friday 2pm in Bio 4203. Bring strain " +
            "design notes and any qPCR data from this week.",
          created_at: ANN_NOW,
          read: false,
        },
        {
          id: "notif-morgan-task-assigned-1",
          type: "lab_task_assignment",
          from_user: "mira",
          owner_username: "alex",
          task_id: 14,
          task_name: "Review morgan's draft figures",
          note:
            "You've been doing the bulk of the figure rework — taking " +
            "this off alex's plate.",
          created_at: "2026-05-19T09:45:01Z",
          read: false,
        },
        {
          id: "notif-morgan-flag-1",
          type: "lab_flag_for_review",
          from_user: "mira",
          owner_username: "morgan",
          record_type: "task",
          record_id: 4,
          record_name: "Draft Chapter 2 outline",
          reason:
            "Let's chat about this in our 1:1 — I want the chapter " +
            "outline scoped tighter before you start the writing pass.",
          created_at: "2026-05-19T09:48:30Z",
          read: false,
        },
      ],
    },
  ]);

  // ── Lab Overview PI fixture-seed manager (Chip C, 2026-05-25) ─────────
  //
  // Targeted additions so Mira's /lab-overview first paint is dense
  // with believable content: a second active flag, a fresh shared
  // note, and a recent pending purchase request. These ride on the
  // last-wins map behavior of buildEntries (pushing the same key
  // path overrides any earlier entry), which lets us add `flagged` to
  // alex/tasks/12.json without re-typing the whole record.
  //
  // Date anchors stay within 48h of TODAY (2026-05-13) so the rebase
  // math keeps each addition reading as "this week" regardless of when
  // the demo is opened.

  // Flag #2: alex's task 12 (Compile growth-curve results). The flag
  // lands a few hours after the announcement post so the Lab Activity
  // feed shows a stack of fresh PI actions, not a single 2026-05-19
  // burst. Existing alex/tasks/12.json is rewritten here with the same
  // payload plus a `flagged` block.
  out.push([
    "users/alex/tasks/12.json",
    {
      id: 12,
      project_id: 3,
      name: "Compile growth-curve results",
      start_date: "2026-05-19",
      duration_days: 1,
      end_date: "2026-05-19",
      is_high_level: false,
      is_complete: false,
      task_type: "list",
      weekend_override: null,
      method_id: null,
      method_ids: [],
      deviation_log: null,
      tags: null,
      sort_order: 12,
      experiment_color: null,
      sub_tasks: [
        { id: "st1", text: "Export plate reader CSVs from Tuesday + Thursday runs", is_complete: false },
        { id: "st2", text: "Subtract YPD blank wells in pandas", is_complete: false },
        { id: "st3", text: "Fit logistic growth + extract doubling times", is_complete: false },
        { id: "st4", text: "Send rough OD600 plot to morgan for sanity check", is_complete: false },
      ],
      pcr_gradient: null,
      pcr_ingredients: null,
      method_attachments: [],
      owner: "alex",
      shared_with: [],
      external_project: null,
      comments: [],
      flagged: {
        by: "mira",
        at: "2026-05-20T07:50:00Z",
        reason:
          "Loop me in before you send the rough plot to morgan. The 4% glucose plateau drift is the headline panel for the DOE renewal and I want eyes on it first.",
      },
    },
  ]);

  // Fresh shared note from morgan, note id 7, created today. Counters
  // bump (notes: 6 -> 7) below. The note carries one Mira reply so the
  // Lab Notes tile renders thread metadata, and shows up in the Recent
  // Lab Activity sidebar as both a note-creation row and a comment row.
  out.push([
    "users/morgan/_counters.json",
    {
      projects: 3,
      tasks: 13,
      methods: 2,
      events: 0,
      goals: 2,
      pcr_protocols: 0,
      purchase_items: 21,
      lab_links: 4,
      notes: 7,
      dependencies: 2,
      // Inventory fixture (behind INVENTORY_ENABLED). morgan owns 4 catalog
      // items / 5 stocks; she uses free-text locations (alex owns the demo
      // storage tree). Counters set to the max seeded id.
      inventory_items: 4,
      inventory_stocks: 5,
    },
  ]);
  out.push([
    "users/morgan/notes/7.json",
    {
      id: 7,
      title: "Reader run 2026-05-13: candidate FY-Δgal80 library v1",
      description:
        "First proper screen of the FY-Δgal80 candidate library off the H1 reader.\n\nPlate setup:\n- 80 candidates (columns 2 to 11)\n- 8 WT negatives (column 1)\n- 8 pDEMO-fluo+ positives (column 12)\n- 12 empty wells with water for evap correction\n\nReader settings: 485/528 nm, 15 min cycle, 6 h total, 30 C.\n\nTop-line numbers:\n- Positive control mean fluorescence: 18,420 a.u. (SD 850, CV 4.6%)\n- WT negative mean: 320 a.u. (SD 95)\n- 14 candidates land above 5,000 a.u. (vs WT + 3SD); 4 above 10,000 a.u.\n\nNext step: re-grow the top 14 from the deep-well plate, repeat the screen Thursday with technical triplicates. Will write up properly once the technical reps land.",
      is_running_log: false,
      is_shared: true,
      shared_with: [{ username: "*", level: "read", permission: "view" }],
      entries: [],
      comments: [
        {
          id: "cmt-mira-morgan-note7-1",
          author: "mira",
          text: "Strong first pass. The 4 above 10k look real to me; flag any of those that also grow faster than WT in the OD curve (the doubles are the prize). Save the reader CSV in the shared folder so I can poke at it before our 1:1.",
          created_at: "2026-05-13T14:20:00Z",
          mentions: [],
        },
        // Mira PI R1 fix manager (Fix 8, 2026-05-25): a reply that
        // explicitly @-mentions mira so the new @-mentions tile on
        // /lab-overview has at least one row. Morgan asks the PI for
        // direction on the next step, matches the "I want a paper
        // trail" lab-coordination tone of the surrounding seed data.
        {
          id: "cmt-morgan-mira-note7-1",
          author: "morgan",
          text: "@mira — should I prep the triplicate reps on the same H1 reader Thursday, or split across two readers to save a day? Either way works on my side; deferring to your call so the writeup methods section reads consistent.",
          created_at: "2026-05-13T17:45:00Z",
          parent_id: "cmt-mira-morgan-note7-1",
          mentions: ["mira"],
        },
      ],
      created_at: "2026-05-13T11:30:00Z",
      updated_at: "2026-05-13T17:45:00Z",
      username: "morgan",
    },
  ]);

  // New pending purchase request from morgan, item 21, dated today.
  // Mirrors the brief's example item ("Primer order for KRAS construct").
  // task_id 13 ("Order Chapter 2 figure reagents") is an existing
  // morgan purchase task so the parent task surface stays consistent.
  out.push([
    "users/morgan/purchase_items/21.json",
    {
      id: 21,
      task_id: 13,
      item_name: "Custom primer set, FY-Δgal80 screen rebuild (10 oligos)",
      quantity: 10,
      link: "https://example.org/demo-idt",
      cas: null,
      price_per_unit: 14,
      shipping_fees: 5,
      total_price: 145,
      notes: "Need these by Tuesday so the rebuild slots into next week's reader run.",
      funding_string: "DEMO-NIH-GM999999",
      vendor: "IDT",
      category: "Reagents",
    },
  ]);

  // Audit appendings for the chip-C additions. Mira's audit entry for
  // flagging alex task 12 piggybacks onto the existing alex audit file.
  // We rewrite the whole array (the demo writer is last-wins per-key)
  // so the new entry stacks on top of the four existing ones from
  // phases 3/5/6 above. Newest first by timestamp.
  out.push([
    "users/alex/_pi_audit.json",
    {
      version: 1,
      entries: [
        {
          id: "audit-mira-alex-1",
          session_id: DEMO_SESSION_A,
          actor: "mira",
          target_user: "alex",
          record_type: "task",
          record_id: 5,
          field_path: "name",
          old_value: "Yeast transformation screen",
          new_value: "Yeast transformation screen (LiAc)",
          timestamp: "2026-05-15T14:32:18Z",
        },
        {
          id: "audit-mira-alex-2",
          session_id: DEMO_SESSION_A,
          actor: "mira",
          target_user: "alex",
          record_type: "task",
          record_id: 5,
          field_path: "duration_days",
          old_value: 3,
          new_value: 4,
          timestamp: "2026-05-15T14:32:45Z",
        },
        {
          id: "audit-mira-alex-3",
          session_id: DEMO_SESSION_C,
          actor: "mira",
          target_user: "alex",
          record_type: "task",
          record_id: 14,
          field_path: "assignee",
          old_value: null,
          new_value: "morgan",
          timestamp: "2026-05-19T09:45:01Z",
        },
        {
          id: "audit-mira-alex-4",
          session_id: DEMO_SESSION_C,
          actor: "mira",
          target_user: "alex",
          record_type: "purchase_item",
          record_id: 3,
          field_path: "approved",
          old_value: false,
          new_value: true,
          timestamp: "2026-05-19T09:42:11Z",
        },
        {
          id: "audit-mira-alex-5",
          session_id: DEMO_SESSION_C,
          actor: "mira",
          target_user: "alex",
          record_type: "task",
          record_id: 12,
          field_path: "flagged",
          old_value: null,
          new_value: {
            by: "mira",
            at: "2026-05-20T07:50:00Z",
            reason:
              "Loop me in before you send the rough plot to morgan. The 4% glucose plateau drift is the headline panel for the DOE renewal and I want eyes on it first.",
          },
          timestamp: "2026-05-20T07:50:00Z",
        },
      ],
    },
  ]);

  // Bell notification for alex on the new flag, and one for morgan so
  // the comment on her note also lands in the bell. Both are
  // append-style, same shape as the existing flag-on-task-4
  // notification for morgan.
  out.push([
    "users/alex/_notifications.json",
    {
      version: 1,
      notifications: [
        {
          id: "notif-alex-announcement-welcome",
          type: "lab_announcement",
          from_user: "mira",
          announcement_id: "ann-mira-welcome",
          preview:
            "Welcome to the new lab dashboard! A few housekeeping " +
            "items before the week kicks off…",
          created_at: ANN_WELCOME,
          read: false,
        },
        {
          id: "notif-alex-announcement-1",
          type: "lab_announcement",
          from_user: "mira",
          announcement_id: "ann-mira-lab-meeting",
          preview:
            "Lab meeting this Friday 2pm in Bio 4203. Bring strain " +
            "design notes and any qPCR data from this week.",
          created_at: ANN_NOW,
          read: false,
        },
        {
          id: "notif-alex-purchase-approval-1",
          type: "lab_purchase_approval",
          from_user: "mira",
          owner_username: "alex",
          purchase_item_id: 3,
          item_name: "Phusion polymerase (demo)",
          created_at: "2026-05-19T09:42:11Z",
          read: false,
        },
        {
          id: "notif-alex-flag-1",
          type: "lab_flag_for_review",
          from_user: "mira",
          owner_username: "alex",
          record_type: "task",
          record_id: 12,
          record_name: "Compile growth-curve results",
          reason:
            "Loop me in before you send the rough plot to morgan. The 4% glucose plateau drift is the headline panel for the DOE renewal and I want eyes on it first.",
          created_at: "2026-05-20T07:50:00Z",
          read: false,
        },
      ],
    },
  ]);

  // ── Trash (soft-delete) seed ────────────────────────────────────────────────
  // Three mixed-type entries in alex's trash so the /trash page has rows to
  // select and the bulk-action bar (Restore / Permanent delete / Clear
  // selection) can be revealed for the trash-bulk-action-bar screenshot. Each
  // record carries the `_trash` metadata block (see lib/trash/trash-types.ts)
  // and is mirrored by a matching `_index.json` entry so the count agrees and
  // the page reads the index directly (no rebuild). All fabricated demo data.
  const TRASH_RECORDS = [
    {
      entity_type: "note",
      dir: "notes",
      id: 91,
      slug: "Old-pYES-cloning-scratch-notes",
      record: {
        id: 91,
        title: "Old pYES cloning scratch notes",
        content:
          "Superseded scratch notes from the first pYES cloning attempt. Replaced by the qPCR optimization log.",
        project_id: 2,
        owner: "alex",
        created_at: "2026-03-02T00:00:00Z",
        updated_at: "2026-03-10T00:00:00Z",
      },
      live: "users/alex/notes/91.json",
      deleted_at: "2026-05-18T14:05:00Z",
      auto_expires_at: "2026-06-17T14:05:00Z",
      deleted_by: "alex",
    },
    {
      entity_type: "task",
      dir: "tasks",
      id: 92,
      slug: "Abandoned-restreak-plan",
      record: {
        id: 92,
        project_id: 1,
        name: "Abandoned restreak plan",
        start_date: "2026-05-09",
        duration_days: 1,
        end_date: "2026-05-09",
        is_complete: false,
        task_type: "list",
        owner: "alex",
        sub_tasks: [],
      },
      live: "users/alex/tasks/92.json",
      deleted_at: "2026-05-19T10:30:00Z",
      auto_expires_at: "2026-06-18T10:30:00Z",
      deleted_by: "alex",
    },
    {
      entity_type: "purchase_item",
      dir: "purchase_items",
      id: 93,
      slug: "Duplicate-Phusion-order",
      record: {
        id: 93,
        item_name: "Duplicate Phusion order",
        vendor: "NEB (demo)",
        price_per_unit: 312,
        quantity: 1,
        project_id: 1,
        owner: "alex",
      },
      live: "users/alex/purchase_items/93.json",
      deleted_at: "2026-05-17T16:20:00Z",
      auto_expires_at: "2026-06-16T16:20:00Z",
      deleted_by: "alex",
    },
  ];
  for (const t of TRASH_RECORDS) {
    const trashPath = `_trash/${t.dir}/${t.id}-${t.slug}.json`;
    out.push([
      `users/alex/${trashPath}`,
      {
        ...t.record,
        _trash: {
          deleted_at: t.deleted_at,
          deleted_by: t.deleted_by,
          auto_expires_at: t.auto_expires_at,
          original_path: t.live,
        },
      },
    ]);
  }
  out.push([
    "users/alex/_trash/_index.json",
    {
      version: 1,
      entries: TRASH_RECORDS.map((t) => ({
        id: t.id,
        entity_type: t.entity_type,
        trash_path: `_trash/${t.dir}/${t.id}-${t.slug}.json`,
        original_path: t.live,
        deleted_at: t.deleted_at,
        deleted_by: t.deleted_by,
        auto_expires_at: t.auto_expires_at,
      })),
      last_cleanup_at: null,
    },
  ]);

  // ── Photo-annotation sidecar seed ───────────────────────────────────────────
  // A saved vector overlay (ellipse + arrow + text labels) for alex's PCR-screen
  // gel. Read by readAnnotations() via fileService.readJson at
  // `${basePath}/Images/<file>.annot.json` (lib/attachments/annotations.ts), so
  // both the inline <AnnotatedImage> overlay (image-annotation-in-note) and the
  // full-screen ImageAnnotatorModal (image-annotation-gel) render the shapes
  // without any live drawing. Coordinates are in the gel's natural pixel space
  // (900x600). Fabricated demo annotations.
  out.push([
    "users/alex/results/task-5/Images/gel-pcr-screen.png.annot.json",
    {
      version: 1,
      imageW: 900,
      imageH: 600,
      shapes: [
        { id: "el1", type: "ellipse", x: 250, y: 300, w: 110, h: 44, color: "#e11d48", strokeWidth: 4 },
        { id: "ar1", type: "arrow", x1: 470, y1: 150, x2: 330, y2: 300, color: "#2563eb", strokeWidth: 4 },
        { id: "tx1", type: "text", x: 250, y: 110, text: "T1 positive", color: "#111827", fontSize: 26 },
        { id: "tx2", type: "text", x: 470, y: 110, text: "~1.4 kb", color: "#111827", fontSize: 26 },
      ],
      updatedAt: "2026-05-13T18:00:00Z",
      updatedBy: "alex",
    },
  ]);

  // ─── Data Hub demo workbooks + Chemistry molecules (read-back) ─────────────
  //
  // These two stores are generated by dedicated seeds, NOT inlined here:
  //   - Data Hub `.json` mirrors carry engine-computed analysis results, so they
  //     are produced by the vitest seed at
  //     src/lib/datahub/__seed__/seed-datahub-demo.test.ts (run with SEED_DEMO=1),
  //     which also writes the authoritative `.loro` snapshots.
  //   - Chemistry molecule `.mol` + `.meta.json` files come from
  //     scripts/seed-molecules-demo.mjs.
  //
  // We READ the committed files back here and push them as entries so:
  //   (a) writeDemoTree re-writes them after its rmSync (they survive a regen), and
  //   (b) writeFixtureTs folds them into buildWikiFixtures() so /demo and
  //       ?wikiCapture=1 see populated Data Hub + Chemistry pages.
  //
  // The `.loro` binaries are intentionally NOT read here (they are binary and the
  // fixture rebuilds the doc from the `.json` mirror anyway). After a bare regen,
  // re-run the vitest seed to restore the on-disk `.loro` snapshots. Read-backs
  // are best-effort: a missing file just leaves that store unseeded.
  out.push(...readBackStore("users/alex/datahub", [".json"]));
  out.push(...readBackStore("users/alex/molecules", [".meta.json", ".mol"]));

  relocateStuffedNoteBodies(out);

  // Spread the demo purchase line items across ordering stages so the Purchases
  // stage filter (Needs ordering / Ordered / Received) and its count chips
  // visibly narrow the list on camera. Without an order_status every item
  // defaults to "needs_ordering", so the stage filter looked inert. Keyed by the
  // alex purchase task so each order sits cleanly in one stage (the page keeps an
  // order when ANY of its line items is in the selected stage).
  const ALEX_PURCHASE_STAGE = {
    7: "received",
    24: "received",
    25: "ordered",
    26: "ordered",
    15: "needs_ordering",
    27: "needs_ordering",
  };
  for (const [p, obj] of out) {
    if (
      typeof p === "string" &&
      p.startsWith("users/alex/purchase_items/") &&
      obj &&
      typeof obj === "object" &&
      ALEX_PURCHASE_STAGE[obj.task_id]
    ) {
      obj.order_status = ALEX_PURCHASE_STAGE[obj.task_id];
    }
  }

  return out;
}

// A handful of demo notes were authored with their entire body text crammed
// into the one-line `description` field and an empty `entries` array, so the
// note popup rendered the whole body in the summary slot. This pass relocates
// each such body (verbatim) into a single note entry and swaps the description
// for a short summary. It mirrors the one-off fix in
// frontend/scripts/fix-demo-note-descriptions.mjs exactly, so a regen
// reproduces that committed fix instead of wiping it. Keyed by demo-tree path.
// HR root-cause follow-up, 2026-06-11.
const STUFFED_NOTE_FIXES = {
  "users/alex/notes/1.json": {
    desc: "Transformed FakeYeast-001 with pYES-GAL1::flbA using the LiAc protocol.",
    label: "transformation run",
  },
  "users/alex/notes/3.json": {
    desc: "Bench card for the column mini-prep.",
    label: "mini-prep recipe",
  },
  "users/alex/notes/4.json": {
    desc: "Lab meeting on strain design, covering flbA integration data and the 96-well screen plan.",
    label: "lab meeting notes",
  },
  "users/alex/notes/6.json": {
    desc: "Reorganizing -80 freezer 3, shelf 2 (what was kept and what was discarded).",
    label: "freezer cleanout",
  },
  "users/alex/notes/7.json": {
    desc: "Prep card for the 1:1 calendar event.",
    label: "1:1 prep",
  },
  "users/mira/notes/1.json": {
    desc: "Check-in covering the chapter 2 figure plan, fakeGFP data, and conference travel.",
    label: "check-in notes",
  },
  "users/morgan/notes/2.json": {
    desc: "Bench card for setting up the 96-well fluorescence screen.",
    label: "screen prep checklist",
  },
  "users/morgan/notes/3.json": {
    desc: "Lab meeting recap, taken from my seat.",
    label: "meeting notes",
  },
  "users/morgan/notes/4.json": {
    desc: "Whiteboard session to design a GFP heat-stress survival assay for the FY-Δgal80 library.",
    label: "brainstorm notes",
  },
  "users/morgan/notes/5.json": {
    desc: "Tracking the reagents I'm responsible for on shelf 2.",
    label: "reagent tracker",
  },
  "users/morgan/notes/7.json": {
    desc: "First proper screen of the FY-Δgal80 candidate library off the H1 reader.",
    label: "reader run",
  },
};

function relocateStuffedNoteBodies(entries) {
  for (const entry of entries) {
    const fix = STUFFED_NOTE_FIXES[entry[0]];
    if (!fix) continue;
    const note = entry[1];
    if (!Array.isArray(note.entries) || note.entries.length !== 0) {
      throw new Error(
        `relocateStuffedNoteBodies: ${entry[0]} expected empty entries, got ${
          Array.isArray(note.entries) ? note.entries.length : typeof note.entries
        }`,
      );
    }
    const ymd = note.created_at.slice(0, 10); // YYYY-MM-DD from ISO created_at
    note.entries = [
      {
        id: `${note.username}-note${note.id}-e1`,
        title: `${ymd}: ${fix.label}`,
        date: ymd,
        content: note.description, // verbatim relocation, no rewrite
        created_at: note.created_at,
        updated_at: note.updated_at,
      },
    ];
    note.description = fix.desc;
  }
}

/**
 * Read the committed files of a generated store and return them as fixture
 * entries. JSON files are parsed into objects; everything else is kept as a raw
 * string (e.g. `.mol` Molfiles). Used for the Data Hub + Chemistry seeds, whose
 * authoritative content is produced by dedicated seed scripts and only mirrored
 * into the static fixture here.
 */
function readBackStore(relDir, extensions) {
  const absDir = path.join(DEMO_DIR, relDir);
  if (!fs.existsSync(absDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(absDir).sort()) {
    if (!extensions.some((ext) => name.endsWith(ext))) continue;
    const abs = path.join(absDir, name);
    const raw = fs.readFileSync(abs, "utf8");
    const rel = `${relDir}/${name}`;
    if (name.endsWith(".json")) {
      out.push([rel, JSON.parse(raw)]);
    } else {
      out.push([rel, raw]);
    }
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Whole-lab EDIT sharing sentinel for inventory records (design §6.1). Carries
// both the unified `level` and the legacy `permission` so old + new read paths
// resolve it (mirrors the notes fixtures above).
const LAB_EDIT_SHARE = [{ username: "*", level: "edit", permission: "edit" }];

/**
 * Inventory fixture for one demo user (behind INVENTORY_ENABLED). Emits the
 * three inventory stores — `inventory_items` (what a thing IS),
 * `inventory_stocks` (the physical containers), and, for alex only, a small
 * `storage_nodes` location tree (freezer -> rack -> box) with a couple of
 * stocks placed into box positions.
 *
 * Every date is HARDCODED relative to the demo anchor TODAY (2026-05-13) — no
 * `Date.now()` / `new Date()`. The demo rebase preserves these offsets so the
 * expiring / expired signals fire deterministically when the demo is opened.
 */
function inventory(owner, color) {
  const out = [];
  const stamp = "2026-05-10T09:00:00Z";

  /** @param {object} it */
  const item = (it) => [
    `users/${owner}/inventory_items/${it.id}.json`,
    {
      id: it.id,
      name: it.name,
      category: it.category,
      catalog_number: it.catalog_number ?? null,
      vendor: it.vendor ?? null,
      cas: it.cas ?? null,
      url: it.url ?? null,
      container_label: it.container_label ?? null,
      notes: it.notes ?? null,
      low_at_count: it.low_at_count ?? null,
      track_consumption: it.track_consumption ?? false,
      product_barcode: it.product_barcode ?? null,
      registry: it.registry ?? null,
      tags: it.tags ?? ["demo"],
      owner,
      shared_with: LAB_EDIT_SHARE,
      created_by: owner,
      last_edited_by: owner,
      last_edited_at: stamp,
    },
  ];

  /** @param {object} s */
  const stock = (s) => [
    `users/${owner}/inventory_stocks/${s.id}.json`,
    {
      id: s.id,
      item_id: s.item_id,
      lot_number: s.lot_number ?? null,
      container_count: s.container_count,
      status: s.status,
      received_date: s.received_date ?? null,
      expiration_date: s.expiration_date ?? null,
      opened_date: s.opened_date ?? null,
      last_touched_at: s.last_touched_at ?? stamp,
      amount_per_container: s.amount_per_container ?? null,
      unit: s.unit ?? null,
      concentration: s.concentration ?? null,
      location_text: s.location_text ?? null,
      location_node_id: s.location_node_id ?? null,
      position: s.position ?? null,
      purchase_item_id: s.purchase_item_id ?? null,
      container_code: s.container_code ?? null,
      notes: s.notes ?? null,
      owner,
      shared_with: LAB_EDIT_SHARE,
      created_by: owner,
      last_edited_by: owner,
      last_edited_at: stamp,
    },
  ];

  /** @param {object} n */
  const node = (n) => [
    `users/${owner}/storage_nodes/${n.id}.json`,
    {
      id: n.id,
      name: n.name,
      kind: n.kind,
      parent_id: n.parent_id ?? null,
      temperature: n.temperature ?? null,
      box_rows: n.box_rows ?? null,
      box_cols: n.box_cols ?? null,
      notes: n.notes ?? null,
      owner,
      shared_with: LAB_EDIT_SHARE,
      created_by: owner,
      last_edited_by: owner,
      last_edited_at: stamp,
    },
  ];

  if (owner === "alex") {
    // Storage tree: freezer "-80 #2" -> rack "Rack 3" -> box "Box: Enzymes".
    out.push(node({ id: 1, name: "-80 #2", kind: "freezer", parent_id: null, temperature: "-80 C", notes: "[Demo] Enzyme + competent-cell freezer, bench-row B." }));
    out.push(node({ id: 2, name: "Rack 3", kind: "rack", parent_id: 1, temperature: "-80 C" }));
    out.push(node({ id: 3, name: "Box: Enzymes", kind: "box", parent_id: 2, temperature: "-80 C", box_rows: 9, box_cols: 9, notes: "[Demo] 9x9 cardboard box, polymerases + ligases." }));

    // Catalog items (what each thing IS).
    out.push(item({ id: 1, name: "Q5 High-Fidelity DNA Polymerase", category: "enzyme", catalog_number: "M0491S", vendor: "NEB", url: "https://www.neb.com/en-us/products/m0491-q5-high-fidelity-dna-polymerase", container_label: "vial", low_at_count: 2, product_barcode: "0656472012345", notes: "[Demo] Primary high-fidelity polymerase for cloning PCRs.", tags: ["demo", "PCR", "cloning"] }));
    out.push(item({ id: 2, name: "Taq DNA Polymerase (with Standard Buffer)", category: "enzyme", catalog_number: "M0273S", vendor: "NEB", url: "https://www.neb.com/en-us/products/m0273-taq-dna-polymerase-with-standard-taq-buffer", container_label: "vial", low_at_count: null, notes: "[Demo] Colony-screen PCR workhorse.", tags: ["demo", "PCR", "screen"] }));
    out.push(item({ id: 3, name: "dNTP Mix (10 mM each)", category: "reagent", catalog_number: "R0192", vendor: "Thermo Fisher", url: "https://www.thermofisher.com/order/catalog/product/R0192", container_label: "tube", low_at_count: 3, notes: "[Demo] 10 mM each dATP/dCTP/dGTP/dTTP. Aliquoted to avoid freeze-thaw.", tags: ["demo", "PCR"] }));
    out.push(item({ id: 4, name: "Anti-beta-actin antibody (HRP)", category: "antibody", catalog_number: "ab197277", vendor: "Abcam", url: "https://www.abcam.com/en-us/products/primary-antibodies/beta-actin-antibody", container_label: "vial", low_at_count: null, notes: "[Demo] Loading-control antibody for Western blots.", tags: ["demo", "antibody", "WB"], registry: { target: "beta-actin", host_species: "Rabbit", clonality: "monoclonal", clone: "EPR-DEMO", conjugate: "HRP", isotype: "IgG", reactivity: "Human, Mouse, Yeast (demo)", applications: ["WB", "FACS"], rrid: "AB_0000000 (demo)", recommended_dilution: "1:1000 (WB)" } }));
    out.push(item({ id: 5, name: "pUC19-GFP (demo plasmid)", category: "plasmid", catalog_number: null, vendor: "in-house", url: null, container_label: "tube", low_at_count: null, notes: "[Demo] GFP reporter cloned into pUC19; AmpR selection.", tags: ["demo", "plasmid", "cloning"], registry: { backbone: "pUC19", insert: "GFP", resistance: "Ampicillin", bacterial_host: "DH5-alpha", size_bp: 2686, source: "in-house", addgene_id: null, sequence_file_path: null, map_notes: "lacZ alpha / MCS replaced with GFP CDS; AmpR; ColE1 ori." } }));
    out.push(item({ id: 6, name: "Lysozyme (from chicken egg white)", category: "reagent", catalog_number: "L6876", vendor: "Sigma-Aldrich", cas: "12650-88-3", url: "https://www.sigmaaldrich.com/US/en/product/sigma/l6876", container_label: "bottle", low_at_count: null, notes: "[Demo] Cell-wall lysis for bacterial preps. Store desiccated.", tags: ["demo", "lysis"] }));
    out.push(item({ id: 7, name: "Ampicillin (100 mg/mL, sterile)", category: "reagent", catalog_number: "A9518", vendor: "Sigma-Aldrich", cas: "69-53-4", url: "https://www.sigmaaldrich.com/US/en/product/sigma/a9518", container_label: "tube", low_at_count: 4, notes: "[Demo] 1000x stock for LB-Amp plates + liquid selection.", tags: ["demo", "selection"] }));

    // Stocks (the physical containers). Signals: LOW (Q5), EXPIRED (Taq),
    // EXPIRING soon (dNTP), EMPTY (Amp); the rest in_stock.
    // Q5: summed count 1 < low_at_count 2 -> LOW. Placed in the box (B4).
    out.push(stock({ id: 1, item_id: 1, lot_number: "10148321", container_count: 1, status: "low", received_date: "2026-03-02", expiration_date: "2027-03-01", amount_per_container: 500, unit: "U", concentration: "2 U/uL", location_node_id: 3, position: "B4", container_code: "Q5-2026-03", notes: "[Demo] Down to the last vial — reorder queued." }));
    // Taq: expiration before TODAY (2026-05-13) -> EXPIRED. Placed in the box (C3).
    out.push(stock({ id: 2, item_id: 2, lot_number: "10142887", container_count: 2, status: "expired", received_date: "2025-04-18", expiration_date: "2026-04-20", amount_per_container: 2000, unit: "U", concentration: "5 U/uL", location_node_id: 3, position: "C3", container_code: "TAQ-2025-04", notes: "[Demo] Past expiry — pull from rotation, was kept for non-critical screens." }));
    // dNTP: expiration 2026-05-30 (17 d after TODAY, inside the 30-day window)
    // -> EXPIRING soon. Placed in the box (B5).
    out.push(stock({ id: 3, item_id: 3, lot_number: "00845512", container_count: 4, status: "in_stock", received_date: "2025-11-20", expiration_date: "2026-05-30", amount_per_container: 1, unit: "mL", concentration: "10 mM each", location_node_id: 3, position: "B5", notes: "[Demo] 4 aliquots left; one nearing expiry — use these first." }));
    // beta-actin antibody: in_stock, free-text fridge location.
    out.push(stock({ id: 4, item_id: 4, lot_number: "GR3300000-5", container_count: 1, status: "in_stock", received_date: "2026-02-14", expiration_date: "2026-12-31", amount_per_container: 100, unit: "uL", concentration: "1 mg/mL", location_text: "4 C antibody fridge, door shelf 2", notes: "[Demo] Aliquot before first use to avoid freeze-thaw." }));
    // pUC19-GFP plasmid: in_stock, free-text -20 location.
    out.push(stock({ id: 5, item_id: 5, lot_number: "pUC19GFP-prep4", container_count: 6, status: "in_stock", received_date: "2026-04-05", expiration_date: null, amount_per_container: 50, unit: "uL", concentration: "120 ng/uL", location_text: "-20 plasmid box 'Reporters', row C", notes: "[Demo] Mini-prep batch 4; Sanger-verified." }));
    // Lysozyme: in_stock, RT shelf, no expiry.
    out.push(stock({ id: 6, item_id: 6, lot_number: "SLCK4521", container_count: 1, status: "in_stock", received_date: "2025-09-10", expiration_date: "2028-09-01", amount_per_container: 5, unit: "g", location_text: "RT reagent shelf 4, desiccator", notes: "[Demo] Lyophilized powder; weigh fresh per prep." }));
    // Ampicillin: container_count 0 -> EMPTY.
    out.push(stock({ id: 7, item_id: 7, lot_number: "SLCH9007", container_count: 0, status: "empty", received_date: "2025-12-01", expiration_date: "2026-12-01", amount_per_container: 1, unit: "mL", concentration: "100 mg/mL", location_text: "-20 stocks box 'Antibiotics'", notes: "[Demo] Out — last tube used making LB-Amp plates Friday. Reorder." }));
    // Ampicillin second stock: a fresh in_stock tube so the item is not all-empty.
    out.push(stock({ id: 8, item_id: 7, lot_number: "SLCJ1188", container_count: 5, status: "in_stock", received_date: "2026-05-02", expiration_date: "2027-05-01", amount_per_container: 1, unit: "mL", concentration: "100 mg/mL", location_text: "-20 stocks box 'Antibiotics'", notes: "[Demo] New batch, 5 aliquots." }));
  } else {
    // morgan — qPCR / fluorescence-screening reagents; free-text locations only.
    out.push(item({ id: 1, name: "PowerUp SYBR Green Master Mix (2x)", category: "kit", catalog_number: "A25742", vendor: "Thermo Fisher", url: "https://www.thermofisher.com/order/catalog/product/A25742", container_label: "tube", low_at_count: 2, notes: "[Demo] 2x master mix for ACT1-normalized qPCR.", tags: ["demo", "qPCR"] }));
    out.push(item({ id: 2, name: "Fluorescein sodium salt", category: "reagent", catalog_number: "F6377", vendor: "Sigma-Aldrich", cas: "518-47-8", url: "https://www.sigmaaldrich.com/US/en/product/sigma/f6377", container_label: "bottle", low_at_count: null, notes: "[Demo] Plate-reader calibration standard (60 nM in PBS).", tags: ["demo", "calibration", "fluorescence"] }));
    out.push(item({ id: 3, name: "T4 DNA Ligase", category: "enzyme", catalog_number: "M0202S", vendor: "NEB", url: "https://www.neb.com/en-us/products/m0202-t4-dna-ligase", container_label: "vial", low_at_count: 2, notes: "[Demo] Sticky/blunt-end ligation for library cloning.", tags: ["demo", "cloning"] }));
    out.push(item({ id: 4, name: "Gibson Assembly Master Mix (2x)", category: "kit", catalog_number: "E2611S", vendor: "NEB", url: "https://www.neb.com/en-us/products/e2611-gibson-assembly-master-mix", container_label: "tube", low_at_count: null, notes: "[Demo] One-pot isothermal assembly. Warm slowly from -20.", tags: ["demo", "cloning", "Gibson"] }));

    // Stocks. Signals: LOW (SYBR), EXPIRED (T4 old tube), EXPIRING soon (Gibson);
    // the rest in_stock.
    // SYBR: summed count 1 < low_at_count 2 -> LOW.
    out.push(stock({ id: 1, item_id: 1, lot_number: "01155432", container_count: 1, status: "low", received_date: "2026-01-15", expiration_date: "2026-09-30", amount_per_container: 5, unit: "mL", concentration: "2x", location_text: "-20 qPCR drawer, tray 1", notes: "[Demo] One tube left — flag at next order." }));
    // Fluorescein: in_stock, RT.
    out.push(stock({ id: 2, item_id: 2, lot_number: "MKCR5520", container_count: 1, status: "in_stock", received_date: "2025-08-22", expiration_date: "2028-08-01", amount_per_container: 25, unit: "g", location_text: "RT reagent shelf 2 (amber bottle)", notes: "[Demo] Light-sensitive; keep in amber bottle." }));
    // T4 ligase: expired old tube (2026-04-10, before TODAY).
    out.push(stock({ id: 3, item_id: 3, lot_number: "10141200", container_count: 1, status: "expired", received_date: "2025-04-05", expiration_date: "2026-04-10", amount_per_container: 20000, unit: "U", concentration: "400 U/uL", location_text: "-20 enzyme drawer, tray 2", notes: "[Demo] Old tube past expiry — kept as backup only." }));
    // T4 ligase: a fresh in_stock tube.
    out.push(stock({ id: 4, item_id: 3, lot_number: "10148990", container_count: 3, status: "in_stock", received_date: "2026-05-02", expiration_date: "2027-05-01", amount_per_container: 20000, unit: "U", concentration: "400 U/uL", location_text: "-20 enzyme drawer, tray 2", notes: "[Demo] Working stock, 3 vials." }));
    // Gibson: expiration 2026-05-28 (15 d after TODAY) -> EXPIRING soon.
    out.push(stock({ id: 5, item_id: 4, lot_number: "10145667", container_count: 2, status: "in_stock", received_date: "2025-11-28", expiration_date: "2026-05-28", amount_per_container: 0.6, unit: "mL", concentration: "2x", location_text: "-20 enzyme drawer, tray 3", notes: "[Demo] Use the nearer-expiry tube first; thaw on ice." }));
  }

  return out;
}

function projects(owner, list) {
  return list.map((p) => [
    `users/${owner}/projects/${p.id}.json`,
    {
      id: p.id,
      name: p.name,
      weekend_active: false,
      tags: p.tags,
      color: p.color,
      created_at: "2026-02-01T00:00:00Z",
      sort_order: p.sort_order,
      is_archived: false,
      archived_at: null,
      owner,
      shared_with: p.shared_with ?? [],
      // Optional link to a lab funding account. Drives the Funding section of
      // the Deposit dialog's metadata-review step (resolvePrimaryFundingAccount
      // in lib/deposit/prefill.ts). Only set on the demo project that has a
      // grant; everything else stays null.
      funding_account_id: p.funding_account_id ?? null,
    },
  ]);
}

function tasks(owner, list) {
  return list.map((t) => {
    // Invariant: ∀ a ∈ method_attachments: a.method_id ∈ method_ids. The
    // canonical "methods attached to this task" list is method_ids; the
    // attachments array carries per-method overrides keyed by method_id.
    // Earlier revisions of this seed hard-coded `method_ids: []` while
    // populating `method_attachments`, which produced orphan rows that the
    // Raw exporter then serialized verbatim. Derive method_ids from the
    // attachments so the two sides stay in sync.
    const methodAttachments = t.method_attachments ?? [];
    const methodIds = methodAttachments.map((a) => a.method_id);
    return [
      `users/${owner}/tasks/${t.id}.json`,
      {
        id: t.id,
        project_id: t.project_id,
        name: t.name,
        start_date: t.start_date,
        duration_days: t.duration_days,
        end_date: t.end_date,
        is_high_level: false,
        is_complete: t.is_complete,
        task_type: t.task_type,
        weekend_override: null,
        method_id: null,
        method_ids: methodIds,
        deviation_log: t.deviation_log ?? null,
        tags: null,
        sort_order: t.id,
        experiment_color: t.experiment_color ?? null,
        sub_tasks: t.sub_tasks ?? null,
        pcr_gradient: null,
        pcr_ingredients: null,
        method_attachments: methodAttachments,
        owner,
        shared_with: t.shared_with ?? [],
        // Cross-owner host (Option C, AGENTS.md §6). When set, the task
        // appears on the destination project's Gantt in addition to its
        // native project_id. Mirror the manifest in `users/<destOwner>/
        // projects/<destId>-hosted.json` — emitted separately below.
        external_project: t.external_project ?? null,
        // LabComment thread on experiment tasks (CommentsThread mount in
        // TaskDetailPopup gates on `isExperiment`). Demo PI Mira leaves
        // guidance/praise/questions here so the LabComment feature is
        // populated cross-user. Append-only by design; normalizeTaskRecord
        // defaults missing values to [] on read.
        comments: t.comments ?? [],
      },
    ];
  });
}

function methodJson(owner, id, name, folder) {
  // The Method type in frontend/src/lib/types.ts uses `source_path` to point
  // at the markdown body — there is no `attachments` field on Method. Earlier
  // versions of this seed wrote `source_path: null` and stashed the .md path
  // in an `attachments[0].path` slot, which left every demo method body
  // unreadable to the methods page and PDF/HTML exporters (they both read
  // method.source_path). `normalizeMethodRecord` in local-api.ts lazy-heals
  // the legacy shape, but new seeds should write the canonical field.
  //
  // Lab Mode retirement R1 (R1 unified sharing manager, 2026-05-23):
  // - `is_public` is dropped on this record (it's still passed through
  //   the legacy `is_public` key for now so older callers don't choke);
  // - new code reads `shared_with` with the unified "*" sentinel
  //   instead. The migration in lib/sharing/migrate-unified.ts converts
  //   on-disk records that still carry `is_public: true` into a
  //   shared_with entry. Demo records all default to private (owner-only)
  //   here; the few that need lab-wide visibility get an explicit
  //   shared_with entry below.
  return {
    id,
    name,
    source_path: `users/${owner}/methods/${id}.md`,
    method_type: "markdown",
    folder_path: folder,
    parent_method_id: null,
    tags: ["demo"],
    is_public: false,
    created_by: owner,
    owner,
    shared_with: [],
  };
}

// ─── Output writers ───────────────────────────────────────────────────────────

function writeDemoTree(entries) {
  if (fs.existsSync(DEMO_DIR)) {
    fs.rmSync(DEMO_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DEMO_DIR, { recursive: true });

  for (const [relPath, content] of entries) {
    const abs = path.join(DEMO_DIR, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (typeof content === "string") {
      fs.writeFileSync(abs, content, "utf8");
    } else {
      fs.writeFileSync(abs, JSON.stringify(content, null, 2) + "\n", "utf8");
    }
  }
}

function writeFixtureTs(entries) {
  // The fixture mock consumes JSON objects plus the cloning .gb sequence
  // bodies (the Cloning Workspace reads the raw GenBank text) and the chemistry
  // .mol Molfiles (the molecule editor reads the raw Molfile text). Drop only
  // markdown method/result bodies, which the fixture never serves. The demo
  // marker stays in so the wiki-capture banner also lights up — fixture mode
  // is itself a demo experience.
  const jsonEntries = entries.filter(
    ([p, c]) =>
      (typeof c !== "string" || p.endsWith(".gb") || p.endsWith(".mol")) &&
      !p.endsWith(".md"),
  );

  const lines = [];
  lines.push("/**");
  lines.push(" * Static fixture data for wiki-screenshot capture mode (?wikiCapture=1).");
  lines.push(" *");
  lines.push(" * GENERATED FILE — do not edit by hand.");
  lines.push(" * Source: scripts/generate-demo-data.mjs");
  lines.push(" *");
  lines.push(" * Mirrors the on-disk demo lab at `frontend/public/demo-data/`. Two");
  lines.push(" * fictional users (alex, morgan), demo projects, demo strains, and");
  lines.push(" * everything else carries a clearly-fake DEMO/Demo prefix.");
  lines.push(" *");
  lines.push(" * Do not import this from production code — it is dev-only.");
  lines.push(" */");
  lines.push("");
  lines.push("type FixtureEntry = [string, unknown];");
  lines.push("");
  lines.push("export function buildWikiFixtures(): FixtureEntry[] {");
  lines.push("  return [");
  for (const [p, c] of jsonEntries) {
    lines.push(`    [${JSON.stringify(p)}, ${JSON.stringify(c)}],`);
  }
  lines.push("  ];");
  lines.push("}");
  lines.push("");
  fs.writeFileSync(FIXTURE_TS, lines.join("\n"), "utf8");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const entries = buildEntries();
writeDemoTree(entries);
writeFixtureTs(entries);

console.log(`Wrote demo lab: ${entries.length} entries`);
console.log(`  Tree:    ${path.relative(REPO_ROOT, DEMO_DIR)}`);
console.log(`  Fixture: ${path.relative(REPO_ROOT, FIXTURE_TS)}`);
