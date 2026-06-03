/**
 * Onboarding v4 P1 step-machine tests — exercises `getNextStep`,
 * `getPreviousStep`, the conditional gates (L16), and the boundary
 * conditions at both ends of the order.
 */
import { describe, expect, it } from "vitest";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import {
  applicableStepIndex,
  firstApplicableStep,
  getNextStep,
  getPreviousStep,
  isLabPhaseStep,
  isSetupPhaseStep,
  isStepGatedOut,
  TOUR_STEP_ORDER,
  totalApplicableSteps,
} from "../step-machine";
import type { TourStepId } from "../step-types";

/** Helper: produce a FeaturePicks with all "no" defaults so each test
 *  can opt features in piecewise. */
function picks(over: Partial<FeaturePicks> = {}): FeaturePicks {
  return {
    account_type: "solo",
    purchases: "no",
    calendar: "no",
    goals: "no",
    telegram: "no",
    ai_helper: "no",
    ...over,
  };
}

/** Helper: walk forward from a start step until phase4-cleanup or null. */
function walkForward(
  start: TourStepId,
  p: FeaturePicks | null,
): TourStepId[] {
  const visited: TourStepId[] = [start];
  let cur: TourStepId | null = start;
  // §6.7b Workbench Notes + Lists expansion (Workbench expansion
  // manager 2026-05-22): the prior 100-iteration cap was just past
  // the maximal lab walk; adding 6 universal steps tipped it over.
  // Bump to 200 to leave headroom for future arc additions.
  for (let i = 0; i < 200; i++) {
    const next = getNextStep(cur, p);
    if (next === null) break;
    visited.push(next);
    cur = next;
  }
  return visited;
}

