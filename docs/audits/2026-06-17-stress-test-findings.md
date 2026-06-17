# Website stress-test findings (2026-06-17)

## MASTER RANKED LIST (interim — 7 automated domains done; 6 Chrome prompts running)

**P0 / CRITICAL:**
0. ~~**Supplies search → React "Maximum update depth exceeded" infinite loop.**~~ **REFUTED (Preview-MCP synthetic-flood artifact), 2026-06-17.** Reproduced live in demo on an isolated worktree (member + lab-head). The supplies search is a cleanly controlled input (`value`/`onChange`) whose `query` feeds only pure `useMemo` filters (`page.tsx` `visible`, `LabInventoryLens` `groups`); there is no query-keyed effect anywhere in the path. Verified clean with realistic input: single `value` set to 165/191 chars, `preview_fill` to 191 chars, and spaced incremental typing of any length all produce zero console errors and no error overlay in both views. The "freeze" appears ONLY under a tight synthetic event flood (events dispatched 1-3ms apart) that outpaces the renderer's keystroke pipeline and the CDP eval; it then recovers cleanly with no React error. It still froze with the BeakerSearch source registration fully disabled, proving it is base render throughput under flooding, not a logic loop — the same Preview-MCP deadlock class already noted for the other freeze-class findings. Hardening shipped on `main` (`a0d1e9942`): capped the search field at `maxLength=120` so a pathological paste can't refilter the list against a runaway string. Not a real app-breaker; do not treat as TOP FIX.

**REFUTED (tooling artifacts, NOT bugs):** dark-mode `.digest` SSR crash (3 agents confirm dark mode works; induced by DOM injection) · popup rapid-button "freeze" (handles fine with a real mouse) · Figure annotation "can't place" (places fine with a real mouse).

**Freeze-class — real underlying gaps, but the freezes were synthetic-JS-triggered (confirm with realistic manual input before calling P0):** Sequences 100k-base paste (validator perf) · Sequences out-of-bounds feature render · Settings 420-rapid-toggle (also corrupted active-user state) · GANTT onDrop hang. The durable bugs here = no length caps, no bounds checks, no write-serialization/debounce.

**Cross-cutting (one fix, many surfaces — highest leverage):**
1. **320px responsive breakage** — main content + inspector hidden behind the sidebar, nav gone. Confirmed Data Hub, Phylo, BeakerBot, Figure (likely every split-shell page). Chrome Prompt E checks the rest.
2. **`JsonStore.update` logs `[object Object]`** — shared store logger missing `JSON.stringify`; floods console (392+ in one session), masks real errors. Confirmed Chemistry, Phylo, Methods. Trivial fix.
3. **Layered-Escape closes the deeper layer** — Escape closes a dialog/whole-surface instead of just the top menu. Confirmed Data Hub (loses an import) + BeakerBot (closes the whole chat from the `/` menu). Shared overlay Escape-handling fix.

**P1 (confirmed, per-surface):**
4. Data Hub: large-dataset mode does not persist across navigation (reverts to editable).
5. Data Hub: rapid "Add row" → duplicate React keys (`Date.now()` collisions); fix = counter/uuid.
6. Experiments: no unsaved-changes guard when closing Lab Notes with edits (silent data loss).
7. Chemistry: empty/nameless structure saves as "Untitled structure" (no guard; dupes).
8. Chemistry: "Select all" checkbox also opens the Ketcher editor (conflicting UI state).
9. BeakerBot: clicking a stopped conversation in RECENT re-fires `/api/ai/chat` (wastes paid tokens).
10. Phylo: HPV58 (90 tips) tip labels overflow/clip at default zoom.

**P2/P3 (selected):** PubChem search not debounced (dup requests) · Literature heading shows unescaped term · serial-dilution `steps=1000` renders 1000 rows (fence off-by-one at 1001) · Figure composer + BeakerBot state not persisted across nav · system dark-mode preference ignored app-wide (likely intentional) · "Add panel" picker no outside-click dismiss · sidebar collapses to a sliver after rapid icon clicks · New Experiment accepts year 9999 / negative duration · Scientific calc shows bare `=` on non-finite (intended; UX-clarity nit).

