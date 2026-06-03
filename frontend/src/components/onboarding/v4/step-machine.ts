/**
 * Pure step-ordering + conditional-gating logic for the Onboarding v4
 * tour controller. No React imports, no I/O, no side effects — fully
 * vitest-able and re-usable from dev tools / debug consoles.
 *
 * Sourced from ONBOARDING_V4_PROPOSAL.md §6 (Phase 2 walkthrough steps)
 * + L16 (conditional gating on `feature_picks`) + L19/L20 (lab tour
 * minimal scope).
 *
 * P1 only owns the step ORDER + gates; step BODIES (real speech /
 * cursorScripts / completion contracts) land in P4 (setup port), P5
 * (universal walkthrough), P6 (conditional walkthroughs), P7 (lab).
 * The machine treats every id as an opaque label and trusts the renderer
 * (TourController.tsx) to draw a placeholder card when the body is still
 * unimplemented.
 */
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import type { TourStepId } from "./step-types";

/**
 * Canonical forward order for the v4 tour. The machine walks this list
 * and filters out gated steps via `isStepGatedOut`. New steps added in
 * P5-P7 must be inserted here at the correct logical position so the
 * forward / backward traversal stays consistent.
 *
 * Grouped (for readability — readers shouldn't depend on the boundaries,
 * use `isSetupPhaseStep` / `isWalkthroughPhaseStep` etc. instead):
 *
 *   Phase 1 — modal setup     : "welcome" + Q1 + Q2-Q6
 *   Phase 2 — in-product tour : home → project → notifications →
 *                               methods → workbench → hybrid editor →
 *                               gantt → settings → search → wiki
 *   Phase 2b — conditional    : telegram / purchases / calendar
 *   Phase 2c — lab tour       : prompt → spawn fake user → permission
 *                               practice
 *   Terminal — goodbye outro  : "tour-goodbye" (auto-cleanup + animation;
 *                               replaces the retired "phase4-cleanup"
 *                               grid per the Cleanup retirement
 *                               2026-05-22).
 *
 * Order matches the proposal §6 sub-sections (6.1 → 6.17). The
 * personalization steps (color + animation + ai-helper) cluster onto
 * the Settings page deep-dive per §6.10. The "More in settings" pointer
 * intentionally lives between the color pick and the AI Helper deep
 * explain to give the speech bubble a beat to land before the longer
 * AI Helper monologue.
 */
