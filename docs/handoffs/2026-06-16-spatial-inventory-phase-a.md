# Spatial Inventory Phase A — BUILT (2026-06-16)

MobileUI lane (cohort-takeover pick-up session). Phase A of the spatial-inventory feature ("where do I find this in the lab") is built end to end and emulator-verified in demo mode. Spec + product direction: [`docs/proposals/2026-06-15-spatial-inventory-where-is-it.md`](../proposals/2026-06-15-spatial-inventory-where-is-it.md).

## What Phase A is
The 90%-of-value, 10%-of-cost layer: plumb the EXISTING `InventoryStock.location_text` (already in the data model, but invisible to the app + never captured) through to the phone, so a researcher can record where a package went at scan-in and look up "where is it / do we have it" at the bench. No map, no 3D — the on-ramp to the shared 2D pin model.

## Commits (local `main`, NOT pushed)
1. `0976d2c9a` — **(1/3) read path.** `location` added to the laptop inventory snapshot's `SnapshotTrackedStock` (populated from `location_text`); mirrored on the mobile `TrackedStock` type; rendered as a subtle pin + location line under the units in the Inventory tab (hidden when none recorded). Demo fixtures seed 3 located stocks + 1 without.
2. `958bf1aa9` — **(2/3) scan-in capture.** A "Where did you put it?" free-text prompt + recent-location autocomplete chips (drawn from synced stock locations) in the scan track/receive step. `location` rides the existing create/register actions: added to `CreatePayload` + `RegisterTrackerPayload` (mobile `lib/scan.ts`) and `CreatePurchasePayload`/`CreateInventoryPayload`/`RegisterTrackerPayload` (laptop `poll.ts`), applied as `location_text` at stock create / tracker register. +2 snapshot read-path unit tests (11/11).
3. `8aeebba50` — **(3/3) lookup.** A "Find an item or location" search box on the Inventory tab (shown once >=4 tracked stocks) filtering by item name OR location, surfacing the row's location + remaining count + status. Clear button + no-match empty state. Composes with the existing Reorder-low filter.

Plus the doc updates: proposal Phase A marked BUILT; product-direction decisions from 2026-06-16 (Grant) folded into the proposal — capture is a one-person iOS-Pro lab-setup task, the 2D map + optional 3D scan are ONE layered feature (not two modes), and RoomPlan needs a *Pro* device (LiDAR), not just a recent iPhone.

## Files touched
- `frontend/src/lib/mobile-relay/inventory-snapshot.ts` — `SnapshotTrackedStock.location` + populate.
- `frontend/src/lib/mobile-relay/poll.ts` — `location` on 3 payloads + applied in `applyCreatePurchase`/`applyCreateInventory`/`applyRegisterTracker`.
- `frontend/src/lib/mobile-relay/__tests__/inventory-snapshot.test.ts` — +2 location tests.
- `mobile/lib/scan.ts` — `location` on `CreatePayload` + `RegisterTrackerPayload`.
- `mobile/app/scan.tsx` — location input + autocomplete chips in `TrackView`; `location` state + recentLocations + payload wiring + resets.
- `mobile/app/(tabs)/inventory.tsx` — location line on the row; search/lookup box.
- `mobile/lib/demo-fixtures.ts` — locations on demo stocks.

## Verification
- mobile `tsc` 0; the location read-path snapshot suite 11/11 green.
- Emulator (`emulator-5554`, demo mode) verified: location line renders on Inventory rows (DMEM "Cold room, shelf B2", FBS "-20 freezer, door rack", Trypsin "-80 door, left", Puromycin no line); the scan-in "Where did you put it?" prompt renders with working autocomplete chips (tap fills + highlights); the Inventory search filters ("-80" narrows to the one matching stock).
- **NOT yet verified: the write round-trip.** The laptop `poll.ts` create/register handlers that apply `location_text` can only be exercised by a REAL paired phone sending the action over the relay (demo mode never hits the laptop). This is the Phase A gate before calling it done — needs Grant's paired Samsung (or a dev-build iPhone). The handlers mirror the existing, tested deduct/create handlers, so confidence is high, but it is unverified on a device.