**NEEDS REAL-MOUSE / CHROME CONFIRMATION (Prompt F):** the "renderer freeze" on rapid popup-button spam (suspected Preview-MCP tooling artifact, NOT confirmed an app bug) · Figure annotation placement (could not place via automated click) · Phylo collision-advisor "Apply" (no observable effect in Preview) · GANTT drag · canvas pan/zoom · nav reorder.

---


Adversarial QA sweep: parallel background agents drive isolated demo-mode dev servers (stress-1..4, ports 3071-3074, off origin/main at 177818c4c) via Preview MCP and try to break each feature area. Mouse-drag surfaces are deferred to Chrome-extension prompts. Severity: P0 blocker, P1 major, P2 minor, P3 polish.

Status: Wave 1 done (Data Hub). Wave 1b running (Experiments, Methods, Chemistry, Phylo). Waves 2-3 queued.

---

## Data Hub (agent: stress-1) — PIPELINE OK, 4 bugs

- **[P1] Large-dataset mode reverts to editable on navigate-away/back.** Converted a 22-row table to large-dataset mode (DuckDB), navigated to Workbench and back; table silently reverted to editable mode, convert button reappeared, DuckDB badge gone. The convert warning implies it is permanent ("cell editing is replaced by the rule builder") but the state is not persisted. Evidence: `largeDatasetBadge:false, switchBtnVisible:true, editableMode:true` after navigate-back.
- **[P1] Rapid "Add row" clicks generate duplicate React keys.** 10 rapid Add-row clicks → 288+ console errors `Encountered two children with the same key, 'row-<timestamp>'`; rows received identical timestamp-derived keys (undefined React behavior, dupe/dropped rows). Likely fix: id from a counter or crypto.randomUUID, not Date.now().
- **[P2] Escape dismisses the deeper layer.** With the Import dialog open AND the account menu open over it, Escape closed BOTH (lost the in-progress import) instead of just the top-most menu. Layered-overlay Escape should close only the top layer.
- **[P3] 320px viewport hides the main content.** At 320x700 the entire main content area (table/graph/analysis) is hidden behind the sidebar and the global nav disappears; account dropdown overflows the edge.

Verified stable (no bug): XSS in a cell (stored as text, not executed), 10k-char cell, survival/ANOVA/t-test/Grubbs/contingency on degenerate data (no NaN leakage, blank rows excluded), empty column header rejected, dark mode, big-table conversion itself (the bug is persistence, not the convert). No error boundary triggered.

---

## Wave 1b — interrupted (Claude Code process restart killed all 4 agents + their servers)

Worktrees/installs survived; relaunched. Salvaged partial lead (UNCONFIRMED, reverify):
- **[lead] Scientific calculator: `1/0` rendered as `=` (blank-ish), not `Infinity`.** Methods agent was mid-investigation when killed. Reverify on relaunch.

## Wave 1b retry — ALSO interrupted (2nd process restart, throttle-induced)

The orchestrator model (opus-4-8) was throttled, which restarted the Claude Code process and killed the agents again. Salvaged confirmed bug before loss:
- **[P2] Serial-dilution calculator: steps=1000 renders a 1000-row table with no cap or warning** (scrolls forever; needs a max-steps guard). (Lab calculators)

Refired all 4 Wave-1b agents after the throttle cleared.

---

## Experiments + TaskDetailPopup + Notes/Results editor (agent: stress-1) — PIPELINE OK, 4 bugs

- **[P0] Full renderer freeze on rapid popup control-button spam.** Opened an experiment popup, clicked all 3 header control buttons ("...", fullscreen, close) in rapid synchronous sequence (JS forEach). Page renderer froze completely; all subsequent eval/screenshot/snapshot/reload timed out; dev server stayed up; NO JS error logged. Evidence: 5 consecutive tool timeouts, `preview_eval("1+1")` timed out. (Likely a state race opening fullscreen + close together.)
- **[P1] No unsaved-changes guard when closing Lab Notes with edits.** Injected ~16k chars into the CM6 Lab Notes editor (footer showed "Unsaved changes"), clicked X to close. Popup closed with zero confirmation; edits silently lost. The close path does not check the unsaved indicator. Evidence: reopened experiment had clean original data.
- **[P2] Popup card renders transparent after a modal-cancel flow.** Opened "New Experiment" dialog, clicked Cancel, then opened an experiment popup. The card rendered with `backgroundColor: rgba(0,0,0,0)` (content bleeding over the list, unreadable) and a `pointer-events-none` wrapper. Evidence: getComputedStyle on `.ros-popup-card-shadow` = transparent.
- **[P3] New Experiment accepts year 9999 + negative duration, no validation.** `9999-12-31` start + `-999` duration accepted/persisted in the form with no inline warning (Create stayed disabled only due to empty name). Evidence: `{dateVal:"9999-12-31", durationVal:"-999"}`.

