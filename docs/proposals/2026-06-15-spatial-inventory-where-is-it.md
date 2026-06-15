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

## Feasibility — open-source spatial tech (research complete 2026-06-15)
Cited landscape research done. The headline reframes the plan: **the 2D floorplan + drag-drop pin model is the canonical data structure, not a mid-tier "nice to have."** Every capture method feeds that one model; 3D is a presentation enhancement for the devices that can do it; photo auto-localization is research-grade and must not be a v1 promise.

**Room capture**
- **Apple RoomPlan** is the single best 3D lever: parametric (labeled, dimensioned) USDZ output, ~cm accuracy, multi-room via StructureBuilder, and a usable **Expo wrapper already exists** (`expo-roomplan`, community-maintained — vet it). BUT it is **LiDAR-only -> iPhone/iPad Pro only** (iPhone 12 Pro+ Pro models, LiDAR iPad Pros). Base iPhones cannot run it. iOS 16+ (17+ for multi-room).
- **Android has NO RoomPlan equivalent.** ARCore Scene Semantics is outdoor-only; the Depth API gives per-frame depth (not a room model) and virtually no Android phones have LiDAR. On-device Android room modeling = a large custom build; the only real Android 3D path is cloud photogrammetry/Gaussian-splat (server step).
- **Photogrammetry (Meshroom/COLMAP) and NeRF/Gaussian Splatting** are desktop/server-GPU or cloud-training pipelines. Using them means **uploading raw lab photos to a GPU backend, which breaks our local-first + E2E model** and adds hosting cost. The phone is only a capture client. Cool, wrong primitive for "where is it" (photoreal blob, not queryable geometry).

**Photo auto-localization ("snap a pic, app finds the spot")** is the trap. The open-source SOTA (hloc: NetVLAD + SuperPoint + SuperGlue) is a research-benchmark Python/desktop-GPU stack -> server-side -> breaks E2E. The realistic on-device version is Apple `ARWorldMap` relocalization, which Apple itself flags as unreliable as space grows and **in dynamic scenes** (a lab with rearranged glassware is near worst-case), and it is iOS-only + not cleanly exposed through Expo. **Verdict: research-grade; do not promise it.** Ship a deterministic QR/shelf-code or manual-pin fallback that does the same job.

**Expo/React-Native reality**
- Expo CAN reach ARKit/RoomPlan via **dev-client + Expo Modules API + config plugin** (no "ejecting"). `expo-roomplan` wraps RoomPlan today; ViroReact (`@reactvision/react-viro`, actively maintained again) gives plane-detection/marker AR but is NOT a room modeler and does not wrap RoomPlan.
- **iOS/Android parity for room MODELING is zero** (RoomPlan iOS-Pro-only, no Android analog). Parity only exists for the 2D pin layer and basic plane AR.
- Displaying a model is easy: USDZ -> AR Quick Look (iOS); `expo-gl`+three.js or `<model-viewer>` for glTF cross-platform; `react-native-svg` for the 2D plan + pins.

**Storage / E2E**
- 2D plan + pins = KBs of JSON (plus an optional plan image) -> trivially local + E2E.
- RoomPlan parametric USDZ = hundreds KB to a few MB -> on-device-friendly, encrypt as a blob.
- Photogrammetry mesh = tens-hundreds MB; Gaussian splat = tens-hundreds MB AND cloud training -> both break E2E and are heavy to sync. Avoid for a lab-data product unless we build encryption-aware GPU infra (large undertaking).

### Feasibility tiers (mapped to the phases above)
- **Tier 1 = Phase A + B + C (ship-soon, the spine).** 2D floorplan + barcode-scan + drag-drop pin, on the canonical pin model, layered on the existing `location_text`. Cross-platform, E2E-clean, low risk. ~90% of the value at ~10% of the cost.
- **Tier 2 = Phase D, iOS-Pro/iPad only, ADDITIVE.** RoomPlan capture -> USDZ; auto-derive the 2D plan from its parametric walls so it feeds the SAME pin model; AR Quick Look / three.js viewing. Strictly additive to Tier 1; UI must say "3D scan available on LiDAR devices."
- **Tier 3 = ambitious, server-required, privacy-fraught.** Cloud photogrammetry/splat for Android 3D parity + an ARWorldMap "suggest a pin" assist (opt-in beta, never the primary locate flow). Only if Android 3D becomes a hard requirement.
- **Tier 4 = NOT realistic for a small team in 2026 (= Phase E and beyond).** Robust cross-platform on-device photo auto-localization in a feature-poor, changing lab; on-device Gaussian-splat training; a self-updating semantic map. Research-grade, multi-year.

Full cited report (with ~25 source URLs: Apple RoomPlan/WWDC, ARCore docs, Meshroom/COLMAP, hloc, ARWorldMap limits, expo-roomplan/ViroReact, react-planner, react-native-svg) is preserved in the research transcript for this session; key sources are linked inline above.