export const TOUR_STEP_ORDER: readonly TourStepId[] = [
  // ----- Phase 1: modal setup (per §4.1, §6 intro, L9 "stays modal-contained")
  // 2026-05-22 (HR-dispatched: v4 drop-Q1a-Q1b sub-bot): setup-q1a (lab
  // storage picker) and setup-q1b (lab connect info) were removed from
  // the v4 setup phase. By the time the user reaches v4 setup, they've
  // already picked + linked their folder via DataSetupScreen, so asking
  // "where will lab data live?" was asking them to self-report what
  // they had just done. The cloud-provider guidance + install
  // instructions move into pre-onboarding §6.4 (cloud-provider screen),
  // which is the natural home — that's where the user makes the actual
  // storage decision. `feature_picks.lab_storage` remains in the
  // FeaturePicks type as optional (parser keeps the field; v4 just
  // stops writing it; pre-onboarding P3-P4 will populate it later).
  "welcome",
  "setup-q1",
  // Lab Head follow-up (setup-q1c lab head manager 2026-05-23). Gated on
  // `account_type === "lab"`; solo accounts skip straight to setup-q2.
  // Skipped letter "b" because v3 had a setup-q1b lab connect-info step
  // that was dropped 2026-05-22; "q1c" reads as "the lab-only follow-up
  // immediately after q1" without confusing the existing q1a/q1b retired
  // ids in test history.
  "setup-q1c",
  "setup-q2",
  "setup-q3",
  "setup-q4",
  "setup-q5",
  "setup-q6",
  // Q7 Lab Links (Lab Links manager 2026-05-22): the Lab Links surface
  // was previously shown unconditionally for lab accounts and never
  // explained in the tour. Q7 gates tab visibility for everyone (solo
  // + lab); the surface name itself is account-type-conditional
  // ("Links" for solo, "Lab Links" for lab).
  "setup-q7",
  // Setup wrap-up beat (v4 setup wrap-up step manager 2026-05-24). Sits
  // between the last setup question and the in-product walkthrough.
  // Echoes back the user's Q1-Q7 picks (account type, integrations,
  // tabs that will be visible) and gives the user a single choice:
  // take the feature tour, or jump straight to home. Modal-contained
  // (added to SETUP_STEP_IDS below) so it reuses the same modal chrome
  // as the Q steps. NEVER gated (every user sees it once); resuming or
  // re-running the wizard re-shows it because there is no completion
  // flag on the step itself; the gate is the wizard-completion flag.
  "setup-wrapup",

  // ----- Phase 2: universal walkthrough (§6.1 - §6.12)
  // 2026-05-27 (v4 tour structural manager, Wave 1): the prior
  // `home-page-intro` page-transition beat is retired. Grant's
  // 2026-05-27 script rewrite folds the home-page framing into the
  // setup-wrapup body, so an extra narration beat between the modal
  // and the first user-action is redundant.
  // Home + first project (§6.1).
  //
  // Top-level New Project rework (dashboard-newproject-tour bot, 2026-05-29):
  // Grant's decided model replaced "open the Projects Overview widget, then
  // create inside it" with a persistent, widget-independent "+ New Project"
  // button on the dashboard toolbar. So the §6.1 anchors (`home-new-project`,
  // the create form, name input, submit) now live on that top-level button +
  // its inline form (see DashboardNewProject.tsx), and the prior OPEN-WIDGET
  // beat (`home-open-projects-widget`) is RETIRED: there is no widget to open
  // before the create affordance is on screen. The cluster is back to the
  // clean two-beat split:
  //   TRIGGER (`home-create-project`): spotlight the top-level New Project
  //     button; advance when the form opens (`tour:home-create-modal-opened`).
  //   FILL (`home-create-project-fill`): explain name + color; advance on
  //     `projectsApi.create` (`tour:project-created`).
  // On create, the §6.1 FILL beat's create routes the user straight to
  // the new project's page (NewProjectButton.onCreated calls
  // router.push), so the next beat runs on /workbench/projects/<id>.
  // See HomeCreateProjectFillStep.tsx.
  "home-create-project",
  "home-create-project-fill",
  // Project route Overview (§6.2). 2026-06-03 (HR / tour-simplification):
  // Grant hand-walked the project click-through and found it overbuilt.
  // The four §6.2 beats (project-overview-nav narration,
  // project-overview-prose "four sections", this typing demo,
  // project-overview-context topbar) collapsed into a SINGLE beat on
  // project-overview-typing-demo. It carries the orientation line, says
  // the page fills in on its own as you add work, explains the Overview
  // box is the part you write yourself, and BeakerBot types a sample.
  // The §6.1 FILL create routes straight to /workbench/projects/<id>, so
  // there is no navigation beat to span. Neighbors auto-stitch:
  // home-create-project-fill -> project-overview-typing-demo ->
  // notifications-intro.
  "project-overview-typing-demo",
  // 2026-06-03 (tour-merge): the old `project-overview-exit` transition
  // beat was removed. It glided the cursor to the notification bell with
  // no click, then `notifications-intro` re-explained that same bell with
  // no cursor — a redundant pair. The exit step's job (route handoff to
  // /workbench, the lead-in framing) folded into `notifications-intro`,
  // which now carries `expectedRoute: "/workbench"` and spotlights the
  // bell. Neighbors auto-stitch: typing-demo -> notifications-intro.
  // 2026-05-27 (v4 tour structural manager, Wave 1): the
  // `notifications-intro` narration beat sits before the click-the-bell
  // user-action so BeakerBot can frame the top-bar bell + inbox pair
  // before the user has to interact with either.
  "notifications-intro",
  // Notifications universal moment (§6.3). Split into three beats so
  // the user actually opens the inbox, silences the row, and dismisses
  // it before moving on — see ONBOARDING_V4_PROPOSAL.md §6.3 (Grant's
  // 2026-05-21 design feedback "be smarter than a Got it button").
  "notifications-bell",      // §6.3a: open the inbox
  "notifications-silence",   // §6.3b: mark-as-read (mute the bell badge)
  "notifications-delete",    // §6.3c: dismiss the row
  // Workbench experiment creation (§6.5)
  // 2026-05-27 (v4 tour structural manager, Wave 1): the prior
  // `workbench-page-intro` page-transition beat is retired. Grant's
  // script rewrite folds the page framing into the
  // `workbench-create-experiment-open` step opening so the user gets
  // one combined narration-plus-click-prompt beat.
  // Grant 2026-05-21 split: separate the user-action open-click from
  // BeakerBot's type+submit demo. Same shape as §6.4 methods-category
  // (open + demo) and §6.1 home-create-project (open + fill). The user
  // clicks "+ New Experiment" themselves; the cursor then takes over to
  // type the placeholder name and click Create Experiment.
  //
  // 2026-05-27 (v4 tour structural manager, Wave 1): the prior
  // `workbench-create-experiment` BEAKERBOT_DEMO follow-up is retired
  // per Grant's `[DROP]` marker in the new script. The user-action
  // open-click stands on its own now; the workbench-create-experiment
  // body owns the auto-fill artifact creation but is no longer a tour
  // step.
  "workbench-create-experiment-open",  // §6.5a (user clicks + New Experiment)
  // USER_ACTION refactor 2026-05-27 (Grant hand-walk): the prior single
  // BeakerBot demo step that filled + submitted the form kept regressing
  // (cursor scripting depended on DOM mount timing, react-query cache
  // freshness, option rendering races). Replaced with three guided
  // USER_ACTION beats so the user does the work themselves. Each beat
  // spotlights one affordance: name input, project dropdown, submit
  // button. Manual advance between them. The submit beat's advance is
  // gated on tour:experiment-created so the user cannot race past the
  // button click. See WorkbenchCreateExperimentOpenStep.tsx for the
  // step bodies.
  "workbench-create-experiment-name",    // §6.5b (user types a name)
  "workbench-create-experiment-project", // §6.5c (user picks a project, or skips)
  "workbench-create-experiment-submit",  // §6.5d (user clicks Create Experiment)
  // §6.6 Experiment detail intro + Methods tab framing.
  //
  // FINAL restructure (FINAL reorder manager 2026-05-27): the
  // experiment-detail / Methods-tab framing now lives BEFORE the methods
  // cluster (§6.7c) and the actual method-attachment beats (§6.7d).
  // The order is:
  //
  //   experiment-attach-method-open  (open the experiment popup, frame it)
  //   experiment-attach-method-tab   (point at the Methods tab, defer the
  //                                  attach to after the methods cluster)
  //   ... hybrid editor + workbench notes/lists clusters ...
  //   ... methods cluster (§6.7c) ...
  //   experiment-attach-method-attach (return to the experiment, attach
  //                                   the method just built)
  //   experiment-attach-method-notes  (variation notes + mental model)
  //
  // The attach + notes beats moved to AFTER methods-create per the FINAL
  // tour script so the user has built a method (in the methods cluster)
  // BEFORE we ask them to attach one to the experiment. The tab beat
  // stays here to introduce the concept early; the attach beat carries
  // a navigation hook to re-open the experiment popup + Methods tab
  // after the methods detour.
  //
  // Saved-step jump-ahead fix (2026-05-27, tour saved-step jump-ahead
  // fix manager): the FINAL reorder relocated `experiment-attach-method-
  // attach` + `experiment-attach-method-notes` to §6.7d (after the
  // methods cluster, around line 316 below) but left their original
  // §6.6c / §6.6d entries here too. Because `STEP_INDEX` is built from
  // `TOUR_STEP_ORDER.map((id, i) => [id, i])` and a Map keeps the LAST
  // value per duplicate key, every lookup of these two ids resolved to
  // their LATE indices. The controller would advance from `-tab` to
  // `-attach` (the first occurrence at +1 in the array), but the next
  // advance / back-step consulted STEP_INDEX and jumped to / from the
  // LATE position, skipping ~30 steps (hybrid editor + workbench notes/
  // lists + methods cluster). Removing the duplicates here keeps `-open`
  // / `-tab` as the §6.6a/b framing beats and lets the canonical §6.7d
  // entries below own the actual attach / notes interactions.
  "experiment-attach-method-open",    // §6.6a click workbench row → open popup
  "experiment-attach-method-tab",     // §6.6b click Methods tab inside popup
  // Hybrid editor — §6.7. Inline-editor collapse (onboarding-inline bot
  // 2026-06-02): the markdown editor is now INLINE-ONLY (the hybrid
  // click-to-edit-blocks mode was retired from the UI). The old §6.7
  // markdown deep-dive (HE-1 through HE-11: markdown-intro / familiarity
  // / overview / mechanic / bold / italic / underline / h1 / h2 / h3 /
  // shortcuts / image-attach / image-drag-in / image-resize / file-attach)
  // taught that retired interaction and typed into the now-dormant hybrid
  // editor, so it was both overcomplicated and broken. Those ~15 beats
  // collapse into the single `inline-editor` narration beat below, which
  // spotlights the live CodeMirror 6 surface and teaches "just type, your
  // markdown renders as you go" (+ one line on Save checkpoint). The HE-2
  // branch gate is gone with it.
  "hybrid-notes-vs-results",       // HE-0
  // 2026-05-27 (v4 tour structural manager, Wave 1): new
  // `hybrid-editor-scope` NARRATION beat sits after HE-0 to call out
  // that "this is the editor you'll use everywhere" before the inline
  // editor beat. See the new tour script's §6.7 for the speech contract.
  "hybrid-editor-scope",
  // Writing Focus Mode enter beat (FOCUS_WRITING_MODE_DESIGN.md §9,
  // focus-writing-mode build bot 2026-05-29). Universal (ungated)
  // BEAKERBOT_DEMO beat between hybrid-editor-scope and the inline editor
  // beat: BeakerBot clicks the Focus Mode toolbar button so the calm
  // writing surface pops. Buffer-safe (the editor is not remounted), and
  // focus mode portals the same editor subtree, so the inline-editor
  // beat's spotlight resolves against the same surface; the exit beat
  // below peels the overlay back afterward.
  "hybrid-focus-enter",
  // Inline-editor collapse (onboarding-inline bot 2026-06-02): the single
  // beat that replaced the retired HE-1..HE-11 markdown deep-dive.
  "inline-editor",
  // §6.7 NEW terminal beat: save concept (hybrid-save-concept manager
  // 2026-05-27). Pure narration: ResearchOS doesn't auto-save, every
  // save is version-controlled, navigating away with unsaved changes
  // shows a warning prompt. Closes the §6.7 editor cluster before the
  // §6.7b Notes/Lists cluster opens.
  "hybrid-save-concept",
  // Writing Focus Mode exit beat (FOCUS_WRITING_MODE_DESIGN.md §9,
  // focus-writing-mode build bot 2026-05-29). Universal (ungated)
  // BEAKERBOT_DEMO beat between hybrid-save-concept and workbench-notes-intro:
  // BeakerBot clicks the Exit focus control so the overlay peels back to
  // reveal the still-expanded popup. Closes out the focus-mode demo before
  // the §6.7b Notes / Lists cluster opens.
  "hybrid-focus-exit",
  // §6.7b Workbench Notes + Lists expansion (Workbench expansion
  // manager 2026-05-22, collapsed to 5 beats by Workbench fix manager
  // R1 2026-05-22). Universal steps inserted between §6.7 (hybrid
  // editor terminal beat) and §6.8 (gantt-intro). Teaches the
  // standalone Notes panel + the Lists panel on /workbench.
  // R1 pacing fix: the prior `workbench-list-add-items` beat was
  // folded into `workbench-list-create-shell` (one continuous cursor
  // script: create + populate). Beat 6 mark-done stays separate
  // because it's a conceptually distinct teaching point.
  "workbench-notes-intro",
  "workbench-notes-create",
  "workbench-lists-intro",
  "workbench-list-create-shell",
  "workbench-list-mark-done",
  // Methods page deep-dive (§6.7c, FINAL restructure 2026-05-27).
  //
  // FINAL reorder manager 2026-05-27: the methods cluster moved here
  // from its old position (right after notifications-delete) so the
  // tour reads as a natural narrative: log work in an experiment first
  // (workbench notes / lists), THEN learn where reusable protocols
  // live (methods), THEN return to the experiment to attach the
  // method (§6.7d below). The §6.7c rename in the FINAL script
  // reflects this new ordering inside the §6.7 family.
  //
  // sec 6.4 redesign (Grant 2026-05-21): split the original
  // category step into a prompt (BeakerBot asks the user what kind of
  // technique they do) + a demo (cursor types the user's pick and
  // saves). The picker lives in MethodsCategoryPromptStep.tsx; the
  // demo retains the `methods-category` id.
  // Then the open-picker beat (Grant 2026-05-21) bridges to the type-
  // breadth wall of speech by having BeakerBot click "+ New Method" so
  // the modal mounts before the next step fires.
  "methods-category-prompt", // §6.7c-prompt (interactive picker)
  // Grant 2026-05-21 rethink: separate the user-action open-click from
  // BeakerBot's type+submit demo. The user clicks "+ New Category"
  // themselves; the cursor then takes over to type the picked label and
  // click Create Empty.
  "methods-category-open",   // §6.7c-open (user opens the modal)
  "methods-category",        // §6.7c-demo (cursor types + clicks Create Empty)
  "methods-open-picker",     // §6.7c bridge (click New Method, modal mounts)
  // 2026-05-27 (v4 tour structural manager, Wave 1): the prior
  // `methods-file-vs-markdown` explainer beat is retired. Grant's new
  // script reshapes §6.7c around two interactive builders (PCR + LC
  // Gradient); file-attach is mentioned in passing in the new
  // `methods-type-tour` copy and doesn't need its own beat anymore.
  "methods-type-tour",        // §6.7c-1: PCR builder demo (two edits + free-play)
  // 2026-05-27 (v4 tour structural manager, Wave 1): re-introduce
  // `methods-lc-demo` as a split-off BEAKERBOT_DEMO that exercises the
  // LC Gradient editor. Lives between PCR (`methods-type-tour`) and the
  // standard markdown demo (`methods-create`).
  "methods-lc-demo",          // §6.7c-2: LC Gradient editor demo
  "methods-create",           // §6.7c-3 (BeakerBot's funny markdown method)
  // Method attachment + variation notes (§6.7d, FINAL restructure
  // 2026-05-27). Originally §6.6c + §6.6d; relocated to after the
  // methods cluster because the user now needs to have BUILT a method
  // before we ask them to attach one. The attach step carries a
  // navigation hook (`onEnter`) that returns the browser to the
  // experiment popup + Methods tab so the cursor script can attach
  // the method to the same experiment created in §6.5. See
  // MethodAttachmentAttachStep.tsx for the onEnter contract.
  "experiment-attach-method-attach",  // §6.7d click Attach + pick funny method
  "experiment-attach-method-notes",   // §6.7d type variation note + mental model
  // Gantt page deep-dive (§6.8) — redesigned 2026-05-22 (Gantt manager).
  // Old order replaced with 14 sub-steps: a 6-step universal dependency-
  // teaching arc, a 7-step lab-only share-feature cluster, and the
  // relocated goals overview. See ONBOARDING_V4_GANTT_REDESIGN.md.
  "gantt-intro",                  // universal: explain what a Gantt is
  "gantt-existing-experiment",    // universal: spotlight user's experiment
  "gantt-drag-drop",              // universal: BeakerBot drags + reschedules
  "gantt-deps-beakerbot",         // universal: BeakerBot wires fake A → user
  "gantt-deps-user",              // universal: USER wires fake B → user (page-lock)
  "gantt-deps-cascade",           // universal: BeakerBot moves head, cascade fires
  // Lab-only share-feature cluster (7 beats). Conditional on
  // picks.account_type === "lab"; solo accounts skip the whole cluster.
  "gantt-share-intro",            // lab: explain task sharing
  "gantt-share-beakerbot-spawn",  // lab: BeakerBot spawns coffee experiment
  "gantt-share-beakerbot-shares", // lab: BeakerBot shares the experiment with user
  "gantt-share-user-explores",    // lab: user-action, explore the shared experiment
  // share-back user-action manager (2026-05-28): the single
  // `gantt-share-user-shares-back` cursor demo is now a 3-beat
  // USER_ACTION cluster (click Fake A, click Share, fill the dialog).
  // The first id is preserved for migration continuity.
  "gantt-share-user-shares-back", // lab: user-action, click Fake A to open popup
  "gantt-share-user-clicks-share",// lab: user-action, click Share on the popup
  "gantt-share-user-fills-dialog",// lab: user-action, pick beakerbot + edit, click Add
  "gantt-share-user-saves-dialog",// lab: user-action, click Save to persist the share
  "gantt-share-profile-switch",   // lab: REAL user-context switch (faked-flagged)
  "gantt-share-user-sees-edit",   // lab: user-action, open popup to see BeakerBot's note
  // Goals overview — RELOCATED to after the share cluster per
  // ONBOARDING_V4_GANTT_REDESIGN.md. Conditional on picks.goals === "yes".
  "gantt-goals-overview",
  // 2026-05-27 (v4 tour structural manager, Wave 1): the prior
  // `settings-page-intro` beat is replaced by `settings-intro` per
  // Grant's new script (different id so a stale resume_state can't
  // pin the controller to the dropped step). Pure narration framing
  // the whole Settings phase before the animation picker.
  "settings-intro",
  // Personalization on the Gantt toolbar (§6.9)
  "personalization-animations",
  // Settings deep-dive (§6.10) — phase redesign 2026-05-22 (Settings
  // manager). The prior 3-step cluster (`personalization-color`,
  // `settings-more`, `ai-helper-deep-explain`) is replaced by 11
  // steps:
  //
  //   - `personalization-color` REFINED to demo primary + invite
  //     optional secondary user-action pick.
  //   - 7 new `settings-tour-*` narration beats explaining the
  //     folder / calendar / telegram / account-type toggle / visible
  //     tabs / streak / re-run surfaces.
  //   - 3 new `ai-helper-*` beats splitting the prior wall of
  //     speech into manual-advance size-diff + paste use case +
  //     agentic use case.
  //
  // Three of the new settings-tour-* beats are conditional:
  //   - `settings-tour-calendar`         gates on picks.calendar === "yes"
  //   - `settings-tour-telegram`         gates on picks.telegram === "yes"
  //   - `settings-tour-account-type-toggle` gates on picks.account_type === "solo"
  //
  // The 3 ai-helper-* beats inherit the prior single-id gate
  // (picks.ai_helper ∈ {full, medium, minimal}); see
  // `isStepGatedOut` below for the predicate. The legacy
  // `settings-more` body was deleted 2026-06-03 (dead);
  // `ai-helper-deep-explain` survives @deprecated in its file.
  // Neither is in TOUR_STEP_ORDER, so the machine never lands on them.
  "personalization-color",
  "settings-tour-folder",
  // settings-tour-calendar retired 2026-05-27 (Grant hand-walk): step
  // told the user to "head over to the Calendar tab" but the tour
  // page-lock kept them on /settings, making the instruction
  // confusing. Speech body had no actionable content for the user on
  // this surface. Step body kept @deprecated in SettingsTourBeats.tsx
  // for git history reference.
  "settings-tour-telegram",
  "settings-tour-account-type-toggle",
  "settings-tour-visible-tabs",
  "settings-tour-streak",
  "settings-tour-rerun",
  "ai-helper-size-diff",
  // 2026-05-27 (v4 tour structural manager, Wave 1): split off the
  // cursor-cycles-through-tabs demo portion of `ai-helper-size-diff`
  // into a dedicated BEAKERBOT_DEMO step. Same `settingsAiHelperSection`
  // spotlight as the size-diff beat; this one drives the Full / Medium /
  // Minimal tab cycle.
  "ai-helper-size-options",
  "ai-helper-use-case-paste",
  "ai-helper-use-case-agentic",
  // 2026-05-27 (v4 tour structural manager, Wave 1): the prior
  // `search-page-intro` page-transition beat is retired. Grant's
  // script rewrite folds the search framing into the `search-demo`
  // step's speech so the page-intro beat is now redundant.
  // Search (§6.11)
  "search-demo",
  // Wiki pointer outro (§6.12) - Wiki pointer multi-beat redesign
  // 2026-05-22 (Wiki pointer manager): the prior single `wiki-pointer`
  // beat is replaced by a 4-beat cluster that intros the wiki,
  // spotlights the `?` icon in the topbar, demos the cursor click
  // through to the matching wiki page, and demos the "Back to app"
  // click to return. The legacy `wiki-pointer` id is retired from this
  // list; the body survives in WikiPointerStep.tsx with @deprecated
  // JSDoc for git-history reference. See ONBOARDING_V4_PROPOSAL.md
  // §6.12 + WikiPointerStep.tsx for the per-beat contracts.
  "wiki-pointer-intro",
  "wiki-pointer-icon-spotlight",
  "wiki-pointer-click-demo",
  "wiki-pointer-back-demo",

  // ----- Phase 2b: conditional walkthroughs (§6.13 - §6.15, plus
  // links from Lab Links manager 2026-05-22)
  // Order matches Grant's voice-to-text: telegram first (since it can
  // dovetail into hybrid editor image), then purchases, then calendar.
  // `links` lives after calendar and before the lab phase per the
  // Lab Links manager brief (the surface is in the top nav alongside
  // calendar / purchases, so the cluster keeps related-surface beats
  // together).
  "telegram",
  // Purchases redesign 2026-05-22 (Purchases manager): the single
  // `purchases` id is replaced by an 8-step cluster split into two
  // phases. Phase 1 teaches on the user's empty page (intro → create
  // button → form fill → autocomplete demo). Phase 2 warps into a
  // read-only viewer over Alex's demo account to teach the analytics
  // surface (warp prompt → viewer mount → charts demo → back to real).
  // All eight steps share the `picks.purchases === "yes"` gate. See
  // ONBOARDING_V4_PURCHASES_REDESIGN.md for the per-step contracts.
  "purchases-intro",
  "purchases-create-button-click",
  "purchases-form-fill",
  "purchases-autocomplete-demo",
  "purchases-demo-warp-prompt",
  "purchases-demo-viewer",
  "purchases-demo-charts",
  "purchases-back-to-real",
  "calendar",
  "links",

  // ----- Phase 2c: Lab Overview tour cluster (R4 Lab Mode retirement,
  // 2026-05-23) — RETIRED 2026-05-23. The 6 placeholder bodies R4 shipped
  // (lab-overview-intro through lab-overview-exit) were throwaway. Grant
  // chose nuke-now-rebuild-fresh ahead of the Mira-substrate walkthrough
  // redesign, so the cluster has been removed from TOUR_STEP_ORDER, the
  // step bodies + tests have been deleted, and the data-tour-target
  // attributes have been stripped from WidgetCanvas + SidebarWidgetRail.
  // The future Mira-substrate rebuild will reshape this slot.

  // ----- Phase 2c: lab cleanup terminal step (§6.16c, conditional on Q1=lab)
  // Gantt redesign 2026-05-22 (Gantt manager): the prior lab tour cluster
  // (`lab-prompt`, `lab-spawn-beakerbot`, `lab-permission-practice`) is
  // RETIRED. Share-feature teaching moved into the §6.8 Gantt share
  // cluster where it belongs (lab-share-intro through gantt-share-user-
  // sees-edit). The lab-cleanup step survives because BeakerBot may have
  // been spawned mid-Gantt-tour (see gantt-share-beakerbot-spawn) and
  // still needs wiping at end-of-tour. Step bodies for the retired ids
  // remain in the repo with @deprecated JSDoc for git-history reference,
  // but TOUR_STEP_ORDER no longer lists them.
  "lab-cleanup",

  // ----- Terminal step: tour-goodbye (Cleanup retirement 2026-05-22)
  // Replaces the prior `phase4-cleanup` grid. BeakerBot says goodbye,
  // user clicks "Let's go", a brief outro animation plays (~3.8 s),
  // auto-cleanup runs in the background, and the route lands on `/`.
  // See TourGoodbyeStep.tsx + auto-cleanup.ts for the body + sweep.
  "tour-goodbye",
];

