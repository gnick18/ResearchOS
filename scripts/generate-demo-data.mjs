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
      source_path: null,
      method_type: "markdown",
      folder_path: "DNA",
      parent_method_id: null,
      tags: ["DNA", "plasmid", "demo"],
      attachments: [
        {
          id: "att-1",
          name: "Protocol",
          attachment_type: "markdown",
          path: "users/public/methods/1.md",
          order: 0,
        },
      ],
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
      tasks: 15,
      methods: 5,
      events: 4,
      goals: 2,
      pcr_protocols: 1,
      purchase_items: 4,
      lab_links: 6,
      notes: 2,
      dependencies: 7,
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
        { id: 5, owner: "morgan", permission: "edit", shared_at: "2026-05-13T00:00:00Z" },
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
    { id: 5, project_id: 1, name: "PCR-screen integrants", start_date: TODAY, duration_days: 1, end_date: TODAY, task_type: "experiment", is_complete: false, experiment_color: "#3b82f6",
      sub_tasks: [
        { id: "st1", text: "Run DemoCheck PCR — 16 rxns", is_complete: false },
        { id: "st2", text: "Pour 1% agarose gel", is_complete: false },
        { id: "st3", text: "Photograph + annotate gel", is_complete: false },
      ],
      method_attachments: [{ method_id: 2, owner: "public", snapshot_at: "2026-05-13T07:00:00Z" }] },
    { id: 6, project_id: 1, name: "Send sequencing — top 4", start_date: TOMORROW, duration_days: 1, end_date: TOMORROW, task_type: "list", is_complete: false },
    { id: 7, project_id: 2, name: "Order DemoStrain ΔADE2 reagents", start_date: LAST_WEEK, duration_days: 1, end_date: LAST_WEEK, task_type: "purchase", is_complete: true },
    { id: 8, project_id: 2, name: "Mini-prep candidate plasmids", start_date: TOMORROW, duration_days: 1, end_date: TOMORROW, task_type: "experiment", is_complete: false, experiment_color: "#8b5cf6" },
    { id: 9, project_id: 2, name: "Build pDEMO-fluo plasmid library", start_date: NEXT_WEEK, duration_days: 4, end_date: "2026-05-23", task_type: "experiment", is_complete: false, experiment_color: "#8b5cf6" },
    { id: 10, project_id: 3, name: "Set up growth curves in YPD/glucose", start_date: "2026-05-15", duration_days: 1, end_date: "2026-05-15", task_type: "experiment", is_complete: false, experiment_color: "#f59e0b",
      method_attachments: [{ method_id: 2, owner: "alex", snapshot_at: "2026-05-13T08:00:00Z" }] },
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
    { id: 14, project_id: 4, name: "Review morgan's draft figures", start_date: TOMORROW, duration_days: 1, end_date: TOMORROW, task_type: "list", is_complete: false },
    { id: 15, project_id: 4, name: "Order LC-MS solvents", start_date: TODAY, duration_days: 1, end_date: TODAY, task_type: "purchase", is_complete: false },
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
            repeats: 40,
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

  // alex purchases (4)
  out.push(["users/alex/purchase_items/1.json", { id: 1, task_id: 7, item_name: "DemoStrain ΔADE2 (fake yeast collection)", quantity: 1, link: "https://example.org/demo-strain-catalog", cas: null, price_per_unit: 220, shipping_fees: 25, total_price: 245, notes: "Demo strain — replaces nothing real.", funding_string: "DEMO-DOE-EERE" }]);
  out.push(["users/alex/purchase_items/2.json", { id: 2, task_id: 7, item_name: "FakeYeast genotyping primers (IDT)", quantity: 4, link: "https://example.org/demo-idt", cas: null, price_per_unit: 14, shipping_fees: 5, total_price: 61, notes: null, funding_string: "DEMO-NIH-GM999999" }]);
  out.push(["users/alex/purchase_items/3.json", { id: 3, task_id: 7, item_name: "Phusion polymerase (demo)", quantity: 1, link: "https://example.org/demo-neb", cas: null, price_per_unit: 285, shipping_fees: 0, total_price: 285, notes: "For DemoCheck PCR.", funding_string: "DEMO-NIH-GM999999" }]);
  out.push(["users/alex/purchase_items/4.json", { id: 4, task_id: 15, item_name: "LC-MS grade acetonitrile (demo)", quantity: 2, link: "https://example.org/demo-sigma", cas: "75-05-8", price_per_unit: 95, shipping_fees: 10, total_price: 200, notes: "Demo solvent for fake-metabolite quantification.", funding_string: "DEMO-Internal-Bridge" }]);

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

  // alex dependencies (chain: 1→2→3→4→5→6, plus 7→2 and 8→9)
  out.push(["users/alex/dependencies/1.json", { id: 1, parent_id: 1, child_id: 2, dep_type: "FS" }]);
  out.push(["users/alex/dependencies/2.json", { id: 2, parent_id: 2, child_id: 3, dep_type: "FS" }]);
  out.push(["users/alex/dependencies/3.json", { id: 3, parent_id: 3, child_id: 4, dep_type: "FS" }]);
  out.push(["users/alex/dependencies/4.json", { id: 4, parent_id: 4, child_id: 5, dep_type: "FS" }]);
  out.push(["users/alex/dependencies/5.json", { id: 5, parent_id: 5, child_id: 6, dep_type: "FS" }]);
  out.push(["users/alex/dependencies/6.json", { id: 6, parent_id: 7, child_id: 2, dep_type: "FS" }]);
  out.push(["users/alex/dependencies/7.json", { id: 7, parent_id: 8, child_id: 9, dep_type: "FS" }]);

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
  out.push(["users/alex/results/task-5/notes.md", DEMO_BANNER_MD + "## PCR screen — DemoCheck\n\nExpected band ~1.4 kb. See `gel-pcr-screen.png` for the demo gel.\n"]);
  out.push(["users/alex/results/task-5/results.md", DEMO_BANNER_MD + "## PCR-screen results\n\n6 / 16 transformants show the ~1.4 kb integration band (demo data).\n"]);
  out.push(["users/alex/results/task-4/notes.md", DEMO_BANNER_MD + "## gDNA quality check\n\nNanodrop A260/280: ~1.85. See `gel-gdna-quality.png`.\n"]);
  out.push(["users/alex/results/task-10/notes.md", DEMO_BANNER_MD + "## Growth curves\n\nTwo strains × 4 glucose levels (demo). See `growth-curve-YPD.png`.\n"]);
  out.push(["users/alex/results/task-11/notes.md", DEMO_BANNER_MD + "## Heat-shock\n\nSee `heatshock-survival.png` for the survival fractions (demo).\n"]);

  // ── User: morgan ──────────────────────────────────────────────────────────
  out.push([
    "users/morgan/_counters.json",
    {
      projects: 2,
      tasks: 5,
      methods: 2,
      events: 0,
      goals: 0,
      pcr_protocols: 0,
      purchase_items: 2,
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
    { id: 1, name: "DEMO: 96-well fluorescence screen", color: "#10b981", tags: ["demo", "screening"], sort_order: 0, shared_with: ["alex"] },
    { id: 2, name: "DEMO: Morgan dissertation milestones", color: "#06b6d4", tags: ["demo", "thesis"], sort_order: 1 },
  ]));

  out.push(...tasks("morgan", [
    { id: 1, project_id: 1, name: "Plate FY-Δgal80 transformants on 96-well", start_date: TODAY, duration_days: 1, end_date: TODAY, task_type: "experiment", is_complete: false, experiment_color: "#10b981",
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
      method_attachments: [{ method_id: 2, owner: "morgan", snapshot_at: "2026-05-13T08:00:00Z" }] },
    // Strategically-overdue: writing tasks slip. Stays 4 days overdue
    // regardless of when the demo is opened (see OVERDUE_* anchors).
    { id: 4, project_id: 2, name: "Draft Chapter 2 outline", start_date: OVERDUE_START, duration_days: 3, end_date: OVERDUE_END_4D, task_type: "list", is_complete: false },
    // Task 5 is shared with alex (view) independently of any shared project,
    // so the fixture covers the individually-shared task path too.
    { id: 5, project_id: 2, name: "Send draft figures to alex", start_date: TOMORROW, duration_days: 1, end_date: TOMORROW, task_type: "list", is_complete: false, shared_with: ["alex"] },
  ]));

  // morgan methods
  out.push(["users/morgan/methods/1.json", methodJson("morgan", 1, "[Demo protocol] Fluorescence screen (96-well)", "Screening")]);
  out.push(["users/morgan/methods/1.md", METHOD_FLUO_SCREEN_MD]);
  out.push(["users/morgan/methods/2.json", methodJson("morgan", 2, "[Demo protocol] qPCR setup", "qPCR")]);
  out.push(["users/morgan/methods/2.md", METHOD_QPCR_MD]);

  // morgan purchases
  out.push(["users/morgan/purchase_items/1.json", { id: 1, task_id: 1, item_name: "96-well black-walled plates (demo)", quantity: 2, link: "https://example.org/demo-platesupply", cas: null, price_per_unit: 48, shipping_fees: 8, total_price: 104, notes: null, funding_string: "DEMO-Internal-Bridge" }]);
  out.push(["users/morgan/purchase_items/2.json", { id: 2, task_id: 2, item_name: "GFP recombinant standard (demo)", quantity: 1, link: "https://example.org/demo-gfp-std", cas: null, price_per_unit: 175, shipping_fees: 0, total_price: 175, notes: "For absolute quantification.", funding_string: "DEMO-DOE-EERE" }]);

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

  // morgan result task markdown stubs
  out.push(["users/morgan/results/task-1/notes.md", DEMO_BANNER_MD + "## 96-well plate setup\n\nPlated 80 candidate transformants + 8 WT + 8 positive controls. See `plate-96-fluo.png`.\n"]);
  out.push(["users/morgan/results/task-2/notes.md", DEMO_BANNER_MD + "## Fluorescence scan\n\nReader run with default GFP settings (485/528). See `fluo-scan-results.png` for the heat-map.\n"]);
  out.push(["users/morgan/results/task-3/notes.md", DEMO_BANNER_MD + "## qPCR products\n\nProducts run on a 1.5% agarose gel — see `gel-qpcr-products.png`.\n"]);

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
      },
    ];
  });
}

function methodJson(owner, id, name, folder) {
  return {
    id,
    name,
    source_path: null,
    method_type: "markdown",
    folder_path: folder,
    parent_method_id: null,
    tags: ["demo"],
    attachments: [
      {
        id: "att-1",
        name: "Protocol",
        attachment_type: "markdown",
        path: `users/${owner}/methods/${id}.md`,
        order: 0,
      },
    ],
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
