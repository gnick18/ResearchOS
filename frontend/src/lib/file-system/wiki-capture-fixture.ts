/**
 * Static fixture data for wiki-screenshot capture mode (?wikiCapture=1).
 *
 * Returned as a flat list of [path, jsonBody] pairs, where path is the same
 * relative path the real FileService writes to (e.g.
 * `users/grant/projects/1.json`). The mock in wiki-capture-mock.ts loads
 * these into an in-memory map.
 *
 * Two users seeded so Lab Mode has something to aggregate. Dates are clustered
 * around 2026-05 to look current relative to the CLAUDE.md anchor date.
 *
 * Do not import this from production code — it is dev-only.
 */

type FixtureEntry = [string, unknown];

const TODAY = "2026-05-13";
const TOMORROW = "2026-05-14";
const NEXT_WEEK = "2026-05-20";
const LAST_WEEK = "2026-05-06";
const TWO_WEEKS = "2026-05-27";

const GRANT_COLOR = "#3b82f6"; // blue
const SARAH_COLOR = "#10b981"; // emerald

export function buildWikiFixtures(): FixtureEntry[] {
  const entries: FixtureEntry[] = [];

  // ── Global / public / lab roots ────────────────────────────────────────────
  entries.push(["users/_global_counters.json", {}]);
  entries.push([
    "users/_user_metadata.json",
    {
      grant: { color: GRANT_COLOR, created_at: "2026-01-01T00:00:00Z" },
      sarah: { color: SARAH_COLOR, created_at: "2026-01-05T00:00:00Z" },
    },
  ]);
  entries.push(["users/public/_counters.json", { methods: 1, pcr_protocols: 1 }]);
  entries.push([
    "users/public/methods/1.json",
    {
      id: 1,
      name: "Genomic DNA extraction (fungal)",
      github_path: null,
      method_type: "markdown",
      folder_path: "DNA",
      parent_method_id: null,
      tags: ["DNA", "fungi"],
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
      created_by: "grant",
      owner: "public",
      shared_with: [],
    },
  ]);
  entries.push([
    "users/public/methods/1.md",
    "# Genomic DNA extraction (fungal)\n\n1. Grind ~100 mg of frozen mycelium in liquid N2.\n2. Resuspend in 600 µL CTAB lysis buffer, 65°C for 30 min.\n3. Chloroform extract twice, then isopropanol precipitate.\n4. Wash pellet with 70% EtOH, air dry, resuspend in 50 µL TE.\n",
  ]);
  entries.push([
    "users/public/pcr_protocols/1.json",
    {
      id: 1,
      name: "ITS1F / ITS4 amplicon",
      gradient: {
        initial: [{ name: "Initial denaturation", temperature: 95, duration: "3 min" }],
        cycles: [
          {
            repeats: 35,
            steps: [
              { name: "Denaturation", temperature: 95, duration: "30 sec" },
              { name: "Annealing", temperature: 55, duration: "30 sec" },
              { name: "Extension", temperature: 72, duration: "60 sec" },
            ],
          },
        ],
        final: [{ name: "Final extension", temperature: 72, duration: "5 min" }],
        hold: { name: "Hold", temperature: 12, duration: "Indef." },
      },
      ingredients: [
        { id: "i1", name: "10x Buffer", concentration: "10x", amount_per_reaction: "2.5" },
        { id: "i2", name: "dNTPs", concentration: "10 mM", amount_per_reaction: "0.5" },
        { id: "i3", name: "ITS1F", concentration: "10 µM", amount_per_reaction: "1.0" },
        { id: "i4", name: "ITS4", concentration: "10 µM", amount_per_reaction: "1.0" },
        { id: "i5", name: "Taq polymerase", concentration: "5 U/µL", amount_per_reaction: "0.25" },
        { id: "i6", name: "Template DNA", concentration: "10 ng/µL", amount_per_reaction: "1.0" },
        { id: "i7", name: "Nuclease-free H2O", concentration: "—", amount_per_reaction: "18.75" },
      ],
      notes: "Standard fungal ITS amplification. 35 cycles, anneal at 55°C.",
      tags: ["ITS", "fungi"],
      is_public: true,
      created_by: "grant",
      owner: "public",
      shared_with: [],
    },
  ]);

  // Lab-wide funding accounts
  entries.push([
    "users/lab/funding_accounts/1.json",
    {
      id: 1,
      name: "NIH R01 GM-141289",
      description: "Fungal biosynthetic gene cluster discovery",
      total_budget: 50000,
      spent: 12450,
      remaining: 37550,
    },
  ]);
  entries.push([
    "users/lab/funding_accounts/2.json",
    {
      id: 2,
      name: "USDA Hatch",
      description: "Lichen-associated isocyanide metabolites",
      total_budget: 15000,
      spent: 3200,
      remaining: 11800,
    },
  ]);
  entries.push(["users/lab/_counters.json", { funding_accounts: 2 }]);

  // ── User: grant ────────────────────────────────────────────────────────────
  entries.push([
    "users/grant/_counters.json",
    {
      projects: 4,
      tasks: 12,
      methods: 2,
      events: 4,
      goals: 2,
      pcr_protocols: 1,
      purchase_items: 3,
      lab_links: 4,
      notes: 2,
      dependencies: 2,
    },
  ]);
  entries.push([
    "users/grant/settings.json",
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

  // Projects
  entries.push(...projectFiles("grant", [
    {
      id: 1,
      name: "ICS Genome Mining",
      color: "#3b82f6",
      tags: ["bioinformatics", "fungi"],
      sort_order: 0,
    },
    {
      id: 2,
      name: "Lichen Isocyanide Diversity",
      color: "#8b5cf6",
      tags: ["lichens", "isocyanides"],
      sort_order: 1,
    },
    {
      id: 3,
      name: "Amanita Comparative Genomics",
      color: "#f59e0b",
      tags: ["Amanita", "invasive"],
      sort_order: 2,
    },
    {
      id: 4,
      name: "Lab Mentoring",
      color: "#ec4899",
      tags: ["mentoring"],
      sort_order: 3,
    },
  ]));

  // Tasks
  entries.push(...taskFiles("grant", [
    {
      id: 1,
      project_id: 1,
      name: "Run NEBuilder on PKS and ICS clones",
      start_date: LAST_WEEK,
      duration_days: 1,
      end_date: LAST_WEEK,
      task_type: "experiment",
      is_complete: false,
      experiment_color: "#3b82f6",
      sub_tasks: [
        { id: "st1", text: "Linearize pUC19 vector (PCR)", is_complete: true },
        { id: "st2", text: "Gel-purify all 5 fragments", is_complete: true },
        { id: "st3", text: "Set up NEBuilder reaction (1:2 vector:insert)", is_complete: true },
        { id: "st4", text: "Transform NEB 10-beta", is_complete: false },
        { id: "st5", text: "Pick 8 colonies for colony PCR", is_complete: false },
      ],
      deviation_log: "Fragment 3 (ICS midsection) gel band was faint, re-amplified with extra 5 cycles. Ran second NEBuilder rxn in parallel using the original fragment 3 as a control.",
      method_attachments: [
        { method_id: 1, owner: "grant", snapshot_at: "2026-05-06T13:50:00Z" },
      ],
    },
    {
      id: 2,
      project_id: 1,
      name: "Sequence assembled ICS contigs",
      start_date: TODAY,
      duration_days: 2,
      end_date: TOMORROW,
      task_type: "experiment",
      is_complete: false,
    },
    {
      id: 3,
      project_id: 1,
      name: "Update CASSIS BGC predictions table",
      start_date: NEXT_WEEK,
      duration_days: 3,
      end_date: "2026-05-22",
      task_type: "list",
      is_complete: false,
    },
    {
      id: 4,
      project_id: 2,
      name: "Figure out where A. nidulans and S. livens are",
      start_date: TODAY,
      duration_days: 1,
      end_date: TODAY,
      task_type: "experiment",
      is_complete: false,
    },
    {
      id: 5,
      project_id: 2,
      name: "Make media",
      start_date: TOMORROW,
      duration_days: 1,
      end_date: TOMORROW,
      task_type: "list",
      is_complete: false,
    },
    {
      id: 6,
      project_id: 2,
      name: "Inoculate A. nidulans and S. livens",
      start_date: "2026-05-15",
      duration_days: 1,
      end_date: "2026-05-15",
      task_type: "experiment",
      is_complete: false,
    },
    {
      id: 7,
      project_id: 2,
      name: "Order ITS primers",
      start_date: TODAY,
      duration_days: 1,
      end_date: TODAY,
      task_type: "purchase",
      is_complete: false,
    },
    {
      id: 8,
      project_id: 3,
      name: "Extract DNA from South African A. muscaria",
      start_date: "2026-05-11",
      duration_days: 2,
      end_date: "2026-05-12",
      task_type: "experiment",
      is_complete: true,
    },
    {
      id: 9,
      project_id: 3,
      name: "Run BiG-SCAPE on Amanita BGCs",
      start_date: "2026-05-18",
      duration_days: 4,
      end_date: "2026-05-21",
      task_type: "experiment",
      is_complete: false,
    },
    {
      id: 10,
      project_id: 3,
      name: "Order LC-MS standards",
      start_date: TODAY,
      duration_days: 1,
      end_date: TODAY,
      task_type: "purchase",
      is_complete: false,
    },
    {
      id: 11,
      project_id: 4,
      name: "Meet with Sarah re: lichen project",
      start_date: TOMORROW,
      duration_days: 1,
      end_date: TOMORROW,
      task_type: "list",
      is_complete: false,
    },
    {
      id: 12,
      project_id: 4,
      name: "Review committee feedback",
      start_date: "2026-05-08",
      duration_days: 1,
      end_date: "2026-05-08",
      task_type: "list",
      is_complete: true,
    },
  ]));

  // Methods
  entries.push([
    "users/grant/methods/1.json",
    {
      id: 1,
      name: "BiG-SCAPE BGC clustering",
      github_path: null,
      method_type: "markdown",
      folder_path: "Bioinformatics",
      parent_method_id: null,
      tags: ["bioinformatics", "BGC"],
      attachments: [
        {
          id: "att-1",
          name: "Protocol",
          attachment_type: "markdown",
          path: "users/grant/methods/1.md",
          order: 0,
        },
      ],
      is_public: false,
      created_by: "grant",
      owner: "grant",
      shared_with: [],
    },
  ]);
  entries.push([
    "users/grant/methods/1.md",
    "# BiG-SCAPE BGC clustering\n\nUsed to group homologous BGCs into gene cluster families (GCFs).\n\n## Inputs\n\n- GenBank files for each BGC\n- Optional: anchor file marking core synthase domains\n\n## Steps\n\n1. Place all `.gbk` files into `input_bgcs/`.\n2. Run: `bigscape.py -i input_bgcs/ -o output/ --mix --cutoffs 0.3`.\n3. Inspect the network in Cytoscape (`output/network_files/`).\n4. Lower the cutoff if GCFs merge too aggressively, raise it if they fragment.\n",
  ]);
  entries.push([
    "users/grant/methods/2.json",
    {
      id: 2,
      name: "antiSMASH 7 baseline run",
      github_path: null,
      method_type: "markdown",
      folder_path: "Bioinformatics",
      parent_method_id: null,
      tags: ["bioinformatics", "BGC"],
      attachments: [
        {
          id: "att-1",
          name: "Protocol",
          attachment_type: "markdown",
          path: "users/grant/methods/2.md",
          order: 0,
        },
      ],
      is_public: false,
      created_by: "grant",
      owner: "grant",
      shared_with: [],
    },
  ]);
  entries.push([
    "users/grant/methods/2.md",
    "# antiSMASH 7 baseline run\n\nRuns the standard fungal BGC predictor on an assembled genome and parks the results in a comparable directory shape every time.\n\n## When to use this\n\n- First pass over any new fungal assembly.\n- Sanity check on a CASSIS or BiG-SCAPE prediction.\n\n## Inputs\n\n- A polished assembly in FASTA format (`assembly.fa`).\n- Optional: a known reference gbk to compare against.\n\n## Steps\n\n1. Place the FASTA at `inputs/<strain>/assembly.fa`.\n2. Run with:\n   ```bash\n   antismash --taxon fungi \\\n     --output-dir results/<strain>/ \\\n     --genefinding-tool glimmerhmm \\\n     --clusterhmmer --asf --cb-knownclusters --pfam2go \\\n     inputs/<strain>/assembly.fa\n   ```\n3. Open `index.html` in the results directory.\n4. Note the type and count of clusters in the lab notebook.\n\n## Common gotchas\n\n- Run with `--allow-long-headers` if your contig names are long.\n- The `--cb-knownclusters` flag is what makes the comparison-to-MIBiG view actually populate.\n",
  ]);

  // PCR protocols
  entries.push([
    "users/grant/pcr_protocols/1.json",
    {
      id: 1,
      name: "qPCR icsA expression",
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
        { id: "i2", name: "icsA-fwd", concentration: "10 µM", amount_per_reaction: "0.5" },
        { id: "i3", name: "icsA-rev", concentration: "10 µM", amount_per_reaction: "0.5" },
        { id: "i4", name: "cDNA template", concentration: "—", amount_per_reaction: "2" },
        { id: "i5", name: "Nuclease-free H2O", concentration: "—", amount_per_reaction: "7" },
      ],
      notes: "Use β-actin as housekeeping reference.",
      tags: ["qPCR", "icsA"],
      is_public: false,
      created_by: "grant",
      owner: "grant",
      shared_with: [],
    },
  ]);

  // Calendar events
  entries.push([
    "users/grant/events/1.json",
    {
      id: 1,
      title: "Keller Lab Meeting",
      event_type: "meeting",
      start_date: TOMORROW,
      end_date: TOMORROW,
      start_time: "11:00",
      end_time: "12:00",
      location: "MSB 4203",
      url: null,
      notes: null,
      color: "#3b82f6",
    },
  ]);
  entries.push([
    "users/grant/events/2.json",
    {
      id: 2,
      title: "SMBE 2026 abstract deadline",
      event_type: "deadline",
      start_date: TWO_WEEKS,
      end_date: TWO_WEEKS,
      start_time: null,
      end_time: null,
      location: null,
      url: "https://smbe2026.org",
      notes: "Submit Chapter 3 results.",
      color: "#ef4444",
    },
  ]);
  entries.push([
    "users/grant/events/3.json",
    {
      id: 3,
      title: "Fungal Genetics Conference",
      event_type: "conference",
      start_date: "2026-06-10",
      end_date: "2026-06-13",
      start_time: null,
      end_time: null,
      location: "Asilomar, CA",
      url: null,
      notes: null,
      color: "#8b5cf6",
    },
  ]);
  entries.push([
    "users/grant/events/4.json",
    {
      id: 4,
      title: "Coon Lab Instrument Meeting",
      event_type: "meeting",
      start_date: TOMORROW,
      end_date: TOMORROW,
      start_time: "14:00",
      end_time: "15:00",
      location: "Chemistry 1315",
      url: null,
      notes: null,
      color: "#10b981",
    },
  ]);

  // High-level goals
  entries.push([
    "users/grant/goals/1.json",
    {
      id: 1,
      project_id: 1,
      name: "Publish ICS genome-mining paper",
      start_date: "2026-04-01",
      end_date: "2026-07-31",
      color: "#3b82f6",
      smart_goals: [
        { id: "sg1", text: "Finalize CASSIS results table", is_complete: true },
        { id: "sg2", text: "Draft methods section", is_complete: true },
        { id: "sg3", text: "Submit to Nat. Comms.", is_complete: false },
      ],
      is_complete: false,
      created_at: "2026-04-01T00:00:00Z",
    },
  ]);
  entries.push([
    "users/grant/goals/2.json",
    {
      id: 2,
      project_id: 3,
      name: "Defend dissertation",
      start_date: "2026-04-01",
      end_date: "2026-08-31",
      color: "#f59e0b",
      smart_goals: [
        { id: "sg1", text: "Send draft to committee", is_complete: false },
        { id: "sg2", text: "Schedule defense", is_complete: false },
      ],
      is_complete: false,
      created_at: "2026-04-01T00:00:00Z",
    },
  ]);

  // Purchase items
  entries.push([
    "users/grant/purchase_items/1.json",
    {
      id: 1,
      task_id: 7,
      item_name: "ITS1F / ITS4 primers (IDT, 25 nmol each)",
      quantity: 2,
      link: "https://www.idtdna.com/",
      cas: null,
      price_per_unit: 15.0,
      shipping_fees: 5.0,
      total_price: 35.0,
      notes: null,
      funding_string: "NIH R01 GM-141289",
    },
  ]);
  entries.push([
    "users/grant/purchase_items/2.json",
    {
      id: 2,
      task_id: 10,
      item_name: "Muscimol standard (Sigma M1523)",
      quantity: 1,
      link: "https://www.sigmaaldrich.com/",
      cas: "2763-96-4",
      price_per_unit: 248.0,
      shipping_fees: 0,
      total_price: 248.0,
      notes: "For LC-MS quantification.",
      funding_string: "NIH R01 GM-141289",
    },
  ]);
  entries.push([
    "users/grant/purchase_items/3.json",
    {
      id: 3,
      task_id: 10,
      item_name: "Ibotenic acid standard (Sigma I2765)",
      quantity: 1,
      link: "https://www.sigmaaldrich.com/",
      cas: "2552-55-8",
      price_per_unit: 312.0,
      shipping_fees: 0,
      total_price: 312.0,
      notes: null,
      funding_string: "NIH R01 GM-141289",
    },
  ]);

  // Lab links
  entries.push([
    "users/grant/lab_links/1.json",
    {
      id: 1,
      title: "antiSMASH 7 (fungal)",
      url: "https://fungismash.secondarymetabolites.org/",
      description: "Web service for fungal BGC prediction.",
      category: "Bioinformatics",
      color: "#3b82f6",
      preview_image_url: null,
      sort_order: 0,
      created_at: "2026-02-01T00:00:00Z",
    },
  ]);
  entries.push([
    "users/grant/lab_links/2.json",
    {
      id: 2,
      title: "MIBiG repository",
      url: "https://mibig.secondarymetabolites.org/",
      description: "Curated BGC reference database.",
      category: "Bioinformatics",
      color: "#3b82f6",
      preview_image_url: null,
      sort_order: 1,
      created_at: "2026-02-01T00:00:00Z",
    },
  ]);
  entries.push([
    "users/grant/lab_links/3.json",
    {
      id: 3,
      title: "Keller Lab IDT ordering",
      url: "https://www.idtdna.com/",
      description: null,
      category: "Ordering",
      color: "#10b981",
      preview_image_url: null,
      sort_order: 0,
      created_at: "2026-02-01T00:00:00Z",
    },
  ]);
  entries.push([
    "users/grant/lab_links/4.json",
    {
      id: 4,
      title: "JGI MycoCosm",
      url: "https://mycocosm.jgi.doe.gov/",
      description: "Fungal genome database.",
      category: "Bioinformatics",
      color: "#3b82f6",
      preview_image_url: null,
      sort_order: 2,
      created_at: "2026-02-01T00:00:00Z",
    },
  ]);

  // Notes
  entries.push([
    "users/grant/notes/1.json",
    {
      id: 1,
      title: "Run 2026-05-06: NEBuilder PKS+ICS",
      description:
        "Five-fragment NEBuilder assembly. Insert ratios 1:2 (vector:insert). Transformed into NEB 10-beta. 50/50 split between LB+Carb and LB+Kan plates.",
      is_running_log: false,
      is_shared: false,
      entries: [],
      comments: [],
      created_at: "2026-05-06T14:00:00Z",
      updated_at: "2026-05-06T18:00:00Z",
      username: "grant",
    },
  ]);
  entries.push([
    "users/grant/notes/2.json",
    {
      id: 2,
      title: "Lab observations (running)",
      description:
        "A. nidulans cultures showing slower growth on minimal media this week. Possibly N-source related. Following up.",
      is_running_log: true,
      is_shared: false,
      entries: [],
      comments: [],
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-13T09:00:00Z",
      username: "grant",
    },
  ]);

  // Dependencies (just one example)
  entries.push([
    "users/grant/dependencies/1.json",
    { id: 1, parent_id: 5, child_id: 6, dep_type: "FS" },
  ]);
  entries.push([
    "users/grant/dependencies/2.json",
    { id: 2, parent_id: 4, child_id: 5, dep_type: "FS" },
  ]);

  // ── User: sarah (for Lab Mode) ─────────────────────────────────────────────
  entries.push([
    "users/sarah/_counters.json",
    {
      projects: 1,
      tasks: 2,
      methods: 0,
      events: 0,
      goals: 0,
      pcr_protocols: 0,
      purchase_items: 0,
      lab_links: 0,
      notes: 0,
      dependencies: 0,
    },
  ]);
  entries.push([
    "users/sarah/settings.json",
    {
      animationType: "celebration",
      defaultGanttViewMode: "1-month",
      defaultCalendarViewMode: "week",
      showSharedByDefault: true,
      visibleTabs: ["/experiments", "/gantt", "/methods", "/purchases", "/calendar"],
      defaultLandingTab: "/",
      sidebarShowTasks: true,
      sidebarShowCalendarEvents: true,
      sidebarEventsHorizonDays: 7,
      coloredHeader: false,
    },
  ]);
  entries.push(...projectFiles("sarah", [
    {
      id: 1,
      name: "Cryptococcus melanin pathway",
      color: SARAH_COLOR,
      tags: ["Cryptococcus", "melanin"],
      sort_order: 0,
    },
  ]));
  entries.push(...taskFiles("sarah", [
    {
      id: 1,
      project_id: 1,
      name: "Western blot CnLAC1 expression",
      start_date: TOMORROW,
      duration_days: 1,
      end_date: TOMORROW,
      task_type: "experiment",
      is_complete: false,
    },
    {
      id: 2,
      project_id: 1,
      name: "Order anti-CnLAC1 antibody",
      start_date: TODAY,
      duration_days: 1,
      end_date: TODAY,
      task_type: "purchase",
      is_complete: false,
    },
  ]));

  return entries;
}

// ─────────────────────────────────────────────────────────────────────────────

type ProjectFix = {
  id: number;
  name: string;
  color: string;
  tags: string[];
  sort_order: number;
};

function projectFiles(owner: string, projects: ProjectFix[]): FixtureEntry[] {
  return projects.map((p) => [
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
      shared_with: [],
    },
  ]);
}

type TaskFix = {
  id: number;
  project_id: number;
  name: string;
  start_date: string;
  duration_days: number;
  end_date: string;
  task_type: "experiment" | "purchase" | "list";
  is_complete: boolean;
  experiment_color?: string;
  sub_tasks?: { id: string; text: string; is_complete: boolean }[];
  deviation_log?: string;
  method_attachments?: { method_id: number; owner: string; snapshot_at: string }[];
};

function taskFiles(owner: string, tasks: TaskFix[]): FixtureEntry[] {
  return tasks.map((t) => [
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
      method_ids: [],
      deviation_log: t.deviation_log ?? null,
      tags: null,
      sort_order: t.id,
      experiment_color: t.experiment_color ?? null,
      sub_tasks: t.sub_tasks ?? null,
      pcr_gradient: null,
      pcr_ingredients: null,
      method_attachments: t.method_attachments ?? [],
      owner,
      shared_with: [],
    },
  ]);
}
