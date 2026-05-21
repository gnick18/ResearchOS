# Onboarding v4.0 proposal

**Status:** Design locked via master ↔ Grant brainstorm 2026-05-21 (12 AskUserQuestion rounds + voice-to-text per-page detail). Ready for manager-bot dispatch.
**Replaces:** v3 (BeakerBot-driven modal-contained walkthrough, 14 phases landed 2026-05-20). v3 in turn replaced v1 (welcome modal + tip catalog) and v2 (7-step wizard modal).
**Author:** master bot, synthesizing the brainstorm into a ready-for-implementation spec.

---

## 1. Thesis

v4 is an **in-product guided tour** where BeakerBot rides along inside the real app — a floating bottom-right overlay with a sky-blue cursor that clicks, types, and drags on the actual product surfaces — instead of a modal-contained tour that recreates flows inside a popup.

**Why v4 supersedes v3.** v3 shipped a modal-contained walkthrough that recreates tiny versions of every product flow inside the wizard modal: W1 has its own project-create form, W5 has a side-by-side preview pane, etc. This was a deliberate complexity trade-off in v3 (no need to anchor on real UI, navigate the user, or detect actions on real surfaces). After walking through v3 on real data, Grant flagged the structural ceiling: **the tour doesn't teach the product, it circumvents it.** Users finish v3 having gone through wizard-flavored flows that don't match what they'll see going forward.

v4 puts BeakerBot inside the actual app. Each step navigates the user to the real page, glow-anchors the real UI element, demonstrates the action (or waits for the user to do it), and advances on the real event firing. The user finishes v4 having done their first project / method / experiment / Gantt drag / search query **on the real product**, with muscle memory that carries forward.

**Target runtime:** ~12-15 min for the maximal lab-plus-all-conditional-features path. Solo + minimal features ~7-9 min. Longer than v3's 10-min target because v4's scope is genuinely larger (per-page deep-dives Grant locked across 12 brainstorm rounds).

---

## 2. What v4 deprecates

| Surface | Fate |
|---|---|
| `OnboardingWizardV3.tsx` (v3 modal shell + step machine) | Deleted in P9 deprecation sweep |
| v3 `setup/` step bodies (Q1-Q6 + Q1a + Q1b) | Mostly re-used, ported to v4's modal Phase 1 surface |
| v3 `walkthrough/` step bodies (W1-W14) | Replaced by v4 in-product step bodies |
| v3 `lab/` step bodies (L1-L11) | Replaced by v4's minimal lab tour (L19 lock) |
| v3 `WizardMount.tsx` (mount gate) | Replaced by v4 tour-controller provider |
| v3 `WizardResumeModal.tsx` (Resume/Restart/Discard) | Re-implemented for v4's resume contract |
| v3 `cleanup/` (Phase 4 grid) | Re-implemented with v4 artifact grouping |
| v3 `BeakerBot.tsx` 7-pose menu + easter egg | Retained as-is, reused in v4 |
| v3 `BeakerBot.module.css` (animations) | Retained as-is, reused in v4 |
| v3 `feature-picks-tabs.ts` (tab visibility helper) | Retained as-is, reused in v4 |
| v3 `_onboarding.json` v4 sidecar schema | Retained as-is (the schema is already named "v4"; no schema bump needed) |
| Existing users gate (L1/L22 invariant) | Retained |
| Settings "Re-run welcome tour" entry | Retained |

---

## 3. Design locks (24 total)

### Architecture (L1-L18)