Verified stable: XSS in Lab Notes (rendered as text, 0 script tags), double-submit guard on New Experiment, empty-name guard, emoji/huge-table in CM6, rapid open/close x5.

---

## Chemistry workbench (agent: stress-3) — PIPELINE OK, 6 bugs

- **[P1] Empty/nameless structure saves as "Untitled structure", no validation.** Drew nothing, "Save to library" → created an "Untitled structure" at 0.00 g/mol. Clearing an existing molecule's name and saving silently makes a 2nd "Untitled structure" (ambiguous dupes). Missing front-end guard.
- **[P1] "Select all" checkbox ALSO opens the Ketcher editor for a random molecule.** Clicking select-all triggered both bulk-select mode AND opened the edit dialog simultaneously (conflicting UI: "5 selected / Delete" bar active while Ketcher is open). Evidence: screenshot of both states at once.
- **[P2] PubChem search not debounced.** Rapid double-click on Search fired duplicate API requests (3x cids + 3x property lookups from one attempt). No in-flight guard. (PubChem 503s seen were upstream throttling, not our bug.)
- **[P2] Literature search shows raw HTML in the result heading.** Entering `<script>...</script>` rendered the literal tag text in the "Literature for ..." heading (NOT executed — no XSS — but unescaped display). Should escape the term.
- **[P2] APP-WIDE console noise: `JsonStore.update` logs `[object Object]`.** Select-all produced 392+ `[JsonStore<projects>.update] writing ... [object Object]` warns (missing `JSON.stringify` on the logged data). Floods console, masks real errors. Not chemistry-specific — a shared store logger.
- **[P3] Literature "Find" on empty input is silently ignored** (no hint/validation).

Verified stable: Ketcher open/close cycles, RDKit identity (correct SMILES/InChIKey/MW), navigate-away mid-wasm-load (clean teardown), 400-char library filter (clean empty state), Escape dismisses PubChem popup (no soft-lock), gibberish PubChem search shows proper "No match".

---

## Phylo Tree Studio (agent: stress-4) — PIPELINE OK, 7 findings