const STEP_INDEX: ReadonlyMap<TourStepId, number> = new Map(
  TOUR_STEP_ORDER.map((id, i) => [id, i]),
);

/** Setup phase 1 step ids (modal-contained per L9). The wrap-up beat
 *  (v4 setup wrap-up step manager 2026-05-24) is included here so it
 *  routes through the same ModalSetupShell as the Q steps; the body
 *  itself renders its own primary CTAs ("Take the feature tour" /
 *  "Go to home") so the shell's footer is hidden via the descriptor's
 *  `hideFooter` flag. */
const SETUP_STEP_IDS: ReadonlySet<TourStepId> = new Set<TourStepId>([
  "welcome",
  "setup-q1",
  // Lab Head follow-up (setup-q1c lab head manager 2026-05-23). Modal-
  // contained alongside the other setup-q* steps; the modal shell mounts
  // the body via SETUP_STEP_DESCRIPTORS.
  "setup-q1c",
  "setup-q2",
  "setup-q3",
  "setup-q4",
  "setup-q5",
  "setup-q6",
  "setup-q7",
  "setup-wrapup",
]);

/** Lab tour step ids (gated on Q1=lab). Gantt redesign 2026-05-22:
 *  pruned to just `lab-cleanup` after the prior lab tour cluster was
 *  retired in favor of the §6.8 Gantt share cluster. */
