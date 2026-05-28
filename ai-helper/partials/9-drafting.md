When the user asks you to draft an entity, follow the templates below. Each lists the minimum required fields, the sensible defaults you can fill without asking, the fields you must ASK about, and a small JSON skeleton with placeholder values.

**Output format (default).** Emit two things, in order:

1. A fenced JSON block ready to paste into the user's data folder at the path you name (`users/<owner>/<entity>/<id>.json`).
2. A short "fields to fill in the UI" cheatsheet listing the user-visible field names and the values you used.

End with the verbatim warning from §8: *"Read this JSON carefully before saving it to your data folder. ResearchOS won't validate fields it doesn't recognize, and a malformed file can break the corresponding tab until you fix or delete it."*

If the user explicitly says "skip the JSON, just tell me what to click in the UI," drop the JSON. If they say "JSON only," drop the cheatsheet.

### Task: experiment

**Required (ask):** `project_id`, `name`, `start_date` (YYYY-MM-DD), `duration_days` (positive integer). `project_id` can be `null` for a standalone experiment (no project); these surface in the "Standalone" filter.

**Sensible defaults:** `task_type: "experiment"`, `is_high_level: false`, `is_complete: false`, `weekend_override: null` (inherit from project), `method_ids: []`, `method_attachments: []`, `tags: null`, `sub_tasks: null`, `experiment_color: null`, `deviation_log: null`, `shared_with: []`, `inherited_from_project: null`, `external_project: null`, `sort_order: 0`. Compute `end_date` from `start_date + duration_days` minus weekend days if the project's `weekend_active` is false.

```json
{
  "id": 12,
  "project_id": 1,
  "name": "GFP transformation Round 2",
  "start_date": "2026-06-01",
  "duration_days": 5,
  "end_date": "2026-06-05",
  "is_high_level": false,
  "is_complete": false,
  "task_type": "experiment",
  "weekend_override": null,
  "method_ids": [],
  "method_attachments": [],
  "deviation_log": null,
  "tags": null,
  "sort_order": 0,
  "experiment_color": null,
  "sub_tasks": null,
  "owner": "alex",
  "shared_with": [],
  "inherited_from_project": null,
  "external_project": null
}
```

Path: `users/alex/tasks/12.json`. Bump `_counters.json` on the next free integer.

### Task: purchase

**Required (ask):** `project_id`, `name`, `start_date`, `duration_days` (usually 1-3 for a purchase).

**Sensible defaults:** Same as the experiment template above with `task_type: "purchase"`. PurchaseItems live in their own files (next template) and reference this task by `task_id`.

The on-disk shape matches the experiment template; change `task_type` and `name`, leave the rest at defaults. Path: `users/<owner>/tasks/<id>.json`.

### Task: list

**Required (ask):** `project_id`, `name`, `start_date`, `duration_days`. Lists are commonly long-running (weeks or months) since they're checkbox piles.

**Sensible defaults:** `task_type: "list"`, `sub_tasks: []` if you don't have items to seed. If the user gives items, populate `sub_tasks` with `{ id: <string>, text: "<item text>", is_complete: false }` entries.

```json
{
  "id": 14,
  "project_id": 1,
  "name": "Reagent inventory checklist",
  "start_date": "2026-06-01",
  "duration_days": 30,
  "end_date": "2026-06-30",
  "is_high_level": false,
  "is_complete": false,
  "task_type": "list",
  "weekend_override": null,
  "method_ids": [],
  "method_attachments": [],
  "deviation_log": null,
  "tags": null,
  "sort_order": 0,
  "experiment_color": null,
  "sub_tasks": [
    { "id": "s1", "text": "Check primer stock concentrations", "is_complete": false },
    { "id": "s2", "text": "Top up dNTP working stock", "is_complete": false }
  ],
  "owner": "alex",
  "shared_with": [],
  "inherited_from_project": null,
  "external_project": null
}
```

### Method: markdown

**Required (ask):** `name`. Optionally `tags`, `is_public`. The body lives at the path in `source_path`; you'll emit both the JSON record and the markdown body file.

**Sensible defaults:** `method_type: "markdown"`, `is_public: false` (private to owner), `parent_method_id: null`, `created_by: <owner>`, `shared_with: []`. Convention: `source_path: "methods/<id>/body.md"` under the user's folder.

```json
{
  "id": 8,
  "name": "Heat shock transformation (E. coli)",
  "source_path": "methods/8/body.md",
  "method_type": "markdown",
  "folder_path": "methods/8",
  "parent_method_id": null,
  "tags": ["transformation", "ecoli"],
  "is_public": false,
  "created_by": "alex",
  "owner": "alex",
  "shared_with": []
}
```

Path: `users/alex/methods/8.json`. Plus the body markdown at `users/alex/methods/8/body.md`.

### Method: pcr (with PCRGradient + PCRIngredient[])

**Required (ask):** `name`, target gene/template, expected amplicon size (drives extension time), annealing temperature. Reagents (polymerase, primers, dNTPs, buffer, water).

**Sensible defaults:** `method_type: "pcr"`, the method record's `source_path: "pcr://protocol/<protocol-id>"`. Two files: the method record at `users/<u>/methods/<id>.json` and the protocol record at `users/<u>/pcr_protocols/<protocol-id>.json`.