- **[P1] HPV58 tree (90 tips) tip labels overflow + clip at default zoom**, stacked unreadably past the right edge. Collision advisor correctly fires (89 issues). Evidence: screenshot of right-edge overflow.
- **[P1] 320px viewport hides the Tree Studio canvas + all inspector tabs** (only the tree-list sidebar renders). SAME app-wide responsive gap as Data Hub.
- **[P2] Collision advisor "Apply" fix has no observable effect.** Clicked Review → Apply on "Shrink the label font" (HPV58): warning still showed 89 issues, labels visually unchanged, card did not dismiss. Either the fix silently failed OR Preview can't observe the SVG change — FLAG to the phylo lane to confirm on :3000 (Chrome).
- **[P2] "Add panel" layer picker does not dismiss on outside click** (stays open until you switch tabs).
- **[P2] Inspector sidebar collapses to a few-pixel strip after rapid icon-button clicks** (needs manual restore via ">").
- **[P3] System `prefers-color-scheme: dark` ignored** (app manages its own theme toggle — likely intentional).
- **[P3] JsonStore `[object Object]` console noise** (56 instances) — CONFIRMS the app-wide logger bug from Chemistry.
- Needs manual drag test (Preview can't): canvas pan/zoom drag, SVG/PNG download verification, CSV drag-drop onto the Data tab.

### Cross-cutting patterns (one fix, many surfaces)
- **320px responsive breakage** confirmed on Data Hub + Phylo (likely every split-shell page): main content + inspector hidden behind the sidebar, nav gone.
- **`JsonStore.update` logs `[object Object]`** confirmed on Chemistry + Phylo + Methods: shared store logger missing `JSON.stringify`, floods console.

---

## Methods library + calculators (agent: stress-2) — PIPELINE OK

- **[P3, intended] Scientific calc `1/0`/`0/0`/`1e308*10` show a bare `=`, not Infinity/NaN.** The agent traced it: `scientific.ts:104` deliberately catches non-finite results (`!Number.isFinite`) and a unit test asserts this is intentional. So NOT a bug — but the UI shows a muted `=` with NO error label, which reads as "nothing happened". UX-clarity nit: show "undefined / not finite" instead of a bare `=`.
- **[P2] Serial dilution `steps=1000` renders 1000 rows, no cap/warning.** Code-confirmed: `calculators.ts:128` fences at `> 1000`, so exactly 1000 passes and renders 1000 DOM rows; 1001 returns empty with no message. Add a visible cap + notice.
- Methods library: NO bugs — all 14 demo method types (PCR gradient, qPCR ΔΔCq, mass-spec/LC-MS, 96-well kit, coding) render correctly in read mode, no missing fields, no 404s.
- Calculators code-verified stable: Tm strips non-ACGT/lowercase/spaces, returns null <2 bases ("needs 2+ bases"), O(N) loop on 10k bases (no hang); protein calc excludes non-standard chars.

### IMPORTANT reframe of the Experiments [P0] freeze
The Methods agent ALSO froze the Preview tab (rapid nav + modal clicks) with ZERO JS errors and the dev server 200-OK throughout, and attributes it to the **Preview MCP browser context deadlocking**, not an app crash. So the Experiments "[P0] renderer freeze" is now SUSPECT as a Preview-MCP tooling artifact. ACTION: re-test the rapid-popup-button-spam in real Chrome (extension) before treating it as a real P0. Downgrade to "unconfirmed / likely tooling" until then.

---

## BeakerBot / BeakerSearch (agent: stress-3) — PIPELINE OK, 4 bugs

- **[P1] Escape in the `/` command menu dismisses the ENTIRE BeakerBot dialog** (not just the dropdown). 100% repro; Escape bubbles from the textarea to the dialog handler. Same family as the Data Hub layered-Escape bug.
- **[P1] Clicking a stopped/truncated conversation in RECENT re-triggers AI generation.** Sent "hello", stopped mid-stream, clicked it in RECENT → fired a 2nd `POST /api/ai/chat`, appended a new assistant reply with no new user message. Evidence: 2x POST in network, two assistant responses one user msg. (Wastes paid tokens.)
- **[P2] Dialog layout broken at 320px** — two panels don't collapse, chat text one-word-per-line, composer pushed below viewport (unusable on phone).
- **[P3] System dark-mode preference not honored** (manual toggle only).

Verified stable: XSS rendered as text, empty submit blocked, queue-during-stream + Discard works, Stop halts stream, @ chip add/remove, rapid Cmd+K (one dialog, no stacking), conversation persists in RECENT, no error boundaries/JS errors.

---

## Figure Composer (agent: stress-4) — PIPELINE OK, 5 findings

- **[P1] Annotation placement (Text/Arrow/Bracket) never places via programmatic click** — tool mode activates ("Click the page to place...") but clicking the artboard via every path placed nothing. NEEDS MANUAL MOUSE TEST (likely a pointer-event gap, or a real bug).
- **[P1] 320px: the figure artboard disappears entirely** (only the sidebar renders). Same app-wide responsive gap.
- **[P2] Composer state not persisted across navigation** — paper/labels/tool reset to defaults after navigate-away + back (pure in-memory store).
- **[P2] System dark-mode preference ignored** (class-based only).
- **[P3] No per-panel inspector/styling controls reachable** — clicking/right-clicking a panel never surfaces recolor/hide/resize/thickness; sidebar stays on global PAGE/ANNOTATE/CONNECT/EXPORT. (May be a known gap; the styling work was per-arc.)
- Note: the "Smart" semantic-search toggle was NOT found on the public `/open-source/icon-library` page (no MiniLM/onnx requests) — either not surfaced there or lives in an in-app panel the demo didn't reach. Worth a manual check.

Verified stable: paper-size + label-style changes, SVG export (incl rapid 3x), undo, icon keyword search (results + empty state), asset CDN loads, back/forward.

---

## Sequences editor (Chrome, Grant-run) — 3 CRITICAL + 7 more

- **[P0] Dark-mode toggle crashes SSR: `Cannot read properties of undefined (reading 'digest')`.** Avatar menu → Dark mode → blank white, then the Next.js error overlay. Full exception captured (renderToHTMLOrFlightImpl → `.digest` on undefined). This is the Next-16 undefined-throw signature (`[[reference_next16_undefined_throw_crash]]`) — a component throws `undefined`/non-Error during render. Dark mode is a GLOBAL control, so this is potentially app-wide, not Sequences-specific. Preference persists client-side (dark after reload), but the toggle's server round-trip crashes. HIGHEST PRIORITY — investigate the dark-mode toggle's SSR path for an undefined throw. NOTE: earlier Preview agents toggled dark mode without a crash, so it may be page/state-specific or intermittent — reproduce + bisect.
- **[P1] 100k-base input hard-freezes the page.** Pasting/injecting 100,000 bases into the New-sequence textarea froze the tab indefinitely (45s+ tool timeouts, never recovered). The real-time "characters removed" validator runs a synchronous O(n)/O(n^2) pass on every input event. Needs debounce + chunking or a length cap.
- **[P1] Out-of-bounds feature coords hard-freeze the render.** Adding a feature with End=99999 on a 4,733 bp sequence is accepted (BUG 3), then the SVG/canvas layout for a 99,999 bp span on a 4.7kb sequence freezes the tab (same 45s timeout signature). Two bugs chained: (a) no bounds validation on feature End, (b) the render path can't survive the out-of-range geometry.
- **[P2] Feature accepted with empty name** (Start=End=1, no validation; commits a blank zero-length feature).
- **[P2] Annotation name: no length cap, no sanitize.** A 566-char name incl `<script>alert(1)</script>` + unicode stored raw. React escapes in JSX (no XSS in-app observed) but it's a risk on GenBank export labels / tooltips / logs. Add a length cap + escape on export.
- **[P2] Degenerate IUPAC primer bases silently stripped.** In Primers → Check, `R Y W S K M B D H V N` codes are removed with only a counter ("8 removed"), no warning. Degenerate primers are common (consensus, mutagenesis); stripping them silently produces wrong Tm/GC with no signal. Should accept IUPAC codes or warn explicitly.
- **[P2] Features floating panel does not scroll** — shows only the first 3 of 18 features; wheel-scroll has no effect (overflow content unreachable).
- **[P3] New-sequence dialog renders with NO backdrop/scrim on first open in dark mode** (dialog overlaid directly on the circular map; second open is fine — z-index/compositing race).
- **[P3] Feature-count discrepancy:** sidebar header "15 features" vs bottom Features tab "18" (latter includes 3 ORF tracks); two numbers for "features", no explanation.

Verified stable: non-ACGT strip in New-sequence (works as designed, orange counter), Detect-common-features (found 10 at 100% on pEGFP-N1), rapid circular/linear/wrapped switching (no crash), rapid sequence switching (no crash). HMMER not reached (needs a selected CDS feature, not tested).

---

## DARK-MODE `.digest` CRASH — REFRAMED as a TOOLING ARTIFACT (not a real bug)

Three Chrome agents independently confirm the dark-mode toggle WORKS (Settings: "rapid dark/light switching survived without errors"; Global shell: "dark mode toggling works correctly each time"; Calendar: "dark mode toggle updated correctly"). The Global-shell agent reproduced the SAME `Cannot read properties of undefined (reading 'digest')` SSR crash from its OWN `document.body.style.cssText` DOM injection and states it was "induced by the test tooling's DOM injection, not spontaneous." So the Sequences agent's attribution to the dark-mode toggle was a MISATTRIBUTION (it had injected DOM/state first). VERDICT: the `.digest` crash comes from agents manipulating the DOM / `documentElement` class / bypassing React state, causing SSR/client divergence — NOT a user path. Downgraded from P0. (The only real residue: Next-16's error path crashes on a non-Error throw, `[[reference_next16_undefined_throw_crash]]` — known, low-priority, not user-reachable here.)