describe("TOUR_STEP_ORDER", () => {
  it("contains all P1-scaffolded step ids", () => {
    expect(TOUR_STEP_ORDER).toContain("welcome");
    expect(TOUR_STEP_ORDER).toContain("setup-q1");
    expect(TOUR_STEP_ORDER).toContain("setup-q6");
    // Lab Links manager 2026-05-22: setup-q7 added for the Links pick.
    expect(TOUR_STEP_ORDER).toContain("setup-q7");
    expect(TOUR_STEP_ORDER).toContain("links");
    expect(TOUR_STEP_ORDER).toContain("home-create-project");
    // Top-level New Project rework (dashboard-newproject-tour bot,
    // 2026-05-29): the OPEN-WIDGET beat (`home-open-projects-widget`) is
    // retired now that the create affordance is a persistent top-level
    // toolbar button, so the §6.1 cluster opens directly on the TRIGGER beat.
    expect(TOUR_STEP_ORDER).not.toContain("home-open-projects-widget");
    expect(TOUR_STEP_ORDER).toContain("home-create-project-fill");
    expect(TOUR_STEP_ORDER.indexOf("home-create-project-fill")).toBe(
      TOUR_STEP_ORDER.indexOf("home-create-project") + 1,
    );
    // 2026-06-03 (HR / tour-simplification): the four §6.2 project-page
    // beats collapsed into the single project-overview-typing-demo beat.
    // The other three ids are fully removed.
    expect(TOUR_STEP_ORDER).toContain("project-overview-typing-demo");
    expect(TOUR_STEP_ORDER).not.toContain("project-overview-nav");
    expect(TOUR_STEP_ORDER).not.toContain("project-overview-prose");
    expect(TOUR_STEP_ORDER).not.toContain("project-overview-context");
    expect(TOUR_STEP_ORDER.indexOf("project-overview-typing-demo")).toBe(
      TOUR_STEP_ORDER.indexOf("home-create-project-fill") + 1,
    );
    // Widget-framework teardown v2 (2026-06-02): the §6.2b Home widgets
    // cluster (5 sub-steps) was removed with the customizable widget canvas.
    expect(TOUR_STEP_ORDER).not.toContain("home-widgets-canvas-intro");
    expect(TOUR_STEP_ORDER).not.toContain("home-widgets-tile-anatomy");
    expect(TOUR_STEP_ORDER).not.toContain("home-widgets-add");
    expect(TOUR_STEP_ORDER).not.toContain("home-widgets-reorder");
    expect(TOUR_STEP_ORDER).not.toContain("home-widgets-exit");
    expect(TOUR_STEP_ORDER).toContain("methods-open-picker");
    expect(TOUR_STEP_ORDER).toContain("methods-create");
    // §6.7 hybrid editor cluster. Inline-editor collapse (onboarding-inline
    // bot 2026-06-02): the HE-1..HE-11 markdown deep-dive collapsed into the
    // single `inline-editor` beat now that the editor is inline-only. The
    // surviving cluster beats keep their ids; the removed markdown ids are
    // gone.
    expect(TOUR_STEP_ORDER).toContain("hybrid-notes-vs-results");
    expect(TOUR_STEP_ORDER).toContain("inline-editor");
    expect(TOUR_STEP_ORDER).toContain("hybrid-save-concept");
    expect(TOUR_STEP_ORDER).not.toContain("hybrid-markdown-familiarity");
    expect(TOUR_STEP_ORDER).not.toContain("hybrid-file-attach");
    expect(TOUR_STEP_ORDER).not.toContain("hybrid-editor");
    expect(TOUR_STEP_ORDER).not.toContain("hybrid-editor-paragraphs");
    expect(TOUR_STEP_ORDER).not.toContain("hybrid-editor-image-drop");
    expect(TOUR_STEP_ORDER).not.toContain("hybrid-editor-resize");
    expect(TOUR_STEP_ORDER).toContain("gantt-drag-drop");
    // §6.10 Settings phase redesign 2026-05-22 (Settings manager): the
    // legacy `ai-helper-deep-explain` + `settings-more` ids are NOT in
    // TOUR_STEP_ORDER any more. New shape: 11 steps. Three of the
    // settings-tour-* beats gate conditionally; the AI Helper trio
    // shares the prior ai_helper ∈ {full,medium,minimal} gate.
    expect(TOUR_STEP_ORDER).not.toContain("settings-more");
    expect(TOUR_STEP_ORDER).not.toContain("ai-helper-deep-explain");
    expect(TOUR_STEP_ORDER).toContain("settings-tour-folder");
    // settings-tour-calendar retired 2026-05-27 (Grant hand-walk): the
    // step told the user to "head over to the Calendar tab" but the
    // tour page-lock kept them on /settings, so the instruction was
    // unactionable. Step body remains @deprecated for git history.
    expect(TOUR_STEP_ORDER).not.toContain("settings-tour-calendar");
    expect(TOUR_STEP_ORDER).toContain("settings-tour-telegram");
    expect(TOUR_STEP_ORDER).toContain("settings-tour-account-type-toggle");
    expect(TOUR_STEP_ORDER).toContain("settings-tour-visible-tabs");
    expect(TOUR_STEP_ORDER).toContain("settings-tour-streak");
    expect(TOUR_STEP_ORDER).toContain("settings-tour-rerun");
    expect(TOUR_STEP_ORDER).toContain("ai-helper-size-diff");
    expect(TOUR_STEP_ORDER).toContain("ai-helper-use-case-paste");
    expect(TOUR_STEP_ORDER).toContain("ai-helper-use-case-agentic");
    expect(TOUR_STEP_ORDER).toContain("telegram");
    // Purchases manager 2026-05-22: the legacy single `purchases` id is
    // replaced by the 8-step cluster. The list intentionally retires
    // the old id, sub-bots that look it up under that name resolve via
    // the legacy `purchasesConditionalStep` export instead.
    expect(TOUR_STEP_ORDER).not.toContain("purchases");
    expect(TOUR_STEP_ORDER).toContain("purchases-intro");
    expect(TOUR_STEP_ORDER).toContain("purchases-create-button-click");
    expect(TOUR_STEP_ORDER).toContain("purchases-form-fill");
    expect(TOUR_STEP_ORDER).toContain("purchases-autocomplete-demo");
    expect(TOUR_STEP_ORDER).toContain("purchases-demo-warp-prompt");
    expect(TOUR_STEP_ORDER).toContain("purchases-demo-viewer");
    expect(TOUR_STEP_ORDER).toContain("purchases-demo-charts");
    expect(TOUR_STEP_ORDER).toContain("purchases-back-to-real");
    expect(TOUR_STEP_ORDER).toContain("calendar");
    // Gantt manager 2026-05-22: lab-prompt / lab-spawn-beakerbot /
    // lab-permission-practice were retired by the §6.8 Gantt redesign.
    // Only lab-cleanup survives the share-cluster restructure.
    expect(TOUR_STEP_ORDER).not.toContain("lab-prompt");
    expect(TOUR_STEP_ORDER).not.toContain("lab-spawn-beakerbot");
    expect(TOUR_STEP_ORDER).not.toContain("lab-permission-practice");
    expect(TOUR_STEP_ORDER).toContain("lab-cleanup");
    // New §6.8 Gantt arc step ids must be in the order.
    expect(TOUR_STEP_ORDER).toContain("gantt-intro");
    expect(TOUR_STEP_ORDER).toContain("gantt-existing-experiment");
    expect(TOUR_STEP_ORDER).toContain("gantt-deps-beakerbot");
    expect(TOUR_STEP_ORDER).toContain("gantt-deps-user");
    expect(TOUR_STEP_ORDER).toContain("gantt-deps-cascade");
    expect(TOUR_STEP_ORDER).toContain("gantt-share-profile-switch");
    // Legacy gantt step ids dropped 2026-05-22 (Gantt manager).
    expect(TOUR_STEP_ORDER).not.toContain("gantt-task-types");
    expect(TOUR_STEP_ORDER).not.toContain("gantt-chained-deps");
    // §6.7b Workbench Notes + Lists expansion (Workbench expansion
    // manager 2026-05-22, collapsed to 5 beats by Workbench fix
    // manager R1 2026-05-22, collapsed to 2 beats 2026-06-03 by HR /
    // tour-simplification). Two universal explanation steps inserted
    // between the hybrid editor cluster and the methods cluster. The
    // three BeakerBot demos were cut 2026-06-03; only the two
    // explanation beats survive.
    expect(TOUR_STEP_ORDER).toContain("workbench-notes-intro");
    expect(TOUR_STEP_ORDER).toContain("workbench-lists-intro");
    expect(TOUR_STEP_ORDER).not.toContain("workbench-list-add-items");
    // The three cut demos must NOT be present so a stale resume_state
    // record can't pin the controller to a step that no longer exists.
    expect(TOUR_STEP_ORDER).not.toContain("workbench-notes-create");
    expect(TOUR_STEP_ORDER).not.toContain("workbench-list-create-shell");
    expect(TOUR_STEP_ORDER).not.toContain("workbench-list-mark-done");
    // Cleanup retirement 2026-05-22 (Cleanup manager R2): the prior
    // `phase4-cleanup` interactive grid is gone; the terminal step is
    // now `tour-goodbye` (auto-cleanup + animation outro). The old id
    // must NOT be present so a stale resume_state record can't pin the
    // controller to a step that no longer exists.
    expect(TOUR_STEP_ORDER).toContain("tour-goodbye");
    expect(TOUR_STEP_ORDER).not.toContain("phase4-cleanup");
  });

  it("contains no duplicate step ids (saved-step jump-ahead fix manager 2026-05-27)", () => {
    // Regression guard: STEP_INDEX is built via
    // `new Map(TOUR_STEP_ORDER.map((id, i) => [id, i]))`. When the same
    // id appears twice in TOUR_STEP_ORDER, the Map keeps only the LAST
    // index. Every subsequent STEP_INDEX lookup (used by `getNextStep`,
    // `getPreviousStep`, `applicableStepIndex`) resolves to that late
    // index, so the controller advances forward by +1 in the array on
    // first hit but the NEXT advance / back-step jumps to / from the
    // late position. The FINAL reorder of 2026-05-27 introduced this
    // bug by relocating `experiment-attach-method-attach` +
    // `experiment-attach-method-notes` to §6.7d but leaving their old
    // §6.6c / §6.6d entries in place. The user walking forward from
    // `experiment-attach-method-tab` (§6.6b) would land on the early
    // duplicate of `-attach`, then the controller's next advance
    // (consulting STEP_INDEX, which pointed at the §6.7d position)
    // jumped them ~30 steps forward, skipping the entire hybrid editor +
    // workbench notes/lists + methods clusters. Going BACK from there
    // landed on `methods-create`, going forward again re-triggered the
    // jump, creating an inescapable loop. This test fails fast if a
    // future reorder reintroduces a duplicate.
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of TOUR_STEP_ORDER) {
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
    }
    expect(duplicates, `TOUR_STEP_ORDER contains duplicate ids: ${duplicates.join(", ")}`).toEqual([]);
  });

  it("hands project-overview-typing-demo straight to notifications-intro (tour-simplification 2026-06-03 collapsed the §6.2 cluster + removed the redundant project-overview-exit beat)", () => {
    // 2026-06-03 (HR / tour-simplification): the four §6.2 beats collapsed
    // into the single project-overview-typing-demo beat. The earlier
    // tour-merge had already removed the `project-overview-exit` beat (it
    // glided the cursor to the notification bell with no click, then
    // notifications-intro re-explained that same bell). With both changes
    // landed, the single project beat now flows directly into the §6.3
    // notifications framing.
    const order = [
      "project-overview-typing-demo",
      "notifications-intro",
      "notifications-bell",
    ];
    const indices = order.map((id) => TOUR_STEP_ORDER.indexOf(id));
    indices.forEach((idx, i) => {
      expect(idx, `${order[i]} missing from TOUR_STEP_ORDER`).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(
          idx,
          `${order[i]} must follow ${order[i - 1]}`,
        ).toBe(indices[i - 1] + 1);
      }
    });
  });

  it("the §6.2b Home widgets cluster ids are fully removed (widget-framework teardown v2)", () => {
    for (const id of [
      "home-widgets-canvas-intro",
      "home-widgets-tile-anatomy",
      "home-widgets-add",
      "home-widgets-reorder",
      "home-widgets-exit",
    ]) {
      expect(TOUR_STEP_ORDER).not.toContain(id);
    }
  });

  it("inserts the §6.7b Workbench Notes + Lists cluster between the §6.7 editor cluster and the methods cluster (FINAL reorder manager 2026-05-27; collapsed to 2 beats 2026-06-03 by HR / tour-simplification)", () => {
    // Workbench expansion manager 2026-05-22, collapsed to 5 beats by
    // Workbench fix manager R1 2026-05-22: universal steps sit BETWEEN
    // the §6.7 editor cluster's terminal beats and the §6.8 first
    // beat (gantt-intro). Order matters because the surviving beats
    // walk Notes -> Lists.
    //
    // FINAL reorder manager 2026-05-27: the methods cluster moved here
    // between the workbench notes/lists cluster and gantt-intro, so
    // this test asserts the workbench-lists-intro → methods-category-
    // prompt adjacency.
    //
    // 2026-06-03 (HR / tour-simplification): the three BeakerBot demos
    // (workbench-notes-create, workbench-list-create-shell,
    // workbench-list-mark-done) were cut, leaving the two explanation
    // beats adjacent: workbench-notes-intro -> workbench-lists-intro.
    //
    // Inline-editor collapse (onboarding-inline bot 2026-06-02): the §6.7
    // editor cluster's terminal beat before hybrid-save-concept is now the
    // single `inline-editor` beat (was hybrid-file-attach).
    const order = [
      "inline-editor",
      // hybrid-save-concept manager 2026-05-27: beat between the inline
      // editor beat and workbench-notes-intro.
      "hybrid-save-concept",
      // Writing Focus Mode exit beat (focus-writing-mode build bot
      // 2026-05-29): inserted between hybrid-save-concept and
      // workbench-notes-intro.
      "hybrid-focus-exit",
      "workbench-notes-intro",
      "workbench-lists-intro",
      "methods-category-prompt",
    ];
    const indices = order.map((id) => TOUR_STEP_ORDER.indexOf(id));
    indices.forEach((idx, i) => {
      expect(idx, `${order[i]} missing from TOUR_STEP_ORDER`).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(
          idx,
          `${order[i]} must follow ${order[i - 1]}`,
        ).toBe(indices[i - 1] + 1);
      }
    });
  });

  it("places the methods cluster (§6.7c) between the workbench notes/lists cluster and experiment-attach-method-attach (FINAL reorder manager 2026-05-27; cluster collapsed to 2 beats 2026-06-03)", () => {
    // FINAL restructure: the 7-step methods cluster moved here from
    // its old position right after notifications-delete. The cluster
    // now runs after the workbench notes/lists cluster and before the
    // experiment-attach-method-attach + -notes beats (§6.7d).
    //
    // 2026-06-03 (HR / tour-simplification): the workbench notes/lists
    // cluster collapsed to its two explanation beats, so the methods
    // cluster now follows workbench-lists-intro directly (was
    // workbench-list-mark-done).
    const order = [
      "workbench-lists-intro",
      "methods-category-prompt",
      "methods-category-open",
      "methods-category",
      "methods-open-picker",
      "methods-type-tour",
      "methods-lc-demo",
      "methods-create",
      "experiment-attach-method-attach",
      "experiment-attach-method-notes",
      "gantt-intro",
    ];
    const indices = order.map((id) => TOUR_STEP_ORDER.indexOf(id));
    indices.forEach((idx, i) => {
      expect(idx, `${order[i]} missing from TOUR_STEP_ORDER`).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(
          idx,
          `${order[i]} must follow ${order[i - 1]}`,
        ).toBe(indices[i - 1] + 1);
      }
    });
  });

  it("places experiment-attach-method-open / -tab immediately before the hybrid editor cluster (FINAL reorder manager 2026-05-27)", () => {
    // FINAL restructure: the §6.6 experiment-detail framing beats
    // (open + tab) stay right after the §6.5 experiment-create cluster
    // (open, name, project, submit), so BeakerBot can frame the
    // experiment popup + Methods tab before the §6.7 hybrid editor
    // deep-dive. The attach + notes beats moved to §6.7d (after
    // methods cluster).
    //
    // USER_ACTION refactor 2026-05-27: the single
    // `workbench-create-experiment-open` beat became four
    // (open, name, project, submit). Order assertion updated to
    // require the FULL four-beat cluster comes first, with
    // experiment-attach-method-open / -tab landing right after the
    // submit beat. Each adjacent pair must be contiguous in
    // TOUR_STEP_ORDER (no other ids in between).
    const order = [
      "workbench-create-experiment-open",
      "workbench-create-experiment-name",
      "workbench-create-experiment-project",
      "workbench-create-experiment-submit",
      "experiment-attach-method-open",
      "experiment-attach-method-tab",
      "hybrid-notes-vs-results",
    ];
    const indices = order.map((id) => TOUR_STEP_ORDER.indexOf(id));
    indices.forEach((idx, i) => {
      expect(idx, `${order[i]} missing from TOUR_STEP_ORDER`).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(
          idx,
          `${order[i]} must follow ${order[i - 1]}`,
        ).toBe(indices[i - 1] + 1);
      }
    });
  });

  it("does NOT place the methods cluster right after notifications-delete (FINAL reorder manager 2026-05-27)", () => {
    // Regression guard: the methods cluster's prior position was
    // right after notifications-delete. The FINAL restructure moved
    // it to after workbench-list-mark-done. If a future refactor
    // moves it back, this test catches it.
    const notifDeleteIdx = TOUR_STEP_ORDER.indexOf("notifications-delete");
    expect(notifDeleteIdx).toBeGreaterThanOrEqual(0);
    expect(TOUR_STEP_ORDER[notifDeleteIdx + 1]).not.toBe("methods-category-prompt");
  });

  it("the §6.7b Workbench cluster is universal (no feature_picks gating)", () => {
    // Both surviving steps fire for every user — the Workbench tabs
    // (Notes, Lists) exist regardless of account_type / purchases /
    // calendar / any other pick. Verify with two contrasting pick
    // configs. 2026-06-03 (HR / tour-simplification): the three
    // BeakerBot demos were cut; only the two explanation beats remain.
    const universal = [
      "workbench-notes-intro",
      "workbench-lists-intro",
    ];
    const allYes = picks({
      account_type: "lab",
      purchases: "yes",
      calendar: "yes",
      goals: "yes",
      telegram: "yes",
      ai_helper: "full",
    });
    const allNo = picks();
    for (const id of universal) {
      expect(isStepGatedOut(id, allYes)).toBe(false);
      expect(isStepGatedOut(id, allNo)).toBe(false);
      expect(isStepGatedOut(id, null)).toBe(false);
    }
  });

  it("does NOT contain setup-q1a / setup-q1b (dropped 2026-05-22)", () => {
    // Lab storage decision moved to pre-onboarding §6.4 (cloud-provider
    // screen). The v4 setup phase no longer asks "where will lab data
    // live?" because by the time the user reaches it, they've already
    // picked + linked the folder via DataSetupScreen. Regression guard
    // matching the §6.3 notifications.not.toContain shape so a stale
    // resume_state record can't pin the controller to a step that no
    // longer exists.
    expect(TOUR_STEP_ORDER).not.toContain("setup-q1a");
    expect(TOUR_STEP_ORDER).not.toContain("setup-q1b");
  });

  it("contains setup-wrapup between setup-q7 and home-create-project (v4 setup wrap-up step manager 2026-05-24)", () => {
    // The wrap-up confirmation beat materializes the README's longstanding
    // "Step 7: confirmation. Each setup decision is echoed back, with an
    // optional feature tour link before 'Go to home.'" promise. It sits
    // BETWEEN the last setup question (setup-q7) and the first beat of
    // the in-product walkthrough (home-create-project). Modal-contained
    // (same chrome as the Q steps), but the body owns its own CTAs.
    const q7Idx = TOUR_STEP_ORDER.indexOf("setup-q7");
    const wrapupIdx = TOUR_STEP_ORDER.indexOf("setup-wrapup");
    const homeIdx = TOUR_STEP_ORDER.indexOf("home-create-project");
    expect(q7Idx).toBeGreaterThanOrEqual(0);
    expect(wrapupIdx).toBe(q7Idx + 1);
    expect(homeIdx).toBeGreaterThan(wrapupIdx);
  });

  it("setup-wrapup is a setup-phase step (modal-contained)", () => {
    expect(isSetupPhaseStep("setup-wrapup")).toBe(true);
  });

  it("setup-wrapup is NEVER gated out (every user sees it once)", () => {
    // The wrap-up beat is unconditional: every user finishing setup
    // sees it regardless of which features they opted into. The body
    // just echoes back whatever picks are present in the sidecar.
    const allYes = picks({
      account_type: "lab",
      purchases: "yes",
      calendar: "yes",
      goals: "yes",
      telegram: "yes",
      ai_helper: "full",
    });
    const allNo = picks();
    expect(isStepGatedOut("setup-wrapup", allYes)).toBe(false);
    expect(isStepGatedOut("setup-wrapup", allNo)).toBe(false);
    expect(isStepGatedOut("setup-wrapup", null)).toBe(false);
  });

  it("getNextStep from setup-q7 lands on setup-wrapup (not home-create-project)", () => {
    // The wrap-up beat MUST sit between Q7 and the walkthrough. If a
    // future refactor moves it (or removes it), this guard catches it.
    const next = getNextStep("setup-q7", picks());
    expect(next).toBe("setup-wrapup");
  });

  it("getNextStep from setup-wrapup lands on the first in-product step", () => {
    // "Take the feature tour" in the wrap-up body calls
    // controller.advance(), which traverses the next applicable step
    // via getNextStep. The next step under default picks should be the
    // start of the in-product walkthrough.
    //
    // v4 tour structural manager (Wave 1, 2026-05-27): `home-page-intro`
    // retired. Grant's new script folds the home framing into the
    // setup-wrapup body.
    //
    // Top-level New Project rework (dashboard-newproject-tour bot,
    // 2026-05-29): the first in-product step is now `home-create-project`
    // (the TRIGGER beat spotlighting the persistent top-level New Project
    // button). The prior OPEN-WIDGET beat is retired.
    const next = getNextStep("setup-wrapup", picks());
    expect(next).toBe("home-create-project");
  });

  it("every account type (PI, member, solo) walks the same dashboard-canvas phase", () => {
    // Dashboard unification (dashboard-unification build, 2026-05-29): Home
    // and Lab Overview collapsed into ONE dashboard at "/", so the interim
    // PI Home-phase skip is removed. A lab_head now walks the same
    // sections 6.1-6.3 (project creation + dashboard widgets +
    // notifications) as members and solo accounts.
    const pi = picks({ account_type: "lab", lab_head: true });
    const member = picks({ account_type: "lab", lab_head: false });
    const solo = picks();
    const dashboardBlock: TourStepId[] = [
      // Top-level New Project rework (dashboard-newproject-tour bot,
      // 2026-05-29): the §6.1 cluster opens on the TRIGGER beat (the
      // OPEN-WIDGET beat is retired).
      "home-create-project",
      "home-create-project-fill",
      // 2026-06-03 (HR / tour-simplification): the four §6.2 beats collapsed
      // into the single project-overview-typing-demo beat.
      "project-overview-typing-demo",
      // Tour-merge (2026-06-03): the redundant `project-overview-exit` beat
      // was removed; the project beat hands straight to the notifications
      // framing.
      "notifications-intro",
      "notifications-bell",
      "notifications-silence",
      "notifications-delete",
    ];
    for (const id of dashboardBlock) {
      expect(isStepGatedOut(id, pi)).toBe(false);
      expect(isStepGatedOut(id, member)).toBe(false);
      expect(isStepGatedOut(id, solo)).toBe(false);
    }
    // Every account type now begins the walkthrough at the TRIGGER beat
    // (dashboard-newproject-tour bot, 2026-05-29): the persistent top-level
    // New Project button is the first in-product affordance.
    expect(getNextStep("setup-wrapup", pi)).toBe("home-create-project");
    expect(getNextStep("setup-wrapup", member)).toBe("home-create-project");
    expect(getNextStep("setup-wrapup", solo)).toBe("home-create-project");
  });

  it("contains the three §6.3 notification sub-step ids", () => {
    // Grant 2026-05-21: split the original single `notifications` step
    // into three beats (bell → silence → delete). The old id MUST be
    // gone so a stale resume_state record can't pin the controller to
    // a step that no longer exists.
    expect(TOUR_STEP_ORDER).toContain("notifications-bell");
    expect(TOUR_STEP_ORDER).toContain("notifications-silence");
    expect(TOUR_STEP_ORDER).toContain("notifications-delete");
    expect(TOUR_STEP_ORDER).not.toContain("notifications");
  });

  it("orders the §6.3 sub-steps bell → silence → delete", () => {
    const bellIdx = TOUR_STEP_ORDER.indexOf("notifications-bell");
    const silenceIdx = TOUR_STEP_ORDER.indexOf("notifications-silence");
    const deleteIdx = TOUR_STEP_ORDER.indexOf("notifications-delete");
    expect(bellIdx).toBeGreaterThanOrEqual(0);
    expect(silenceIdx).toBe(bellIdx + 1);
    expect(deleteIdx).toBe(silenceIdx + 1);
  });

  it("ends with tour-goodbye (Cleanup retirement 2026-05-22)", () => {
    // The retired `phase4-cleanup` sentinel was replaced by `tour-goodbye`
    // when the interactive cleanup grid was retired in favor of an
    // automatic end-of-tour sweep + animation outro.
    expect(TOUR_STEP_ORDER[TOUR_STEP_ORDER.length - 1]).toBe("tour-goodbye");
  });

  it("starts with welcome", () => {
    expect(TOUR_STEP_ORDER[0]).toBe("welcome");
  });

  it("places methods-open-picker between methods-category and methods-type-tour (Wave 1 2026-05-27)", () => {
    // §6.4 open-picker beat sits between finishing the category and
    // the type-tour PCR builder demo. The cursor click on "+ New
    // Method" owns the modal-open transition before the PCR demo
    // fires. v4 tour structural manager (Wave 1, 2026-05-27):
    // `methods-file-vs-markdown` retired; methods-type-tour is now the
    // first beat after methods-open-picker.
    const categoryIdx = TOUR_STEP_ORDER.indexOf("methods-category");
    const openPickerIdx = TOUR_STEP_ORDER.indexOf("methods-open-picker");
    const typeTourIdx = TOUR_STEP_ORDER.indexOf("methods-type-tour");
    expect(categoryIdx).toBeGreaterThanOrEqual(0);
    expect(openPickerIdx).toBeGreaterThan(categoryIdx);
    expect(typeTourIdx).toBeGreaterThan(openPickerIdx);
  });

  it("walks the methods builder arc in PCR -> LC -> markdown order (v4 tour structural manager Wave 1, 2026-05-27)", () => {
    // §6.4b (Grant 2026-05-27 rewrite): the new arc is PCR builder
    // demo (methods-type-tour) followed by LC Gradient demo
    // (methods-lc-demo, re-introduced) followed by Standard Markdown
    // (methods-create). The 2026-05-26 file-vs-markdown explainer was
    // retired in favor of a single combined PCR+LC interactive-builder
    // narrative.
    const order = [
      "methods-type-tour",
      "methods-lc-demo",
      "methods-create",
    ];
    const indices = order.map((id) => TOUR_STEP_ORDER.indexOf(id));
    indices.forEach((idx, i) => {
      expect(idx, `${order[i]} missing from TOUR_STEP_ORDER`).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(
          idx,
          `${order[i]} must follow ${order[i - 1]}`,
        ).toBe(indices[i - 1] + 1);
      }
    });
  });

  it("does NOT contain the retired methods-file-vs-markdown step (Wave 1 2026-05-27)", () => {
    expect(TOUR_STEP_ORDER).not.toContain("methods-file-vs-markdown");
  });

  it("orders the §6.7 hybrid-editor cluster after the inline-editor collapse (onboarding-inline bot 2026-06-02)", () => {
    // Inline-editor collapse (onboarding-inline bot 2026-06-02): the
    // HE-1..HE-11 markdown deep-dive (markdown-intro / familiarity /
    // overview / mechanic / bold / italic / underline / h1 / h2 / h3 /
    // shortcuts / image-attach / image-drag-in / image-resize /
    // file-attach) collapsed into the single `inline-editor` beat. The
    // cluster is now: notes-vs-results → editor-scope → focus-enter →
    // inline-editor → save-concept → focus-exit.
    const order = [
      "hybrid-notes-vs-results",
      "hybrid-editor-scope",
      // Writing Focus Mode enter beat (focus-writing-mode build bot
      // 2026-05-29): inserted between hybrid-editor-scope and the inline
      // editor beat.
      "hybrid-focus-enter",
      "inline-editor",
      // hybrid-save-concept manager 2026-05-27: terminal beat of the
      // §6.7 editor cluster (manual save / version control / unsaved-
      // changes warning) before §6.7b workbench-notes-intro opens.
      "hybrid-save-concept",
    ];
    const indices = order.map((id) => TOUR_STEP_ORDER.indexOf(id));
    indices.forEach((idx, i) => {
      expect(idx, `${order[i]} missing from TOUR_STEP_ORDER`).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(
          idx,
          `${order[i]} must follow ${order[i - 1]}`,
        ).toBe(indices[i - 1] + 1);
      }
    });
  });

  it("inserts the two Writing Focus Mode beats at the right positions (focus-writing-mode build bot 2026-05-29)", () => {
    // FOCUS_WRITING_MODE_DESIGN.md §9: hybrid-focus-enter sits immediately
    // AFTER hybrid-editor-scope and BEFORE the inline-editor beat (was
    // hybrid-markdown-intro before the inline-editor collapse 2026-06-02);
    // hybrid-focus-exit sits immediately AFTER hybrid-save-concept and
    // BEFORE workbench-notes-intro.
    const scope = TOUR_STEP_ORDER.indexOf("hybrid-editor-scope");
    const enter = TOUR_STEP_ORDER.indexOf("hybrid-focus-enter");
    const inlineEditor = TOUR_STEP_ORDER.indexOf("inline-editor");
    expect(enter).toBeGreaterThanOrEqual(0);
    expect(enter).toBe(scope + 1);
    expect(inlineEditor).toBe(enter + 1);

    const save = TOUR_STEP_ORDER.indexOf("hybrid-save-concept");
    const exit = TOUR_STEP_ORDER.indexOf("hybrid-focus-exit");
    const notes = TOUR_STEP_ORDER.indexOf("workbench-notes-intro");
    expect(exit).toBeGreaterThanOrEqual(0);
    expect(exit).toBe(save + 1);
    expect(notes).toBe(exit + 1);
  });

  it("traverses the focus-mode beats (universal, never gated) on both solo and lab paths", () => {
    // Both beats are ungated, so getNextStep / firstApplicableStep walk
    // through them regardless of account type. Verify the forward traversal
    // lands on each from its predecessor for both a solo and a lab picks.
    const solo = picks({ account_type: "solo" });
    const lab = picks({ account_type: "lab" });
    for (const p of [solo, lab]) {
      expect(getNextStep("hybrid-editor-scope", p)).toBe("hybrid-focus-enter");
      expect(getNextStep("hybrid-focus-enter", p)).toBe("inline-editor");
      expect(getNextStep("hybrid-save-concept", p)).toBe("hybrid-focus-exit");
      expect(getNextStep("hybrid-focus-exit", p)).toBe("workbench-notes-intro");
      // Neither beat is gated out.
      expect(isStepGatedOut("hybrid-focus-enter", p)).toBe(false);
      expect(isStepGatedOut("hybrid-focus-exit", p)).toBe(false);
    }
  });
});