### Follow-up: realtor-space tools + AUTO 2D-floorplan generation (research 2 complete)
Grant asked specifically whether we can steal from the real-estate space or built-in OS to get an AUTO-generated floorplan (vs the user manually drawing one). Findings:

- **RoomPlan's 2D plan is essentially free.** RoomPlan's neural net literally predicts walls/openings as 2D LINES first, then lifts to 3D. So flattening `CapturedRoom` to a top-down 2D plan is a small geometry step (project each wall's transform+dimensions onto the floor), no ML on our side, **100% on-device (Apple Neural Engine), nothing to Apple's servers** — ideal for lab privacy. This is the single best auto-floorplan lever, but still **LiDAR-Pro-iPhone/iPad-only**.
- **No Android / non-Pro auto-floorplan that is both on-device and measured.** Android has no room LiDAR and ARCore has no floorplan API; AR-plane "floorplan" apps estimate (walls bow, corners distort). So cross-platform AUTO floorplan = a cloud service.
- **Realtor products — only two have real integration paths:** **CubiCasa** (real mobile SDK + Integrate/Exporter APIs; video walk-through -> CAD-grade 2D floorplan; works on ANY phone, no LiDAR) and **magicplan** (REST API around their app, RoomPlan under the hood on iOS). BUT both **upload raw walk-through video to a third-party cloud** and bill per scan — a real privacy hit for lab imagery + ongoing cost. **Matterport** (render/embed existing models only, paid), **Zillow 3D Home** (closed; only displays tours already submitted to Zillow), **Polycam** (on-device + good privacy but export-only, no embeddable API), **Canvas/RoomScan** (human service / no SDK) are NOT usable integration paths for us.
- **Open-source point-cloud -> floorplan is paper-grade** (a couple of 4-commit research repos); productizing it is a multi-month rabbit hole for one dev. Not realistic.

**Refined recommendation:** manual-draw 2D plan is the **universal spine** (works everywhere, day one, zero privacy/cost risk). Add **RoomPlan auto-capture -> flatten-to-2D as an on-device shortcut for LiDAR Pro devices** (free, private, feeds the same pin model). Hold **CubiCasa behind an explicit opt-in** as the only credible cross-platform auto-floorplan, used only if a user accepts the cloud upload (it breaks our local/E2E default, so never the default). DIY ARCore/open-source floorplan: do NOT. Sources: [Apple ML RoomPlan](https://machinelearning.apple.com/research/roomplan), [CubiCasa developers](https://www.cubi.casa/developers/), [magicplan API](https://apidocs.magicplan.app/), [Matterport dev pricing](https://support.matterport.com/hc/en-us/articles/360057506813-Matterport-Developer-Tools-Pricing-and-Availability), [Polycam floor plans](https://poly.cam/floor-plans).

## Key open questions
- Capture friction: will researchers actually record location at scan-in? (Phase A must be near-zero-tap or it dies.)
- iOS/Android parity: LiDAR room scan is iPhone-Pro-only; what is the Android story, and do we accept an asymmetric feature?
- Storage + E2E: room scans are large binaries; how do they ride our local-first, end-to-end-encrypted data model?
- Where does the value plateau — is Phase A+B+C enough, with D/E as "wow" extras?

## Recommendation (post-research)
1. **Make the 2D pin model the canonical data structure** now: `{ plan, zones, pins: {itemId, x, y, zoneLabel} }`, local + E2E. Every capture method (free-text, structured location, drawn/imported plan, and later a RoomPlan flatten) feeds this one model. This is the architectural decision that keeps us cross-platform and out of the research swamp.
2. **Build Phase A immediately** (wire the existing `location_text` to the app + scan-in prompt + lookup) — it is small, needs no 3D, and delivers the core "where do I find this / do we have it" value on every phone today. It is the on-ramp to the pin model.
3. **Phases B + C are the Tier-1 spine** (structured locations -> 2D floorplan + drag-drop pins via `react-native-svg`; author the plan on the laptop with `react-planner` or a simple SVG editor). Cross-platform, E2E-clean, low risk. This is the realistic full feature.
4. **Phase D (RoomPlan 3D) is a Tier-2 ADDITIVE enhancement for LiDAR iPhone/iPad Pro users only** — it auto-derives the 2D plan so it feeds the same pin model; everyone else uses the 2D path. Gate the UI by device capability.
5. **Photo auto-localization (Phase E) is research-grade — do NOT promise it.** Ship a deterministic QR/shelf-code or manual-pin mechanism as the real "fast placement" feature; treat any auto-localize as an iOS-only flagged experiment, never the primary flow.

Net: the ambitious "scan the room, photo finds the spot" vision is partly real (RoomPlan capture on Pro devices) and partly a multi-year research trap (cross-platform on-device auto-localization). The win is achievable now by treating 2D pins as the spine and 3D as a device-gated garnish.