---

## Settings / Profile (Chrome, Grant-run) — many findings

- **[P1/architectural] Settings Escape + X navigate BROWSER HISTORY instead of closing.** Settings sections are URL-history entries, so Escape/X step back one section at a time; after exhausting history, Escape navigates the tab to `chrome://newtab` (exits the app). A nested dialog (Rotate key) + Escape blows past BOTH the dialog and Settings to newtab. Settings should be a modal with its own close + an internal layer stack, not browser history. (Related to the layered-Escape pattern below.)
- **[P1] Rapid-toggle freeze + STATE CORRUPTION.** 420 rapid switch writes (no delay) froze the renderer AND flipped the active user `alex → Dev` (a real local account) by corrupting the `research-os-current-user` IndexedDB key mid-write; nav tabs left all-disabled (partial write). Synthetic volume, but the un-debounced per-toggle disk write + lack of write serialization is the real issue.
- **[P2] Display name: no length cap.** 10k-char name blows out the avatar preview, overflowing the panel and pushing settings off-screen. (Researcher-profile Display name also uncapped, while Affiliation correctly caps at 200.)
- **[P2] Display name accepts RTL-override (U+202E), null bytes (U+0000), zero-width spaces — all persisted to `_user_metadata.json`** (preview shows reversed "nimdA"; null byte saved raw). Sanitize/strip control chars.
- **[P2] ORCID accepts `javascript:alert(1)` (soft warning, still saved); email-notification field accepts `...<script>...@garbage!!!` (saved raw, type=email bypassed via JS setter).** Risk if ever rendered as a link / unescaped.
- **[P2] Settings search with `<script>...`/no-match → blank panel, sidebar links cleared, NO "no results" message.**
- **[P3] `?section=ai-helper` deep-link silently falls back to Profile** (real key is `aihelper`, no hyphen).
- **[P3] AI Helper shows a version-mismatch banner every load** ("prompts from 2483b9a, app at bfd584a") — stale committed `ai-helper/*` autogen vs running build.
- Demo-blocked (noted): bio/links fields, phone/email channels, publish-profile, recovery-words confirm (need a real account).