describe("isSetupPhaseStep / isLabPhaseStep", () => {
  it("classifies the Phase 1 setup steps", () => {
    expect(isSetupPhaseStep("welcome")).toBe(true);
    expect(isSetupPhaseStep("setup-q1")).toBe(true);
    expect(isSetupPhaseStep("setup-q6")).toBe(true);
    expect(isSetupPhaseStep("home-create-project")).toBe(false);
    expect(isSetupPhaseStep("phase4-cleanup")).toBe(false);
    // setup-q1a / setup-q1b removed 2026-05-22 — no longer setup steps.
    expect(isSetupPhaseStep("setup-q1a")).toBe(false);
    expect(isSetupPhaseStep("setup-q1b")).toBe(false);
    // setup-q1c added 2026-05-23 (lab head follow-up).
    expect(isSetupPhaseStep("setup-q1c")).toBe(true);
  });

  it("classifies the Phase 2c lab steps", () => {
    // Gantt manager 2026-05-22: lab-prompt, lab-spawn-beakerbot,
    // lab-permission-practice retired by the Gantt redesign. Only
    // lab-cleanup survives in the lab phase.
    expect(isLabPhaseStep("lab-prompt")).toBe(false);
    expect(isLabPhaseStep("lab-spawn-beakerbot")).toBe(false);
    expect(isLabPhaseStep("lab-permission-practice")).toBe(false);
    expect(isLabPhaseStep("lab-cleanup")).toBe(true);
    expect(isLabPhaseStep("welcome")).toBe(false);
    expect(isLabPhaseStep("home-create-project")).toBe(false);
    expect(isLabPhaseStep("phase4-cleanup")).toBe(false);
  });
});

