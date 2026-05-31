# Inventory, Storage Map, and Biological Registries: Design

Author: inventory-design sub-bot of HR
Date: 2026-05-31
Status: DESIGN ONLY. No app code in this slice. HR reviews before any build, and every data-shape FLAG below must clear Grant before a single field lands on disk.
Companion: `plans/COMPETITIVE_GAP_ANALYSIS.md` (inventory is the #1 universal gap; the box map reuses our plate grid; plasmid/antibody registries are the highest-traffic).

---

## 1. The idea in one paragraph

Our Purchases system answers "what did we buy" (an order ledger). It does not answer "what do we have, where is it, and is it still good." Every competitor surveyed (Quartzy, Genemod, SciNote, Labguru, eLabNext, RSpace, LabArchives, Benchling) ships a standing stock-on-hand inventory with storage locations; we ship none. This is the single biggest competitive hole, and it is fully feasible local-first because inventory is just structured JSON in the data folder. This doc designs that inventory, the freezer/box storage map on top of it, and the first two biological registries (plasmid, antibody), all built to our existing JsonStore + unified-sharing + history-engine architecture so they get version history, trash, sharing, and search for free.

The throughline of the design is a two-layer split that every serious competitor uses and that we must copy: **the catalog item** (what a thing is: "Q5 High-Fidelity Polymerase, NEB M0491") is separate from **the stock instance** (a physical tube of it: lot, expiry, amount remaining, and one box position). One catalog item has many stock instances. This is exactly how Quartzy's "receive into inventory" and Labguru's "collection + stocks" both work, and it is the join point where Purchases flows in and where freezer positions hang.

---

## 2. What competitors actually model (concrete, cited)

The research below drives every field choice in section 4. Sources are listed at the end of this section.

### 2.1 The catalog-vs-stock split is universal

- **Quartzy** separates the inventory *item* from item *instances*. When you mark an order request "Received," you choose Do-Not-Add / Create-New-Item / Update-Existing-Item; adding to an existing item creates a new **item instance** carrying location + lot number + expiration date, and "if the combination of the location, lot number, and expiration date fields matches an existing instance, the quantity will be updated." That is the canonical receive-to-stock flow, and it proves instances are keyed by (location, lot, expiry). (quartzy.com/tour/inventory, support.quartzy.com Receive-requests-and-add-to-Inventory)
- **Labguru** splits a **collection item** (a plasmid, an antibody, with descriptive fields like source / clonality / application) from its **stocks** ("tubes, bottles, vials that contain your inventory item"), each stock having its own amount and location, with stock alerts on low levels. Collections link parent/child (a cell line derived from a plasmid). (labguru.com/inventory, help.labguru.com Setting-Up-Your-Collections)
- **Genemod** layers an item with a *lifecycle* layer (status, ownership, reservations, QC), a *lineage* layer (parent/child, splits, derivations, batches), and a *context* layer (links to experiments, protocols, results, files), on top of the freezer location. (genemod.net/products/virtual-freezers)

Takeaway: catalog item (1) -> stock instance (N) -> optional position (1). We adopt this directly.

### 2.2 Fields each tool tracks

| Field | Quartzy | Genemod | SciNote | Labguru | eLabNext |
| --- | --- | --- | --- | --- | --- |
| Name / product name | yes | yes | yes (preset) | yes | yes |
| Catalog # | yes | yes | custom col | yes | yes |
| Vendor / brand | yes | yes | custom col | yes | yes |
| Lot / batch # | yes (on instance) | yes (lineage) | custom col | yes (stock) | yes |
| Expiration date | yes (alerts) | yes | custom col | yes | yes |
| Quantity + unit | yes | yes | stock mgmt col | yes (stock) | yes (amount) |
| Concentration | custom | yes | custom col | yes | yes |
| Location (to box position) | yes (graphical) | yes (freezer/rack/box/pos) | storage location | yes (box labels) | yes (browser) |
| Price | yes | yes | custom col | yes | yes |
| Low-stock threshold + alert | yes | yes | yes (reminder + bell) | yes (stock alert) | yes |
| SDS / safety doc | yes | n/a | file col | n/a | n/a |
| Barcode / QR | n/a stated | yes | yes (QR per item) | yes (labels) | yes (RackScan) |
| Custom fields per type | yes | yes (custom item types) | yes (custom columns) | yes | yes (sample types) |

SciNote's only fixed columns are Assigned / ID / Name / Added-on / Added-by; everything else (expiry, lot, barcode, files, dropdowns) is a custom column. SciNote fires a low-stock reminder (bell + row warning) when an item hits the alert amount. (scinote.net/product/inventory-management, knowledgebase.scinote.net stock-management-column)

### 2.3 The storage hierarchy

| Tool | Hierarchy levels |
| --- | --- |
| Genemod | freezer -> rack -> box -> position (up to 120 boxes/rack, 225 items/box) |
| eLabNext / eLabJournal | storage-unit type (freezer / LN2 / cabinet / cold room / cupboard, custom) -> compartments (towers / drawers / shelves) -> box (configurable dims) -> position (grid, auto-numbered) |
| Quartzy | locations + nestable sub-locations -> freezer box (graphical grid finder) |
| Labguru | storage location + box labels |

Convergent model: a **nestable container tree** of arbitrary depth (room / freezer / shelf / rack / drawer), terminating in a **box** that has a fixed rows x cols grid, and a **position** inside the box (A1-style). eLabNext's "any unit type, any depth" is the most flexible and the one we should mirror: do not hard-code "freezer" as a level; model a generic container node with a `kind` label.

### 2.4 Biological item types competitors ship as first-class

- **Genemod** premade item types: Cell Line, Enzyme, Plasmid, Chemical Probe, Chemical, Antibody, Strain, Primer (+ custom types with custom fields).
- **Labguru** default collections: Antibodies, Bacteria, Botany, Cell Lines, Flies, Fungi, Genes, Lipids, Plasmids, Primers, Proteins, Rodents, Sequences, Tissues, Viruses, Worms, Yeasts, Zebrafish, Compounds (+ custom).
- **eLabNext** sample types: cell lines, plant seeds, tissue, forensic specimen, bacterial strains, antibodies, and lab-defined types.

Takeaway: every tool models these as **typed inventory categories sharing one storage + stock backbone**, not as wholly separate record kinds. The "plasmid" is a category of inventory item with extra fields (backbone, resistance, sequence file); it still has stocks and positions like any reagent. This decides our registry design (section 6).

Sources: quartzy.com/tour/inventory; support.quartzy.com/hc/en-us/articles/233434167; genemod.net/products/virtual-freezers; scinote.net/product/inventory-management; knowledgebase.scinote.net/en/knowledge/how-to-use-the-stock-management-column; labguru.com/inventory; help.labguru.com/en/articles/1492335; help.labguru.com biocollections; elabnext.com / elabjournal.com Storage Units + Samples docs. Confidence: feature existence and field lists are well sourced; exact per-plan limits behind logins are unverified.

---

## 3. How this maps onto our architecture (what we already own)

Everything we need is already in the codebase; inventory is new content on proven rails, not new infrastructure.

| We need | We already have | File |
| --- | --- | --- |
| Per-entity JSON store at `users/<owner>/<entity>/<id>.json`, per-user counters, spread-merge updates that keep unknown keys | `JsonStore<T>` with `user` / `public` / `lab` store types | `frontend/src/lib/storage/json-store.ts` |
| Lab-shared vs private records (the "*" sentinel, canRead / canWrite, PI view-all) | unified sharing primitive | `frontend/src/lib/sharing/unified.ts` |
| Version history (jsonl delta rows, trash, restore) per entity via a recorder + a viewer adapter | history engine + per-entity recorders/adapters (notes, tasks, projects) | `frontend/src/lib/history/` (`engine.ts`, `notes-history.ts`, `task-history.ts`, `entity-viewer.ts`) |
| A paintable rows x cols grid keyed by `A1` cell ids with role colors and read-only mode | `PlateLayoutEditor` (dims from `dimsForSize`, cells via `wellId(row,col)`, `parseWellId`) | `frontend/src/components/PlateLayoutEditor.tsx`, `PlateViewer.tsx` |
| An order ledger with vendor / cas / price / funding / received status to flow stock in | `PurchaseItem` (`order_status: needs_ordering | ordered | received`) + `purchasesApi.setOrderStatus` | `frontend/src/lib/types.ts`, `frontend/src/lib/local-api.ts` |
| Dashboard tiles + popups | Tool/Widget registry split | `frontend/src/lib/lab-overview/tool-registry.tsx`, `components/lab-overview/widgets/registry.ts` |
| Autocomplete from past purchases | `CatalogItem` / `item_catalog` store | `frontend/src/lib/types.ts`, `local-api.ts` |

Note on `item_catalog`: it is purchase-autocomplete history (item_name / link / cas / price), NOT stock-on-hand. We do not extend it; inventory is a new store. It can later seed the inventory "add item" autocomplete.

Note on the plate grid: `PlateLayoutEditor` is hard-wired to the five plate sizes via `dimsForSize` (12/24/48/96/384 -> fixed rows/cols) and to plate *roles* (blank/sample/control). A freezer box is an arbitrary rows x cols grid (e.g. 9x9, 10x10) whose cells hold a stock instance, not a role. So we do NOT drop `PlateLayoutEditor` in unchanged; we extract its grid skeleton (the `wellId` / `parseWellId` cell-id scheme, the row-letter header, the paint/click interaction, read-only mode) into a shared `GridCanvas` primitive and have both the plate editor and the new `BoxGrid` render through it. This is a refactor-to-share, cited explicitly as FLAG-G below. The cell-id contract (`A1`, letter-row + 1-indexed-col, `parseWellId`) is reused verbatim so box positions speak the same language as plate wells.

---

## 4. The inventory entities (TypeScript-style field lists)

Three new record types. All extend the shareable shape (`owner`, `shared_with`) and the VCP attribution stamps (`created_by`, `last_edited_by`, `last_edited_at`) exactly like Method / Task / Note.

### 4.1 `InventoryItem` (the catalog item: what a thing IS)

```ts
export type InventoryCategory =
  | "reagent"      // generic chemical / consumable (default)
  | "antibody"     // registry-extended (section 6)
  | "plasmid"      // registry-extended (section 6)
  | "enzyme"
  | "primer"
  | "cell_line"
  | "strain"
  | "kit"
  | "equipment"    // v3+; instances are single, no "amount"
  | "other";

export interface InventoryItem {
  id: number;
  name: string;                       // "Q5 High-Fidelity DNA Polymerase"
  category: InventoryCategory;        // drives which extra fields render
  catalog_number: string | null;     // vendor catalog #
  vendor: string | null;
  cas: string | null;                 // chemicals; reuse the Purchases field name
  url: string | null;                 // product page (mirrors PurchaseItem.link)
  default_unit: string | null;        // "uL", "mg", "vial", "rxn" - unit instances inherit
  notes: string | null;

  // Low-stock policy lives on the item, evaluated against summed instance amounts.
  low_stock_threshold: number | null; // null = no alert; unit = default_unit
  // Optional category-specific structured blob (section 6). Null for plain reagents.
  registry?: AntibodyRegistry | PlasmidRegistry | null;

  // Sharing + attribution (identical to Method).
  owner: string;
  shared_with: SharedUser[];
  created_by: string | null;
  last_edited_by?: string;
  last_edited_at?: string;
  is_shared_with_me?: boolean;        // read-time overlay, never persisted
  shared_permission?: "view" | "edit";

  tags?: string[] | null;
}
```

### 4.2 `InventoryStock` (the stock instance: a physical tube/vial/bottle)

One `InventoryItem` has many `InventoryStock`. This is where amount, lot, expiry, and a single box position live (the Quartzy "instance" keyed by location + lot + expiry).

```ts
export interface InventoryStock {
  id: number;
  item_id: number;                    // FK -> InventoryItem.id (same owner)
  lot_number: string | null;
  amount: number;                     // current remaining amount
  unit: string;                       // inherits item.default_unit, overridable
  concentration: string | null;      // free text "10 uM", "5 mg/mL" (v1 keeps simple)
  received_date: string | null;      // ISO; stamped from Purchases receive when applicable
  expiration_date: string | null;    // ISO; drives "expiring soon"
  opened_date: string | null;        // some reagents expire N days after opening
  status: "in_stock" | "low" | "empty" | "expired"; // derived + persisted snapshot

  // Location: one stock sits in at most one box position (or unplaced).
  location_node_id: number | null;   // FK -> StorageNode.id (the box), null = unplaced
  position: string | null;           // "A1" cell id inside that box, null = box-but-no-cell

  // Provenance back to the order ledger (section 7.1).
  purchase_item_id: number | null;   // FK -> PurchaseItem.id when received from an order

  notes: string | null;

  owner: string;                      // always equals the parent item's owner
  shared_with: SharedUser[];          // inherits the item's sharing (kept in sync)
  created_by: string | null;
  last_edited_by?: string;
  last_edited_at?: string;
}
```

Design choices, stated:
- Stock inherits the item's `shared_with` (you cannot share a tube more narrowly than its catalog entry). The writer keeps them in sync; `canRead`/`canWrite` still run per record so the engine is unchanged.
- `status` is *derived* (amount vs threshold, expiry vs now) but *persisted* so list views and widgets do not recompute across every record on load. Recomputed on every write. This mirrors how `FundingAccount.spent/remaining` are stored-derived.
- A stock with `amount === 0` is kept (status `empty`) rather than deleted, so lot history survives; trash handles real deletion.

### 4.3 `StorageNode` (the location tree: room -> freezer -> ... -> box)

A single recursive container model (eLabNext's "any unit type, any depth"), not a fixed freezer/shelf/rack schema.

```ts
export type StorageNodeKind =
  | "room" | "freezer" | "fridge" | "ln2" | "cabinet" | "shelf"
  | "rack" | "drawer" | "tower" | "box" | "other";

export interface StorageNode {
  id: number;
  name: string;                       // "-80 #2", "Shelf 3", "Box: Q5 enzymes"
  kind: StorageNodeKind;
  parent_id: number | null;          // null = top-level (a room or standalone freezer)
  temperature: string | null;        // "-80 C", "4 C", "RT" - free text, display only

  // ONLY meaningful when kind === "box": the grid dims for the box map.
  box_rows: number | null;           // e.g. 9
  box_cols: number | null;           // e.g. 9
  // Box positions are NOT stored on the node; a position is owned by the
  // InventoryStock that occupies it (stock.location_node_id + stock.position).
  // The box view computes occupancy by indexing stocks where location_node_id === box.id.

  notes: string | null;

  owner: string;
  shared_with: SharedUser[];          // the location tree is typically whole-lab shared
  created_by: string | null;
  last_edited_by?: string;
  last_edited_at?: string;
}
```

The tree is just `parent_id` links; depth is unbounded, so "Room 401 / -80 freezer / Rack B / Drawer 2 / Box 7" is five nested nodes ending in a `box` node with `box_rows`/`box_cols` set. Only `box` nodes carry grid dims; everything above is a pure container. A breadcrumb path is derived by walking `parent_id`.

---

## 5. On-disk paths (and the key open question)

Following the JsonStore convention `users/<base>/<entity>/<id>.json`:

| Record | Store entity name | Path |
| --- | --- | --- |
| InventoryItem | `inventory_items` | `users/<base>/inventory_items/<id>.json` |
| InventoryStock | `inventory_stocks` | `users/<base>/inventory_stocks/<id>.json` |
| StorageNode | `storage_nodes` | `users/<base>/storage_nodes/<id>.json` |

`<base>` is the per-user `users/<username>/` for the `user` store type, or `users/lab/` for the `lab` store type. Which one is THE design decision below.

### 5.1 OPEN QUESTION A (the big one): per-user inventory vs one shared lab inventory

The unified sharing model lets either work, but they imply different defaults and different "truth" semantics. The two real options:

**Option 1 - Per-user store, whole-lab-shared by default (RECOMMENDED).** Records live under `users/<owner>/inventory_*` like every other entity. New inventory records default their `shared_with` to `[{ username: "*", level: "edit" }]` (whole-lab edit) instead of the private default. A solo researcher gets a normal private inventory with zero ceremony; a lab gets a de-facto shared inventory because everyone's items default to lab-visible, and the existing `fetchAll...IncludingShared` read path already unions everyone's shared records into one list.

- Pros: zero new infrastructure (the `user` store type + unified sharing already do this); history / trash / sharing / PI view-all work identically to Notes the day it ships; solo mode is automatic; an item stays attributable to who added it; matches our whole codebase pattern (every entity is per-owner + shared).
- Cons: "the lab inventory" is a *computed union*, not a single file tree; two people could create duplicate "Q5" items (a dedup-on-name nicety, not a blocker); a departing member's items live under their username folder (mitigated: PI view-all already sees them; a future "transfer ownership" is a small follow-up).

**Option 2 - Dedicated `users/lab/` store (the `lab` JsonStore type).** A single shared tree all members write to directly.

- Pros: one canonical "lab inventory" tree; no duplicate-item drift; survives member departure with no transfer step.
- Cons: the `lab` store type is the least-exercised path; concurrent writers to one shared tree is exactly the **shared-manifest race** our own memory warns about (parallel sessions sweep each other's writes); per-record `owner`/attribution gets muddier; solo users get an odd `users/lab/` folder; history-engine wiring for the `lab` base path is less trodden than the per-user path. Higher risk for marginal benefit at our 1-30-person scale.

**Recommendation: Option 1.** It is the lowest-risk, ships soonest, gives solo users a private inventory and labs a shared one through the exact sharing primitive we already trust, and avoids the shared-tree write race. The only thing we add is a per-category *default* of whole-lab-edit sharing for inventory records (a create-time default, not a new mechanism). Grant should confirm the default-sharing level: whole-lab **edit** (anyone can deduct/receive) vs whole-lab **read** (only the owner edits their items). I recommend **edit**, because the daily inventory action (deduct 2 uL, mark a tube empty) must work for whoever is at the bench, not just the buyer.

---

## 6. Biological registries (plasmid, antibody): category, not separate kind

**Recommendation: registries are specialized inventory *categories*, not distinct top-level record types.** Every competitor (Genemod item types, Labguru collections, eLabNext sample types) models them as typed inventory that still has stocks and storage positions. A plasmid you own is a tube in a box with a freezer position and a low-stock alert, plus extra descriptive fields. Making them separate record kinds would duplicate the stock + location + history + sharing plumbing for no benefit and would orphan them from the freezer map.

So: `InventoryItem.category = "plasmid" | "antibody"` and the extra fields hang off the optional `registry` blob (section 4.1). The list/grid/box views, low-stock, expiry, Purchases-link, history, trash, and sharing are all inherited unchanged. Only the detail editor renders the extra category fields.

### 6.1 `PlasmidRegistry` (category `"plasmid"`)

```ts
export interface PlasmidRegistry {
  backbone: string | null;            // "pUC19", "pET-28a"
  insert: string | null;             // gene / fragment cloned in
  resistance: string | null;         // "Ampicillin", "Kanamycin"
  bacterial_host: string | null;     // "DH5-alpha"
  size_bp: number | null;
  source: string | null;             // Addgene #, collaborator, "in-house"
  addgene_id: string | null;
  sequence_file_path: string | null; // attached .gb/.fasta/.dna in the data folder
  // v3 ships the registry record; an interactive sequence/feature map is OUT of
  // scope (Benchling/SnapGene territory, fights local-first). The file attaches
  // and downloads; we do not parse or render it as a map in v3.
  map_notes: string | null;          // free-text feature list as a stopgap
}
```

### 6.2 `AntibodyRegistry` (category `"antibody"`)

```ts
export interface AntibodyRegistry {
  target: string | null;             // antigen, "beta-actin"
  host_species: string | null;       // "Rabbit", "Mouse"
  clonality: "monoclonal" | "polyclonal" | null;
  clone: string | null;              // clone id for monoclonals
  conjugate: string | null;          // "HRP", "AlexaFluor-488", "unconjugated"
  isotype: string | null;            // "IgG1"
  reactivity: string | null;         // species reactivity "Human, Mouse"
  applications: string[] | null;     // ["WB", "IF", "IHC", "FACS"]
  rrid: string | null;               // antibody RRID for reproducibility
  recommended_dilution: string | null; // "1:1000 (WB)"
}
```

Antibody fields are chosen to feed the planned structured Western blot / IHC method types (host, conjugate, dilution) and to carry an RRID for reproducibility. Plasmid fields feed PCR template references and the Addgene workflow.

Both blobs are optional and additive; a `reagent`-category item has `registry: null` and JsonStore writes nothing extra. Future registries (cell_line, strain, primer, enzyme) are new `registry` shapes behind new `category` values, no schema rip.

---

## 7. Integration

### 7.1 Purchases -> inventory (the receive flow)

Adopt Quartzy's three-way receive choice. When a `PurchaseItem` flips to `order_status: "received"` (via `purchasesApi.setOrderStatus`), the receiver is offered:

1. **Do not add to inventory** (default for services / one-offs).
2. **Create new inventory item** - pre-fill an `InventoryItem` from the PurchaseItem (`item_name -> name`, `vendor`, `cas`, `link -> url`), then create a first `InventoryStock` with `purchase_item_id` set, prompting for lot / expiry / amount / location.
3. **Add stock to existing item** - pick a matching `InventoryItem`, add a new `InventoryStock` (or, if (location, lot, expiry) matches an existing instance, bump that instance's `amount`).

`InventoryStock.purchase_item_id` is the back-link so a stock can show "received from order #N on date." This is a read-side join, not a new coupling on PurchaseItem. The receive UI is the only new surface; the Purchases data shape is unchanged except for the optional reverse note in 8.

### 7.2 Methods / experiments -> consumption (v4)

The deepest differentiator: "this PCR consumed 2 uL of this enzyme lot." A consumption record deducts from a specific `InventoryStock`:

```ts
export interface InventoryConsumption {
  id: number;
  stock_id: number;                  // which physical tube
  amount: number;                    // amount consumed (same unit as stock)
  task_id: number | null;            // the experiment/task that used it
  method_id: number | null;          // optional: which method/attachment
  used_at: string;                   // ISO
  used_by: string;
  notes: string | null;
  owner: string;                     // = stock owner
}
```

Applying a consumption decrements `InventoryStock.amount` and re-derives `status`; the consumption row is the audit trail (and feeds a future "reagent usage by experiment" report). This is v4 and deliberately last: it is the most valuable and the most invasive (it touches the experiment/task surface and needs a deduct UI). v1-v3 must stand alone without it.

### 7.3 Version history, trash, search

- **History**: register `inventory_item`, `inventory_stock`, `storage_node` as new entity types in the history engine. Each needs (a) a recorder mirroring `recordNoteHistory` / `recordTaskHistory` (called from the create/update/delete paths) and (b) an `EntityViewerAdapter` mirroring `notesAdapter` (projects canonical state to a diffable body). The shared flags `HISTORY_ENGINE_ENABLED` / `RESTORE_ENABLED` gate them; no per-entity flag. Files: new `inventory-history.ts` + `inventory-viewer.ts` under `frontend/src/lib/history/`. (FLAG-H)
- **Trash**: follow the VCP R2 "trash everywhere" pattern (`_trash/<entity>/` soft-delete, same as `_trash/tasks/`, `_trash/methods/`). Deleting an item should warn if it has live stocks (and offer to trash them together).
- **Search**: inventory items + stocks join the global search index on name / catalog_number / vendor / lot / target / backbone. Reuses the existing search surface; new fields are added to the indexer.

### 7.4 Sharing / PI mode

Falls straight out of Option 1 (section 5.1): records carry `owner` + `shared_with`, `canRead` / `canWrite` gate access, PI gets implicit view-all and passcode-gated edit-anywhere. The only inventory-specific choice is the create-time default sharing level (Open Question A).

---

## 8. The storage map (box view) reuse, restated

- A `box` `StorageNode` has `box_rows` x `box_cols`. The **BoxGrid** view renders that grid through the shared `GridCanvas` primitive extracted from `PlateLayoutEditor` (FLAG-G), reusing the `wellId(row,col)` / `parseWellId` cell-id scheme so a position is the same `A1` string a plate well uses.
- Each cell is occupied iff some `InventoryStock` has `location_node_id === box.id && position === cellId`. Clicking an empty cell opens "place a stock here"; clicking a filled cell shows the stock (item name, lot, expiry, amount) and a "move / remove" action.
- Color/legend differs from plate roles: cells are colored by status (in-stock / low / expiring / empty) instead of blank/sample/control. This is why we extract a neutral `GridCanvas` rather than reusing `PlateLayoutEditor` with its baked-in role palette.
- The location tree above the box (room/freezer/rack) renders as a simple expandable tree from `StorageNode.parent_id`; a breadcrumb shows the full path of the box being viewed.

---

## 9. Dashboard widgets

Both ride the existing Tool/Widget registry (`tool-registry.tsx` + `widgets/registry.ts`). One new Tool ("Inventory") with two widget variants; computed at load from the inventory stores, no new storage.

| Widget | What it shows | Computation |
| --- | --- | --- |
| **Low stock** | Items whose summed in-stock `amount` across instances is below `low_stock_threshold` | group stocks by item, sum amounts, compare to threshold; mirrors SciNote's reminder + the funding burn-bar widget pattern |
| **Expiring soon** | Stock instances with `expiration_date` within N days (default 30), plus already-expired | filter stocks by `expiration_date <= now + N`; sort soonest-first |

Both open the Inventory tool popup filtered to the offending records. A combined "Inventory health" snapshot tile (counts: X low, Y expiring) is a nice third variant. Visibility: member-visible and lab-head-visible (everyone benefits).

---

## 10. DATA-SHAPE FLAGS (every new entity / path / type / field, for Grant)

HR must surface ALL of these before any build. Nothing here ships without sign-off.

### FLAG-1: New entities (3 in v1-v2, +2 deferred)
- `InventoryItem` (store `inventory_items`, path `users/<base>/inventory_items/<id>.json`)
- `InventoryStock` (store `inventory_stocks`, path `users/<base>/inventory_stocks/<id>.json`)
- `StorageNode` (store `storage_nodes`, path `users/<base>/storage_nodes/<id>.json`)
- `InventoryConsumption` (store `inventory_consumptions`) - v4, deferred
- (registries are NOT new entities - they are a blob on InventoryItem; see FLAG-4)

### FLAG-2: New folder paths created under the data folder
- `users/<base>/inventory_items/`
- `users/<base>/inventory_stocks/`
- `users/<base>/storage_nodes/`
- `users/<base>/inventory_consumptions/` (v4)
- `_trash/inventory_items/`, `_trash/inventory_stocks/`, `_trash/storage_nodes/` (trash mirror)
- `users/<owner>/_history/inventory_item/`, `.../inventory_stock/`, `.../storage_node/` (history jsonl)

### FLAG-3: New TypeScript types
- `InventoryCategory` (string union), `InventoryItem`, `InventoryItemCreate`, `InventoryItemUpdate`
- `InventoryStock`, `InventoryStockCreate`, `InventoryStockUpdate`
- `StorageNodeKind` (string union), `StorageNode`, `StorageNodeCreate`, `StorageNodeUpdate`
- `PlasmidRegistry`, `AntibodyRegistry` (v3)
- `InventoryConsumption` (v4)

### FLAG-4: New fields on EXISTING records (the riskiest category - these touch shipped shapes)
- `PurchaseItem`: OPTIONAL additive reverse-link `inventory_stock_ids?: number[]` so a received order can show "what stock it became." Could be omitted and computed from the stock side instead; PREFERENCE is to compute from the stock side and add NOTHING to PurchaseItem. (FLAG: confirm we add zero fields to PurchaseItem.)
- No other existing record is modified in v1-v3.

### FLAG-G: Shared-component refactor (not a data shape, but a structural FLAG)
- Extract a neutral `GridCanvas` primitive from `PlateLayoutEditor.tsx` (cell-id scheme, header, paint/click, read-only). `PlateLayoutEditor` and the new `BoxGrid` both render through it. This refactors a shipped component used by plate methods, so it needs the post-redesign verifier loop. Reuses `wellId` / `parseWellId` verbatim.

### FLAG-H: History-engine + search wiring
- Register 3 new entity types with recorders + viewer adapters in `frontend/src/lib/history/`.
- Add inventory fields to the global search indexer.

---

## 11. Phasing (smallest shippable first)

| Phase | Scope | New entities | Why this order |
| --- | --- | --- | --- |
| **v1** | Flat **inventory list**: add/edit/delete `InventoryItem` + its `InventoryStock`s (lot, expiry, amount, unit, vendor, catalog #). A single free-text `location_text` on the stock as a stopgap (no tree yet). **Low-stock + expiring-soon widgets.** History + trash + sharing (Option 1). | InventoryItem, InventoryStock | This alone closes the universal gap. It is shippable without any location tree or box map. The two widgets deliver the daily value (don't re-buy, don't use expired). |
| **v2** | The **storage map**: `StorageNode` tree + the **BoxGrid** view (FLAG-G refactor). Stocks move from `location_text` to `location_node_id` + `position`. | StorageNode | The highest daily-pain feature ("which box is my tube in"), built once inventory exists. Reuses the plate grid. |
| **v3** | **Registries**: `category` + `PlasmidRegistry` / `AntibodyRegistry` blobs and their detail editors. Sequence/feature *map* explicitly out of scope. | (none new - blob on InventoryItem) | Cheapest high-value add once the inventory backbone exists; antibody fields feed the planned WB/IHC method types. |
| **v4** | **Consumption linkage**: `InventoryConsumption`, deduct-from-stock UI on the experiment/task surface, "reagent usage by experiment" report. | InventoryConsumption | Most valuable and most invasive (touches the task surface); deliberately last so v1-v3 stand alone. |

Each phase is independently shippable and independently verifiable. v1 is the smallest thing that closes the #1 competitive gap.

A pre-v1 spike worth doing: confirm the history-engine recorder/adapter wiring for a brand-new entity is as turnkey as it looks (notes/tasks/projects were retrofits onto existing entities; inventory is greenfield). If it is heavier than expected, v1 can ship with trash + sharing and add history as v1.5 without changing any data shape.

---

## 12. OPEN QUESTIONS for Grant

1. **Per-user vs lab-shared inventory (Open Question A).** Recommendation: Option 1 (per-user store, whole-lab-shared by default). Confirm the default sharing *level* for new inventory records: whole-lab **edit** (recommended - anyone at the bench can deduct/receive) vs whole-lab **read** (only the owner edits). Solo users are unaffected either way.
2. **Location taxonomy.** Recommendation: the generic recursive `StorageNode` with a `kind` label (eLabNext model), arbitrary depth, only `box` nodes carry grid dims. Confirm we do NOT hard-code a fixed freezer/shelf/rack schema. Also confirm default box dims to offer (9x9 and 10x10 are the common -80 box sizes; we should not force one).
3. **Barcode / QR support.** SciNote and Genemod lean on it; it needs a scanner workflow and label printing. Recommendation: DEFER past v3 (it is a label-printing + camera-scan project orthogonal to the data model; the data model already has unique ids that can encode to QR later). Confirm deferral.
4. **v1 scope.** Recommendation: v1 = inventory list (item + stock) + low-stock + expiring-soon + history/trash/sharing, with a free-text stopgap location and the storage tree deferred to v2. Confirm this is the right minimal cut, or whether the box map must ship in the first release.
5. **Zero new fields on PurchaseItem (FLAG-4).** Recommendation: compute the order<->stock relationship from `InventoryStock.purchase_item_id` only; add nothing to PurchaseItem. Confirm we keep the Purchases shape frozen.
6. **Registries as categories, not separate kinds (section 6).** Recommendation: categories on InventoryItem. Confirm before any registry build so plasmid/antibody don't get their own stores.

---

-- inventory-design sub-bot of HR