Verified stable: XSS escaped everywhere (no exec), Affiliation 200-char cap, empty-display-name rejected, maintenance "re-run checks" double-click safe, disabled demo toggles ignore clicks, rapid theme switching fine.

## Supplies / Purchases (Chrome, Grant-run) — 1 CRITICAL + more

- **[P0/CRITICAL] Supplies search → React "Maximum update depth exceeded" infinite loop.** ~100+ chars in the "Search supplies..." input throws an uncaught setState-recursion loop (`onChange` at `src/app/supplies/...:1626`), un-dismissable error toast, all interaction dead until reload. Confirmed member + lab-head views. REAL bug with a file:line — top fix candidate.
- **[P1] Lab-head "Approve" has no double-click guard** — double-click approved TWO items in the batch (44→42). Could over-approve.
- **[P2] Container count: no upper bound** (`999999999999` accepted + persisted); the row then clips its Edit/Delete buttons off the dialog edge (no horizontal scroll).
- **[P2] XSS stored raw in Location + Funding-account fields** (escaped in JSX, but the funding value rides into the lab-head approval queue → risk on PDF/email/CSV export).
- **[P3] No unsaved-changes guard** on the Add-Stock dialog (navigate away silently discards); lot-number no length cap; negative-count validation message renders above the scroll (easy to miss).
- Note: NO CSV import exists in Supplies (the brief assumed one); no standalone Purchases nav — ordering is the Reorder-cart modal.

Verified stable: negative/below-zero counts clamped, reorder min-qty clamp, XSS no-exec, number inputs reject text, dark mode persists, rapid tab switching, reorder double-click adds once.

## Global app shell (Chrome, Grant-run) — responsive gap confirmed with DOM evidence