// 2026-05-22: setup-q1a / setup-q1b dropped from the v4 setup phase.
// The gating tests they used to live in were removed; lab storage is
// now decided in pre-onboarding §6.4 (cloud-provider screen) instead.

// setup-q1c lab head manager 2026-05-23: setup-q1c (lab head follow-up)
// gates on account_type === "lab". Solo accounts skip the question.
describe("isStepGatedOut — setup-q1c (PI follow-up)", () => {
  it("fires for lab accounts regardless of lab_head value", () => {
    expect(
      isStepGatedOut("setup-q1c", picks({ account_type: "lab" })),
    ).toBe(false);
    expect(
      isStepGatedOut(
        "setup-q1c",
        picks({ account_type: "lab", lab_head: true }),
      ),
    ).toBe(false);
    expect(
      isStepGatedOut(
        "setup-q1c",
        picks({ account_type: "lab", lab_head: false }),
      ),
    ).toBe(false);
  });

  it("hides for solo accounts and null picks", () => {
    expect(
      isStepGatedOut("setup-q1c", picks({ account_type: "solo" })),
    ).toBe(true);
    expect(isStepGatedOut("setup-q1c", null)).toBe(true);
  });
});

describe("isStepGatedOut — Phase 2 conditional walkthroughs (§6.13-6.15)", () => {
  it("gates telegram on picks.telegram === 'yes'", () => {
    expect(isStepGatedOut("telegram", picks({ telegram: "yes" }))).toBe(false);
    expect(isStepGatedOut("telegram", picks({ telegram: "no" }))).toBe(true);
    expect(isStepGatedOut("telegram", picks({ telegram: "maybe" }))).toBe(true);
  });

  it("gates the entire purchases cluster on picks.purchases === 'yes'", () => {
    // Purchases manager 2026-05-22: 8-step cluster, all members share
    // the same gate. Each id checked here is what the redesigned
    // cluster surfaces in TOUR_STEP_ORDER.
    const clusterIds = [
      "purchases-intro",
      "purchases-create-button-click",
      "purchases-form-fill",
      "purchases-autocomplete-demo",
      "purchases-demo-warp-prompt",
      "purchases-demo-viewer",
      "purchases-demo-charts",
      "purchases-back-to-real",
    ] as const;
    for (const id of clusterIds) {
      expect(isStepGatedOut(id, picks({ purchases: "yes" }))).toBe(false);
      expect(isStepGatedOut(id, picks({ purchases: "no" }))).toBe(true);
      expect(isStepGatedOut(id, picks({ purchases: "maybe" }))).toBe(true);
    }
  });

  it("gates calendar on picks.calendar === 'yes'", () => {
    expect(isStepGatedOut("calendar", picks({ calendar: "yes" }))).toBe(false);
    expect(isStepGatedOut("calendar", picks({ calendar: "no" }))).toBe(true);
    expect(isStepGatedOut("calendar", picks({ calendar: "maybe" }))).toBe(true);
  });

  // Lab Links manager 2026-05-22: links conditional walkthrough added.
  // Gated on Q7 answer (links === "yes") rather than account_type, so
  // both solo and lab users with a yes pick get the explainer beat.
  it("gates links on picks.links === 'yes'", () => {
    expect(isStepGatedOut("links", picks({ links: "yes" }))).toBe(false);
    expect(isStepGatedOut("links", picks({ links: "no" }))).toBe(true);
    expect(isStepGatedOut("links", picks({ links: "maybe" }))).toBe(true);
    // null + undefined both gate out (treat unanswered as no).
    expect(isStepGatedOut("links", null)).toBe(true);
  });

  it("links conditional is account-type-agnostic (lab + solo both pass when links=yes)", () => {
    expect(
      isStepGatedOut("links", picks({ account_type: "solo", links: "yes" })),
    ).toBe(false);
    expect(
      isStepGatedOut("links", picks({ account_type: "lab", links: "yes" })),
    ).toBe(false);
  });

  it("gates gantt-goals-overview on picks.goals === 'yes'", () => {
    expect(isStepGatedOut("gantt-goals-overview", picks({ goals: "yes" }))).toBe(
      false,
    );
    expect(isStepGatedOut("gantt-goals-overview", picks({ goals: "no" }))).toBe(
      true,
    );
    expect(
      isStepGatedOut("gantt-goals-overview", picks({ goals: "maybe" })),
    ).toBe(true);
  });

  it("gates ai-helper-deep-explain on full/medium/minimal", () => {
    // §6.10 Settings phase redesign 2026-05-22 (Settings manager): the
    // legacy `ai-helper-deep-explain` id is retired from TOUR_STEP_ORDER
    // but the gating predicate is preserved so stale resume_state +
    // dev tools that reference the id still gate correctly.
    expect(
      isStepGatedOut("ai-helper-deep-explain", picks({ ai_helper: "full" })),
    ).toBe(false);
    expect(
      isStepGatedOut("ai-helper-deep-explain", picks({ ai_helper: "medium" })),
    ).toBe(false);
    expect(
      isStepGatedOut("ai-helper-deep-explain", picks({ ai_helper: "minimal" })),
    ).toBe(false);
    expect(
      isStepGatedOut("ai-helper-deep-explain", picks({ ai_helper: "no" })),
    ).toBe(true);
    expect(
      isStepGatedOut("ai-helper-deep-explain", picks({ ai_helper: "maybe" })),
    ).toBe(true);
    expect(isStepGatedOut("ai-helper-deep-explain", null)).toBe(true);
  });

  it("gates the four ai-helper-* beats on the same ai_helper picks (trio + size-options skeleton, Wave 1 2026-05-27)", () => {
    // §6.10 Settings phase redesign 2026-05-22 (Settings manager): the
    // ai-helper cluster shares the prior single-step gate so opt-out users
    // (no / maybe) skip the entire arc just as before. v4 tour structural
    // manager (Wave 1, 2026-05-27): added `ai-helper-size-options` to the
    // cluster; it inherits the same gate.
    const trio = [
      "ai-helper-size-diff",
      "ai-helper-size-options",
      "ai-helper-use-case-paste",
      "ai-helper-use-case-agentic",
    ] as const;
    for (const id of trio) {
      expect(isStepGatedOut(id, picks({ ai_helper: "full" }))).toBe(false);
      expect(isStepGatedOut(id, picks({ ai_helper: "medium" }))).toBe(false);
      expect(isStepGatedOut(id, picks({ ai_helper: "minimal" }))).toBe(false);
      expect(isStepGatedOut(id, picks({ ai_helper: "no" }))).toBe(true);
      expect(isStepGatedOut(id, picks({ ai_helper: "maybe" }))).toBe(true);
      expect(isStepGatedOut(id, null)).toBe(true);
    }
  });

  // settings-tour-calendar retired 2026-05-27 (Grant hand-walk): the
  // step told the user to "head over to the Calendar tab" but the
  // tour page-lock kept them on /settings. Gating predicate dropped
  // alongside the step removal; the prior `gates settings-tour-calendar
  // on picks.calendar === 'yes'` test was deleted with the step.

  it("gates settings-tour-telegram on picks.telegram === 'yes'", () => {
    expect(
      isStepGatedOut("settings-tour-telegram", picks({ telegram: "yes" })),
    ).toBe(false);
    expect(
      isStepGatedOut("settings-tour-telegram", picks({ telegram: "no" })),
    ).toBe(true);
    expect(
      isStepGatedOut("settings-tour-telegram", picks({ telegram: "maybe" })),
    ).toBe(true);
    expect(isStepGatedOut("settings-tour-telegram", null)).toBe(true);
  });

  it("gates settings-tour-account-type-toggle on solo accounts only", () => {
    // Lab users are already on a lab account, so they skip this beat.
    // Solo users see it so they know how to flip over later.
    expect(
      isStepGatedOut(
        "settings-tour-account-type-toggle",
        picks({ account_type: "solo" }),
      ),
    ).toBe(false);
    expect(
      isStepGatedOut(
        "settings-tour-account-type-toggle",
        picks({ account_type: "lab" }),
      ),
    ).toBe(true);
    // null picks → no account_type → gate-out (defensive).
    expect(isStepGatedOut("settings-tour-account-type-toggle", null)).toBe(true);
  });

  it("fires settings-tour-folder + visible-tabs + streak + rerun for everyone", () => {
    // These four beats are universal — gate predicate must return false
    // for both solo and lab + null picks.
    const universal = [
      "settings-tour-folder",
      "settings-tour-visible-tabs",
      "settings-tour-streak",
      "settings-tour-rerun",
    ] as const;
    for (const id of universal) {
      expect(isStepGatedOut(id, picks({ account_type: "solo" }))).toBe(false);
      expect(isStepGatedOut(id, picks({ account_type: "lab" }))).toBe(false);
      expect(isStepGatedOut(id, null)).toBe(false);
    }
  });

  it("orders the §6.10 Settings cluster: color → 6 tour beats → 4 ai-helper beats (Wave 1 added ai-helper-size-options 2026-05-27; settings-tour-calendar retired 2026-05-27)", () => {
    const order = [
      "personalization-color",
      "settings-tour-folder",
      "settings-tour-telegram",
      "settings-tour-account-type-toggle",
      "settings-tour-visible-tabs",
      "settings-tour-streak",
      "settings-tour-rerun",
      "ai-helper-size-diff",
      // v4 tour structural manager (Wave 1, 2026-05-27): new
      // ai-helper-size-options BEAKERBOT_DEMO splits off the cursor-cycles
      // portion of size-diff. Sits between size-diff and use-case-paste.
      "ai-helper-size-options",
      "ai-helper-use-case-paste",
      "ai-helper-use-case-agentic",
    ];
    const indices = order.map((id) => TOUR_STEP_ORDER.indexOf(id));
    indices.forEach((idx, i) => {
      expect(idx, `${order[i]} missing from TOUR_STEP_ORDER`).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(
          idx,
          `${order[i]} must follow ${order[i - 1]}`,
        ).toBe(indices[i - 1] + 1);
      }
    });
  });
});