| # | Decision | Locked value |
|---|---|---|
| **L1** | Paradigm | In-product guided tour, NOT modal-contained |
| **L2** | v3 fate | Fully replaced by v4; v3 deprecation sweep in P9 |
| **L3** | Drafting flow | Master synthesized brainstorm into proposal; no planning bot |
| **L4** | BeakerBot position | Fixed bottom-right corner; speech bubble pops up-and-to-the-left |
| **L5** | Anchor highlight | Pulsing glow ring around target + slight dim (~60%) of surrounding UI |
| **L6** | Step completion detection | Hybrid: event-listen when feasible (button click, API write success); "Done, take me to the next step" button fallback for ambiguous steps |
| **L7** | BeakerBot cursor | Sky-blue `<BeakerBotCursor />` overlay component; visible glide animation + click ripple |
| **L8** | Cursor action set | Nav clicks + button clicks + typing into inputs + drag operations (for Gantt drag-drop, etc.) |
| **L9** | Setup phase Q1-Q6 | Stays modal-contained (pure data collection, no real surface to anchor on yet) |
| **L10** | Skip patterns | Persistent "I've got it from here" link on every step + per-step "skip this step" (same as v3 L8/L9) |
| **L11** | Wrong action | Gentle redirect: BeakerBot acknowledges + re-highlights the correct target; user not blocked |
| **L12** | Step scope | Expanded vs v3 (per-page brainstorm in §6) |
| **L13** | Lab mode share semantics | REAL cross-user shares via new `shareTaskAs(actorId, ...)` admin-mode API (replaces v3's simulated shares) |
| **L14** | Resume contract | Same as v3: `wizard_resume_state` + Restart/Resume/Discard modal on mid-tour close |
| **L15** | Cleanup grid | Same as v3 Phase 4 pattern, grouped by entity type per L24 |
| **L16** | Feature coverage | Conditional on `feature_picks` (W10-W14-equivalent gating from v3) |
| **L17** | Cursor speed | Medium / realistic: ~300-500ms per glide, ~150ms click ripple, ~95ms typewriter cadence (matches existing `use-typewriter.ts`) |
| **L18** | Cursor architecture | Separate component, mounted alongside BeakerBot; reusable beyond onboarding (future power-user "watch BeakerBot do this for me" demos) |

### Lab mode (L19-L21)

| # | Decision | Locked value |
|---|---|---|
| **L19** | Lab content scope | Minimal: spawn fake BeakerBot user + real share + practice both permission types (edit + view-only). v3's L5-L10 (share-back / revoke / lab Gantt / lab purchases / lab search) NOT included — users discover those naturally post-tour. |
| **L20** | Lab tour timing | End of main walkthrough; offer now / later / dismiss prompt (same L18 lock from v3) |
| **L21** | Lab cleanup | Auto-remove fake BeakerBot user + their tasks at end of Lab tour. NOT in Phase 4 cleanup grid. |

### Behavior + UX (L22-L24)

| # | Decision | Locked value |
|---|---|---|
| **L22** | Post-tour BeakerBot | Disappears; re-summon from Settings "Re-run welcome tour." Persistent BeakerBot deferred to future arc only if AI is added to him. |
| **L23** | Tour interruption | Page-body fully interactable. Top-nav tabs DISABLED during tour (user can't accidentally navigate away). Escape via "I've got it from here" instantly re-enables all chrome. |
| **L24** | Cleanup grid grouping | By entity type: Projects / Methods / Experiments / Tasks / Settings / Conditional add-ons. Collapsible sections. Master "Start fresh" toggle nukes all groups. |

---

## 4. Architecture

### 4.1 Tour controller

New global provider: `<TourControllerProvider>` mounted at app root (or just below `<OnboardingProvider>`). Owns:

- `currentStep: TourStepId | null` — null = no tour active
- `tourMode: "modal-setup" | "in-product-walkthrough" | "lab" | "cleanup" | null`
- `interactedWithCurrentStep: boolean` — for gentle-redirect detection
- `stepCompletion: { manual: boolean; eventFired: boolean }` — hybrid detection state
- Methods: `start()`, `advance()`, `goBack()`, `skipStep()`, `exitTour()`, `pause()`, `resume()`

Replaces v3's `WizardMount.tsx` + state machine + step dispatcher.

### 4.2 BeakerBotCursor component

New `frontend/src/components/BeakerBotCursor.tsx`. Renders a fixed-position sky-blue cursor SVG with four primitives:

1. **Glide** — animates to `{x, y}` over ~300-500ms via CSS transform or framer-motion
2. **Click** — ripple animation on arrival (~150ms) + programmatically triggers the actual click on the target element
3. **Type** — moves to input → focus-click → types characters at typewriter cadence (reuses `use-typewriter.ts`)
4. **Drag** — press state at source → smooth glide to target with pressed visual → release; programmatically performs the drag operation

Exposed API: `<BeakerBotCursor controller={cursorController} />` where `cursorController` exposes `glideTo(el)`, `clickAt(el)`, `typeInto(el, text)`, `dragFromTo(srcEl, destEl)`.

Lives alongside BeakerBot (not inside) so it can be positioned anywhere on screen independent of BeakerBot's bottom-right home.

### 4.3 Anchor highlight primitive

New `frontend/src/components/TourSpotlight.tsx`. Given a target `HTMLElement`, renders:

- A pulsing glow ring positioned via `getBoundingClientRect()`
- A fixed-position dim layer at ~60% opacity covering everything except the target
- Updates on scroll, resize, or target movement via ResizeObserver + IntersectionObserver

Used by the tour controller for every step that has an anchor target.

### 4.4 Step-completion detection layer

Each step declares:

```ts
type TourStep = {
  id: string;
  speech: ReactNode;             // BeakerBot's speech bubble content
  pose: BeakerBotPose;           // BeakerBot's pose during this step
  targetSelector?: string;       // anchor element via CSS selector or data-tour-target
  cursorScript?: CursorAction[]; // pre-baked cursor actions (glide/click/type/drag)
  completion: {
    type: "event" | "manual" | "auto";
    eventListener?: (cb: () => void) => () => void; // returns unsubscribe
    autoAdvanceAfterMs?: number;
  };
  onEnter?: () => void;          // optional setup (spawn artifacts, navigate route)
  conditionalOn?: (picks: FeaturePicks) => boolean; // gating per L16
};
```

Steps register event listeners via the existing `imageEvents` / `fileEvents` / new `tourEvents` bus pattern (per project-activity precedent). Manual fallback: a "Done, take me to the next step" button BeakerBot suggests when an event isn't reliable.

### 4.5 Tour-mode UI gating

When `tourMode !== null`, the global app shell:

- Disables top-nav tabs (visually grayed, onClick suppressed)
- Page-body remains fully interactable
- The "I've got it from here" link always visible in BeakerBot's speech bubble corner
- Per-step "skip this step" link in the speech bubble too

Top-nav disable implemented via `AppShell.tsx` reading `tourMode` from controller + conditionally rendering disabled state on the nav-item buttons. BeakerBot's cursor can programmatically click disabled tabs (bypass via direct route navigation, not via DOM click event).

---

## 5. Phase plan

| Phase | Effort | Scope | Notes |
|---|---|---|---|
| **P0** | 2-3 days | `shareTaskAs(actorId, taskId, recipient, permission)` admin-mode API in `sharingApi`. Real cross-user shares without requiring current-user-as-sender. Underpins L13. Hold merge for master verify (API surface change). | Was post-v3 bookmark #16 |
| **P1** | 3-4 days | Tour controller infrastructure: `<TourControllerProvider>`, step state machine, `tour-mode` flag in app store, top-nav disabling in `AppShell.tsx`. UI-merge-on-report. | Foundation phase |
| **P2** | 2-3 days | `<BeakerBotCursor />` component with all four cursor primitives (glide / click / type / drag). UI-only; merge on report. | Reusable beyond onboarding |
| **P3** | 2 days | `<TourSpotlight />` anchor-highlight primitive. Pulsing glow + dim layer + scroll/resize tracking. UI-only. | Reusable |
| **P4** | 1-2 days | Setup phase Phase 1 port from v3 — Q1-Q6 + Q1a + Q1b modal step bodies re-mounted under the v4 tour controller. Mostly reuse + light glue. | Reuses v3 work |
| **P5** | 6-8 days | Universal walkthrough Phase 2 step bodies (steps 1-14 from §6). Heaviest phase. Touches every product surface. | The bulk of the arc |
| **P6** | 3-4 days | Conditional walkthroughs: Telegram (with branching) + Purchases + Calendar. Gated on `feature_picks`. | |
| **P7** | 2-3 days | Lab mode tour (L19 minimal scope) using P0's `shareTaskAs`. Spawn fake user + real share + permission practice. Auto-cleanup at end. | Depends on P0 + P5 |
| **P8** | 2 days | Phase 4 cleanup grid with grouped-by-entity-type display (L24). Tracks v4's larger artifact set. | UI-only |
| **P9** | 1 day | v3 deprecation sweep: delete `OnboardingWizardV3.tsx`, v3 step bodies, `WizardMount.tsx`, `WizardResumeModal.tsx`, v3 `cleanup/` step bodies. Verify nothing imports them. | XS effort |
| **P10** | XS | Wiki rewrite — relay draft to wiki manager. Documents v4 in `/wiki/getting-started/welcome-wizard` (overwrite v3's page). | Handoff only |
| **P11** | 1 day | BeakerBot post-tour cleanup; Settings "Re-run welcome tour" reconnects to v4 controller. | Per L22 |
| **P12** | 2-3 days | Resume contract for v4: `wizard_resume_state` extended with current cursor position + active spotlight target so Resume restores mid-step accurately. Restart/Resume/Discard modal re-implemented. Hold merge for master verify (data-shape adjacent). | Per L14 |
| **P13** | 1-2 days | Polish: animation timing tuning, reduced-motion fallbacks across all four cursor primitives, accessibility audit (screen-reader narration of BeakerBot speech), edge-case smoke. | Final polish |

**Estimated total:** ~30-40 person-days. ~3-4 weeks at one manager dispatching chips sequentially. Some parallelism possible: P2 + P3 + P0 are independent; could fire in parallel after P1 lands.

---

## 6. Per-page tour content (Phase 2 detail)

Setup Phase 1 (modal): same as v3 — Welcome + Q1 solo-or-lab + (if lab) Q1a storage + Q1b connect info + Q2-Q6 feature picks. No changes.

Phase 2 walkthrough fires in this sequence (conditional steps gated per L16):

### 6.1 Home page + first project

**Speech:** "Let's make your first project. Click the blue plus button up there to get started."

**Cursor script:** Glide to the "+" New Project button (upper-right of home page). Click ripple. The real "New Project" modal opens.

**User action:** Fills name (BeakerBot can pre-type a placeholder via cursor if user prefers demo-mode; or stays hands-off and user types). Clicks Create.

**Completion:** API event `projectsApi.create` success → advance.

**Artifact:** `project` (the new project, cleanup_default: keep).

### 6.2 Project route Overview prose demo

**Speech:** "I'm taking us into your project. Watch — I'll type a hypothesis sentence into the Overview."

**Cursor script:** Navigate to `/workbench/projects/<id>` (auto-nav via cursor click on the project card on home page). Glide to the Overview textarea. Click to focus. Type a placeholder hypothesis sentence (~30 chars).

**Completion:** Auto-advance after typing finishes (autoAdvanceAfterMs: 1500).

**Artifact:** `overview_prose` (the typed content, cleanup_default: discard since it's placeholder).

### 6.3 Notifications (universal UI moment)

Fires right after Home + Project Overview — Grant's call: teach notifications as a universal element before drilling into specific tabs.

**Speech:** "Quick universal: notifications. I'm firing a test one now — see the bell badge?"

**Cursor script:** None (notification fires programmatically). Cursor glides to the bell icon, clicks it. Panel opens. Cursor points at the test notification + the dismiss affordance.

**Completion:** Manual "Got it" button (no specific user action required).

**Artifact:** None (test notification is transient).

### 6.4 Methods page

The biggest expansion vs v3. Grant locked: first category creation + breadth-of-method-types tour + BeakerBot creates a funny markdown method.

**6.4a — Category creation.** Navigate to `/methods`. Cursor demos the folder-tree affordance to create a first category. Type a placeholder name. Save.

**6.4b — Method type breadth.** Cursor clicks "+ New Method." Type picker modal opens. Cursor briefly hovers over the structured method types (PCR, LC Gradient, Plate, Cell Culture, Mass Spec, qPCR, Sequencing, Coding, Compound). Briefly clicks into PCR + LC Gradient builders to show they're interactive editable graphics (per Grant: "show them, like, oh, it's an edible graphic"). Doesn't fill them in; just demonstrates that the structured editors exist.

**6.4c — Compound method explanation.** Cursor briefly opens a Compound method (the bundling primitive). Speech: "Sometimes you want a kit — a method that combines a blank plate layout with a downstream protocol. You build it once, reuse it across experiments. Just FYI."

**6.4d — BeakerBot creates a funny markdown method.** Cursor goes back to picker, clicks Standard Markdown. Form opens. Cursor types a tongue-in-cheek method body (placeholder funny content TBD in P5 — "BeakerBot's Patent-Pending Coffee Brewing Protocol" or similar; should be obviously-not-real). Saves.

**Completion:** API event `methodsApi.create` success → advance.

**Artifact:** `method` (the new method) + `category` (the new category).

### 6.5 Workbench experiment creation

**Speech:** "Now let's make an experiment that uses that method."

**Cursor script:** Auto-navigate to `/workbench`. Glide to "New Experiment" (or equivalent task-creation affordance). Click. Form opens. Cursor types placeholder name. Saves.

**Completion:** API event `tasksApi.create` success → advance.

**Artifact:** `experiment` (the new task).

### 6.6 Method attachment + variation notes + snapshot teach

Critical mental-model teaching moment per Grant's voice-to-text.

**Speech:** "Open your experiment. See that Methods tab? You attach methods there. I'm doing it now."

**Cursor script:** Cursor clicks the experiment to open its detail popup. Clicks the Methods tab inside the popup. Clicks "Attach Method." Method picker opens. Cursor scrolls to + clicks the method just created. Attached.

**Then variation note demo.** Cursor clicks the variation-notes field on the attachment. Types a placeholder note ("this experiment uses 30°C instead of 25°C").

**Speech (the mental model):** "Important: when you edit a method from inside an experiment, you're editing this experiment's COPY. The original method stays untouched. So you can tweak per-experiment without worrying about overriding the master."

**Completion:** Auto-advance after variation note types out.

**Artifact:** `method_attachment` (the attachment with variation note).

### 6.7 Hybrid editor — shortcuts + paragraph chunks + image drops

Expanded vs v3 W5 per Grant's voice-to-text.

**Speech:** "Quick fact: ResearchOS runs on markdown. Notes, methods, results, task descriptions, the whole shebang. These keyboard shortcuts work in every markdown editor on the site."

**Cursor script (shortcuts demo):** Cursor opens the experiment's Notes tab (real hybrid editor). Types into the editor demonstrating each shortcut: bold (Cmd+B), italic (Cmd+I), code block (triple-backtick + python), block quote (>), heading 2 (##). User sees real Hybrid/Preview toggle work.

**Cursor script (paragraph chunks demo):** Cursor hits Enter twice to start a new paragraph chunk. Speech: "These paragraph chunks are unique to ResearchOS — each one is a separate editable block."

**Cursor script (selfie image drop):** Cursor moves to the image-strip below the editor. BeakerBot's selfie image (committed asset `public/onboarding/beakerbot-selfie.png`) auto-appears in the strip. Cursor drags the image from the strip into the markdown editor. Image embeds.

**Cursor script (resize demo):** Cursor hovers the embedded image; resize handle appears. Cursor drags the corner to resize. Speech: "You can resize images inline — useful when a gel image is huge."

**Speech (mental model):** "One more thing: notes-tab images and results-tab images are stored separately even though they're both linked to the same experiment. Notes are your working scratch; results are the published output."

**Completion:** Manual "Got it, next" button.

**Artifact:** `notes_content` (the experiment's notes with shortcuts demo + image) + `notes_image` (the selfie image attached).

### 6.8 Gantt page

Big segment per Grant's voice-to-text. Multiple sub-demos.

**Speech (task types intro):** "Gantt time. Three task types: experiments, lists, and projects. You just made an experiment; let me show you the timeline."

**Cursor script (alt-creation peek):** Cursor briefly demonstrates double-clicking a day on the timeline → new-task affordance appears. Then cursor clicks the "+ Task" blue button. Affordance closes. Speech: "Two ways to make tasks here — you already made yours on the Workbench."

**Cursor script (drag-drop demo):** Cursor moves to the experiment's bar on the timeline. Drag from current position to a different date. Bar moves. Date updates. Then cursor grabs the right edge of the bar and drags right to resize duration.

**Cursor script (chained dependencies demo):** BeakerBot programmatically creates 3 placeholder tasks ("Demo A," "Demo B," "Demo C") that appear in the Gantt. Speech: "Quick demo — I made three throwaway tasks. Watch how dependencies work." Cursor drags Demo A onto Demo B, then Demo B onto Demo C. Dependency chain forms. Cursor drags Demo A's bar; B and C shift with it. Speech: "Chains move as a unit when you reschedule. Useful for protocol stages."

**Speech (goals overview):** "Goals visualize over the Gantt. You can keep them personal (just you) or share with the lab (everyone sees them). Personal goals are private to your account; lab-wide goals appear for every lab member."

**Cursor script (conditional Q4 = yes goals demo):** Cursor creates a placeholder personal goal spanning a few days. Goal overlay appears on the Gantt.

**Completion:** Optional "try it" invitation per L locked earlier — user can drag a task themselves or skip and advance.

**Artifacts:** 3 `demo_dep_task` artifacts (chain demo, cleanup_default: discard) + 1 `goal` (conditional, cleanup_default: keep).

### 6.9 Animation picker (on Gantt page)

Per Grant: animation picker is on the Gantt's Toolbar too, so demo it without navigating.

**Speech:** "Quick personal touch — pick an animation theme that fires when you complete experiments."

**Cursor script:** Cursor moves to the Toolbar's animation icon. Click. Animation picker popup opens. Cursor clicks a theme (suggest BeakerBot's "default" pick depends on user pref; default to "celebration"). Animation preview fires (same UX as v3 W6's fix).

**Completion:** Auto-advance after picker close.

**Artifact:** `settings_change` (animationType from→to).

### 6.10 Settings page — color picker + "more here" + AI Helper deep-explain

Navigate to Settings post-Gantt.

**Speech:** "Now let's pick your color. Watch the chrome shift live."

**Cursor script:** Auto-navigate to `/settings`. Cursor moves to the color swatches. Picks one. Header tint flows immediately.

**Speech (more options mention):** "By the way, there's a lot more you can change in Settings — explore later. For now, let me scroll down to one more thing..."

**Cursor script:** Cursor scrolls page down to the AI Helper section.

**Speech (AI Helper deep-explain, conditional Q6 = yes):** "This is the AI Helper. Three prompt sizes — Full, Medium, Minimal. Big context for big models like Claude, ChatGPT, or Gemini. Two use cases worth knowing: (1) Paste a prompt into your favorite AI chat — now you've got a ResearchOS-fluent agent you can ask questions to. (2) More interesting: agentic models with access to your data folder can WRITE your lab notebook with you. You give them a prompt + read access to your folder; they help you draft entries, build new methods, fill in experiment notes. It's like having a research collaborator that knows your codebase."

**Cursor script (AI Helper):** Cursor points at the three prompt-size tabs (Full / Medium / Minimal) and briefly clicks each to show the size diff. Optionally clicks "Copy prompt" + toast appears.

**Completion:** Manual "Got it, next" button.

**Artifact:** `settings_change` (color from→to) + `ai_helper_prompt_copied` (conditional, if user clicks copy).

### 6.11 Search

**Speech:** "Quick one. Search across everything — experiments, methods, tasks, results."

**Cursor script:** Auto-navigate to `/search`. Cursor moves to search bar. Types a query matching the experiment ("demo" or the experiment's name). Results appear. Cursor briefly highlights a filter chip or two (project / date / status).

**Speech (acknowledgment):** "Your account's pretty empty so the demo's small — try this again after you've got real experiments."

**Completion:** Auto-advance after search query types out + results render.

**Artifact:** None (search is transient).

### 6.12 Wiki pointer (brief)

**Speech:** "If you ever get stuck, the Wiki tab has guides. I'll show you where it is."

**Cursor script:** Cursor clicks Wiki tab. Landing page loads. Cursor scrolls once. Speech: "OK, back to your work."

**Completion:** Auto-advance after wiki page renders.

**Artifact:** None.

### 6.13 Telegram (conditional Q5 = yes), with branching

Grant locked a branched flow: BeakerBot ASKS the user whether they have Telegram installed.

**Speech (initial):** "I see you wanted the Telegram bot. Quick question first: do you have Telegram installed on your phone right now?"

**Branch A — Yes + want to set up now:**
- Cursor opens pairing modal. Pair flow same as today. After pair success: cursor moves to user's phone (well, BeakerBot says "send me a photo from Telegram now"). Test image arrives in inbox. Cursor drags the image into the experiment's notes editor (built earlier).

**Branch B — Yes + later:**
- Speech: "No problem, I'll let you set it up later. Skipping for now."

**Branch C — No Telegram on phone:**
- Speech: "No problem — let me show you what it WOULD look like."
- BeakerBot programmatically injects a synthetic image into the inbox. The synthetic image is a SECOND funny BeakerBot image (different from the selfie used in 6.7 — committed asset `public/onboarding/beakerbot-telegram-silly.png`).
- Cursor opens the inbox, points at the injected image, demonstrates the caption + metadata flow, then drags the image into the experiment's notes.

**Completion:** Auto-advance based on branch.

**Artifact:** `telegram_pair` (if Branch A) OR `telegram_synthetic_image` (if Branch C) — both cleanup_default: discard.

### 6.14 Purchases (conditional Q2 = yes)

Per Grant: BeakerBot creates a funding string + funny purchase, all via cursor demo. Funny purchase ITEM stays through cleanup for use in Lab Mode tour.

**Speech:** "You wanted the Purchases tab. Let me show you how it works — I'll make us a funding source and a sample purchase."

**Cursor script:** Auto-navigate to `/purchases`. Cursor clicks "New Funding String" (or equivalent). Cursor types placeholder funding string name + amount (e.g., "BeakerBot's allowance," $1000). Save.

**Cursor script (purchase order):** Cursor clicks "New Purchase." Form opens. Cursor types in a funny placeholder item (e.g., "12-well Plates Of Premium Hand-Painted Quality," vendor "BeakerBot's Boutique," $42.00, qty 1). Cursor clicks the funding string dropdown, picks the just-made one. Saves.

**Completion:** Auto-advance after purchase saves.

**Artifact:** `funding_string` (cleanup_default: keep — useful) + `purchase` (cleanup_default: keep through main tour; if Q1=lab, reappears in Lab Mode tour's lab purchases view; final fate determined by user at cleanup grid).

### 6.15 Calendar (conditional Q3 = yes)

Per Grant: high-level explanation only. No real subscribe (would require user to fetch ICS URLs they don't have ready).

**Speech:** "Calendar tab's optional. You can add events directly, or link external calendars — Outlook, Apple, Google iCloud — in read-only mode. ResearchOS shows your external events alongside your experiments + tasks. When you want, set it up in Settings."

**Cursor script:** Cursor briefly navigates to `/calendar`, shows the month view. Done.

**Completion:** Auto-advance.

**Artifact:** None.

### 6.16 Lab mode tour (Q1 = lab, end of main tour)

Per L20: BeakerBot asks now / later / dismiss.

**Speech:** "Bonus round: Lab Mode tour. Want to see how collaboration works? Now / Later / Dismiss."

**If "now":** Lab tour fires per L19 minimal scope:

**6.16a — Spawn fake BeakerBot user + real shares.** Programmatically create the BeakerBot user (sky avatar, `is_tutorial: true` flag). Via new `shareTaskAs` API, BeakerBot user shares 2 placeholder experiments with the real user: one with edit permission, one with view-only permission. Tasks appear in real Workbench / Gantt.

**Speech:** "Meet BeakerBot the lab member. They just shared two experiments with you — one you can edit, one is view-only."

**6.16b — Permission practice.** Cursor opens the edit-permission experiment. Cursor tries to edit content; succeeds. Speech: "Edit access lets you change anything."

Cursor opens the view-only experiment. Cursor tries to delete it. Red lock indicator fires + delete blocked. Speech: "View-only locks the task — you can read but not edit or delete."

**Completion:** Manual "Got it" button.

**6.16c — Auto-cleanup.** After main tour ends (or user dismisses lab tour), BeakerBot user + their shared tasks are programmatically removed (no Phase 4 cleanup grid entry per L21).

**If "later":** `lab_tour_pending: true` written. Snooze prompt fires on first natural `/lab` navigation. User can re-pick now / later / dismiss there.

**If "dismiss":** `lab_tour_dismissed_at: timestamp` written. Never auto-fires again. Settings re-run is the only entry.

### 6.17 Phase 4 — cleanup grid

Final screen. Lists every artifact the tour created, grouped per L24:

- **Projects** (1 entry — the first project)
- **Methods** (2 entries — category + funny markdown method)
- **Experiments** (1 entry — the experiment with attached method)
- **Tasks** (3 entries — chained dependency demo tasks, cleanup_default: discard)
- **Settings changes** (2 entries — color + animation)
- **Conditional add-ons** (variable: variation note, notes content + selfie, goal, telegram pair/synthetic, funding string, purchase order)

Default: each entry's `cleanup_default` per its definition. Master "Start fresh" toggle unchecks everything + confirm modal. Finish writes `wizard_completed_at` (or `wizard_skipped_at` if entered via "I've got it from here") and exits the tour.

---

## 7. Assets committed in P5

| Asset | Purpose | Location |
|---|---|---|
| `beakerbot-selfie.png` | Hybrid editor image drop demo (§6.7) | `public/onboarding/beakerbot-selfie.png` |
| `beakerbot-telegram-silly.png` | Synthetic Telegram image (§6.13 Branch C) | `public/onboarding/beakerbot-telegram-silly.png` |

Both should be ~100-200px PNGs of BeakerBot in different silly poses. Created during P5 (or earlier, in a parallel asset chip).

---

## 8. Behavior contracts

### 8.1 Resume contract (per L14)

Same shape as v3:

```ts
wizard_resume_state: {
  current_step: string;
  skipped_steps: string[];
  artifacts_created: WizardArtifact[];
  // v4 additions:
  active_spotlight_target?: string;  // CSS selector to restore highlight
  active_cursor_position?: { x: number; y: number };  // last known cursor pos
} | null
```

On tab close: state persists. On next open: Restart/Resume/Discard modal (same component as v3, re-implemented in P12 to read v4's state shape).

### 8.2 Gentle redirect (per L11)

Each step has a `targetSelector` declaring its expected interaction target. The tour controller listens for clicks anywhere on the page body during a step. If a click lands OUTSIDE the target:

- BeakerBot speech bubble updates: "Hmm, almost — try this one instead."
- Spotlight pulses slightly more strongly for 2 seconds to redraw attention.
- No blocking; user can ignore and the tour patiently waits.

### 8.3 Skip patterns (per L10)

- **"I've got it from here"** persistent link in speech bubble corner. Always visible during tour. Click → confirm modal → jumps to Phase 4 cleanup grid.
- **"Skip this step"** per-step link. If skipped step's artifact is needed downstream, tour controller programmatically creates a placeholder per the v3 auto-prerequisite pattern.

### 8.4 Wrong-action examples

| Step | Right action | Wrong action handling |
|---|---|---|
| §6.1 Home + project create | Click "+" New Project button | User clicks a different button → "Try the blue plus button up there" + re-pulse |
| §6.4 Methods page | Click "+ New Method" | User clicks an existing method → "Almost — let's make a fresh one; click the + button" |
| §6.8 Gantt drag | Drag the task bar | User clicks a tab → tab disabled, no nav happens, BeakerBot speech: "Stay here for one more sec, want to show you the drag" |

---

## 9. Migration + deprecation

- **In-flight v3 users at v4 ship time:** finish v3 (their state machine completes; no automatic migration to v4). After v3 completes, all future re-runs use v4.
- **New users post-v4 ship:** get v4 (modal Phase 1 + in-product Phase 2+).
- **Existing users with `wizard_completed_at`:** nothing changes (L1/L22 invariant retained).
- **Anyone re-running from Settings post-v4 ship:** gets v4.
- **v3 source code:** deleted in P9 deprecation sweep. Verify no production imports before deletion.

---

## 10. Data model

v4 reuses v3's "v4" sidecar schema (the v3-introduced `_onboarding.json` schema already named v4) with minor additions:

```ts
// Reused as-is from v3 v4 sidecar:
feature_picks: FeaturePicks | null;
wizard_completed_at: string | null;
wizard_skipped_at: string | null;
wizard_force_show: boolean;
lab_tour_pending: boolean;
lab_tour_dismissed_at: string | null;

// Reused with minor additions:
wizard_resume_state: {
  current_step: string;
  skipped_steps: string[];
  artifacts_created: WizardArtifact[];
  // v4 additions (optional, defaults backward-compat):
  active_spotlight_target?: string;
  active_cursor_position?: { x: number; y: number };
} | null;

// No schema_version bump needed — additive optional fields are backward-compat.
```

---

## 11. Phase plan summary table

| Phase | Effort | Description | Merge timing |
|---|---|---|---|
| P0 | 2-3d | shareTaskAs API | Master verify (data-shape) |
| P1 | 3-4d | Tour controller infra | Merge on report |
| P2 | 2-3d | BeakerBotCursor | Merge on report |
| P3 | 2d | TourSpotlight | Merge on report |
| P4 | 1-2d | Setup Phase 1 port | Merge on report |
| P5 | 6-8d | Universal walkthrough | Merge on smoke |
| P6 | 3-4d | Conditional walkthroughs | Merge on smoke |
| P7 | 2-3d | Lab mode tour | Merge on smoke |
| P8 | 2d | Cleanup grid | Merge on report |
| P9 | 1d | v3 deprecation sweep | Merge on report |
| P10 | XS | Wiki relay | Handoff |
| P11 | 1d | Post-tour cleanup + Settings | Merge on report |
| P12 | 2-3d | Resume contract for v4 | Master verify (data-shape) |
| P13 | 1-2d | Polish | Merge on report |

**Total:** ~30-40 person-days, ~3-4 weeks at sustained dispatch cadence.

---

## 12. Open questions for implementation manager

These were locked by Grant but warrant manager re-read before P5 dispatches:

1. **Funny markdown method content (§6.4d):** What specifically does BeakerBot type? Suggest TBD until P5 — manager picks something tongue-in-cheek that's obviously not real lab work (BeakerBot's coffee brewing? Cat hair extraction protocol?).
2. **Demo dependency-chain task names (§6.8):** "Demo A / B / C" or something funnier (BeakerBot-themed)?
3. **Cursor-script JSON shape:** Should cursor actions be declarative (`{type: "click", target: "[data-tour-target='new-project']"}`) or imperative (function callbacks)? Manager's design call in P1.
4. **Top-nav disable during tour (L23):** Implement via inline style on each nav-item or via global CSS class on `<AppShell>`? Manager picks based on existing AppShell patterns.

---

## 13. Acknowledgment + handoff

This proposal is ready for an Onboarding v4 manager to absorb as their role brief. Manager should:

1. Create `ONBOARDING_V4_MANAGER_ROLE_BRIEF.md` modeled on v3's brief, with this proposal cited as canonical spec
2. Append an AGENTS.md §8 "Active bot branches (in flight)" entry once they start
3. Dispatch P0 first (shareTaskAs API, data-shape) — hold merge until master verifies
4. Surface any unlocked design call to master via AskUserQuestion before the dependent chip fires (per the brief-flagged-design-questions memory rule)

Signed: **master bot**, 2026-05-21