const LAB_STEP_IDS: ReadonlySet<TourStepId> = new Set<TourStepId>([
  "lab-cleanup",
]);

/** Purchases sub-step ids (Purchases redesign 2026-05-22). Every entry
 *  gates on `picks.purchases === "yes"` — declining the Q2.purchases
 *  pick skips the whole cluster. Exported for the dev tools that walk
 *  the cluster + for step-machine.test assertions. */
export const PURCHASES_CLUSTER_STEP_IDS: ReadonlySet<TourStepId> =
  new Set<TourStepId>([
    "purchases-intro",
    "purchases-create-button-click",
    "purchases-form-fill",
    "purchases-autocomplete-demo",
    "purchases-demo-warp-prompt",
    "purchases-demo-viewer",
    "purchases-demo-charts",
    "purchases-back-to-real",
  ]);

/** Lab-only Gantt share cluster step ids (Gantt redesign 2026-05-22).
 *  Gated on `picks.account_type === "lab"` so solo accounts skip the
 *  entire cluster. Tracked separately from LAB_STEP_IDS because these
 *  steps live in the §6.8 Gantt phase, not the §6.16 lab cleanup phase. */
const GANTT_SHARE_LAB_ONLY_STEP_IDS: ReadonlySet<TourStepId> =
  new Set<TourStepId>([
    "gantt-share-intro",
    "gantt-share-beakerbot-spawn",
    "gantt-share-beakerbot-shares",
    "gantt-share-user-explores",
    "gantt-share-user-shares-back",
    "gantt-share-user-clicks-share",
    "gantt-share-user-fills-dialog",
    "gantt-share-user-saves-dialog",
    "gantt-share-profile-switch",
    "gantt-share-user-sees-edit",
  ]);