describe("isStepGatedOut — Phase 2c lab tour cluster (post Gantt redesign)", () => {
  it("hides lab-cleanup for solo accounts", () => {
    // Gantt manager 2026-05-22: lab-prompt / lab-spawn-beakerbot /
    // lab-permission-practice were retired; only lab-cleanup gates here.
    const p = picks({ account_type: "solo" });
    expect(isStepGatedOut("lab-cleanup", p)).toBe(true);
  });

  it("shows lab-cleanup for lab accounts", () => {
    const p = picks({ account_type: "lab" });
    expect(isStepGatedOut("lab-cleanup", p)).toBe(false);
  });

  it("hides lab-cleanup when picks is null", () => {
    expect(isStepGatedOut("lab-cleanup", null)).toBe(true);
  });
});

describe("isStepGatedOut — §6.8 Gantt share cluster (Gantt manager 2026-05-22)", () => {
  it("hides every Gantt share cluster step for solo accounts", () => {
    const p = picks({ account_type: "solo" });
    expect(isStepGatedOut("gantt-share-intro", p)).toBe(true);
    expect(isStepGatedOut("gantt-share-beakerbot-spawn", p)).toBe(true);
    expect(isStepGatedOut("gantt-share-beakerbot-shares", p)).toBe(true);
    expect(isStepGatedOut("gantt-share-user-explores", p)).toBe(true);
    expect(isStepGatedOut("gantt-share-user-shares-back", p)).toBe(true);
    expect(isStepGatedOut("gantt-share-profile-switch", p)).toBe(true);
    expect(isStepGatedOut("gantt-share-user-sees-edit", p)).toBe(true);
  });

  it("shows every Gantt share cluster step for lab accounts", () => {
    const p = picks({ account_type: "lab" });
    expect(isStepGatedOut("gantt-share-intro", p)).toBe(false);
    expect(isStepGatedOut("gantt-share-beakerbot-spawn", p)).toBe(false);
    expect(isStepGatedOut("gantt-share-beakerbot-shares", p)).toBe(false);
    expect(isStepGatedOut("gantt-share-user-explores", p)).toBe(false);
    expect(isStepGatedOut("gantt-share-user-shares-back", p)).toBe(false);
    expect(isStepGatedOut("gantt-share-profile-switch", p)).toBe(false);
    expect(isStepGatedOut("gantt-share-user-sees-edit", p)).toBe(false);
  });
});

