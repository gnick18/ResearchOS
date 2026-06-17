# Handoff — Mobile companion polish sweep (2026-06-14)

Make EVERY companion-app screen/popup match the "Companion UI Contract" HTML renders to a 10/10 finish. One agent per FILE, hyper-scoped. 4 file-disjoint branches, orchestrator merges each when done. Full detail + resume recipe in memory `project_mobile_polish_sweep`.

## ✅ COMPLETE + SHIPPED TO MAIN + PUSHED (2026-06-14)
All 4 branches + Phase-0 primitives merged to `mobile-redesign-foundation` (was `3eec47ddd`, tsc 0), then **merged → `main` and pushed to origin** (`main` now `7b3efb7c4`, `44c924f74..7b3efb7c4`). Merge reconciled 3 conflicts where main had diverged with real mobile FEATURES foundation lacked (calc lineHeight fix — already in foundation's polish; MethodReadMode parser+figures+checklist-sync+clipping-fix+auto-collapse — fused with foundation's per-type accent polish, git auto-merged most, tsc 0; the contract-plan doc — kept foundation's newer status). No web/frontend code touched (foundation only ever changed `mobile/` + 1 doc), so main's dark-mode/color/de-yellow revamps are preserved. Fresh dev-APK build ran (`assembleDebug` BUILD SUCCESSFUL; packageDebug UP-TO-DATE because no native deps changed — all polish is JS served by Metro; 322 MB APK at `ROS-mobile-redesign/mobile/android/app/build/outputs/apk/debug/app-debug.apk`).
- **Branch B** (capture+tools): note, annotate, bulk, NotebookChooser, AnnotationOverlay, wiki, wiki/[slug], calc-custom — DONE + merged.
- **Branch C** (method read modes): MethodReadMode.tsx + method-detail.tsx (per-type accent calm reader) — DONE + merged.
- **Branch D** (inventory-deep + system + notifications): scan (8-step machine), add-purchase, reorder, pair, modal/Settings, AppLockGate+AppSplash, notifications, LabAlarm+TodayPanel+AlarmSettingsCard+SuccessBurst — DONE + merged. `app/_layout.tsx` needed NO edit (overlay mounts already correct).
- Every commit solo-per-file; all merges fast-forward + clean. Live emulator-5556 spot-checks passed (timers/home/notebook/wiki/methods/method-read-mode/inventory/scan all render the contract).
- Shared vocabulary threaded everywhere: `fonts.*` Geist tokens, sky focus-ring fields, gradient hero + GlowLine + StockBar, row-list hairline cards, section eyebrows, calm-reader, success-check states, sky/amber/danger/violet callouts, per-type method accents, category icon-chips.
- **NEXT (Grant's call, not auto):** push base / merge `mobile-redesign-foundation` → main + a fresh dev-APK build before ship.

---
### (original handoff below — historical)

## Design contract (source of truth)
`docs/mockups/mobile-contract/` (8 pages + `contract.css`); single combined file `docs/mockups/2026-06-14-companion-contract-combined.html`. **Principle (in every agent contract):** the render is the AESTHETIC target, NOT a feature spec — match polish/depth/color/type/composition exactly but PRESERVE every real app feature/state even when the render omits it; extend the design language (theme-consistent color) to app-only elements. NO new native deps mid-loop except the two below.

## DONE + merged to base `mobile-redesign-foundation` (HEAD `f1c9adf17`, NOT pushed)
- **Native rebuild (one-time):** added `expo-linear-gradient` + `expo-blur` (commit `cebf9a7b0`); rebuilt dev APK (`cd mobile/android && JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ./gradlew assembleDebug`; APK at `mobile/android/app/build/outputs/apk/debug/app-debug.apk`). Radial gradients reuse react-native-svg. Agents may use LinearGradient/BlurView only.
- **Phase 0 primitives** (`150e72804`): `components/ui/*` + `lib/design.ts` to contract; fixed clipped tab labels, Button/EmptyState/shadow tokens. Done FIRST so branches inherit + never touch primitives (collision-avoidance). RainbowBar left (brand-locked).
- **Branch A — tab roots (all 4):** Notebook (gradients/blob/green scan card), Home (TODAY/TOOLS/Wiki/Sync labels un-clipped + status/timer/recent gradients), Methods (filter chips + active-exp callout + type-colored rows), Inventory (gradient scan hero + section labels + thumb/pill).

## Saved on branches (NOT merged — resume here)
- **Branch B** `polish/B-capture-tools` (worktree `/Users/gnickles/Desktop/ROS-polish-B`, Metro :8084, emulator-5556): **Calculators (×5) + Timers DONE+committed.** Remaining 8 files: `app/annotate.tsx`, `app/note.tsx`, `app/bulk.tsx`, `app/(tabs)/wiki.tsx`, `app/wiki/[slug].tsx`, `components/NotebookChooser.tsx`, `components/AnnotationOverlay.tsx`, `app/calc-custom.tsx`.
- **Branch C** (not created) — method read modes: `components/method/MethodReadMode.tsx` + `app/method-detail.tsx` (own BOTH; 10 read-mode types dispatch from MethodReadMode).
- **Branch D** (not created) — inventory-deep + system + notifications: `app/{scan,add-purchase,reorder,pair,modal,notifications}.tsx`, `components/{AppLockGate,AppSplash,LabAlarm,TodayPanel,AlarmSettingsCard,SuccessBurst}.tsx`, + overlay mounts in `app/_layout.tsx`. (`scan.tsx` = Step state machine = 8 inventory screens; `modal.tsx` = Settings.)

## Operational must-knows (hard-won)
- **EMULATOR RECIPE — use `10.0.2.2:<metroPort>`, NOT localhost/adb-reverse (that was the flaky culprit).** Connect: `adb -s <DEV> shell am start -n app.researchos.companion/.MainActivity` then `... am start -a android.intent.action.VIEW -d "researchos://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A<PORT>"`, wait ~12s. Demo mode: if "Pair this phone" shows, `uiautomator dump /sdcard/ui.xml` + cat, tap "Pair this phone" bounds, dump, tap "Try the demo". After an edit PREFER Fast Refresh (save → keeps demo state); full relaunch loses demo. adb = `~/Library/Android/sdk/platform-tools/adb`.
- **RUN AGENTS SERIALLY** — parallel dispatch hit server-side API rate limits that killed an agent mid-run (it left a tsc-clean partial that turned out fine, but a kill could leave it broken).
- Multiple emulators: clone the AVD (`cp ~/.android/avd/ros_pixel7.ini ros_pixel7b.ini` + `cp -c -R ros_pixel7.avd ros_pixel7b.avd`, fix paths/AvdId, rm *.lock+snapshots), `install -r` the APK. 32GB RAM → 2 at a time.
- Per-branch infra: worktree off base + COW `cp -c -R` node_modules (from updated base = has the gradient/blur deps) + own Metro port. Merge base into the branch BEFORE its agents run.

## Resume steps
1. Ensure base Metro + an emulator (APK installed, demo mode) via the recipe above. 2. Finish Branch B's 8 files (serial agents; per-file contract = scope(1 file) + principle + matching contract render page + emulator recipe + report). Merge B → base. 3. Create C + D off base, do their files (serial), merge each. 4. Spot-check screencaps at branch milestones; commit per file; merge per branch. Nothing pushed to origin yet.

## Cross-lane note (Live-editor lane relay, 2026-06-14)
Desktop calm-editor arc landed on local main: **`CalmPopupShell`** (one shared popup chrome; exp+note popups migrated — transparent header on a single calm surface, title + one meta subline, ⤢ Focus / ✕ Close / ··· overflow, ambient-save footer, floating edit pill at fullscreen); docked toolbar slimmed to `Edit | Preview · + · / to insert`. This is the desktop analogue of the mobile calm-reader direction — **keep the shared vocabulary** (insert "/" + rail ↔ mobile capture/insert; quiet contextual strip ↔ read-mode receding controls). Per-type popup rollout (Purchase→Project→Molecule→…) is approved, each through a screenshot-diff render gate. **Also: app-wide font fix `7404905a7` — body was falling back to Arial, now real Geist everywhere; a rebase picks it up** (relevant if any mobile/shared font assumptions).

## Other branches from this session (separate, held for merge)
- `method-autoopen-push` (+ mobile `_layout` commit `b3d11b421` on `mobile-redesign-foundation`): "View on phone" fires a content-free push to AUTO-OPEN the focused method on the phone. tsc 0, route tests 8/8. Held off main (another lane had uncommitted blob-import WIP in `method-snapshot.ts`). See memory `project_notification_preferences`.
- `oauth-first-finish`: finished the OAuth-first login migration (made it the only entry surface, retired `NEXT_PUBLIC_OAUTH_FIRST_LOGIN` + StartScreen/EntrySnapSurface). tsc 0, Chrome-verified. See memory `project_pending_vercel_oauth_flag`.
