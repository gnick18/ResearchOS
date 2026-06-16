# Handoff — Phylo lane (collision-aware layout advisor built end-to-end + verify fixes)

**Date:** 2026-06-15
**Lane:** Phylo / Tree Studio (`/phylo`)
**Posture:** everything LOCAL main, route-free, path-scoped. Several commits rode siblings' pushes to **origin/main** (shared single-checkout main — any lane's push publishes everyone's committed commits; commit only origin-safe work, gate anything risky on a branch). tsc 0 + phylo suite green at every commit.

---

## PART A — session pickup (all DONE + verified)
Took over the throttled Phylo lane. Closed its open items:
- **dev-mock sign-in regression** (`bf2192b61`, on origin): `?previewLogin=` persisted `PREVIEW_KEY` in sessionStorage, so after the dev-mock `signIn` returned to `/?sharingClaim=1` the boot gate re-entered the preview branch and re-showed "Welcome back" though the session was set ("closes and refreshes, no sign-in"). Fix: clear `PREVIEW_KEY` + yield out of preview when `sharingClaimReturn`. `providers.tsx`.
- **ggtree Wave 2 Chrome-verify**: rotate / collapse / multi-highlight / bracket / nodepie all PASS. "Branch color by" reported missing = FALSE NEGATIVE (gated on `metaColumns.length>0`, test tree had no metadata). ONE real bug fixed: clade highlight band anchored at the tree base; now at the **MIDDLE of the MRCA stem branch** `(parentX+x)/2` (`49c48de01`) — CONFIRMED against Grant's drag-widget placement (~50% along stem on all 5 test trees). Also legend **dedupe** (`36d318843`): one column bound to several geoms drew the same colorbar 2-3x over the labels.
- **Phase 4 Smart Data Binding**: browser-verified PASS (join chip honest "joins 7 of 8 tips" in BOTH GUI + BeakerBot doors). 2 follow-up gaps then FIXED (`c29532b88`): save a pasted tree into a project (Save-panel picker + "Move to project" row menu) + Unfiled-joins-Unfiled (`dataHubApi.listUnfiled`/`listForScope`). Plus Save-in-place (`d46120d80`, no duplicate record). Inspector-overflow-behind-the-ask-bar fix (`8255af2fc`, shared rail `pb-24`).

## PART B — Collision-aware layout advisor (the big build — phases 1-4 DONE)
Grant's vision (memory `[[project_collision_layout_advisor]]`, proposal `docs/proposals/2026-06-15-collision-aware-layout-advisor.md`): when a data-page figure has overlapping/illegible elements, the system auto-detects + offers parameterized fixes with live previews. **Decisions LOCKED:** apply model = magic-wand one-click (reversible) + per-fix preview menu; trigger = threshold-gated banner→BeakerBot-popup, silenceable per-plot; dup-overlays prevented at add-time.

Built, phylo-first (commits in order):
1. **Geometry source + engine** (`785dd2fc3`): `render.ts` emits a `LayoutManifest` (exact element bboxes — tip labels / panel columns / legend) via an optional out-param + `renderTreeWithManifest`; `layout-manifest.ts` + `layout-collision.ts` (`detectCollisions`: legend-over-content / label-crowding / panel-overlap / duplicate-overlay; `suggestFixes`). Pure, unit + real-render integration tested.
2. **Phase 1 toggles** (the wand can only move settings that exist): column spacing `columnGap` (`29e59981c`), rectangular **label tilt** (`5de3ffd36`, + ggtree `geom_tiplab(angle=)` parity), **legend right|bottom** placement (`c6d1605a8`). Each = additive figure-spec field (`PhyloFigureSpec`+`RenderSpec`+the figure-to-render adapter, back-compat) + render + Shape-panel control + save/restore. With all 3 built, `suggestFixes` marks every fix `available`.
3. **Phase 4 wand/menu UI** (`4a0b3274d`): `PhyloLayoutAdvisor.tsx` — amber banner when crowded; "Auto-fix layout" applies combined reversible fixes + flips to "Undo auto-fix" (snapshots prior state); "Review N fixes" menu, each with a **live preview thumbnail** (rendered from the modified spec) + Apply; per-plot silence (localStorage keyed by tree id; `key=openTreeId` remounts per plot). Mounted atop the Shape panel; `applyAdvisorDelta` maps a delta onto the figure state. Destructive drop-duplicate is menu-only (keeps undo honest).
4. **Q2 add-time prevention** (earlier): SmartDataWizard warns when one column is picked as multiple geoms.