describe("getNextStep — forward traversal", () => {
  it("solo + minimal picks walks the universal path only", () => {
    const p = picks({ account_type: "solo" });
    const visited = walkForward("welcome", p);
    // setup-q1a / setup-q1b are no longer in the order (dropped
    // 2026-05-22 — lab storage decision moved to pre-onboarding §6.4).
    expect(visited).not.toContain("setup-q1a");
    expect(visited).not.toContain("setup-q1b");
    // setup-q1c lab head manager 2026-05-23: setup-q1c is lab-only;
    // solo accounts skip it.
    expect(visited).not.toContain("setup-q1c");
    // Solo skips all lab steps
    expect(visited).not.toContain("lab-prompt");
    expect(visited).not.toContain("lab-spawn-beakerbot");
    expect(visited).not.toContain("lab-permission-practice");
    expect(visited).not.toContain("lab-cleanup");
    // All-no skips conditionals
    expect(visited).not.toContain("telegram");
    // Purchases manager 2026-05-22: 8-step cluster gated as a whole on
    // picks.purchases === "yes"; under all-no none of these ids appear.
    expect(visited).not.toContain("purchases-intro");
    expect(visited).not.toContain("purchases-form-fill");
    expect(visited).not.toContain("purchases-demo-viewer");
    expect(visited).not.toContain("calendar");
    expect(visited).not.toContain("gantt-goals-overview");
    // §6.10 Settings phase redesign 2026-05-22 (Settings manager): the
    // ai-helper trio + the 3 conditional settings-tour-* beats all gate
    // out under all-no picks. Universal beats (folder, visible-tabs,
    // streak, rerun) still fire.
    expect(visited).not.toContain("ai-helper-deep-explain");
    expect(visited).not.toContain("ai-helper-size-diff");
    expect(visited).not.toContain("ai-helper-use-case-paste");
    expect(visited).not.toContain("ai-helper-use-case-agentic");
    expect(visited).not.toContain("settings-tour-calendar");
    expect(visited).not.toContain("settings-tour-telegram");
    // solo account_type === "solo", so account-type-toggle DOES fire.
    expect(visited).toContain("settings-tour-account-type-toggle");
    expect(visited).toContain("settings-tour-folder");
    expect(visited).toContain("settings-tour-visible-tabs");
    expect(visited).toContain("settings-tour-streak");
    expect(visited).toContain("settings-tour-rerun");
    // Always includes core walkthrough
    expect(visited).toContain("home-create-project");
    // Widget-framework teardown v2 (2026-06-02): the §6.2b Home widgets
    // cluster was removed, so it never appears on either path.
    expect(visited).not.toContain("home-widgets-canvas-intro");
    expect(visited).not.toContain("home-widgets-exit");
    expect(visited).toContain("methods-open-picker");
    expect(visited).toContain("methods-create");
    // §6.7 hybrid editor cluster. Inline-editor collapse (onboarding-inline
    // bot 2026-06-02): first id of the cluster is hybrid-notes-vs-results;
    // the markdown deep-dive collapsed into the single `inline-editor` beat.
    expect(visited).toContain("hybrid-notes-vs-results");
    expect(visited).toContain("inline-editor");
    expect(visited).toContain("hybrid-save-concept");
    expect(visited).toContain("gantt-drag-drop");
    // Terminates at tour-goodbye (Cleanup retirement 2026-05-22).
    expect(visited[visited.length - 1]).toBe("tour-goodbye");
  });

  it("PI + all conditionals walks the maximal path", () => {
    const p = picks({
      account_type: "lab",
      // setup-q1c lab head manager 2026-05-23: lab_head: true unlocks
      // the 6-step Lab Overview cluster (the PI dashboard tour).
      lab_head: true,
      purchases: "yes",
      calendar: "yes",
      goals: "yes",
      telegram: "yes",
      ai_helper: "full",
      // Lab Links manager 2026-05-22: maximal lab path now includes
      // the Q7 links pick + the links conditional walkthrough step.
      links: "yes",
    });
    const visited = walkForward("welcome", p);
    // setup-q1a / setup-q1b were dropped 2026-05-22 — lab storage now
    // lives in pre-onboarding §6.4 (cloud-provider screen).
    expect(visited).not.toContain("setup-q1a");
    expect(visited).not.toContain("setup-q1b");
    // setup-q1c lab head manager 2026-05-23: the lab head follow-up
    // fires for any lab account (regardless of lab_head answer).
    expect(visited).toContain("setup-q1c");
    // Lab Links manager 2026-05-22: setup-q7 + links cluster appear
    // in the maximal lab walk.
    expect(visited).toContain("setup-q7");
    expect(visited).toContain("links");
    expect(visited).toContain("telegram");
    // Purchases manager 2026-05-22: all 8 cluster ids fire in the
    // maximal lab walk.
    expect(visited).toContain("purchases-intro");
    expect(visited).toContain("purchases-create-button-click");
    expect(visited).toContain("purchases-form-fill");
    expect(visited).toContain("purchases-autocomplete-demo");
    expect(visited).toContain("purchases-demo-warp-prompt");
    expect(visited).toContain("purchases-demo-viewer");
    expect(visited).toContain("purchases-demo-charts");
    expect(visited).toContain("purchases-back-to-real");
    expect(visited).toContain("calendar");
    expect(visited).toContain("gantt-goals-overview");
    // §6.10 Settings phase redesign 2026-05-22 (Settings manager): the
    // maximal lab walk includes the 3 ai-helper-* beats + the 6
    // settings-tour-* beats that apply to lab accounts (folder,
    // calendar, telegram, visible-tabs, streak, rerun). Lab users skip
    // account-type-toggle because they're already on a lab account.
    expect(visited).not.toContain("ai-helper-deep-explain");
    expect(visited).toContain("ai-helper-size-diff");
    expect(visited).toContain("ai-helper-use-case-paste");
    expect(visited).toContain("ai-helper-use-case-agentic");
    expect(visited).toContain("settings-tour-folder");
    // settings-tour-calendar retired 2026-05-27 (Grant hand-walk): the
    // step is no longer in TOUR_STEP_ORDER, so the maximal-lab walk
    // skips it even with calendar=yes.
    expect(visited).not.toContain("settings-tour-calendar");
    expect(visited).toContain("settings-tour-telegram");
    expect(visited).not.toContain("settings-tour-account-type-toggle");
    expect(visited).toContain("settings-tour-visible-tabs");
    expect(visited).toContain("settings-tour-streak");
    expect(visited).toContain("settings-tour-rerun");
    // Gantt manager 2026-05-22: lab-prompt / lab-spawn-beakerbot /
    // lab-permission-practice were retired in favor of the §6.8 Gantt
    // share cluster. Only lab-cleanup survives in the lab phase.
    expect(visited).not.toContain("lab-prompt");
    expect(visited).not.toContain("lab-spawn-beakerbot");
    expect(visited).not.toContain("lab-permission-practice");
    expect(visited).toContain("lab-cleanup");
    // §6.8 lab share cluster (Gantt redesign 2026-05-22): all 7 beats
    // fire in the maximal lab walk.
    expect(visited).toContain("gantt-share-intro");
    expect(visited).toContain("gantt-share-beakerbot-spawn");
    expect(visited).toContain("gantt-share-beakerbot-shares");
    expect(visited).toContain("gantt-share-user-explores");
    expect(visited).toContain("gantt-share-user-shares-back");
    expect(visited).toContain("gantt-share-profile-switch");
    expect(visited).toContain("gantt-share-user-sees-edit");
    // Universal Gantt arc: 6 beats fire for everyone.
    expect(visited).toContain("gantt-intro");
    expect(visited).toContain("gantt-existing-experiment");
    expect(visited).toContain("gantt-drag-drop");
    expect(visited).toContain("gantt-deps-beakerbot");
    expect(visited).toContain("gantt-deps-user");
    expect(visited).toContain("gantt-deps-cascade");
    // Cleanup retirement 2026-05-22 (Cleanup manager R2): terminus is
    // tour-goodbye, not the retired phase4-cleanup grid.
    expect(visited[visited.length - 1]).toBe("tour-goodbye");
  });

  it("returns null when current is already tour-goodbye (Cleanup retirement 2026-05-22)", () => {
    expect(getNextStep("tour-goodbye", picks())).toBeNull();
    expect(getNextStep("tour-goodbye", null)).toBeNull();
  });

  it("returns the first applicable step from an unknown id", () => {
    const p = picks({ account_type: "solo" });
    expect(getNextStep("not-a-real-step", p)).toBe("welcome");
  });

  it("solo-from-welcome step 2 lands on setup-q1, then setup-q2", () => {
    const p = picks({ account_type: "solo" });
    expect(getNextStep("welcome", p)).toBe("setup-q1");
    expect(getNextStep("setup-q1", p)).toBe("setup-q2");
  });

  it("lab-from-q1 lands on setup-q1c (PI follow-up, setup-q1c PI manager 2026-05-23)", () => {
    // setup-q1a (lab storage picker) + setup-q1b (lab connect info)
    // were dropped 2026-05-22. setup-q1c (lab head follow-up) was added
    // 2026-05-23 — it asks the lab user if they're the PI so the
    // lab-overview cluster gate can scope to lab heads only.
    const p = picks({ account_type: "lab" });
    expect(getNextStep("setup-q1", p)).toBe("setup-q1c");
    // From setup-q1c, lab users advance to setup-q2 (universal).
    expect(getNextStep("setup-q1c", p)).toBe("setup-q2");
  });
});