**Sensible PCR gradient defaults:** initial 95°C for 2 min; 25 cycles of 95°C / 30 sec → annealing / 30 sec → 72°C for 1 min per kb of amplicon; final 72°C for 5 min; hold at 4°C indefinitely. Adjust if the user names a polymerase that needs different temps (e.g. Q5 wants 98°C denaturation and a shorter extension).

**Sensible reagent defaults (25 µL reaction):** 12.5 µL polymerase master mix (2x), 1.25 µL forward primer (10 µM), 1.25 µL reverse primer (10 µM), 1 µL template, 9 µL water.

**Method record skeleton:**

```json
{
  "id": 9,
  "name": "Colony PCR (GFP gene)",
  "source_path": "pcr://protocol/2",
  "method_type": "pcr",
  "folder_path": null,
  "parent_method_id": null,
  "tags": ["pcr", "colony"],
  "is_public": false,
  "created_by": "alex",
  "owner": "alex",
  "shared_with": []
}
```

**PCR protocol skeleton:**

```json
{
  "id": 2,
  "name": "Colony PCR (GFP gene)",
  "gradient": {
    "initial": [{ "name": "Initial denaturation", "temperature": 95, "duration": "2 min" }],
    "cycles": [{
      "repeats": 25,
      "steps": [
        { "name": "Denaturation", "temperature": 95, "duration": "30 sec" },
        { "name": "Annealing",    "temperature": 58, "duration": "30 sec" },
        { "name": "Extension",    "temperature": 72, "duration": "45 sec" }
      ]
    }],
    "final": [{ "name": "Final extension", "temperature": 72, "duration": "5 min" }],
    "hold": { "name": "Hold", "temperature": 4, "duration": "Indef." }
  },
  "ingredients": [
    { "id": "i1", "name": "Q5 master mix (2x)",  "concentration": "2x",   "amount_per_reaction": "12.5" },
    { "id": "i2", "name": "Fwd primer (GFP-F)",  "concentration": "10 µM","amount_per_reaction": "1.25" },
    { "id": "i3", "name": "Rev primer (GFP-R)",  "concentration": "10 µM","amount_per_reaction": "1.25" },
    { "id": "i4", "name": "Colony lysate",       "concentration": "—",    "amount_per_reaction": "1" },
    { "id": "i5", "name": "Nuclease-free water", "concentration": "—",    "amount_per_reaction": "9" }
  ],
  "notes": "Touch a single colony with a sterile tip, swirl into 25 µL water, use 1 µL of that as template.",
  "is_public": false,
  "created_by": "alex"
}
```

Paths: `users/alex/methods/9.json` + `users/alex/pcr_protocols/2.json`. Bump both counters.

### Project

**Required (ask):** `name`. Optionally `weekend_active`, `tags`, `color` (hex string).

**Sensible defaults:** `weekend_active: false`, `tags: null`, `color: null`, `is_archived: false`, `archived_at: null`, `sort_order: 0`, `shared_with: []`.

```json
{
  "id": 5,
  "name": "Yeast biofuel screen",
  "weekend_active": false,
  "tags": ["yeast", "biofuel"],
  "color": "#7c3aed",
  "created_at": "2026-06-01T09:00:00Z",
  "sort_order": 0,
  "is_archived": false,
  "archived_at": null,
  "owner": "alex",
  "shared_with": []
}
```

### HighLevelGoal

**Required (ask):** `project_id` (or `null` for personal goals), `name`, `start_date`, `end_date`. Optionally `smart_goals` (an array of `{ id, text, is_complete }`).

**Sensible defaults:** `color: null`, `smart_goals: []`, `is_complete: false`, `created_at` = now ISO.

```json
{
  "id": 3,
  "project_id": 5,
  "name": "Identify 3 candidate biofuel-producing strains by Q3",
  "start_date": "2026-06-01",
  "end_date": "2026-09-30",
  "color": "#10b981",
  "smart_goals": [
    { "id": "sg1", "text": "Run growth curves on 12 strains", "is_complete": false },
    { "id": "sg2", "text": "GC-MS quantify biofuel output for top 6", "is_complete": false }
  ],
  "is_complete": false,
  "created_at": "2026-06-01T09:00:00Z"
}
```

### PurchaseItem

**Required (ask):** `task_id` (parent purchase task's id, in the same owner's namespace), `item_name`, `quantity`. Strongly recommend asking `vendor`, `price_per_unit`, `funding_string`.

**Sensible defaults:** `link: null`, `cas: null`, `shipping_fees: 0`, `total_price: quantity * price_per_unit + shipping_fees`, `notes: null`, `category: null`. Don't invent a CAS number.

```json
{
  "id": 7,
  "task_id": 13,
  "item_name": "GFP-Forward primer (25 nmol, desalted)",
  "quantity": 1,
  "link": null,
  "cas": null,
  "price_per_unit": 28.50,
  "shipping_fees": 0,
  "total_price": 28.50,
  "notes": "Sequence: ATGGTGAGCAAGGGCGAGGAG",
  "funding_string": "NIH-R01-Yeast",
  "vendor": "IDT",
  "category": "Oligos"
}
```

Make sure `task_id: 13` references a task whose `task_type` is `"purchase"`.

### Universal closing

After every JSON emit, append:

> Read this JSON carefully before saving it to your data folder. ResearchOS won't validate fields it doesn't recognize, and a malformed file can break the corresponding tab until you fix or delete it.

If you've drafted multiple linked files (a method + its PCR protocol, a purchase task + its purchase items), list all the paths in one place at the bottom so the user can save them in order without missing one.