/** True when this step is one of the Phase 1 modal setup questions. */
export function isSetupPhaseStep(step: TourStepId): boolean {
  return SETUP_STEP_IDS.has(step);
}

/** True when this step belongs to the conditional lab tour cluster. */
export function isLabPhaseStep(step: TourStepId): boolean {
  return LAB_STEP_IDS.has(step);
}

/** True when this step belongs to the lab-only §6.8 Gantt share cluster
 *  (Gantt redesign 2026-05-22). The cluster sits inside the Gantt phase
 *  but is gated by `picks.account_type === "lab"`. */
export function isGanttShareLabStep(step: TourStepId): boolean {
  return GANTT_SHARE_LAB_ONLY_STEP_IDS.has(step);
}

/**
 * Returns true when this step should be skipped under the current
 * feature picks (gating per L16). The machine walks the full order and
 * uses this predicate to fast-forward in both directions.
 *
 * Mirrors `WizardStepMachine.isStepSkippedByGate` for v3, adapted to
 * the v4 step ids + the simplified lab tour scope (L19 dropped v3's
 * L5-L10 sub-tours, so we only gate the lab cluster as a whole on
 * account_type === "lab").
 */
export function isStepGatedOut(
  step: TourStepId,
  picks: FeaturePicks | null,
): boolean {
  // Phase 1 lab sub-questions (setup-q1a / setup-q1b) used to live here;
  // they were dropped 2026-05-22 (HR-dispatched: v4 drop-Q1a-Q1b
  // sub-bot). Lab storage decision moved to pre-onboarding §6.4
  // (cloud-provider screen), so the v4 modal setup no longer asks the
  // user where lab data lives.

  // Lab Head follow-up (setup-q1c lab head manager 2026-05-23). The
  // step asks "are you the lab head?" and only makes sense after the
  // user picked "Lab" on Q1. Solo accounts skip it. The answer drives
  // the Lab Overview cluster gate (only lab heads see the dashboard
  // customization tour).
  if (step === "setup-q1c") return picks?.account_type !== "lab";

  // Dashboard unification (dashboard-unification build, 2026-05-29): the
  // interim PI Home-phase skip is removed. Home and Lab Overview collapsed
  // into ONE dashboard at "/", so every account type (member, solo, PI)
  // walks the same dashboard-canvas phase (sections 6.1 - 6.3). The §6.1
  // to §6.3 copy was reframed from "your personal Home" to "your
  // dashboard" so it reads correctly for a PI.

  // Phase 2 conditional walkthroughs (§6.13 - §6.15).
  if (step === "telegram") return picks?.telegram !== "yes";
  // Purchases redesign 2026-05-22 (Purchases manager): the legacy
  // single-id `purchases` gate fans out to the 8-step cluster. Every
  // member shares the same `picks.purchases === "yes"` gate, so a
  // declined Q2.purchases pick still skips the whole cluster.
  if (PURCHASES_CLUSTER_STEP_IDS.has(step)) return picks?.purchases !== "yes";
  if (step === "calendar") return picks?.calendar !== "yes";
  // Links conditional (Lab Links manager 2026-05-22): same yes-only
  // shape as the other conditional walkthroughs. Tab visibility +
  // step gating both key off picks.links === "yes".
  if (step === "links") return picks?.links !== "yes";

  // §6.8 goals overview sub-step: only show when picks.goals === "yes".
  // The other Gantt sub-steps (intro, existing-experiment, drag-drop,
  // deps-beakerbot, deps-user, deps-cascade) fire for everyone — they
  // teach core Gantt mechanics, not the goals overlay feature.
  if (step === "gantt-goals-overview") return picks?.goals !== "yes";

  // §6.7 inline-editor collapse (onboarding-inline bot 2026-06-02): the
  // old `hybrid-markdown-overview` (HE-3) gate keyed off the retired HE-2
  // `hybrid-markdown-familiarity` branch choice. Both steps are gone now
  // that the markdown deep-dive collapsed into the single `inline-editor`
  // beat, so the gate (and its `lastBranchChoice` import) is removed.

  // §6.8 lab-only share cluster (Gantt redesign 2026-05-22): solo
  // accounts skip the entire 7-step share cluster. The teaching
  // surface (cross-user sharing) doesn't exist for solo users.
  if (GANTT_SHARE_LAB_ONLY_STEP_IDS.has(step)) {
    return picks?.account_type !== "lab";
  }

  // §6.10 AI Helper deep-explain: only fire when AI Helper is opted in
  // (full / medium / minimal). "no" and "maybe" route around the
  // deep-explain monologue.
  //
  // Settings manager 2026-05-22 (§6.10 phase redesign): the prior
  // single `ai-helper-deep-explain` id is replaced by three beats
  // (size-diff + paste use case + agentic use case). All three share
  // the same gate; the legacy id is retained for back-compat so any
  // stale `wizard_resume_state.current_step` referencing it still
  // gates correctly (the machine skips it because it's not in
  // TOUR_STEP_ORDER, but the gate predicate stays in lockstep with
  // the new ids in case dev tools / debug consoles ask).
  if (
    step === "ai-helper-deep-explain" ||
    step === "ai-helper-size-diff" ||
    // v4 tour structural manager (Wave 1, 2026-05-27): new
    // `ai-helper-size-options` BEAKERBOT_DEMO inherits the trio's gate.
    step === "ai-helper-size-options" ||
    step === "ai-helper-use-case-paste" ||
    step === "ai-helper-use-case-agentic"
  ) {
    const v = picks?.ai_helper;
    if (!v) return true;
    return v === "no" || v === "maybe";
  }

  // §6.10 Settings tour narration beats (Settings manager 2026-05-22).
  // Two of the remaining beats are conditional; the others (folder,
  // visible-tabs, streak, rerun) fire for everyone.
  //
  //   - settings-tour-telegram         → picks.telegram === "yes"
  //   - settings-tour-account-type-toggle → picks.account_type === "solo"
  //
  // Lab users skip the account-type-toggle beat because they're already
  // on a lab account (the toggle's flavor changes for them); solo users
  // see it so they know how to flip over later.
  //
  // settings-tour-calendar retired 2026-05-27 — the step is no longer in
  // TOUR_STEP_ORDER, so this predicate is unreachable. Kept removed
  // rather than gating-false so the registry skip path matches the
  // ordering source of truth.
  if (step === "settings-tour-telegram") {
    return picks?.telegram !== "yes";
  }
  if (step === "settings-tour-account-type-toggle") {
    return picks?.account_type !== "solo";
  }

  // Lab tour cluster — entire cluster gates on account_type === "lab".
  // P7 will additionally consult `lab_tour_pending` /
  // `lab_tour_dismissed_at` from the sidecar inside the lab-prompt step
  // body (per §6.16 now/later/dismiss branching), but the machine-level
  // gate only knows about the feature pick. Defer the runtime decision
  // to the step body, same shape as v3 P3a did via
  // `getLabTourDecision`.
  if (LAB_STEP_IDS.has(step)) {
    return picks?.account_type !== "lab";
  }

  // R4 Lab Overview tour cluster — RETIRED 2026-05-23. The 6 placeholder
  // bodies R4 shipped were throwaway; Grant chose nuke-now-rebuild-fresh
  // ahead of the Mira-substrate walkthrough redesign. No ids remain in
  // TOUR_STEP_ORDER for this cluster, so no gate predicate is needed
  // here; the future rebuild will introduce its own ids + gating contract.

  return false;
}