- **[P1] App-wide narrow-viewport breakage (DOM-confirmed).** NO responsive breakpoints on: top nav (logo 93px + right icons 311px = 404px min, no hamburger/collapse/wrap), Data Hub sidebar (352px, exceeds a 320px viewport alone), Methods sidebar (224px, no `hidden md:` fallback), GANTT toolbar (overflows < ~700px, no wrap). Sequences is the GOOD pattern (`relative hidden h-full md:flex`). Below ~450px the nav icons become unreachable. This is the cross-cutting responsive bug, now with concrete evidence.
- **[P2] "Icon Library" overflow-nav item navigates to the PUBLIC `/library` marketing site**, replacing the authenticated app shell with the marketing nav, no warning/redirect-back.
- **[P2] "More" overflow dropdown ignores Escape** (account menu + BeakerSearch both close on Escape; More doesn't — must click outside).
- BUG 7 here = the same tooling-induced `.digest` crash (DOM injection), see the reframe above.

Verified stable: back/forward spam, BeakerSearch (gibberish/256-char/XSS/arrow-nav/rapid Cmd+K), dark-mode toggling, all pages render fine at full width.

## Calendar + Notifications (Chrome, Grant-run) — silent-validation theme

- **[P1] New Event form: ALL validation failures are silent (zero feedback).** Empty title, missing end date, and end-before-start each just keep the dialog open with no message/highlight/toast/aria — the user can't tell a required-field miss from an end-before-start error. No required indicators either. (This is the cross-cutting silent-validation pattern, also in the ICS form + Settings forms.)
- **[P2] Event title no length cap** (5000 chars accepted + stored).
- **[P2] ICS "Add Calendar" silently fails for all bad URLs** (empty/huge/non-ICS) — no message, no loading state; rapid 20x submit fires NO network requests and gives no feedback (can't tell debounced vs broken).
- **[P2] Notifications bell: rapid-click permanently removes the unread badge** (count "4" → gone, never returns even after nav).
- **[P2] "Mark all read" does not update the unread count** (stays "4", no per-item state change).
- **[P3] Console: recurring 401s every ~20s** from `capture-poller` + `today-publisher` (mobile-relay, dev-only, hardcoded `ws://localhost:8787`); warnings not errors, app continues.

Verified stable: rapid view switching, extreme date nav (year 1800–2200, thousands of clicks), back/forward, XSS escaped, dark mode.

---

## Mouse + confirm-the-uncertain (Prompt F, Chrome real-mouse, Grant-run)

Resolved the three uncertain items + tested drag surfaces. Zero JS errors across all.
- **REFUTED [was suspected P0] Popup rapid-button freeze.** With a real mouse, rapid "..."/fullscreen/close spam handles cleanly, no freeze, page stays responsive. The automated freeze was a tooling artifact. NOT a bug.
- **REFUTED [was P1] Figure annotation placement.** Text/Arrow/Bracket all place correctly on a real-mouse artboard click (each shows its inspector). The automated "can't place" was a tooling artifact. NOT a bug.
- **CONFIRMED [P2] Phylo collision advisor: Apply doesn't re-run the check.** "Apply" on "Shrink the label font" DOES shrink the font (slider moves, labels smaller), but the banner still reads "89 layout issues" — the advisor never recomputes the collision count after applying. Stale count. Real bug (phylo lane).
- **[P1/P2] GANTT: drag fires but the drop hangs the page; resize handles absent; no cascade arrows.** HTML5 drag moved a bar, but onDrop put the page into a 45-60s unresponsive loading state (did not persist on reload). MAY be tooling-induced (matches the other synthetic-input hangs) — needs a calm real-user drag to confirm. Separately: task bars have NO resize handles (end-drag resize absent), and no dependency arrows / cascade were visible in the demo GANTT (possibly demo data has no deps — verify).
- **PASS** Tree pan/zoom (smooth; one note: ctrl-wheel zoom jumps ~2x/tick, coarse for trackpad pinch). **PASS** nav drag-reorder (via More > Customize tabs; persists). 

---

## FINAL COVERAGE + CALIBRATION NOTE

All 13 domains covered (7 automated Preview + 6 Chrome real-mouse). KEY CALIBRATION: many "freeze/crash" findings were **tooling artifacts** from agents injecting DOM/state via JS (the dark-mode `.digest` crash and the popup-freeze "P0" are both refuted). Treat any freeze that was triggered by synthetic JS injection (100k-base paste, OOB-feature render, 420-rapid-toggles, GANTT onDrop) as NEEDS-MANUAL-CONFIRMATION before P0 — BUT the underlying validation/perf gaps behind them (no length caps, no bounds checks, no debounce, un-serialized writes) are real regardless. The ONE solid app-breaker with a concrete root cause is the Supplies search infinite loop.








