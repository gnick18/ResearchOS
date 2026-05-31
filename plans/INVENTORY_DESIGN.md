# Inventory, Storage Map, and Biological Registries: Design (v2)

Author: inventory-design-v2 sub-bot of HR
Date: 2026-05-31
Status: DESIGN ONLY. No app code in this slice. HR reviews with Grant before any build, and every data-shape FLAG below must clear Grant before a single field lands on disk.
Companion: `plans/COMPETITIVE_GAP_ANALYSIS.md` (inventory is the #1 universal gap; the box map reuses our plate grid; plasmid/antibody registries are the highest-traffic).

---

## 0. What changed from v1 of this doc, and why

Grant's concern after reading v1: "This type of inventory feature most labs wont make and i want to know how the hell we're supposed to keep track of things as they get used over time." He is right. v1 framed stock around a precise `amount` remaining and a v4 "deduct on use" consumption model. That is exactly the design that kills inventory features in real labs: a per-pipette volume ledger needs constant manual upkeep nobody sustains, so it drifts, goes stale, and becomes worse than nothing because now the data actively lies.

This v2 keeps everything structurally sound about v1 (the catalog-item / stock-instance split, the recursive `StorageNode` tree, the box map reusing the plate grid, registries as categories, the per-user store shared whole-lab, and the history / trash / search / sharing wiring) and changes one thing: **the granularity we ask the user to maintain.** Concretely:

| v1 of this doc | v2 (this doc) |
| --- | --- |
| Primary quantity is `amount` (a number you decrement) | Primary quantity is a **count of containers** ("3 vials"), updated only when a whole container is finished |
| Low-stock signal = summed `amount` vs threshold (needs the ledger to be accurate) | Low-stock signal = **container count** vs a count threshold (needs almost no upkeep) |
| Per-use consumption (deduct 2 uL) is the deep differentiator and the eventual foundation | Per-use consumption is an **explicitly opt-in power feature** for the minority that needs it; the system is fully useful without it |
| `amount` / `unit` required on every stock | `amount_per_container` / `unit` are **optional**, never the basis of any default signal |
| Value comes from completeness | Value comes from **auto-computed, zero-upkeep signals** (expiry, staleness, low-count) and from self-populating creation |
| v1 scope is the list + low-stock + expiring widgets | v1 scope is the full **low-maintenance loop**: add an item with a container count + status + expiry, the expiring / low / stale widgets, AND the Purchases-receive self-populate (the loop is what makes it stick) |

Nothing technical from v1 is discarded; the field lists in section 5 are edits, not rewrites, and all the FLAGs and competitor sources carry forward.

---

## 1. The idea in one paragraph

Our Purchases system answers "what did we buy" (an order ledger). It does not answer "what do we have, where is it, and is it still good." Every competitor surveyed ships a standing stock-on-hand inventory with storage locations; we ship none. This doc designs that inventory, the freezer/box storage map on top of it, and the first two biological registries (plasmid, antibody), all on our existing JsonStore + unified-sharing + history-engine rails so they inherit version history, trash, sharing, and search for free. The throughline is a two-layer split every serious competitor uses: **the catalog item** (what a thing is: "Q5 High-Fidelity Polymerase, NEB M0491") is separate from **the stock** (the physical containers of it: lot, expiry, a count of vials, and a box position). But the design decision that makes this feature actually survive in a real lab is not the schema. It is that we ask the user to maintain only what a busy lab will realistically keep current: a coarse count of containers and a one-tap status, with the genuinely valuable signals (what is expiring, what is running low, what has gone stale) computed for free from data entered once.

---

## 2. How it stays current, and why most inventories fail (the heart of this design)

This is the make-or-break section. Read it before the schema.

### 2.1 Why lab inventories die

Inventory features in ELNs die for one reason: they demand a level of bookkeeping precision that the daily reality of a bench does not sustain. The canonical failure is the **volume ledger**: the system stores "47.3 mL remaining" and expects the user to decrement it every time they pipette. Nobody does this for more than a week. Within a month the numbers are wrong; within a quarter the whole inventory is fiction. And a fiction is worse than an empty page, because people trust it, skip a reorder, and find an empty bottle on experiment day. Benchling, Genemod, SciNote, Labguru, and Quartzy all ship rich inventories. Walk into the average academic lab that "has" one and it is half-abandoned for exactly this reason. Feature-completeness is not the problem they solve and it is not the problem we should try to win.

So the design question is not "what can we track" but **"what will a small academic lab actually keep current with near-zero effort, and how do we make the few things they do maintain produce real value."** Five moves answer that.

### 2.2 Move 1 - Count containers, not volumes (the default)

The primary quantity on a stock is a **count of physical containers**: 3 vials, 2 bottles, 1 plate, a box of 50 tips. You change it only when a whole container is **finished** (you throw out the empty tube) or a new one **arrives**. That is an event that happens roughly monthly per item, is unambiguous (the tube is in your hand, empty), and takes one tap (count goes 3 -> 2). It does not require you to remember how much you used, do arithmetic, or update anything mid-experiment.

There is an **optional** per-container amount/volume field (`amount_per_container`, e.g. "1 mL", "100 ug") for users who want to record how big each container is. It is never required, never decremented automatically, and **never the basis of the low-stock signal by default.** It is a label, not a ledger. A lab that wants more detail can add it; a lab that wants none never sees a number it is obligated to keep accurate.

### 2.3 Move 2 - Status over amount (one tap, no math)

Every stock carries a coarse `status`: `in_stock` / `low` / `empty` / `expired`. The first three are flipped by a **one-tap control** the moment the user notices ("this is getting low," "this is the last tube"). No threshold math is required for the status to be useful, because a human eyeball at the bench is the sensor. On top of that, a **count-based** low threshold (`low_at_count`, e.g. "flag when vials < 2") can auto-flip `in_stock -> low` when the container count drops, so even the tap is optional. `expired` is computed, never tapped (see Move 3). The point: the system is useful whether the user maintains a count, taps a status, both, or neither, and it degrades gracefully rather than lying.

### 2.4 Move 3 - Auto-computed, zero-upkeep signals carry the value

The actual payoff of inventory is not the stock list. It is three signals, and all three are derived from data entered **once at receive** (or not at all) and then maintained by the calendar, not the user. These are the centerpiece widgets, not afterthoughts.

| Signal | Input (entered once, or free) | Upkeep after that | What it prevents |
| --- | --- | --- | --- |
| **Expiring soon / expired** | `expiration_date` typed once when the tube arrives (or read off the vendor label) | None. The clock does the work forever. | Running a failed experiment on dead reagent; tossing money on lapsed antibodies |
| **Stale / untouched** | `received_date` (auto-stamped at receive) + optional `last_touched_at` (auto-stamped whenever the record is edited) | None. Pure time math. | "We have six tubes of this we forgot about" and the inverse: a critical reagent nobody has confirmed is still there |
| **Low count** | `container_count` + `low_at_count`, OR a manual `status: low` tap | One tap, ~monthly, when a tube is finished | Re-buying what you have; discovering empty on experiment day |

None of these requires an accurate running total of anything. Expiry and staleness require **zero** ongoing input. That is the whole game: the value lives in signals that the passage of time computes for free.

### 2.5 Move 4 - Self-populating, near-zero-friction creation

Grant's "most labs wont make one" is answered at the front door: the bar to **start** an inventory must be near zero, and the inventory should partly build itself from work the lab already does.

- **The Purchases "received" flow offers to add to inventory.** Marking an order "received" is an action the buyer already performs. At that moment we offer one click: "Add to inventory." We pre-fill name / vendor / catalog # / CAS / url from the `PurchaseItem`, default the container count to the quantity ordered, stamp `received_date`, and prompt only for expiry and (optionally) location. The buyer is already standing there with the box; capturing it costs them one extra field. Over a few months of ordering, the inventory populates itself with the reagents the lab actually churns through, with no separate data-entry chore.
- **Autocomplete from `item_catalog` (past purchases).** When someone does add an item by hand, the name / vendor / catalog # autocomplete from the existing purchase-autocomplete history, so re-stocking a known reagent is a pick, not a re-type.
- **A flat, optional location.** v1 lets you skip location entirely (a free-text `location_text` like "-80 door, left"). No one is forced to build a freezer tree before recording that they own something.

The principle: never make the user start from a blank database. Let ordering, autocomplete, and "skip it for now" defaults carry the cold-start.

### 2.6 Move 5 - Precise per-use consumption is opt-in, not the foundation

The old v1 "deduct 2 uL from this stock per experiment" is the single most upkeep-heavy idea in the space, and it is the right tool for a real but **narrow** set of cases: expensive monoclonal antibodies, controlled substances, regulated / audited work, a shared aliquot people fight over. For those, a precise per-use ledger is worth the effort because the stakes justify it.

So consumption becomes an **explicit opt-in toggle per item** (`track_consumption: true`), off by default. When off (the default, the vast majority), the item lives entirely in the count + status + expiry world above and the user never sees a volume field they must maintain. When on, that item (and only that item) exposes the deduct-from-stock workflow and the per-use audit log. The system is fully useful with consumption tracking off for every item. It is a power feature you reach for when a specific reagent earns it, not a foundation everything sits on.

### 2.7 What this buys us, stated plainly (positioning)

The differentiator is **not feature-completeness.** Benchling and Genemod win the feature checklist, and nobody maintains theirs either, for the reasons above. Our differentiator is narrower and truer: **the low-maintenance inventory a small academic lab actually keeps current, because it does not demand busywork.** It asks for a count and a tap, computes the signals that matter from a date typed once, and builds itself from the ordering you already do. That is squarely "by academics, for academics" and squarely aimed at the solo-to-30-person lab that has no inventory manager and will abandon anything that feels like a second job. We should say this out loud in the product copy: not "track everything," but "the inventory you will actually keep."

---

## 3. What competitors actually model (concrete, cited)

The research below drove the field choices. It also, read carefully, supports the reframe: every tool offers volume tracking, and the count-vs-volume distinction is exactly where their adoption falls off.

### 3.1 The catalog-vs-stock split is universal

- **Quartzy** separates the inventory *item* from item *instances*. Marking an order "Received" offers Do-Not-Add / Create-New-Item / Update-Existing-Item; adding to an existing item creates a new **item instance** carrying location + lot + expiration, and "if the combination of the location, lot number, and expiration date fields matches an existing instance, the quantity will be updated." That is the canonical receive-to-stock flow, and it proves instances are keyed by (location, lot, expiry). (quartzy.com/tour/inventory, support.quartzy.com Receive-requests-and-add-to-Inventory)
- **Labguru** splits a **collection item** (a plasmid, an antibody, with descriptive fields) from its **stocks** ("tubes, bottles, vials that contain your inventory item"), each stock having its own amount and location, with stock alerts on low levels. (labguru.com/inventory, help.labguru.com Setting-Up-Your-Collections)
- **Genemod** layers an item with a lifecycle layer (status, ownership, reservations, QC), a lineage layer (parent/child, splits, batches), and a context layer (links to experiments / protocols / results), on top of the freezer location. (genemod.net/products/virtual-freezers)

Takeaway: catalog item (1) -> stock instance (N) -> optional position (1). We adopt this directly. Note that Quartzy's instance carries a **quantity** (a count), and "the quantity will be updated" on a match: their canonical model is already count-first, not volume-first. We lean into that.

### 3.2 Fields each tool tracks

| Field | Quartzy | Genemod | SciNote | Labguru | eLabNext |
| --- | --- | --- | --- | --- | --- |
| Name / product name | yes | yes | yes (preset) | yes | yes |
| Catalog # | yes | yes | custom col | yes | yes |
| Vendor / brand | yes | yes | custom col | yes | yes |
| Lot / batch # | yes (on instance) | yes (lineage) | custom col | yes (stock) | yes |
| Expiration date | yes (alerts) | yes | custom col | yes | yes |
| Quantity (count) | yes (instance qty) | yes | stock col | yes (stock) | yes |
| Amount + unit (volume/mass) | optional | yes | stock col | yes | yes (amount) |
| Concentration | custom | yes | custom col | yes | yes |
| Location (to box position) | yes (graphical) | yes (freezer/rack/box/pos) | storage location | yes (box labels) | yes (browser) |
| Low-stock threshold + alert | yes | yes | yes (reminder + bell) | yes (stock alert) | yes |
| Barcode / QR | n/a stated | yes | yes (QR per item) | yes (labels) | yes (RackScan) |
| Custom fields per type | yes | yes | yes | yes | yes |

SciNote's only fixed columns are Assigned / ID / Name / Added-on / Added-by; everything else (expiry, lot, barcode, files, dropdowns) is a custom column, and its low-stock reminder fires when a tracked stock amount hits the alert level. (scinote.net/product/inventory-management, knowledgebase.scinote.net stock-management-column)

### 3.3 The storage hierarchy

| Tool | Hierarchy levels |
| --- | --- |
| Genemod | freezer -> rack -> box -> position (up to 120 boxes/rack, 225 items/box) |
| eLabNext / eLabJournal | storage-unit type (freezer / LN2 / cabinet / cold room / cupboard, custom) -> compartments (towers / drawers / shelves) -> box (configurable dims) -> position (grid, auto-numbered) |
| Quartzy | locations + nestable sub-locations -> freezer box (graphical grid finder) |
| Labguru | storage location + box labels |

Convergent model: a **nestable container tree** of arbitrary depth terminating in a **box** with a fixed rows x cols grid and an A1-style position. eLabNext's "any unit type, any depth" is the most flexible and the one we mirror: do not hard-code "freezer" as a level; model a generic container node with a `kind` label.

### 3.4 Biological item types competitors ship as first-class

- **Genemod** premade item types: Cell Line, Enzyme, Plasmid, Chemical Probe, Chemical, Antibody, Strain, Primer (+ custom).
- **Labguru** default collections: Antibodies, Cell Lines, Plasmids, Primers, Proteins, Strains, and many more (+ custom).
- **eLabNext** sample types: cell lines, plant seeds, tissue, bacterial strains, antibodies, and lab-defined types.

Takeaway: every tool models these as **typed inventory categories sharing one storage + stock backbone**, not as wholly separate record kinds. This decides our registry design (section 7).

Sources: quartzy.com/tour/inventory; support.quartzy.com/hc/en-us/articles/233434167; genemod.net/products/virtual-freezers; scinote.net/product/inventory-management; knowledgebase.scinote.net/en/knowledge/how-to-use-the-stock-management-column; labguru.com/inventory; help.labguru.com/en/articles/1492335; elabnext.com / elabjournal.com Storage Units + Samples docs. Confidence: feature existence and field lists are well sourced; exact per-plan limits behind logins are unverified.

---

## 4. How this maps onto our architecture (what we already own)

Inventory is new content on proven rails, not new infrastructure.

| We need | We already have | File |
| --- | --- | --- |
| Per-entity JSON store at `users/<owner>/<entity>/<id>.json`, per-user counters, spread-merge updates that keep unknown keys | `JsonStore<T>` with `user` / `public` / `lab` store types | `frontend/src/lib/storage/json-store.ts` |
| Lab-shared vs private records (the "*" sentinel, canRead / canWrite, PI view-all) | unified sharing primitive | `frontend/src/lib/sharing/unified.ts` |
| Version history (jsonl delta rows, trash, restore) per entity via a recorder + a viewer adapter | history engine + per-entity recorders/adapters | `frontend/src/lib/history/` (`engine.ts`, `notes-history.ts`, `task-history.ts`, `entity-viewer.ts`) |
| A paintable rows x cols grid keyed by `A1` cell ids with role colors and read-only mode | `PlateLayoutEditor` (`dimsForSize`, `wellId`, `parseWellId`) | `frontend/src/components/PlateLayoutEditor.tsx`, `PlateViewer.tsx` |
| An order ledger with vendor / cas / price / funding / received status to flow stock in | `PurchaseItem` (`order_status: needs_ordering | ordered | received`) + `purchasesApi.setOrderStatus` | `frontend/src/lib/types.ts`, `frontend/src/lib/local-api.ts` |
| Dashboard tiles + popups | Tool/Widget registry split | `frontend/src/lib/lab-overview/tool-registry.tsx`, `components/lab-overview/widgets/registry.ts` |
| Autocomplete from past purchases | `CatalogItem` / `item_catalog` store | `frontend/src/lib/types.ts`, `local-api.ts` |

Note on `item_catalog`: it is purchase-autocomplete history (item_name / link / cas / price), NOT stock-on-hand. We do not extend it; inventory is a new store. It seeds the inventory "add item" autocomplete (Move 4).

Note on the plate grid: `PlateLayoutEditor` is hard-wired to the five plate sizes via `dimsForSize` and to plate *roles* (blank/sample/control). A freezer box is an arbitrary rows x cols grid (e.g. 9x9, 10x10) whose cells hold a stock, colored by status, not a role. So we extract the grid skeleton (the `wellId` / `parseWellId` cell-id scheme, the row-letter header, the paint/click interaction, read-only mode) into a shared `GridCanvas` primitive and have both the plate editor and the new `BoxGrid` render through it. Refactor-to-share, cited as FLAG-G. The cell-id contract (`A1`, letter-row + 1-indexed-col) is reused verbatim so box positions speak the same language as plate wells.

---

## 5. The inventory entities (TypeScript-style field lists)

Three new record types. All extend the shareable shape (`owner`, `shared_with`) and the VCP attribution stamps (`created_by`, `last_edited_by`, `last_edited_at`) exactly like Method / Task / Note. The reframe lives in `InventoryStock` (5.2): container count + status + dates are primary; volume is optional; consumption is opt-in.

### 5.1 `InventoryItem` (the catalog item: what a thing IS)

```ts
export type InventoryCategory =
  | "reagent"      // generic chemical / consumable (default)
  | "antibody"     // registry-extended (section 7)
  | "plasmid"      // registry-extended (section 7)
  | "enzyme"
  | "primer"
  | "cell_line"
  | "strain"
  | "kit"
  | "equipment"    // v3+; instances are single, no count semantics
  | "other";

export interface InventoryItem {
  id: number;
  name: string;                       // "Q5 High-Fidelity DNA Polymerase"
  category: InventoryCategory;        // drives which extra fields render
  catalog_number: string | null;
  vendor: string | null;
  cas: string | null;                 // chemicals; reuse the Purchases field name
  url: string | null;                 // product page (mirrors PurchaseItem.link)
  container_label: string | null;     // what one container IS: "vial" | "tube" | "bottle" | "plate" | "box". Display word for the count. Default "container".
  notes: string | null;

  // Low-stock policy is COUNT-BASED by default (section 2.3). Flags low when the
  // summed container_count across this item's stocks drops below low_at_count.
  low_at_count: number | null;        // null = no auto low-stock flag; unit is "containers"

  // OPT-IN precise consumption (section 2.6). Default false. When true, this item's
  // stocks expose the volume/amount field and the deduct-from-stock workflow (v4).
  track_consumption?: boolean;        // default false

  // Optional category-specific structured blob (section 7). Null for plain reagents.
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

Key change from v1: the low-stock policy field is `low_at_count` (a count of containers), not a volume threshold. `track_consumption` is the opt-in gate for the precise workflow.

### 5.2 `InventoryStock` (the stock: the physical containers of one item)

One `InventoryItem` has many `InventoryStock`. A stock is one lot/batch of containers sitting in (optionally) one box position. This is where the reframe is concentrated.

```ts
export interface InventoryStock {
  id: number;
  item_id: number;                    // FK -> InventoryItem.id (same owner)
  lot_number: string | null;

  // --- PRIMARY quantity: a COUNT of physical containers (section 2.2) ---
  container_count: number;            // e.g. 3 (vials). The default quantity.
                                      // Changed only when a container is finished or arrives.

  // --- COARSE status, one-tap or auto-flipped (section 2.3) ---
  status: "in_stock" | "low" | "empty" | "expired";
                                      // in_stock/low/empty are user-tappable;
                                      // expired is computed from expiration_date;
                                      // low may auto-flip from item.low_at_count.

  // --- ZERO-UPKEEP date signals (section 2.4) ---
  received_date: string | null;       // ISO; auto-stamped at Purchases-receive
  expiration_date: string | null;     // ISO; drives "expiring soon" forever, entered once
  opened_date: string | null;         // some reagents expire N days after opening
  last_touched_at: string | null;     // ISO; auto-stamped on any edit; drives "stale" signal

  // --- OPTIONAL precise amount, NEVER required, NEVER the default low-stock basis ---
  // A label on each container ("1 mL", "100 ug"), not a ledger. Only surfaced/decremented
  // when item.track_consumption === true (section 2.6).
  amount_per_container: number | null;
  unit: string | null;               // "uL", "mg", "vial", "rxn"; null when count-only
  concentration: string | null;      // free text "10 uM", "5 mg/mL"

  // --- Location: one stock sits in at most one box position (or unplaced) ---
  location_text: string | null;      // v1 stopgap free-text "-80 door, left"; null once tree exists
  location_node_id: number | null;   // v2+: FK -> StorageNode.id (the box), null = unplaced
  position: string | null;           // v2+: "A1" cell id inside that box

  // --- Provenance back to the order ledger (section 8.1) ---
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
- **`container_count` is the spine, not `amount`.** It is changed on container-level events (finish a tube, receive a box), which happen roughly monthly and are unambiguous. There is no per-pipette decrement in the default path.
- **`amount_per_container` + `unit` are optional and inert by default.** They render and matter only when `item.track_consumption === true`. A count-only stock leaves them null and the UI shows no volume field to maintain. This is the single most important change from v1.
- **`status` is derived-and-persisted.** `expired` recomputes from `expiration_date` vs now; `low` can auto-flip from `low_at_count` vs summed counts; `in_stock` / `low` / `empty` are also directly tappable. Persisted (not recomputed on every list load) so widgets are cheap, mirroring how `FundingAccount.spent/remaining` are stored-derived. Recomputed on every write.
- **`last_touched_at` powers the staleness signal for free.** Stamped on any edit; no separate user action. "Received 8 months ago, not touched since" falls straight out.
- **A `container_count === 0` stock** flips to `status: empty` and is kept (lot history survives); trash handles real deletion.
- Stock inherits the item's `shared_with` (you cannot share a tube more narrowly than its catalog entry); the writer keeps them in sync; `canRead` / `canWrite` still run per record.

### 5.3 `StorageNode` (the location tree: room -> freezer -> ... -> box)

A single recursive container model (eLabNext's "any unit type, any depth"), not a fixed freezer/shelf/rack schema. Unchanged from v1.

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
  // Positions are NOT stored on the node; a position is owned by the
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

The tree is just `parent_id` links; depth is unbounded. Only `box` nodes carry grid dims; everything above is a pure container. A breadcrumb path is derived by walking `parent_id`.

---

## 6. On-disk paths and the sharing decision

Following the JsonStore convention `users/<base>/<entity>/<id>.json`:

| Record | Store entity name | Path |
| --- | --- | --- |
| InventoryItem | `inventory_items` | `users/<base>/inventory_items/<id>.json` |
| InventoryStock | `inventory_stocks` | `users/<base>/inventory_stocks/<id>.json` |
| StorageNode | `storage_nodes` | `users/<base>/storage_nodes/<id>.json` |

### 6.1 Per-user store, whole-lab-shared by default (DECIDED: whole-lab edit)

Records live under `users/<owner>/inventory_*` like every other entity. New inventory records default their `shared_with` to `[{ username: "*", level: "edit" }]` (whole-lab edit). A solo researcher gets a normal private inventory with zero ceremony; a lab gets a de-facto shared inventory because everyone's items default to lab-visible-and-editable, and the existing `fetchAll...IncludingShared` read path unions everyone's shared records into one list.

- Pros: zero new infrastructure (the `user` store type + unified sharing already do this); history / trash / sharing / PI view-all work identically to Notes the day it ships; solo mode is automatic; items stay attributable to who added them; matches the whole-codebase pattern.
- Cons: "the lab inventory" is a computed union, not a single file tree; two people could create duplicate "Q5" items (a dedup-on-name nicety, not a blocker); a departing member's items live under their username folder (PI view-all already sees them; "transfer ownership" is a small follow-up).

**Grant decided: whole-lab EDIT.** The daily inventory action (mark a tube empty, drop the count from 3 to 2, receive a new box) must work for whoever is at the bench, not just the buyer. This is locked; the alternative (`lab` store type, a single shared tree) is rejected as the least-exercised path and the exact shared-tree write race our own memory warns about, for marginal benefit at 1-30 people.

---

## 7. Biological registries (plasmid, antibody): category, not separate kind

**Registries are specialized inventory categories, not distinct top-level record types.** Every competitor models them as typed inventory that still has stocks and storage positions. A plasmid you own is a tube in a box with a freezer position and a low-stock signal, plus extra descriptive fields. Separate record kinds would duplicate the stock + location + history + sharing plumbing for no benefit and orphan them from the freezer map.

So: `InventoryItem.category = "plasmid" | "antibody"` and the extra fields hang off the optional `registry` blob (5.1). The list / grid / box views, low-count, expiry, staleness, Purchases-link, history, trash, and sharing are all inherited unchanged. Only the detail editor renders the extra category fields.

### 7.1 `PlasmidRegistry` (category `"plasmid"`)

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

### 7.2 `AntibodyRegistry` (category `"antibody"`)

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

Antibody fields feed the planned structured Western blot / IHC method types (host, conjugate, dilution) and carry an RRID for reproducibility. Antibodies are also the textbook **opt-in consumption** candidate (expensive, finite, fought over), so the registry and `track_consumption` pair naturally for the labs that want it. Plasmid fields feed PCR template references and the Addgene workflow.

Both blobs are optional and additive; a `reagent`-category item has `registry: null` and JsonStore writes nothing extra. Future registries (cell_line, strain, primer, enzyme) are new `registry` shapes behind new `category` values, no schema rip.

---

## 8. Integration

### 8.1 Purchases -> inventory (the self-populate receive flow, now in v1)

This is Move 4 and it is core to adoption, so it ships in **v1**, not later. Adopt Quartzy's three-way receive choice. When a `PurchaseItem` flips to `order_status: "received"` (via `purchasesApi.setOrderStatus`), the receiver is offered:

1. **Do not add to inventory** (default for services / one-offs).
2. **Create new inventory item** - pre-fill an `InventoryItem` from the PurchaseItem (`item_name -> name`, `vendor`, `cas`, `link -> url`), then create a first `InventoryStock` with `purchase_item_id` set, `received_date` auto-stamped, `container_count` defaulted from the ordered quantity, prompting only for expiry and (optionally) a free-text location. No volume required.
3. **Add stock to existing item** - pick a matching `InventoryItem` (autocompleted from existing items), add a new `InventoryStock`, or if (location, lot, expiry) matches an existing stock, bump that stock's `container_count`.

`InventoryStock.purchase_item_id` is the back-link so a stock can show "received from order #N on date." This is a read-side join, not a new coupling on PurchaseItem. The receive UI is the only new surface; the Purchases data shape is unchanged (FLAG-4 keeps zero new fields on PurchaseItem).

### 8.2 Methods / experiments -> consumption (v4, opt-in only)

For items with `track_consumption === true` (the minority), a consumption record deducts from a specific stock's `amount_per_container` pool:

```ts
export interface InventoryConsumption {
  id: number;
  stock_id: number;                  // which physical container set
  amount: number;                    // amount consumed (same unit as stock)
  task_id: number | null;            // the experiment/task that used it
  method_id: number | null;          // optional: which method/attachment
  used_at: string;                   // ISO
  used_by: string;
  notes: string | null;
  owner: string;                     // = stock owner
}
```

Applying a consumption decrements the tracked amount and re-derives `status`; the row is the audit trail (and feeds a future "reagent usage by experiment" report). This is v4, deliberately last and deliberately gated: it touches the experiment/task surface, needs a deduct UI, and is only ever active for items the user explicitly opted in. v1-v3 stand fully alone without it, and most items never enter this path.

### 8.3 Version history, trash, search

- **History**: register `inventory_item`, `inventory_stock`, `storage_node` as new entity types in the history engine. Each needs (a) a recorder mirroring `recordNoteHistory` / `recordTaskHistory` (called from create/update/delete paths) and (b) an `EntityViewerAdapter` mirroring `notesAdapter`. The shared flags `HISTORY_ENGINE_ENABLED` / `RESTORE_ENABLED` gate them; no per-entity flag. New `inventory-history.ts` + `inventory-viewer.ts` under `frontend/src/lib/history/`. (FLAG-H)
- **Trash**: follow the VCP R2 "trash everywhere" pattern (`_trash/<entity>/` soft-delete). Deleting an item warns if it has live stocks (and offers to trash them together).
- **Search**: inventory items + stocks join the global search index on name / catalog_number / vendor / lot / target / backbone. Reuses the existing search surface; new fields added to the indexer.

### 8.4 Sharing / PI mode

Falls straight out of section 6.1: records carry `owner` + `shared_with` (default whole-lab edit), `canRead` / `canWrite` gate access, PI gets implicit view-all and passcode-gated edit-anywhere. No inventory-specific sharing mechanism.

---

## 9. The storage map (box view) reuse

- A `box` `StorageNode` has `box_rows` x `box_cols`. The **BoxGrid** view renders that grid through the shared `GridCanvas` primitive extracted from `PlateLayoutEditor` (FLAG-G), reusing the `wellId(row,col)` / `parseWellId` cell-id scheme so a position is the same `A1` string a plate well uses.
- Each cell is occupied iff some `InventoryStock` has `location_node_id === box.id && position === cellId`. Clicking an empty cell opens "place a stock here"; clicking a filled cell shows the stock (item name, lot, expiry, count) and a "move / remove" action.
- Cells are colored by **status** (in_stock / low / expiring / empty), not plate roles. This is why we extract a neutral `GridCanvas` rather than reusing `PlateLayoutEditor` with its baked-in role palette.
- The location tree above the box renders as a simple expandable tree from `StorageNode.parent_id`; a breadcrumb shows the full path of the box being viewed.

The box map stays **v2** (not v1). v1 ships with the flat `location_text` stopgap so no one must build a freezer tree to start (Move 4). This keeps the cold-start cost near zero, which is the point.

---

## 10. Dashboard widgets (the centerpiece, per Move 3)

These are not afterthoughts; they are where the value lives, so they ship in **v1**. All ride the existing Tool/Widget registry (`tool-registry.tsx` + `widgets/registry.ts`), computed at load from the inventory stores, no new storage. All three run on data that needs zero ongoing upkeep.

| Widget | What it shows | Computation | Upkeep needed |
| --- | --- | --- | --- |
| **Expiring soon** | Stocks with `expiration_date` within N days (default 30), plus already-expired | filter by `expiration_date <= now + N`; sort soonest-first | None (date typed once) |
| **Stale / untouched** | Stocks `received_date` older than M months (default 6) with no recent `last_touched_at` | filter by age of `received_date` / `last_touched_at` | None (auto-stamped) |
| **Low count** | Items whose summed `container_count` across stocks is below `low_at_count`, plus anything manually flagged `status: low` | group stocks by item, sum counts, compare to `low_at_count`; union with `status === "low"` | One tap, ~monthly |

Each opens the Inventory tool popup filtered to the offending records. A combined **"Inventory health"** snapshot tile (X expiring, Y stale, Z low) is the headline variant. Visibility: member-visible and lab-head-visible (everyone benefits). Note that the two highest-value widgets (Expiring, Stale) require literally zero ongoing maintenance, which is the whole pitch.

---

## 11. DATA-SHAPE FLAGS (every new entity / path / type / field, for Grant)

HR must surface ALL of these before any build. Nothing here ships without sign-off.

### FLAG-1: New entities (3 in v1-v2, +1 deferred)
- `InventoryItem` (store `inventory_items`, path `users/<base>/inventory_items/<id>.json`)
- `InventoryStock` (store `inventory_stocks`, path `users/<base>/inventory_stocks/<id>.json`)
- `StorageNode` (store `storage_nodes`, path `users/<base>/storage_nodes/<id>.json`) - v2
- `InventoryConsumption` (store `inventory_consumptions`) - v4, deferred, opt-in only
- (registries are NOT new entities - they are a blob on InventoryItem; see FLAG-4)

### FLAG-2: New folder paths created under the data folder
- `users/<base>/inventory_items/`
- `users/<base>/inventory_stocks/`
- `users/<base>/storage_nodes/` (v2)
- `users/<base>/inventory_consumptions/` (v4)
- `_trash/inventory_items/`, `_trash/inventory_stocks/`, `_trash/storage_nodes/` (trash mirror)
- `users/<owner>/_history/inventory_item/`, `.../inventory_stock/`, `.../storage_node/` (history jsonl)

### FLAG-3: New TypeScript types
- `InventoryCategory` (string union), `InventoryItem`, `InventoryItemCreate`, `InventoryItemUpdate`
- `InventoryStock`, `InventoryStockCreate`, `InventoryStockUpdate`
- `StorageNodeKind` (string union), `StorageNode`, `StorageNodeCreate`, `StorageNodeUpdate` (v2)
- `PlasmidRegistry`, `AntibodyRegistry` (v3)
- `InventoryConsumption` (v4)

### FLAG-4: New fields on EXISTING records (the riskiest category)
- `PurchaseItem`: PREFERENCE is to add NOTHING. Compute the order<->stock relationship from `InventoryStock.purchase_item_id` only. (FLAG: confirm zero fields on PurchaseItem.)
- No other existing record is modified in v1-v3.

### FLAG-5: New count-first / status-first / opt-in fields on InventoryStock and InventoryItem (the reframe)
These are the fields that implement the maintenance-realism reframe; calling them out explicitly because they are what changed from v1 of this doc:
- `InventoryStock.container_count` (the primary quantity, replaces v1's `amount` as the spine)
- `InventoryStock.status` now includes the one-tap `low` / `empty` semantics
- `InventoryStock.last_touched_at` (drives the staleness signal; auto-stamped)
- `InventoryStock.amount_per_container` + `unit` are now OPTIONAL (null by default)
- `InventoryStock.location_text` (v1 stopgap free-text location)
- `InventoryItem.container_label` (the display word for the count)
- `InventoryItem.low_at_count` (count-based low threshold, replaces v1's volume `low_stock_threshold`)
- `InventoryItem.track_consumption` (opt-in gate for the precise volume workflow)

### FLAG-G: Shared-component refactor (structural, not a data shape)
- Extract a neutral `GridCanvas` primitive from `PlateLayoutEditor.tsx` (cell-id scheme, header, paint/click, read-only). `PlateLayoutEditor` and the new `BoxGrid` both render through it. Refactors a shipped component used by plate methods, so it needs the post-redesign verifier loop. Reuses `wellId` / `parseWellId` verbatim. (v2)

### FLAG-H: History-engine + search wiring
- Register 3 new entity types with recorders + viewer adapters in `frontend/src/lib/history/`.
- Add inventory fields to the global search indexer.

---

## 12. Phasing (the v1 cut is the full low-maintenance LOOP)

The v1 boundary moved from v1-of-this-doc. The point of v1 is no longer "a list plus two widgets," it is **the complete loop that makes the feature stick**: you can add an item (with a container count, a status, an expiry), the expiring / low / stale widgets pay you back for it, and the Purchases-receive self-populate means the inventory partly builds itself. That loop, end to end, is what survives in a real lab; shipping less than the loop ships something that does not stick.

| Phase | Scope | New entities | Why this order |
| --- | --- | --- | --- |
| **v1** | The full low-maintenance loop: add/edit/delete `InventoryItem` + its `InventoryStock`s with **container_count + status + expiry + received_date** (volume optional, consumption off). Free-text `location_text` stopgap (no tree). **Expiring-soon + stale + low-count widgets.** **Purchases-receive self-populate (section 8.1).** Count-based low-stock. History + trash + sharing (whole-lab edit). | InventoryItem, InventoryStock | This is the loop that makes inventory stick: near-zero start cost (self-populate + skip-location), near-zero upkeep (count + tap + dates-typed-once), real payback (the three widgets). It closes the #1 competitive gap and answers Grant's "how do we keep it current" directly. |
| **v2** | The **storage map**: `StorageNode` tree + the **BoxGrid** view (FLAG-G refactor). Stocks move from `location_text` to `location_node_id` + `position`. | StorageNode | "Which box is my tube in," built once inventory exists. Reuses the plate grid. Deferred out of v1 so the cold-start stays trivial. |
| **v3** | **Registries**: `category` + `PlasmidRegistry` / `AntibodyRegistry` blobs and detail editors. Sequence/feature *map* out of scope. | (none new - blob on InventoryItem) | Cheap high-value add once the backbone exists; antibody fields feed the planned WB/IHC method types. |
| **v4** | **Opt-in consumption**: `InventoryConsumption`, deduct-from-stock UI on the experiment/task surface for `track_consumption` items only, "reagent usage by experiment" report. | InventoryConsumption | Most upkeep-heavy and most invasive; gated to the minority that opts in. Deliberately last so v1-v3 stand alone and the default experience never touches it. |

Each phase is independently shippable and verifiable. The self-populate receive flow is in v1 on purpose (recommendation: keep it there) because it is the adoption mechanism, not a nice-to-have. The box map is v2 on purpose because forcing a freezer tree at cold-start raises the bar to start, which is the thing we are most trying to lower.

A pre-v1 spike worth doing: confirm the history-engine recorder/adapter wiring for a brand-new (greenfield) entity is as turnkey as it looks; notes/tasks/projects were retrofits onto existing entities. If heavier than expected, v1 can ship with trash + sharing and add history as v1.5 with no data-shape change.

---

## 13. OPEN QUESTIONS for Grant

1. **Container-count primary, volume optional, consumption opt-in (the reframe, sections 2 and 5.2).** This is the core decision to approve. Confirm: `container_count` is the spine, `amount_per_container` / `unit` are optional and inert unless `track_consumption` is on, and the default low-stock signal is `low_at_count` (a count), not a volume. Everything below is downstream of this.
2. **`container_count` granularity: is per-container count the right default, or do some labs think in even coarser terms (just `status` and nothing else)?** NEW question the reframe surfaces. Some labs may not even want to maintain a count, only the one-tap in_stock/low/empty status. Recommendation: ship the count as the default but make it skippable (a stock with `container_count` left at 1 and only `status` maintained is valid). Confirm we allow "status-only" stocks with no real count.
3. **Self-populate-from-Purchases in v1 (section 8.1).** Recommendation: yes, it is the adoption mechanism, not a later add. Confirm it belongs in the first release.
4. **v1 scope = the full loop (section 12).** Recommendation: v1 = item + stock (count/status/expiry) + expiring/stale/low widgets + Purchases self-populate + history/trash/sharing, with `location_text` stopgap and the box map deferred to v2. Confirm this is the right minimal cut, or whether the box map must ship in the first release.
5. **Staleness signal defaults (section 2.4, 10).** NEW question the reframe surfaces. The "stale / untouched" widget needs a default age threshold (recommend 6 months on `received_date` / `last_touched_at`). Also: do we auto-stamp `last_touched_at` on *any* edit, or only on meaningful ones (status change, count change)? Recommendation: any edit, to keep it zero-effort. Confirm the default age and the stamping rule.
6. **Location taxonomy (v2).** Recommendation: the generic recursive `StorageNode` with a `kind` label, arbitrary depth, only `box` nodes carry grid dims. Confirm we do NOT hard-code a fixed freezer/shelf/rack schema. Confirm default box dims to offer (9x9 and 10x10 are common -80 sizes; do not force one).
7. **Zero new fields on PurchaseItem (FLAG-4).** Recommendation: compute the order<->stock relationship from `InventoryStock.purchase_item_id` only. Confirm we keep the Purchases shape frozen.
8. **Registries as categories, not separate kinds (section 7).** Recommendation: categories on InventoryItem. Confirm before any registry build so plasmid/antibody don't get their own stores.
9. **Barcode / QR (deferred).** Recommendation: DEFER past v3 (a label-printing + camera-scan project orthogonal to the data model; ids can encode to QR later). Confirm deferral.

---

-- inventory-design-v2 sub-bot of HR