/**
 * Next applicable step. Returns `"tour-goodbye"` once every gated step
 * has been consumed. Returns `null` when `current` is already
 * `"tour-goodbye"` (the controller's advance off the terminal step
 * lands on null; the outro animation owns its own teardown via a
 * sibling overlay that survives the tour state going null).
 *
 * Cleanup retirement 2026-05-22: prior to this sweep, the sentinel was
 * `"phase4-cleanup"`. The new terminal step replaces the cleanup grid
 * with an auto-cleanup + animation outro; the sentinel ids change
 * accordingly.
 *
 * Unknown / off-graph `current` ids fall back to the first applicable
 * step — same defensive behavior as v3.
 */
export function getNextStep(
  current: TourStepId,
  picks: FeaturePicks | null,
): TourStepId | null {
  if (current === "tour-goodbye") return null;
  const start = STEP_INDEX.get(current);
  if (start === undefined) {
    // Unknown id → bootstrap from the first applicable step.
    for (const candidate of TOUR_STEP_ORDER) {
      if (!isStepGatedOut(candidate, picks)) return candidate;
    }
    return "tour-goodbye";
  }
  for (let i = start + 1; i < TOUR_STEP_ORDER.length; i++) {
    const candidate = TOUR_STEP_ORDER[i];
    if (!isStepGatedOut(candidate, picks)) return candidate;
  }
  return "tour-goodbye";
}

