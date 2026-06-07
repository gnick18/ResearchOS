# Inventory v1 build plan

Status: BUILD PLAN, ready to execute in chunks. Design is signed off, see `plans/INVENTORY_DESIGN.md` (v2 + sections 14-15, decisions resolved 2026-06-07).
Author: orchestrator (master bot).
Date: 2026-06-07.
Related: `plans/INVENTORY_DESIGN.md` (the design and every data-shape FLAG), `project_inventory_design` and `project_mobile_companion` memories.

## Goal

Ship inventory v1, the full low-maintenance loop plus the desktop barcode interaction, exactly as designed. v1 is the loop that makes the feature stick, add an item with a container count, a status, and an expiry, get paid back by the expiring / stale / low signals, and have the inventory partly build itself from the Purchases-receive flow. The storage map (v2), registries (v3), and opt-in consumption (v4) are out of scope here.

## Hard rules (carry into every chunk brief)

1. Additive only. New entities and optional fields, never an on-disk cutover. Legacy or absent fields lazy-normalize on read, per the field-migration pattern in AGENTS.md section 4.
2. The data-shape FLAGs (design sections 11 and 15.7) are signed off, but each lands only in its chunk. No field appears on disk before its chunk.
3. Do NOT build on the `lab-overview` widget framework (`components/lab-overview/**`, `lib/lab-overview/**`). It is being deleted (AGENTS.md section 8). Inventory surfaces live on a dedicated `/inventory` route. The "Inventory health" snapshot is a self-contained component that can later drop into whatever replaces the dashboard, but it is NOT wired into the doomed widget registry.
4. Whole-lab-edit sharing default via the unified primitive (`lib/sharing/unified.ts`), the decision locked in design section 6.1. New records default `shared_with` to `[{ username: "*", level: "edit" }]`. Solo users get a private inventory for free.
5. Gate the whole surface behind a feature flag (`INVENTORY_ENABLED`, default off, on in Grant's working tree for dogfooding), mirroring `LORO_PILOT_ENABLED`. So partial chunks can land on main without exposing an unfinished feature.
6. Typecheck gate per chunk (`cd frontend && npx tsc --noEmit`, exit 0). Vitest for the data layer and the count/status/signal logic. Worktree discipline from AGENTS.md section 4 for any sub-bot (symlink node_modules, never install; rebase onto live main; commit on the branch, do not merge or push).
7. Zero new fields on `PurchaseItem` (FLAG-4). The order-to-stock link is `InventoryStock.purchase_item_id` only.

## Chunks

Each chunk is independently shippable behind the flag and independently verifiable.

### Chunk 1, data layer and types (the foundation)

- `types.ts`: `InventoryCategory`, `InventoryItem`, `InventoryStock` (+ their `Create` / `Update` shapes) exactly as in design section 5, including the count-first spine (`container_count`, `status`, `received_date`, `expiration_date`, `last_touched_at`), the optional inert `amount_per_container` / `unit`, the opt-in `track_consumption`, and the barcode fields `product_barcode` (item) and `container_code` (stock).
- `local-api.ts`: `inventoryItemsApi` and `inventoryStocksApi` (CRUD, `getForUser` / `saveForUser` cross-user routing, `fetchAll...IncludingShared`), per-user counters, and `normalizeInventoryItemRecord` / `normalizeInventoryStockRecord` read-boundary helpers (so future shape changes stay lazy). New records default to whole-lab-edit sharing.
- Status derivation helper, recompute-and-persist `status` (`expired` from `expiration_date`; `low` from `low_at_count` vs summed counts; `empty` at `container_count === 0`), called on every write, mirroring the stored-derived `FundingAccount.spent/remaining` pattern.
- No UI.
- FLAGs landing here: FLAG-1, FLAG-2, FLAG-3, FLAG-5, FLAG-B1, FLAG-B2 (entities, paths, types, the count-first fields, the two barcode fields).
- Verify: vitest over the API (create/read/update, cross-user routing, whole-lab-edit default), the status derivation (each transition), and normalization of a legacy or partial record. Typecheck clean.

### Chunk 2, the inventory surface and item/stock CRUD

- New `/inventory` route (register it in `APP_ROUTE_TO_WIKI` in `nav.ts` so the wiki coverage gate passes; the wiki page itself is a separate wiki sub-bot, list the implications, do not write the page here).
- Item list, add/edit item (name, category, catalog #, vendor, cas, url, container_label, low_at_count, notes), and per-item stock rows (container_count, status, lot, received_date, expiration_date, optional volume, `location_text` free-text stopgap).
- The one-tap status control (in_stock / low / empty) and a one-tap container-count step (3 to 2).
- Autocomplete item name / vendor / catalog # from the existing `item_catalog` purchase history (design Move 4).
- Verify: live in `/inventory` behind the flag, add an item with a stock, flip status, drop the count, confirm persistence and the whole-lab-edit read path. Typecheck clean.

### Chunk 3, the three signal surfaces (where the value lives)

- A self-contained `InventoryHealth` component plus three views, expiring-soon (expiration within N days, default 30, plus already expired), stale/untouched (received or last-touched older than 6 months, the locked default), and low-count (summed `container_count` below `low_at_count`, unioned with manual `status: low`). All computed at load from the stores, no new storage.
- Surfaced on the `/inventory` page (a health strip plus filtered views). NOT on the lab-overview registry (rule 3). The component is portable so it can later mount wherever the dashboard lands.
- Verify: seed fixtures hitting each signal, confirm each surfaces the right records and the health snapshot counts are correct. Unit-test the three filter computations. Typecheck clean.

### Chunk 4, Purchases-receive self-populate (the adoption mechanism)

- Hook the existing Purchases receive flow (`purchasesApi.setOrderStatus` to `received`) to offer the three-way choice from design section 8.1, do-not-add / create-new-item / add-stock-to-existing.
- Pre-fill a new `InventoryItem` from the `PurchaseItem` (item_name, vendor, cas, link), create a first `InventoryStock` with `purchase_item_id` set, `received_date` stamped, `container_count` defaulted from the ordered quantity, prompting only for expiry and optional location. The (location, lot, expiry) match path bumps an existing stock's count.
- Zero new fields on `PurchaseItem` (FLAG-4). The back-link is read-side only.
- Verify: mark a purchase received, walk all three choices, confirm the stock carries `purchase_item_id` and the item pre-fills correctly. Typecheck clean.

### Chunk 5, history, trash, search

- Register `inventory_item` and `inventory_stock` with the history engine, a recorder each (mirror `sequences-history.ts` / `purchase-viewer.ts`, the recently-added greenfield pattern that de-risks this) and an `EntityViewerAdapter` each. Gated by the existing `HISTORY_ENGINE_ENABLED` / `RESTORE_ENABLED` flags.
- Trash mirror (`_trash/inventory_items/`, `_trash/inventory_stocks/`), soft-delete, with the "this item has live stocks" warning on item delete.
- Add inventory fields (name, catalog_number, vendor, lot, barcode) to the global search indexer.
- FLAGs: FLAG-H.
- Verify: edit an item, confirm a history row and a restore; trash and restore a stock; search finds an item by name and lot. Typecheck clean. (Spike already largely answered, sequences-history proves greenfield wiring is turnkey; if it surprises, history can slip to v1.5 with no data-shape change, per design section 12.)

### Chunk 6, the barcode loop (desktop webcam, the headline interaction)

- `BarcodeScanner` component on the browser `BarcodeDetector` API (no existing usage in the tree, this is new) with a `@zxing/browser` fallback where unavailable, `getUserMedia` for the camera. The app is already Chrome / Edge only, which `BarcodeDetector` fits.
- Scan resolver, `container_code` first (exact container), then `product_barcode` (the product); design section 15.2.
- Scan-to-register (15.3), unknown code starts item creation, with a best-effort online lookup behind a thin pluggable seam (the lookup source is a separate research item, see below; the seam ships even if the source is stubbed, so the scanner is useful immediately and the lookup drops in later).
- Scan-to-consume (15.4), a registered code does `container_count -= 1`, re-derives status, drops the item into the Purchases needs-ordering queue on crossing low, with a quick-undo toast.
- Verify: drive the scanner against printed test barcodes (or a code on screen), confirm resolve, register, and consume behaviors and the reorder-queue drop. Note the CDP smooth-scroll and camera-permission limits if a bot drives it; real-camera confirmation may fall to Grant.
- Dependency, the lookup-source research (which product-barcode API clears CORS and has any lab-reagent coverage). The seam does not block on it; the scanner ships with manual entry and the lookup fills in once chosen. If the scanner component proves heavy, this whole chunk can split to v1.x with no data-shape change, because the `product_barcode` / `container_code` fields already shipped in chunk 1.

## Sequencing and parallelism

Chunks 1 to 4 are best serialized (each builds on the last, all touch `local-api.ts` and the `/inventory` surface, a high-touch shared file where parallel chips collide per AGENTS.md). Chunk 5 (history/trash/search) and chunk 6 (barcode) can each run after chunk 2 lands, chunk 5 in parallel with chunk 3 or 4 if dispatched to a separate worktree, since it touches `lib/history/**` and the search indexer rather than the inventory CRUD surface. Chunk 6 is the natural last landing and the one that can slip to v1.x.

## What this plan does NOT include

- The storage / box map (StorageNode tree + BoxGrid + the FLAG-G GridCanvas refactor). That is v2.
- Plasmid / antibody registries. That is v3.
- Opt-in per-use consumption (`InventoryConsumption` + the deduct UI). That is v4.
- Phone scanning. That follows the mobile-companion decision (`project_mobile_companion`).
- The wiki page for `/inventory`. A separate wiki sub-bot writes it after the surface settles; this plan only registers the route in `APP_ROUTE_TO_WIKI` so the coverage gate passes.

## Open follow-up before chunk 6

The best-effort barcode-lookup source was researched 2026-06-07 (`docs/research/barcode-lookup-apis.md`). Outcome: lab reagents rarely carry retail barcodes, so the manufacturer-lookup is low value. Chunk 6 should make the per-container `container_code` (lab-applied) and manual entry the PRIMARY scan path, and ship the manufacturer-barcode online lookup behind a flag, default off, bring-your-own-key (Go-UPC browser-direct, or UPCitemdb keyless trial if CORS checks out). A live CORS check is still needed before wiring browser-direct vs a proxy. Grant confirmed this refinement of decision B3 on 2026-06-07 (container codes primary, manufacturer lookup demoted to a flag-off bonus). Not blocking chunks 1 to 5.