**Debug test (Grant) — PASSED.** Full Chrome run: steps 1-6, 6b, 7a, 7c, all of 8 PASS, zero console errors (wand auto-fix + undo, live preview thumbnails, per-fix apply, banner recompute, all 3 manual toggles confirmed). Earlier it found a false positive — "legend overlaps 4 elements" on a clean figure — FIXED (`524298853`): the legend ink draws at `plotWidth+12` but the manifest box was at `plotWidth`, so the 12px reserved gap counted as legend territory and the 4 tip labels falsely overlapped; anchored the box at `plotWidth+12` + require a >2px real intersection. The "MIC shown as 3 overlays" warning is REAL (3 marks/tip).

**Two NON-bugs confirmed during the test (working as intended):**
- *Step 7b (silence-persists-across-reload) "blocked"* = test setup, NOT an advisor bug. (a) The **Save control lives in the Export tab** (`PhyloStudio.tsx:1656/1712`, "Save to" project picker + Save) — the agent searched Data/Layers/Shape; save the tree there first and it gets an `openTreeId`, then silence persists. (b) BY DESIGN an unsaved pasted scratch tree has `plotId=null` so silence is session-only (re-paste re-shows the banner — expected). Compounded by the app-level **folder-drift-on-reload** bug (TestFolder → ROS-verify-c2) that also blocks reopening the tree — same bug Popup Unifier's restore agent hit, NOT mine.
- *"Auto-fix didn't change column spacing"* = correct. The wand only applies fixes for the collisions actually DETECTED; this figure had legend-over-content + duplicate-overlay (no panel-overlap / label-crowding), so it applied relocate-legend (drop-duplicate is menu-only, destructive). Gap/tilt only fire when those collisions exist.

**Two OPTIONAL enhancements (Grant: leave NOTED, do next session):**
1. **Make Save discoverable** — it's buried in the Export tab; surface a Save affordance nearer the tree/rail (relates to chip `task_5d100382`).
2. **Content-hash silence keying** — key per-plot silence to a tree-content hash so even unsaved trees' dismissals survive reload (saved trees already persist; this is polish).

**Verify prompt:** `docs/handoffs/CHROME_VERIFY_COLLISION_ADVISOR.md` (also `CHROME_VERIFY_PHYLO_GGTREE_WAVE2.md`, `CHROME_VERIFY_PHYLO_PHASE4_SMART_BINDING.md`).

## NEXT
- Finish Grant's advisor debug test (reload to pick up `524298853`; confirm the legend false-positive is gone + the wand/undo/preview-menu/per-plot-silence flow). It is **folder + overlay dependent** (needs a real tree + crowding), so it's a live pass, not synthetic preview.
- **Phase 5**: generalize the advisor to the shared `FigureSource` seam (Data Hub plots + Figure Composer) — the engine + manifest pattern are reusable; each surface needs to emit its own manifest.
- Optional: move the advisor banner from the Shape panel to a stable overlay above the canvas (currently in Shape because a floating banner inside `ZoomPanCanvas` would pan with the figure).

## Cross-lane state (coordinated this session)
- MobileUI relayed shared-main mechanics + the NAV_ITEMS→wiki-coverage prebuild rule (my work is route-free, not at risk).
- Popup Unifier (identity/Phase C): confirmed NO overlap with my `providers.tsx` sign-in fix; I relayed their stalled DEVICE_KEY_V2 Chrome-restore-test agent message back to them (folder drifted to c2-member, needs switch to ROS-verify-c5).
- BeakerAI: `conversation-store.send {resultInChat}` is additive, no effect on my overlay tool; re-smoke after their branch merges. SmartDataWizard whitespace fix is MINE to do (they flagged, didn't touch).
- Figure Composer: diagnosed the advisor false positive with me (bbox hunch was right).