/**
 * Previous applicable step. Returns `null` when `current` is the first
 * applicable step (typically `"welcome"` — back-stepping off the head
 * is a no-op, and the UI hides the Back affordance in that state).
 */
export function getPreviousStep(
  current: TourStepId,
  picks: FeaturePicks | null,
): TourStepId | null {
  const start = STEP_INDEX.get(current);
  if (start === undefined || start === 0) return null;
  for (let i = start - 1; i >= 0; i--) {
    const candidate = TOUR_STEP_ORDER[i];
    if (!isStepGatedOut(candidate, picks)) return candidate;
  }
  return null;
}

/**
 * Total applicable step count under the given picks — useful for a
 * "Step X of Y" indicator in the speech bubble. Filters
 * `TOUR_STEP_ORDER` through `isStepGatedOut` once.
 */
export function totalApplicableSteps(picks: FeaturePicks | null): number {
  let n = 0;
  for (const step of TOUR_STEP_ORDER) {
    if (!isStepGatedOut(step, picks)) n++;
  }
  return n;
}

/**
 * 1-based index of `current` among applicable steps. Returns 0 when
 * `current` is itself gated out (defensive — covers an in-flight
 * `feature_picks` mutation that toggles a gate while a gated-out step
 * is somehow active).
 */
export function applicableStepIndex(
  current: TourStepId,
  picks: FeaturePicks | null,
): number {
  let idx = 0;
  for (const step of TOUR_STEP_ORDER) {
    if (isStepGatedOut(step, picks)) continue;
    idx++;
    if (step === current) return idx;
  }
  return 0;
}

/**
 * The first applicable step under the given picks — used at tour start
 * when no explicit `initialStep` is provided. Falls back to
 * `"tour-goodbye"` if every preceding step is gated out (impossible
 * under any real `FeaturePicks` shape, but a deterministic terminus
 * matters for tests + dev tools). Cleanup retirement 2026-05-22: the
 * fallback sentinel changed from `"phase4-cleanup"` to `"tour-goodbye"`
 * when the cleanup grid was retired.
 */
export function firstApplicableStep(
  picks: FeaturePicks | null,
): TourStepId {
  for (const candidate of TOUR_STEP_ORDER) {
    if (!isStepGatedOut(candidate, picks)) return candidate;
  }
  return "tour-goodbye";
}
