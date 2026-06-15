# Spatial Inventory — "where do I find this in the lab?"

Status: design exploration, 2026-06-15. Owner: MobileUI lane. Companion deep-research (open-source spatial-scanning landscape) launched in parallel; its findings fill the Feasibility section below.

## The idea (in one line)
Turn the inventory system from "what do we have / when to reorder" into ALSO "where is this physically in the lab", by capturing each item's location and making it lookable from the phone, ideally seamlessly at the moment a package is scanned in.

## Why it is compelling
A lab that stays current on inventory already answers "do we have this, or do I order it?". If the same records also carry location, the phone answers the question people actually ask at the bench: "where do I go to find this?" The payoff scales with how diligently the lab records locations, so the capture step has to be near-zero-friction or it will not happen.

## What exists today (grounded in the code)
- **Location field already exists, minimally.** `InventoryStock.location_text` is a free-text field, commented in code as a "v1 free-text location stopgap" (`frontend/src/lib/ai/tools/inventory-tools.ts`). The AI `add_inventory_item` tool accepts it.
- **It is never prompted on arrival.** The receive-to-inventory flow creates the stock with `location_text: null` (`frontend/src/lib/__tests__/receive-to-inventory.test.ts`) and there is no UI asking where the item went.
- **The app cannot see or set it.** The mobile inventory snapshot (`SnapshotTrackedStock` in `frontend/src/lib/mobile-relay/inventory-snapshot.ts`) does NOT include location, so the mobile Inventory tab (`mobile/app/(tabs)/inventory.tsx`) cannot show it, and the barcode scan flow (`mobile/app/scan.tsx`) never captures it.
- **Mobile inventory is a reorder view, not a full browser.** It lists *tracked stocks* (barcoded items with a units ledger) + recent purchases, centered on low-stock/"Reorder low". It is not a "show me everything in the lab" surface yet.

Net: the data model has a toe-hold (`location_text`), but it is unstructured, invisible to the app, and never captured at the natural moment (scan-in).

## Phased plan (cheapest, highest-value first)

### Phase A — make "where is it" real with what we already have (no 3D, ship-soon)
The 90%-of-value, 10%-of-cost layer. Pure data plumbing on top of the existing `location_text`.
- **Laptop:** add `location_text` to the inventory snapshot (`SnapshotTrackedStock`); on receive-to-inventory, optionally carry a location.
- **App:** (1) show each stock's location in the Inventory tab; (2) on barcode scan / receive, prompt "Where did you put this?" (free text, recent-locations autocomplete); (3) a lookup: search an item and see its location + a "do we have this?" yes/quantity/where answer; this is the seamless scan→place loop Grant described, minus any map.
- This alone delivers the "where do I find this" + "do we have it or order it" experience for any diligent lab.

### Phase B — structured locations (a named place graph)
Replace free text with a lab-defined hierarchy (e.g. Room -> Unit (freezer/shelf/cabinet) -> Position), so locations are pickable, consistent, and aggregatable ("everything in Freezer B"). Free text stays as an escape hatch.
- **Laptop:** a "Lab locations" model + manager (define the named places once).
- **App:** location picker on scan-in; browse-by-location.

### Phase C — 2D floorplan + drag-drop pins (the pragmatic spatial layer)
A top-down lab map with labeled pins. The lab draws or imports a floorplan once; placing an item = drop/drag a pin (or attach a pin to a named location from Phase B). This is likely the realistic "map" most labs actually need.

### Phase D — 3D room scan + place-on-overview (ambitious)
The "scan the room once" idea: capture a 3D model of the lab, then placing an item drops a marker on the 3D overview. Device + tooling constraints are significant (see Feasibility). Likely iOS-LiDAR-first.

### Phase E — photo auto-localization (most ambitious / research-grade)
"Take a photo of where you put it, and the app guesses the spot on the overview; user nudges if wrong." This is camera relocalization against the prior scan. Almost certainly the hardest piece and may be research-grade rather than shippable; the deep-research will give an honest verdict.

## Feasibility — open-source spatial tech (RESEARCH IN FLIGHT)
A background deep-research is investigating, with citations: ARKit RoomPlan (and its LiDAR-only device limit), ARCore Depth/Scene Semantics, open-source photogrammetry (Meshroom/COLMAP/OpenMVG), NeRF/Gaussian Splatting, photo-based localization (hloc/COLMAP), Expo/React-Native AR integration reality (the likely biggest blocker), the 2D-floorplan middle ground, scan storage size vs our local+E2E model, and honest "not realistic for a small team" calls. This section will be filled from that report, with feasibility tiers mapped to Phases C/D/E.

## Key open questions
- Capture friction: will researchers actually record location at scan-in? (Phase A must be near-zero-tap or it dies.)
- iOS/Android parity: LiDAR room scan is iPhone-Pro-only; what is the Android story, and do we accept an asymmetric feature?
- Storage + E2E: room scans are large binaries; how do they ride our local-first, end-to-end-encrypted data model?
- Where does the value plateau — is Phase A+B+C enough, with D/E as "wow" extras?

## Recommendation (pre-research)
Build Phase A regardless of how the 3D research lands — it is small, uses the existing field, and delivers the core "where do I find this / do we have it" value immediately. Treat C as the likely spatial sweet spot and D/E as research-gated stretch goals. Revisit after the feasibility report.