## Caveat for the next session — frontend `tsc` is currently RED for an unrelated reason
A sibling lane committed `a65f2a1fc` ("migrate smart-search to @huggingface/transformers v3") which added `@huggingface/transformers` to `frontend/package.json` but `node_modules` was never reinstalled, so `frontend/src/lib/figure/asset-embed-search.ts` fails `tsc` with TS2307 (module not found). This is NOT from spatial-inventory work — my changed frontend files (`poll.ts`, `inventory-snapshot.ts`) have zero tsc errors. Run `pnpm -C frontend install` to clear it (pnpm is pinned 10.34.3, Corepack auto-switches).

## Push state
Local `main` is well ahead of `origin/main` (was ahead 51 / behind 42 at session start; more since). The cohort's work is unpushed and origin has diverged — a merge-then-push is owed but it is a coordinator decision needing the other lanes quiesced + Grant's go-ahead. Not pushed.

## Next steps (in order)
1. **Paired-device round-trip** for Phase A writes (scan in -> set location -> laptop applies `location_text` -> re-sync shows it). The single remaining Phase A gate.
2. **Phase B** — structured locations (named place graph: Room -> Unit -> Position), the canonical `{ plan, zones, pins }` model the proposal locks as the spine.
3. **Phase C** — 2D floorplan + drag-drop pins (`react-native-svg`), laptop-authored or RoomPlan-derived.
4. **Phase D** — RoomPlan 3D capture (iOS-Pro-only, one-person lab-setup, auto-derives the 2D plan -> same pin model). See the proposal's "One feature, layered" section.

## Phase B bridge — laptop StorageMap → phone (2026-06-16)
**KEY DISCOVERY:** the laptop ALREADY ships a full structured-location system the proposal never noticed — `StorageMap` (mounted in `frontend/src/app/inventory/page.tsx:49` as a "List ⇄ Storage map" toggle): a `StorageNode` tree (room→freezer→rack→box, any depth) down to A1 box-cell placement, whole-lab shared. That IS the proposal's "Phase B (structured locations)", already built + then some. The proposal's Phase B is therefore redundant on the laptop; the real gap was that the PHONE had none of it. Grant's decision (2026-06-16): **bridge StorageMap to the phone** (not rebuild it; not jump to the spatial 2D/3D map yet).

- **Read/display half DONE + emulator-verified** (`e9c67e7f4`): the inventory snapshot resolves each stock's `location_node_id` + `position` to a readable path ("-80 #2 > Box: Q5 - A1") via `buildNodePath` over the whole-lab-shared node tree (`fetchAllStorageNodesIncludingShared`); the phone Inventory row prefers this structured path over the Phase A free-text note, and search matches both. tsc 0; snapshot tests 13/13. NOTE the snapshot builder now does a shared-inclusive storage-node walk — slightly heavier; fine at the slow publish cadence.
- **Write half (structured picker at scan-in) DONE + emulator-verified** (`45b0d624f`, Grant chose to build it): the inventory snapshot now publishes the lab's `StorageNode` tree (`SnapshotStorageNode[]`); the scan-in track/receive step shows a cascading `StorageLocationPicker` (mobile/app/scan.tsx) — drill room→freezer→...→box, then tap an A1 cell on a live 9x9 grid; the resolved path shows as a green selected summary with a clear button; free-text stays as the "or jot a quick note" fallback. Sets `location_node_id` + `position` via `locationNodeId`/`position` added to the create/register payloads (mobile + laptop), applied in `applyCreatePurchase`/`applyCreateInventory`/`applyRegisterTracker`. Emulator-verified full drill-down (-80 #2 → Rack 1 → Box → C5); tsc 0 both sides; snapshot tests 14/14. **The write ROUND-TRIP (phone action → laptop sets the fields) still needs a paired device** — same gate as the Phase A writes; the laptop apply handlers mirror the tested create/deduct paths.

## Genuinely-new spatial layer (still unbuilt)
`StorageMap` is a LOGICAL hierarchy + box grids, NOT a spatial floorplan. Grant's "2D map of the room with pins / 3D RoomPlan / click-to-see-the-actual-spot" vision (proposal Phases C/D) remains unbuilt and is the real new frontier once the bridge is settled.

## Memory
`[[project_spatial_inventory]]`, `[[project_mobile_experiment_hub]]`, `[[reference_mobile_dev_build_emulator]]`.