describe("getPreviousStep — backward traversal", () => {
  it("returns null at the head of the order", () => {
    expect(getPreviousStep("welcome", picks())).toBeNull();
    expect(getPreviousStep("welcome", null)).toBeNull();
  });

  it("solo backstep from setup-q2 lands on setup-q1", () => {
    const p = picks({ account_type: "solo" });
    expect(getPreviousStep("setup-q2", p)).toBe("setup-q1");
  });

  it("lab backstep from setup-q2 lands on setup-q1c (setup-q1c PI manager 2026-05-23)", () => {
    // setup-q1c (lab head follow-up) sits between setup-q1 and setup-q2
    // for lab accounts only. Backstep from setup-q2 for a lab user
    // lands on setup-q1c; backstep from setup-q1c lands on setup-q1.
    const p = picks({ account_type: "lab" });
    expect(getPreviousStep("setup-q2", p)).toBe("setup-q1c");
    expect(getPreviousStep("setup-q1c", p)).toBe("setup-q1");
  });

  it("conditional-on backstep traverses the conditional step", () => {
    const p = picks({ purchases: "yes" });
    // "calendar" is gated out (calendar=no), so backstep from
    // "lab-prompt" with lab=solo → first non-lab non-calendar before.
    // Easier check: from "calendar" with all-no, getPreviousStep should
    // skip purchases too (gated out under all-no).
    const allNo = picks({ purchases: "no", calendar: "no", telegram: "no" });
    // §6.12 Wiki pointer multi-beat redesign 2026-05-22: the cluster's
    // terminal beat is `wiki-pointer-back-demo`, so backstep from
    // `calendar` under all-no picks lands there (skipping the gated-out
    // purchases / telegram / links cluster between).
    expect(getPreviousStep("calendar", allNo)).toBe("wiki-pointer-back-demo");
    // With purchases=yes, backstep from "calendar" lands on the LAST
    // applicable purchases cluster step (purchases-back-to-real per
    // the redesign 2026-05-22). Per the cluster order in TOUR_STEP_ORDER.
    expect(getPreviousStep("calendar", p)).toBe("purchases-back-to-real");
  });

  it("returns null for unknown current id", () => {
    expect(getPreviousStep("not-a-real-step", picks())).toBeNull();
  });

  it("backstep from hybrid-notes-vs-results lands on experiment-attach-method-tab, not anywhere in the methods cluster (back-nav jump fix manager 2026-05-27)", () => {
    // Grant's repro: after the duplicate-id dedup landed (commit d42461c4),
    // clicking Back on hybrid-notes-vs-results (HE-0) was still observed
    // jumping to somewhere in the §6.7c methods cluster (methods-create or
    // similar). Per TOUR_STEP_ORDER the immediate predecessor of HE-0 is
    // experiment-attach-method-tab; no gating predicate hides it, so
    // backstep MUST land there under every picks shape.
    //
    // Belt-and-suspenders coverage: assert NOT inside the methods cluster
    // (which would be the symptom of the bug) AND assert that the back-
    // step lands precisely on experiment-attach-method-tab.
    const methodsClusterIds = new Set([
      "methods-category-prompt",
      "methods-category-open",
      "methods-category",
      "methods-open-picker",
      "methods-type-tour",
      "methods-lc-demo",
      "methods-create",
    ]);

    const shapes: Array<[string, FeaturePicks | null]> = [
      ["null picks", null],
      ["default picks", picks()],
      ["solo + all conditional", picks({
        account_type: "solo",
        purchases: "yes",
        calendar: "yes",
        goals: "yes",
        telegram: "yes",
        ai_helper: "full",
        links: "yes",
      })],
      ["lab + all conditional", picks({
        account_type: "lab",
        purchases: "yes",
        calendar: "yes",
        goals: "yes",
        telegram: "yes",
        ai_helper: "full",
        links: "yes",
      })],
    ];

    for (const [label, p] of shapes) {
      const prev = getPreviousStep("hybrid-notes-vs-results", p);
      expect(prev, `back from hybrid-notes-vs-results under ${label}`).toBe(
        "experiment-attach-method-tab",
      );
      expect(
        methodsClusterIds.has(prev as string),
        `back from hybrid-notes-vs-results landed inside methods cluster (${prev}) under ${label}`,
      ).toBe(false);
    }
  });
});

