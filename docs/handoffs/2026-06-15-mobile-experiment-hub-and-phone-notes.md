# MobileUI lane handoff — experiment hub + phone-notes + design research (2026-06-15)

This session (a cohort takeover after a throttled subscription) ran the **MobileUI lane** plus acted as the cohort's **relay / merge / push coordinator**. Everything below is on `origin/main` unless noted. Mobile work is emulator-verified; relay round-trips need a paired device.

## TL;DR of what shipped
The mobile **experiment hub** arc — tap an experiment, see + act on it — built and pushed end to end:
1. **Card/row taps open the method (not read mode)** + a "View method" affordance.
2. **Every Today/Overdue/Coming-up row** with a linked method is tappable (not just the experiment band).
3. **"+N more"** glance when an experiment has multiple methods.
4. **Experiment hub screen** (`app/experiment-detail.tsx`) — lists the experiment's methods, always-hub routing.
5. **Add to this experiment** — photo → Notes/Results (Phase 2a) AND text → Notes/Results (Phase 2b).
6. **Render existing Notes & Results** read-only on the hub (phone-notes P1, mobile half).

Plus a stack of **design/research docs** for the bigger questions Grant raised (spatial inventory, real-time collab).

## Commits (MobileUI, all on origin/main)
- `f8ebda4a4` — Active Experiments card opens the method (not read mode) + "View method" affordance.
- `c8f9f820b` — Today/Overdue/Coming-up rows open their linked method (`TaskRow` made tappable).
- `f78ea93e5` — "+N more" when a task has multiple methods (additive `linkedMethodCount` on the today snapshot, laptop + phone).
- `58174c774` — **experiment hub screen (Phase 1)**: `app/experiment-detail.tsx` reads the task's `linkedMethods` (new additive snapshot array) and lists them; routed from Today rows + Home band via `?taskId=`. Also fixed a real gap: the laptop now resolves EVERY attached method across active/overdue/upcoming for ANY task type (was active-experiments-only).
- `d34c81f5c` — **Phase 2a**: add a photo to an experiment's Notes/Results from the hub. New `lib/experiment-capture.ts` (`addCapture → sendCapture → postRouteCapture`), targets the experiment via numeric task id + new additive snapshot `owner` field.
- `71c9b0871` — **Phase 2b**: write a text note to Notes/Results from the hub. Reused the EXISTING `append-line` command (`lib/calc-export.ts` `postAppendLine`) — no new relay command/laptop handler needed (the laptop already appends text to the experiment's notes/results .md).
- `0d5aaf0c9` — **phone-notes P1 (read), mobile half**: render the experiment's existing notes.md/results.md on the hub. New `ExperimentNotesSnapshot` type + `'experiment-notes'` fetch kind + demo fixture; new dependency-free `components/MarkdownLite.tsx` renderer (headings/bullets/paragraphs/inline bold+code) = the seam the rich embed cards slot into later.

## Post-handoff polish (late 2026-06-15, after this doc was written — NOT pushed)
A second interactive stretch with Grant landed four small mobile fixes. These are committed to the **local shared `main`** but **not yet on `origin/main`** (the checkout is ahead of origin; see push note below). Pick-up session committed the last one, which the throttled agent had verified but left orphaned in the working tree.
- `54364923a` — Active Experiments card now shows the **project folder**; also folded in the **singular demo-fixture unit labels** (`bottle`/`vial`).
- `6dabc601c` — camera-roll button relabelled **"Bulk upload from camera roll"** (was ambiguous).
- `81651bde3` — **removed the vestigial "View method on phone" button** from the Notebook capture screen. It only did `router.push('/method-detail')` (opened the *last* laptop-published method with no which-method context) — a leftover from before the Methods tab / experiment hub / Today dropdown existed as proper contextual entry points. The `/method-detail` route stays (other paths use it).
- `2e9b86365` — **inventory unit pluralization** (`unitFor(n)` helper, "3 of 6 bottles left"). This was the orphaned half of the HMR-verified fix whose demo-fixture half had already shipped in `54364923a`; the pick-up session typechecked (tsc 0) and committed it.

**Push state at takeover:** local `main` was **ahead 51 / behind 42** of `origin/main`. The cohort's work (this lane + others) is unpushed and origin has diverged — a merge-then-push is owed but it's a **coordinator decision** (needs the other lanes quiesced + Grant's go-ahead), so the pick-up session did NOT push. Flag to Grant.

## THE design decision (read this before building more)
Grant explicitly chose a **no-Loro "pull / read / place / push phone-note embeds"** model over full real-time CRDT editing. Spec: **`docs/proposals/2026-06-15-experiment-hub-phone-notes-pull-edit-push.md`**. The model:
- Phone PULLS a notes/results snapshot, READS + scrolls, INSERTS self-contained note blocks at line boundaries; on PUSH each lands in the laptop doc as a `[!phone-note]` callout embed at that position.
- NO Loro on phone, NO WebView editor, NO live transport, NO char-merge. The **new-line / whole-block constraint** is the safety mechanism: any anchor drift is cosmetic, never corrupting.
- Sub-phases: **P1 read** (DONE mobile half) / **P2 place + push** (`insert-note-block` command = positioned `append-line` + content-anchor) / **P3 Loro-cursor precision** (laptop-only) / **P4 polish** (outbox staging, post-push refresh).

Real-time Loro collab was researched and is **DEFERRED, not the plan** (feasibility doc below).

## What's NOT built yet (next steps, in order)
1. ~~**phone-notes P1 laptop half**~~ — **DONE** (this doc predated it by ~28 min; corrected by the pick-up session 2026-06-16). `frontend/src/lib/mobile-relay/experiment-notes-snapshot.ts` builds the `experiment-notes` snapshot (resolves the per-user results base via `findExistingTaskResultsBase`, reads `notes.md` + `results.md` best-effort, seals per device, `publishSnapshot`). The publish TRIGGER rides the focused-experiment pass in `frontend/src/components/TodaySnapshotPublisher.tsx` (next to `publishMethodToAllDevices`), content-gated by `experimentNotesVersion` (djb2 hash over the markdown bodies, ignores `generatedAt`). Mobile reads it live via `fetchSnapshot('experiment-notes', …)` in `mobile/app/experiment-detail.tsx`. Committed in merge `d282af833`; tsc 0; 7/7 unit tests green (`__tests__/experiment-notes-snapshot.test.ts`). **Only remaining gate: paired-device relay round-trip (needs Grant's Samsung) — demo-mode render already verified via the P1 mobile half (`0d5aaf0c9`).**
2. **phone-notes P2** — APPEARS LARGELY BUILT after this doc (commit `bc8015a86` "phone-notes P2 — place + push note-block embeds" + `5a2e1d25b` placement-mode UX; `insert-note-block` handler in `poll.ts`, `phone-note-callout.ts` callout renderer, `note-anchor.ts`, and the place/stage/push UI already in `experiment-detail.tsx`). NOT independently re-verified by the pick-up session — confirm completeness + paired-device round-trip before calling it done. Original spec was: block-list edit UI on the hub + `insert-note-block` sealed command (positioned generalization of `append-line`; `poll.ts` handler inserts at a content-anchor, Loro insert if the editor is open / `.md` splice if closed; `clientId` idempotency) + the `[!phone-note]` callout renderer in `RenderedMarkdown`.
3. **Per-experiment method CONTENT** (carried limitation): opening a method from the hub still lands on `/method-detail` showing the LAST laptop-published method snapshot, not the tapped one. Needs a laptop-side per-experiment/per-method on-demand publish (a relay request). Same root gap the band card always had.
4. **Spatial inventory** — Grant's call (see below).

## Design / research docs produced (for Grant's review)
- **`docs/proposals/2026-06-15-spatial-inventory-where-is-it.md`** — "where do I find this item in the lab". Grounded: `InventoryStock.location_text` exists as a free-text stopgap but is never prompted on arrival + invisible to the app. Two cited research passes folded in. Verdict: 2D-floorplan-with-pins is the spine; RoomPlan 3D is iOS-LiDAR-Pro-only + free/on-device; realtor space = only CubiCasa/magicplan have real APIs but upload raw video to a cloud (privacy hit); photo auto-localization is research-grade. Phase A (wire `location_text` to app + scan-in prompt + lookup) is the cheap high-value start. NOT built — awaiting Grant's direction.
- **`docs/proposals/2026-06-15-mobile-realtime-loro-collab.md`** — real-time Loro on the phone: hard-but-doable, no showstopper. Official `loro-react-native` binding exists; editor must live in a WebView (CodeMirror is DOM-bound); transport = promote the CF Worker relay to a per-doc Durable Object WebSocket; E2E via Loro's experimental mode. ~2-4 wk. **DEFERRED** in favor of the pull/push design above.
- **`docs/proposals/2026-06-15-experiment-hub-phase2b-text-entries.md`** — superseded (append-line already existed; see commit `71c9b0871`).
- **`docs/proposals/2026-06-15-experiment-hub-phase2c-render-notes.md`** — read-only notes spec, superseded by the richer pull/edit/push spec.

## Cohort coordination this session (the relay/merge/push role)
- Merged Figure Composer branches cleanly into main + pushed: `datahub-axis-errorbar-pick` (cherry-pick, avoided a stale-merge-base that would have reverted the library work), `figure-grouped-sidebar`, and `datahub-errorbar-cap-fix` (`a35043d1d`, Grant-approved).
- **Push coordinator** for the prod deploy. **Caught (via INJEST) that prod was silently failing for hours**: adding `/library` to `NAV_ITEMS` broke the prebuild wiki-coverage gate (`tsc` does NOT catch this), fast-failing every Vercel build. Fix `bf1ab7dd5`. **Cohort rule relayed to all lanes: run `node scripts/check-wiki-coverage.mjs --ci` (or `pnpm -C frontend run prebuild`) before merging any `NAV_ITEMS` change.**
- Standing rule reinforced across the cohort: **on this single shared checkout, committing to `main` = it publishes on the next lane's push; gate-worthy/experimental work must live on a branch/worktree** (Popup Unifier's C3 escrow backend correctly stayed on `feat/identity-c3-escrow`).

## Verification rig
Emulator `emulator-5554` (AVD `ros_pixel7`), Metro on `:8081` from the main checkout, dev-client deep link `researchos://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081`. Demo mode (`pairing.demo`) shows the fixtures, so hub/methods/notes are emulator-verifiable; relay round-trips (capture/append/notes pull on a real doc) need Grant's paired Samsung. **Emulator flakiness note:** repeated deep-link relaunches can land on the launcher / trigger an ANR / blank-boot — none of it was code (no JS error logged); `adb shell am force-stop app.researchos.companion` + a single relaunch clears it.

## Memory
`[[project_mobile_experiment_hub]]` (the arc + the pivot + sub-phases), `[[project_app_store_beta_launch]]` (updated: store-URL constants removed by Billing, single launch hook = swap brand-free pill for official badges + flip `NEXT_PUBLIC_COMPANION_APP_LIVE`).
