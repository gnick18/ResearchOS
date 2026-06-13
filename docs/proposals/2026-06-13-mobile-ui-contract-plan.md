# Mobile UI Contract, scope and plan

Goal: take the ResearchOS companion app from a 4-5/10 to a 9/10 on every surface, then lock the result as the final UI design contract (HTML mockups the real app is rebuilt to match). Features are locked; this is pure refinement of look, feel, polish, and navigation.

This doc is the coverage checklist. The contract is not done until every surface below has an approved mockup. Status legend: TODO, MOCKED, APPROVED.

## Locked direction (Grant, 2026-06-13)

- BOLD REINVENTION, not just refinement. Fresh flagship design: new type scale, richer depth and motion, rethought navigation, distinctive BeakerBot moments. Keep the brand colors (sky #1AA0E6, the pastel-vs-vivid rainbow rule), everything else is on the table.
- CUSTOM TYPEFACE is on the table (propose specific options in the foundation mockup; system fonts are the fallback, not the default).
- House voice rules still apply to all copy in the mockups: no em-dashes, no emojis in UI (BeakerBot SVG is the mascot), no mid-sentence colons.

## Locked decisions log

- Navigation: 4 capability tabs (Home, Notebook, Methods, Inventory) + center ＋ Capture action + Home hub for Timers/Calc/Wiki. Floating glass pill bar, persistent on tab roots, slides away on pushed/detail screens (back chevron). APPROVED.
- Typeface: Geist (UI) + Geist Mono (all numeric data). APPROVED.
- Boldness: bold reinvention (see above).
- Foundation mockup APPROVED 2026-06-13 (docs/mockups/2026-06-13-mobile-redesign-foundation.html).
- Tab-roots batch APPROVED (01-tab-roots.html).
- Method read mode: a dedicated, designed reader for ALL 10 method types (markdown, pdf, pcr, lc_gradient, plate, cell_culture, mass_spec, compound/kit, coding_workflow, qpcr_analysis), each with its type accent color and native data rendering. In 03b-method-read-modes.html.
- Recipe checklist: optional "check off as added" ingredient documentation is a STANDARD recipe component, applied everywhere recipes appear (PCR reaction mix, LC ingredients/solvents, Buffer Recipe calculator, any future ingredient list). Real build can timestamp each check. APPROVED.

- Canvas background: FLAT, one token (`--bg`) on every standard screen (Apple/iOS systemGroupedBackground convention; premium via restraint, matches the research's token-discipline finding). No gradient/wash behind content. Depth + color come from cards, accents, the rainbow edge, elevation. Only exceptions: Annotate (dark, full-focus markup) and the PDF reader (sunken paper tray). APPROVED 2026-06-13.

Shared stylesheet: docs/mockups/mobile-contract/contract.css is the single source of truth; every contract page links it.

## NEW FEATURE: smart package scan (barcode lookup), approved 2026-06-13

Beyond pure redesign. When a package barcode is scanned, identify the item across three layers (all surfaced in 04-inventory.html: Smart match + Auto-fill screens):
1. OWN-DATA MATCH (reliable, offline, primary): match the barcode/catalog against the lab's purchase orders awaiting arrival + previously-tracked items. If matched -> suggestion card on top after scanning ("We think this is X, matches an order awaiting arrival") -> one tap "mark it arrived" / "not this".
2. ON-BARCODE PARSING (reliable, offline): parse the GS1 GTIN company prefix -> brand (GS1 GEPIR), and read the vendor catalog # when it is encoded in the symbol. These prefill as checked "barcode"-sourced fields.
3. EXTERNAL WEB LOOKUP (best-effort, online-only): query an external barcode/product DB for the product name. Weak coverage for lab reagents (consumer-retail DBs), so name comes back as an unchecked "web · guess". Needs an API key + a thin Vercel proxy (companion is offline-first; never blocks; only runs online).
On a "new item", show the Auto-fill picker: user checks which found fields (brand/catalog/GTIN reliable, name = guess) to carry into the new-item form. Grant approved ALL THREE layers including external lookup. Build: needs a proxy + API choice (evaluate UPCitemdb / Barcode Lookup / Digit-Eyes coverage + GS1 GEPIR for brand).

## Cross-lane: companion active-experiments band (from companion lane, 2026-06-13)

Grant approved a dedicated "Active experiments" band for the companion Today pull-down (separate band, not inline cards). Fold into the redesign:
- TodayPanel (and the Home hub glance) get an ACTIVE EXPERIMENTS band: purple cards showing the linked method name + "Day N of M", tapping deep-links to the method read mode (/method-detail?read=1) -> reuses the 03b readers.
- Part 1 already on main (4578ef848, frontend-only): TodaySnapshotPublisher auto-publishes the focused active-today experiment's method snapshot, so the Methods recs band populates without a manual press. Leave it.
- Part 2 HELD on branch worktree-agent-af8955a1ce87fdd9a (commit 624a0f64f), NOT merged, for me to integrate at build time:
  - today-snapshot.ts: additive OPTIONAL linkedMethodName / linkedMethodType on experiment SnapshotTasks (can merge standalone).
  - TodayPanel.tsx: the band + ExperimentCard + dayLabel.
  - snapshots.ts: take ONLY the two SnapshotTask field additions.
- BUILD CAUTION: that branch's snapshots.ts edit also deleted the recordSnapshotGeneratedAt liveness wiring by mistake. Keep our liveness wiring (import + demo-mode stamp + real-snapshot generatedAt) intact; lift only the two type fields.

## STATUS: contract complete (2026-06-13)

All 6 batches + foundation built and approved, on one locked stylesheet (contract.css). Front door: docs/mockups/mobile-contract/00-index.html.
- Foundation APPROVED · 01 Tab roots APPROVED · 02 Capture · 03 Tools · 03b Method read modes (all 10 types) · 04 Inventory deep (+ smart scan) · 05 System & popups (+ active-experiments band) · 06 Notifications & components.
- Grant reaction: "love them all".
NEXT: the real React Native rebuild, screen by screen matched to these pages, then a paired-device test pass with the companion lane. Pull the held active-experiments branch fields at build time (see cross-lane note). Smart-scan needs an external barcode API choice + Vercel proxy.

## BUILD HARNESS (proven 2026-06-13) — self-verifying visual loop, no phone photos

The old loop (build -> run -> load on phone -> photograph with a 2nd phone -> airdrop -> send) is dead. PROVEN this session: a build agent can screenshot the LIVE app on the Android emulator via `adb exec-out screencap` and read the PNG directly (I captured the current Notebook screen). So the agent self-verifies against the contract mockups with no human in the loop.

- adb lives at `~/Library/Android/sdk/platform-tools/adb`. An emulator (`emulator-5554`, sdk_gphone64_arm64) is/was running. A physical Samsung dev build is also available if USB debugging is authorized (would also appear in `adb devices`).
- Emulator > Expo web for this: full native fidelity (Skia mascot/alarm/burst, camera viewfinder UI, all modules), AND adb can drive input (`adb shell input tap`, deep-links via `am start -a VIEW -d <url>`). So we DROP the Expo-web path (no @expo/metro-runtime, no web guards needed).
- Helper: `mobile/scripts/device-shot.sh [outfile] [serial]` captures a screenshot in one command (verified working).
- The loop: emulator runs the worktree's metro dev build (Fast Refresh on edits) -> navigate (deep-link/tap) -> device-shot -> compare to the matching docs/mockups/mobile-contract/ screen -> edit RN -> re-shot until it matches.
- Containerize: each screen/area = its own background build agent in its own worktree (build in worktrees, merge when matched; never fight the shared mobile/ checkout). Native-only functional bits (push/FCM, real camera input, biometric hardware) get a final pass on the physical Samsung.

## Process

1. Deep design research (running) drives the navigation decision and the polish bar.
2. Foundation mockup first (design language plus the new navigation plus two hero screens) for sign-off, per the review-by-interactive-mockup rule.
3. Once the language is locked, mass-produce every remaining surface to it.
4. Each batch is reviewed change-by-change; only then does the real RN build start.

## Design foundation (must be defined first)

- TODO Color system (light plus dark), refined from the current sky/coral/amber tokens
- TODO Type scale and font decision (system vs a custom typeface)
- TODO Spacing and grid (8pt rhythm), corner radii, elevation/depth
- TODO Iconography rules (Ionicons consistency, sizing, weight)
- TODO Buttons: every variant, accent, size, and state (default, pressed, disabled, loading)
- TODO Inputs and form controls (text, multiline, unit selectors, toggles, chips, steppers)
- TODO Cards, list rows, section headers, pills/badges
- TODO Motion and microinteraction spec (transitions, haptics, success bursts)
- TODO Empty states, skeleton loaders, error/offline banners
- TODO The rainbow edge treatment and BeakerBot placement rules

## Navigation (the big decision, research-driven)

- TODO Primary navigation model (current = 6 bottom tabs, at the crowding limit)
- TODO Where each of the 6 current tabs lands in the new model
- TODO How the ~12 stack screens are reached
- TODO Global actions (capture, search, notifications, settings) placement

## Tab / primary screens

- TODO Notebook (capture, Today glance, inbox/outbox, pairing card, quick note)
- TODO Inventory (scan hero, tracked items, purchase orders)
- TODO Method library (offline status, search, filters, sort, recs, browse)
- TODO Calculators (Scientific, Molarity, Dilution, Serial, Buffer, lab calcs link)
- TODO Timers (running, quick-start, custom keypad, finished, alarm settings)
- TODO Wiki (search, browse by section, last-pulled)

## Stack / pushed screens

- TODO Pair (QR scan, manual entry, demo CTA, error states)
- TODO Quick note compose (paired inline and standalone)
- TODO Scan flow (scan, tracked/deduct, new package, track setup, done)
- TODO Annotate (canvas, tools, save/discard)
- TODO Notifications (list, row, states)
- TODO Settings (appearance, interaction, security, device, pairing, about, alarm)
- TODO Method detail (read-mode protocol/markdown viewer, favorite, export)
- TODO Add purchase (form)
- TODO Bulk upload (multi-photo grid, progress)
- TODO Reorder (quantity, confirm)
- TODO Custom/lab calculators (list, open, run, export)
- TODO Wiki page reader (markdown, related)

## Overlays, sheets, popups

- TODO NotebookChooser bottom sheet (recommended, list, unsorted)
- TODO NoteEntryPicker sheet
- TODO TodayPanel pull-down panel
- TODO Method download prompt sheet
- TODO Native confirm dialogs (unpair, remove all, etc.) styled equivalents
- TODO App-lock gate (biometric)
- TODO Splash / launch
- TODO Full-screen timer alarm
- TODO Success burst / capture-sent celebration

## Notifications and system surfaces

- TODO In-app notification row (read/unread)
- TODO Unread bell badge, Today badge
- TODO OS push notification copy and presentation (the content-free buzz)
- TODO Connection status cue (Live / Syncing / Last synced / Offline)

## Components inventory (the design-system page)

- TODO Button, Card, ScreenFrame, ScreenHeader, TabHeader, EmptyState, SectionHeader
- TODO Pills/badges, chips, toggles, inputs, search bar
- TODO Status dots, thumbnails, list rows, swipe actions
- TODO RainbowBar, BeakerBot/HeaderMascot placement