describe("firstApplicableStep / totalApplicableSteps / applicableStepIndex", () => {
  it("firstApplicableStep returns welcome under every picks shape", () => {
    expect(firstApplicableStep(null)).toBe("welcome");
    expect(firstApplicableStep(picks())).toBe("welcome");
    expect(firstApplicableStep(picks({ account_type: "lab" }))).toBe("welcome");
  });

  it("totalApplicableSteps reflects gating", () => {
    const soloMin = picks({ account_type: "solo" });
    const labMax = picks({
      account_type: "lab",
      purchases: "yes",
      calendar: "yes",
      goals: "yes",
      telegram: "yes",
      ai_helper: "full",
      // Lab Links manager 2026-05-22: maximal picks include links=yes
      // so labCount === TOUR_STEP_ORDER.length (no conditionals gated
      // out for the maximal lab path).
      links: "yes",
    });
    const soloCount = totalApplicableSteps(soloMin);
    const labCount = totalApplicableSteps(labMax);
    expect(labCount).toBeGreaterThan(soloCount);
    // Gantt + Purchases + Hybrid combined math (R4 lab-overview
    // placeholder nuker, 2026-05-23):
    //
    // Gantt manager: lab tour Phase 3 retired (lab-prompt /
    // lab-spawn-beakerbot / lab-permission-practice gone), only
    // lab-cleanup survives. §6.8 Gantt share cluster adds 7 lab-only
    // steps gated on account_type === "lab".
    //
    // Purchases manager: single `purchases` id grew into an 8-step
    // cluster (purchases-intro through purchases-back-to-real).
    //
    // Inline-editor collapse (onboarding-inline bot 2026-06-02): the prior
    // HE-3 (`hybrid-markdown-overview`) branch-gated step was removed with
    // the markdown deep-dive collapse, so it no longer contributes a
    // gated-out step to either path. The solo constant drops from 30 to 29.
    //
    // R4 lab-overview placeholder nuker 2026-05-23: the 6 placeholder
    // lab-overview-* bodies R4 shipped were throwaway and have been
    // removed from TOUR_STEP_ORDER ahead of the Mira-substrate
    // walkthrough redesign. The cluster no longer contributes to the
    // gated-step math on either path.
    //
    // setup-q1c lab head manager 2026-05-23: added one new modal-setup
    // step (`setup-q1c`) gated on `account_type === "lab"`. Solo
    // accounts skip it; lab accounts (regardless of lab_head) see it
    // once and then branch.
    //
    // §6.10 Settings phase redesign 2026-05-22 (Settings manager):
    // ai-helper-deep-explain split into 3 beats (size-diff, paste,
    // agentic) sharing the prior ai_helper ∈ {full,medium,minimal}
    // gate. 7 settings-tour-* beats added; calendar gates on
    // calendar=yes, telegram gates on telegram=yes, account-type-toggle
    // gates on account_type=solo.
    //
    // Solo+minimal skips: 4 prior conditionals (telegram, calendar,
    // links, gantt-goals-overview) + 4 ai-helper-* (Wave 1 2026-05-27
    // added ai-helper-size-options to the trio, all 4 share the same
    // gate) + 8 purchases cluster + 1 lab-cleanup + 10 Gantt share
    // cluster + 1 settings-tour-* conditional (telegram; calendar's
    // settings beat retired 2026-05-27, account-type-toggle FIRES for
    // solo) + 1 setup-q1c (lab-only) = 29 gated out for solo. Constant
    // dropped from 28 to 27 on 2026-05-27 when the settings-tour-calendar
    // step was retired, then rose from 27 to 29 on 2026-05-28 when
    // share-back user-action manager split gantt-share-user-shares-back
    // into 3 lab-only beats, then rose from 29 to 30 on 2026-05-28 when
    // share-dialog manager split gantt-share-user-fills-dialog into Add +
    // Save beats, then dropped from 30 to 29 on 2026-06-02 when the
    // inline-editor collapse removed the branch-gated HE-3
    // (hybrid-markdown-overview) from TOUR_STEP_ORDER.
    expect(soloCount).toBe(TOUR_STEP_ORDER.length - 29);
    // Lab+max: inline-editor collapse (onboarding-inline bot 2026-06-02)
    // removed the branch-gated HE-3 (hybrid-markdown-overview), which used
    // to be gated out on the lab path too. Now only
    // settings-tour-account-type-toggle (gates on solo, so lab skips it)
    // is gated out = 1 gated out (was 2).
    expect(labCount).toBe(TOUR_STEP_ORDER.length - 1);
  });

  it("applicableStepIndex is 1-based and skips gated steps", () => {
    const p = picks({ account_type: "solo" });
    expect(applicableStepIndex("welcome", p)).toBe(1);
    // setup-q1 is the 2nd applicable step
    expect(applicableStepIndex("setup-q1", p)).toBe(2);
    // setup-q2 is the 3rd applicable step (q1a/q1b removed 2026-05-22)
    expect(applicableStepIndex("setup-q2", p)).toBe(3);
  });

  it("applicableStepIndex returns 0 for a gated-out current", () => {
    const p = picks({ account_type: "solo" });
    // Gantt manager 2026-05-22: lab-prompt removed from TOUR_STEP_ORDER.
    // gantt-share-intro is the new gated-on-solo step we can probe.
    expect(applicableStepIndex("gantt-share-intro", p)).toBe(0);
  });
});

// R4 Lab Overview tour cluster — RETIRED 2026-05-23. The 6 placeholder
// bodies R4 shipped were throwaway; Grant chose nuke-now-rebuild-fresh
// ahead of the Mira-substrate walkthrough redesign. The corresponding
// describe block (cluster-order + gate + walk-forward assertions) was
// deleted alongside the step-machine constants. Future Mira-substrate
// rebuild will introduce a fresh test suite for whatever ids replace
// this slot.

