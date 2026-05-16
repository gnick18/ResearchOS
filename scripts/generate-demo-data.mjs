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
      alex: { color: ALEX_COLOR, created_at: "2026-01-15T00:00:00Z" },
      morgan: { color: MORGAN_COLOR, created_at: "2026-01-20T00:00:00Z" },
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
      goals: 2,
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
      notes: 2,
      dependencies: 8,
    },
  ]);
  out.push([
    "users/alex/settings.json",
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
        "/search",
        "/links",
      ],
      defaultLandingTab: "/",
      sidebarShowTasks: true,
      sidebarShowCalendarEvents: true,
      sidebarEventsHorizonDays: 7,
      coloredHeader: false,
    },
  ]);
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
    { id: 1, name: "DEMO: Engineer FakeYeast for biofuel", color: "#3b82f6", tags: ["demo", "strains"], sort_order: 0 },
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
      method_attachments: [{ method_id: 2, owner: "public", snapshot_at: "2026-05-13T07:00:00Z" }] },
    { id: 6, project_id: 1, name: "Send sequencing — top 4", start_date: TOMORROW, duration_days: 1, end_date: TOMORROW, task_type: "list", is_complete: false },
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
    { id: 12, project_id: 3, name: "Compile growth-curve results", start_date: "2026-05-19", duration_days: 1, end_date: "2026-05-19", task_type: "list", is_complete: false },
    // Strategically-overdue: started a week ago, kept slipping. Stays
    // 6 days overdue regardless of when the demo is opened (see
    // OVERDUE_* anchors). Demonstrates the overdue UI state to users.
    { id: 13, project_id: 4, name: "Update lab onboarding doc", start_date: OVERDUE_START, duration_days: 2, end_date: OVERDUE_END_6D, task_type: "list", is_complete: false },
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
        { id: "st3", text: "Send consolidated feedback to morgan", is_complete: false },
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
    { id: 17, project_id: 1, name: "Pilot transformation — strain choice", start_date: "2026-02-10", duration_days: 1, end_date: "2026-02-10", task_type: "experiment", is_complete: true, experiment_color: "#3b82f6" },
    { id: 18, project_id: 2, name: "Pilot Gibson assembly — backbone test", start_date: "2026-02-18", duration_days: 1, end_date: "2026-02-18", task_type: "experiment", is_complete: true, experiment_color: "#8b5cf6" },
    { id: 19, project_id: 3, name: "Baseline growth profile in YPD", start_date: "2026-03-05", duration_days: 1, end_date: "2026-03-05", task_type: "experiment", is_complete: true, experiment_color: "#f59e0b" },
    // Workbench "Completed list tasks" fixture: a second completed list
    // task so the bottom accordion has more than one row to expand.
    { id: 20, project_id: 4, name: "Set up demo lab onboarding doc skeleton", start_date: "2026-02-01", duration_days: 1, end_date: "2026-02-01", task_type: "list", is_complete: true,
      sub_tasks: [
        { id: "st1", text: "Choose hosting (Notion vs internal wiki)", is_complete: true },
        { id: "st2", text: "Draft initial outline", is_complete: true },
      ] },
    // Workbench Lists-tab fixtures (chip: Lists-tab landing). Each one
    // populates a specific section of the new tab. Anchored at BASE_DATE
    // offsets so the section assignment stays stable after rebase.
    // ── Overdue (alex/21): a different overdue archetype than task 13
    //    (admin paperwork, ~2 days overdue, partially worked through).
    { id: 21, project_id: 4, name: "Send compliance paperwork — quarterly renewal", start_date: OVERDUE_START, duration_days: 4, end_date: OVERDUE_END_2D, task_type: "list", is_complete: false,
      sub_tasks: [
        { id: "st1", text: "Pull approval form template from compliance portal", is_complete: true },
        { id: "st2", text: "Get PI signature", is_complete: false },
        { id: "st3", text: "Submit to compliance office + log confirmation", is_complete: false },
      ] },
    // ── Scheduled later (alex/22): a list task that lives past the 14d
    //    Upcoming horizon, demonstrating the "+ N scheduled later" footer.
    { id: 22, project_id: 4, name: "Plan grant renewal milestone outline", start_date: SCHEDULED_LATER, duration_days: 3, end_date: SCHEDULED_LATER_END, task_type: "list", is_complete: false,
      sub_tasks: [
        { id: "st1", text: "Sketch aims 1–3", is_complete: false },
        { id: "st2", text: "Draft preliminary-data list", is_complete: false },
      ] },
    // ── Earlier (alex/23): completed > 30 days ago, lands in the
    //    collapsed-by-default Earlier accordion at the bottom of the panel.
    { id: 23, project_id: 4, name: "Lab orientation — onboard rotation student", start_date: EARLIER_DONE_ALEX, duration_days: 1, end_date: EARLIER_DONE_ALEX, task_type: "list", is_complete: true,
      sub_tasks: [
        { id: "st1", text: "Walk through bench safety + waste protocol", is_complete: true },
        { id: "st2", text: "Set up server account + lab notebook template", is_complete: true },
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
        { id: "st3", text: "Email summary to PI + safety office", is_complete: true },
      ] },
    // ── Earlier (alex/29): completed > 30 days before BASE_DATE — gives the
    //    Earlier accordion a second alex row beside alex/20 + alex/23.
    { id: 29, project_id: 4, name: "Archive 2025 inventory log", start_date: "2026-03-10", duration_days: 1, end_date: "2026-03-10", task_type: "list", is_complete: true,
      sub_tasks: [
        { id: "st1", text: "Export 2025 reagent ledger from shared sheet", is_complete: true },
        { id: "st2", text: "Move CSV into lab archive folder", is_complete: true },
        { id: "st3", text: "Reset running tally for 2026", is_complete: true },
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

  // Cell-culture-typed method entry surfacing alex's private passaging
  // schedule (Phase 2D). Clicking opens the CellCultureViewer — the only
  // way to reach that code path in fixture mode. Source path uses the
  // canonical cell_culture://protocol/{id} scheme from app/methods/page.tsx.
  out.push([
    "users/alex/methods/7.json",
    {
      id: 7,
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
  out.push(["users/alex/purchase_items/18.json", { id: 18, task_id: 15, item_name: "LC-MS column hardware service kit", quantity: 1, link: "https://example.org/demo-thermo", cas: null, price_per_unit: 450, shipping_fees: 25, total_price: 475, notes: "Awaiting PI sign-off on funding source.", funding_string: null, vendor: "Thermo", category: "Service" }]);
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

  // alex notes
  out.push(["users/alex/notes/1.json", { id: 1, title: "Run 2026-05-08: pYES-GAL1::flbA transformation", description:
      "Demo experiment note. Transformed FakeYeast-001 with pYES-GAL1::flbA using the LiAc protocol. Heat shock ran short (38 min, see deviation_log). Plated on SD-Ura. 40 colonies after 48 h — eight patched for downstream work.",
    is_running_log: false, is_shared: false, entries: [], comments: [], created_at: "2026-05-08T14:00:00Z", updated_at: "2026-05-11T09:00:00Z", username: "alex" }]);
  out.push(["users/alex/notes/2.json", { id: 2, title: "Lab observations (running log)", description:
      "Demo running log. Tracking weekly bench notes.\n\n2026-05-13: PCR screen of 16 transformants today. Expect ~50% positive based on the patch results. Will update the gel image once it's run.\n\n2026-05-10: Patched plates look clean — no contamination.",
    is_running_log: true, is_shared: false, entries: [], comments: [], created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-13T09:00:00Z", username: "alex" }]);

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

  // alex result task notes/results markdown stubs (selected tasks)
  //
  // task-2 notes.md is intentionally prepended with a stamp header (the
  // canonical HTML-comment format from `lib/stamp-utils.ts`) so the export
  // pipeline's `extractUserContent` → `parseContent` strip path has a
  // realistic fixture to exercise. Other tasks' notes/results stay
  // stamp-free to mirror older legacy content.
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
    "- Strain: `FakeYeast-001`\n" +
    "- Plasmid: `pYES-GAL1::flbA`, ~120 ng/rxn\n" +
    "- 10 rxns; heat shock 38 min (interrupted)\n" +
    "- Plated on SD-Ura; counted 40 colonies after 48 h.\n"]);
  out.push(["users/alex/results/task-2/results.md",
    DEMO_BANNER_MD +
    "## Results — yeast transformation\n\n" +
    "- See `transformation-plate.png` for the colony plate.\n" +
    "- 40 / 200 µL plated → est. 200 transformants/µg DNA (demo numbers).\n"]);
  out.push(["users/alex/results/task-3/notes.md", DEMO_BANNER_MD + "## Patch plate notes\n\nPatched 8 colonies onto a fresh SD-Ura plate (see `patch-plate.png`).\n"]);
  out.push(["users/alex/results/task-3/results.md", DEMO_BANNER_MD + "## Patch results\n\nAll 8 patched colonies grew on SD-Ura — pick top 4 for sequencing (demo data).\n"]);
  out.push(["users/alex/results/task-5/notes.md", DEMO_BANNER_MD + "## PCR screen — DemoCheck\n\nExpected band ~1.4 kb. See `gel-pcr-screen.png` for the demo gel.\n"]);
  out.push(["users/alex/results/task-5/results.md", DEMO_BANNER_MD + "## PCR-screen results\n\n6 / 16 transformants show the ~1.4 kb integration band (demo data).\n"]);
  out.push(["users/alex/results/task-4/notes.md", DEMO_BANNER_MD + "## gDNA quality check\n\nNanodrop A260/280: ~1.85. See `gel-gdna-quality.png`.\n"]);
  out.push(["users/alex/results/task-4/results.md", DEMO_BANNER_MD + "## gDNA prep results\n\nAll 8 preps came back A260/280 ≥ 1.80, A260/230 ≥ 2.0 — ready for PCR screen (demo data).\n"]);
  out.push(["users/alex/results/task-10/notes.md", DEMO_BANNER_MD + "## Growth curves\n\nTwo strains × 4 glucose levels (demo). See `growth-curve-YPD.png`.\n"]);
  out.push(["users/alex/results/task-11/notes.md", DEMO_BANNER_MD + "## Heat-shock\n\nSee `heatshock-survival.png` for the survival fractions (demo).\n"]);

  // task-8: empty results.md (explicitly created as a 0-byte file, not
  // missing). Powers the gallery's "Awaiting results" section — completed
  // tasks with no on-disk writeup or images. Different from a *missing*
  // results.md (which would be the pre-touch state); this fixture mirrors
  // the realistic "I made the file but forgot to fill it in" pattern.
  // Per master 4.0's v3 ruling, notes.md content does NOT bail this task
  // out of "Awaiting results," so we don't seed notes.md here either.
  out.push(["users/alex/results/task-8/results.md", ""]);

  // task-17/18/19: short results.md write-ups so the older completed
  // experiments register as having result content (probeTaskResults checks
  // results.md non-empty / Images/) — needed for them to land in the
  // Workbench "Earlier results" archive instead of "Awaiting writeup."
  out.push(["users/alex/results/task-17/results.md", DEMO_BANNER_MD + "## Pilot transformation\n\nFakeYeast-001 transformed cleanly with the test cassette — confirmed strain choice (demo data).\n"]);
  out.push(["users/alex/results/task-18/results.md", DEMO_BANNER_MD + "## Gibson backbone test\n\n3 / 4 mock backbones gave the expected band; locked in pYES2 for the library work (demo data).\n"]);
  out.push(["users/alex/results/task-19/results.md", DEMO_BANNER_MD + "## Baseline growth\n\nDoubling time ~95 min in YPD/glucose for FakeYeast-001 — used as the no-stress reference (demo data).\n"]);

  // ── User: morgan ──────────────────────────────────────────────────────────
  out.push([
    "users/morgan/_counters.json",
    {
      projects: 2,
      tasks: 13,
      methods: 2,
      events: 0,
      goals: 0,
      pcr_protocols: 0,
      purchase_items: 20,
      lab_links: 4,
      notes: 1,
      dependencies: 2,
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
    },
  ]);

  out.push(...projects("morgan", [
    // Project 1 is shared with alex (view) so the fixture covers the
    // shared-project surface area: listByProject threading, hide-Share-button
    // on receiver-side project popup, and the fetchAllTasksIncludingShared
    // shared-project path. Counterpart entry lives in
    // users/alex/_shared_with_me.json above.
    { id: 1, name: "DEMO: 96-well fluorescence screen", color: "#10b981", tags: ["demo", "screening"], sort_order: 0, shared_with: [{ username: "alex", permission: "edit" }] },
    { id: 2, name: "DEMO: Morgan dissertation milestones", color: "#06b6d4", tags: ["demo", "thesis"], sort_order: 1 },
  ]));

  out.push(...tasks("morgan", [
    // Completed today — has a fluorescence plate image AND a results.md
    // write-up, so the gallery renders it in "Fresh results."
    { id: 1, project_id: 1, name: "Plate FY-Δgal80 transformants on 96-well", start_date: TODAY, duration_days: 1, end_date: TODAY, task_type: "experiment", is_complete: true, experiment_color: "#10b981",
      method_attachments: [{ method_id: 1, owner: "morgan", snapshot_at: "2026-05-13T08:00:00Z" }] },
    { id: 2, project_id: 1, name: "Run fluorescence reader scan", start_date: TOMORROW, duration_days: 1, end_date: TOMORROW, task_type: "experiment", is_complete: false, experiment_color: "#10b981",
      sub_tasks: [
        { id: "st1", text: "Pre-warm plate reader to 30 °C", is_complete: false },
        { id: "st2", text: "Read OD600 baseline (no shake)", is_complete: false },
        { id: "st3", text: "Read GFP — ex 485 / em 528, gain 60", is_complete: false },
        { id: "st4", text: "Export CSV + push to analysis notebook", is_complete: false },
      ],
      method_attachments: [{ method_id: 1, owner: "morgan", snapshot_at: "2026-05-13T08:00:00Z" }] },
    { id: 3, project_id: 1, name: "qPCR setup — verify GFP transcripts", start_date: "2026-05-16", duration_days: 1, end_date: "2026-05-16", task_type: "experiment", is_complete: false, experiment_color: "#10b981",
      method_attachments: [{ method_id: 2, owner: "morgan", snapshot_at: "2026-05-13T08:00:00Z" }], shared_with: [{ username: "alex", permission: "edit" }] },
    // Strategically-overdue: writing tasks slip. Stays 4 days overdue
    // regardless of when the demo is opened (see OVERDUE_* anchors).
    { id: 4, project_id: 2, name: "Draft Chapter 2 outline", start_date: OVERDUE_START, duration_days: 3, end_date: OVERDUE_END_4D, task_type: "list", is_complete: false },
    // Task 5 is shared with alex (view) independently of any shared project,
    // so the fixture covers the individually-shared task path too.
    { id: 5, project_id: 2, name: "Send draft figures to alex", start_date: TOMORROW, duration_days: 1, end_date: TOMORROW, task_type: "list", is_complete: false },
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
      ] },
    // ── Recent-done + shared (morgan/9): completed in the last 30 days,
    //    shared into alex via _shared_with_me.json above. On alex's Lists
    //    tab the row renders in "Recently done" with the SharedFromPill.
    //    On morgan's view it just renders as a standard recent-done row.
    { id: 9, project_id: 1, name: "Set up shared screening template", start_date: RECENT_DONE, duration_days: 1, end_date: RECENT_DONE, task_type: "list", is_complete: true, shared_with: [{ username: "alex", permission: "view" }],
      sub_tasks: [
        { id: "st1", text: "Draft 96-well plate map for the joint screen", is_complete: true },
        { id: "st2", text: "Wire fixture column for alex's pYES library positives", is_complete: true },
        { id: "st3", text: "Push template to the lab notebook", is_complete: true },
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

  // morgan notes
  out.push(["users/morgan/notes/1.json", { id: 1, title: "96-well plate layout notes", description:
    "Demo note. Column 1 = WT negative, column 12 = pDEMO-fluo+ positive. Columns 2–11 are candidate FY-Δgal80 transformants from alex's library.",
    is_running_log: false, is_shared: false, entries: [], comments: [], created_at: "2026-05-12T00:00:00Z", updated_at: "2026-05-13T08:00:00Z", username: "morgan" }]);

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

  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  // The fixture mock consumes JSON only, so drop markdown bodies. The demo
  // marker stays in so the wiki-capture banner also lights up — fixture mode
  // is itself a demo experience.
  const jsonEntries = entries.filter(
    ([p, c]) => typeof c !== "string" && !p.endsWith(".md"),
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
