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
    expect(TOUR_STEP_ORDER).toContain("methods-open-picker");
    expect(TOUR_STEP_ORDER).toContain("methods-create");
    // §6.7 hybrid editor redesign (Hybrid editor manager 2026-05-22):
    // the old "hybrid-editor" id is gone; the new shape uses HE-0 → HE-11
    // ids starting with hybrid-notes-vs-results.
    expect(TOUR_STEP_ORDER).toContain("hybrid-notes-vs-results");
    expect(TOUR_STEP_ORDER).toContain("hybrid-markdown-familiarity");
    expect(TOUR_STEP_ORDER).toContain("hybrid-file-attach");
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
    expect(TOUR_STEP_ORDER).toContain("settings-tour-calendar");
    expect(TOUR_STEP_ORDER).toContain("settings-tour-telegram");
    expect(TOUR_STEP_ORDER).toContain("settings-tour-lab-mode-toggle");
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
    // manager R1 2026-05-22). Universal steps inserted between
    // hybrid-file-attach and gantt-intro. The prior
    // `workbench-list-add-items` beat was folded into
    // `workbench-list-create-shell` (one continuous cursor script).
    expect(TOUR_STEP_ORDER).toContain("workbench-notes-intro");
    expect(TOUR_STEP_ORDER).toContain("workbench-notes-create");
    expect(TOUR_STEP_ORDER).toContain("workbench-lists-intro");
    expect(TOUR_STEP_ORDER).toContain("workbench-list-create-shell");
    expect(TOUR_STEP_ORDER).toContain("workbench-list-mark-done");
    expect(TOUR_STEP_ORDER).not.toContain("workbench-list-add-items");
    // Cleanup retirement 2026-05-22 (Cleanup manager R2): the prior
    // `phase4-cleanup` interactive grid is gone; the terminal step is
    // now `tour-goodbye` (auto-cleanup + animation outro). The old id
    // must NOT be present so a stale resume_state record can't pin the
    // controller to a step that no longer exists.
    expect(TOUR_STEP_ORDER).toContain("tour-goodbye");
    expect(TOUR_STEP_ORDER).not.toContain("phase4-cleanup");
  });

  it("inserts the §6.7b Workbench Notes + Lists cluster between hybrid-file-attach and gantt-intro", () => {
    // Workbench expansion manager 2026-05-22, collapsed to 5 beats by
    // Workbench fix manager R1 2026-05-22: universal steps sit BETWEEN
    // the §6.7 terminal beat (hybrid-file-attach) and the §6.8 first
    // beat (gantt-intro). Order matters because each step builds on
    // the prior one's DOM state. R1 folded `workbench-list-add-items`
    // into `workbench-list-create-shell` so add-items is no longer a
    // separate beat.
    const order = [
      "hybrid-file-attach",
      "workbench-notes-intro",
      "workbench-notes-create",
      "workbench-lists-intro",
      "workbench-list-create-shell",
      "workbench-list-mark-done",
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

  it("the §6.7b Workbench cluster is universal (no feature_picks gating)", () => {
    // All six steps fire for every user — the Workbench tabs (Notes,
    // Lists) exist regardless of account_type / purchases / calendar /
    // any other pick. Verify with two contrasting pick configs.
    const universal = [
      "workbench-notes-intro",
      "workbench-notes-create",
      "workbench-lists-intro",
      "workbench-list-create-shell",
      "workbench-list-mark-done",
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

  it("places methods-open-picker between methods-category and methods-type-tour (sub-bot 2026-05-21)", () => {
    // §6.4 open-picker beat sits between finishing the category and the
    // wall of type-breadth speech. The cursor click on "+ New Method"
    // owns the modal-open transition before the type-tour body fires.
    const categoryIdx = TOUR_STEP_ORDER.indexOf("methods-category");
    const openPickerIdx = TOUR_STEP_ORDER.indexOf("methods-open-picker");
    const typeTourIdx = TOUR_STEP_ORDER.indexOf("methods-type-tour");
    expect(categoryIdx).toBeGreaterThanOrEqual(0);
    expect(openPickerIdx).toBeGreaterThan(categoryIdx);
    expect(typeTourIdx).toBeGreaterThan(openPickerIdx);
  });

  it("walks the methods-type-tour deep-demo arc in PCR-then-LC order (Grant 2026-05-21 rework)", () => {
    // §6.4b: methods-type-tour mounts the PCR builder (manual-advance
    // pause for exploration), then methods-lc-demo mounts the LC
    // builder (manual-advance pause), then methods-create takes over
    // with Standard Markdown. The intermediate PCR sub-steps (edit /
    // add-cycle / confirm-cycle) were removed per Grant's feedback
    // that the click-around drama moved too fast to follow.
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

  it("orders the §6.7 hybrid-editor redesign cluster HE-0 through HE-11 (Hybrid editor manager 2026-05-22)", () => {
    const order = [
      "hybrid-notes-vs-results",
      "hybrid-markdown-intro",
      "hybrid-markdown-familiarity",
      "hybrid-markdown-overview",
      "hybrid-editor-mechanic",
      "hybrid-bold",
      "hybrid-italic",
      "hybrid-underline",
      "hybrid-h1",
      "hybrid-h2",
      "hybrid-h3",
      "hybrid-shortcuts",
      "hybrid-image-attach",
      "hybrid-image-drag-in",
      "hybrid-image-resize",
      "hybrid-file-attach",
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

  it("gates the three new ai-helper-* beats on the same ai_helper picks", () => {
    // §6.10 Settings phase redesign 2026-05-22 (Settings manager): the
    // ai-helper trio shares the prior single-step gate so opt-out users
    // (no / maybe) skip the entire arc just as before.
    const trio = [
      "ai-helper-size-diff",
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

  it("gates settings-tour-calendar on picks.calendar === 'yes'", () => {
    expect(
      isStepGatedOut("settings-tour-calendar", picks({ calendar: "yes" })),
    ).toBe(false);
    expect(
      isStepGatedOut("settings-tour-calendar", picks({ calendar: "no" })),
    ).toBe(true);
    expect(
      isStepGatedOut("settings-tour-calendar", picks({ calendar: "maybe" })),
    ).toBe(true);
    expect(isStepGatedOut("settings-tour-calendar", null)).toBe(true);
  });

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

  it("gates settings-tour-lab-mode-toggle on solo accounts only", () => {
    // Lab users are already in lab mode, so they skip this beat. Solo
    // users see it so they know how to flip over later.
    expect(
      isStepGatedOut(
        "settings-tour-lab-mode-toggle",
        picks({ account_type: "solo" }),
      ),
    ).toBe(false);
    expect(
      isStepGatedOut(
        "settings-tour-lab-mode-toggle",
        picks({ account_type: "lab" }),
      ),
    ).toBe(true);
    // null picks → no account_type → gate-out (defensive).
    expect(isStepGatedOut("settings-tour-lab-mode-toggle", null)).toBe(true);
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

  it("orders the §6.10 Settings cluster: color → 7 tour beats → 3 ai-helper beats", () => {
    const order = [
      "personalization-color",
      "settings-tour-folder",
      "settings-tour-calendar",
      "settings-tour-telegram",
      "settings-tour-lab-mode-toggle",
      "settings-tour-visible-tabs",
      "settings-tour-streak",
      "settings-tour-rerun",
      "ai-helper-size-diff",
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
    // solo account_type === "solo", so lab-mode-toggle DOES fire.
    expect(visited).toContain("settings-tour-lab-mode-toggle");
    expect(visited).toContain("settings-tour-folder");
    expect(visited).toContain("settings-tour-visible-tabs");
    expect(visited).toContain("settings-tour-streak");
    expect(visited).toContain("settings-tour-rerun");
    // Always includes core walkthrough
    expect(visited).toContain("home-create-project");
    expect(visited).toContain("methods-open-picker");
    expect(visited).toContain("methods-create");
    // §6.7 hybrid editor redesign (Hybrid editor manager 2026-05-22):
    // first id of the new cluster is hybrid-notes-vs-results (HE-0).
    expect(visited).toContain("hybrid-notes-vs-results");
    expect(visited).toContain("hybrid-shortcuts");
    expect(visited).toContain("hybrid-file-attach");
    expect(visited).toContain("gantt-drag-drop");
    // Terminates at tour-goodbye (Cleanup retirement 2026-05-22).
    expect(visited[visited.length - 1]).toBe("tour-goodbye");
  });

  it("lab + all conditionals walks the maximal path", () => {
    const p = picks({
      account_type: "lab",
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
    // lab-mode-toggle because they're already in lab mode.
    expect(visited).not.toContain("ai-helper-deep-explain");
    expect(visited).toContain("ai-helper-size-diff");
    expect(visited).toContain("ai-helper-use-case-paste");
    expect(visited).toContain("ai-helper-use-case-agentic");
    expect(visited).toContain("settings-tour-folder");
    expect(visited).toContain("settings-tour-calendar");
    expect(visited).toContain("settings-tour-telegram");
    expect(visited).not.toContain("settings-tour-lab-mode-toggle");
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

  it("lab-from-q1 lands on setup-q2 (q1a/q1b removed 2026-05-22)", () => {
    // setup-q1a (lab storage picker) + setup-q1b (lab connect info)
    // were dropped from the v4 setup phase. Lab storage is decided in
    // pre-onboarding §6.4 (cloud-provider screen) now. So setup-q1
    // advances straight to setup-q2 for lab users, same as solo.
    const p = picks({ account_type: "lab" });
    expect(getNextStep("setup-q1", p)).toBe("setup-q2");
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

  it("lab backstep from setup-q2 also lands on setup-q1 (q1a/q1b removed 2026-05-22)", () => {
    // setup-q1a / setup-q1b dropped from the v4 setup phase; lab
    // storage decision moved to pre-onboarding §6.4. Backstep behavior
    // for lab is now identical to solo.
    const p = picks({ account_type: "lab" });
    expect(getPreviousStep("setup-q2", p)).toBe("setup-q1");
  });

  it("conditional-on backstep traverses the conditional step", () => {
    const p = picks({ purchases: "yes" });
    // "calendar" is gated out (calendar=no), so backstep from
    // "lab-prompt" with lab=solo → first non-lab non-calendar before.
    // Easier check: from "calendar" with all-no, getPreviousStep should
    // skip purchases too (gated out under all-no).
    const allNo = picks({ purchases: "no", calendar: "no", telegram: "no" });
    expect(getPreviousStep("calendar", allNo)).toBe("wiki-pointer");
    // With purchases=yes, backstep from "calendar" lands on the LAST
    // applicable purchases cluster step (purchases-back-to-real per
    // the redesign 2026-05-22). Per the cluster order in TOUR_STEP_ORDER.
    expect(getPreviousStep("calendar", p)).toBe("purchases-back-to-real");
  });

  it("returns null for unknown current id", () => {
    expect(getPreviousStep("not-a-real-step", picks())).toBeNull();
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
    // Gantt + Purchases + Hybrid + Lab Mode combined math (2026-05-22):
    //
    // Gantt manager: lab tour Phase 3 retired (lab-prompt /
    // lab-spawn-beakerbot / lab-permission-practice gone), only
    // lab-cleanup survives. §6.8 Gantt share cluster adds 7 lab-only
    // steps gated on account_type === "lab".
    //
    // Purchases manager: single `purchases` id grew into an 8-step
    // cluster (purchases-intro through purchases-back-to-real).
    //
    // Hybrid fix R1 (P1 #7): HE-3 (`hybrid-markdown-overview`) is
    // gated by the in-tour branchOn choice at HE-2. The choice cache
    // is empty at module load (no branch click fired), so the gate
    // evaluates to "gated out" — applies to both solo and lab paths.
    //
    // Lab Mode manager: §6.16 Phase 2c Lab Mode tour cluster adds 12
    // more lab-only steps (lab-mode-prompt through lab-mode-exit).
    //
    // §6.10 Settings phase redesign 2026-05-22 (Settings manager):
    // ai-helper-deep-explain split into 3 beats (size-diff, paste,
    // agentic) sharing the prior ai_helper ∈ {full,medium,minimal}
    // gate. 7 settings-tour-* beats added; calendar gates on
    // calendar=yes, telegram gates on telegram=yes, lab-mode-toggle
    // gates on account_type=solo.
    //
    // §6.16 Lab Mode tour: 12 lab-only steps still in the order.
    //
    // Solo+minimal skips: 4 prior conditionals (telegram, calendar,
    // links, gantt-goals-overview) + 3 ai-helper-* (was 1
    // ai-helper-deep-explain; now 3 split beats sharing the same gate)
    // + 8 purchases cluster + 1 lab-cleanup + 7 Gantt share cluster
    // + 12 Lab Mode cluster + 1 HE-3 (branch-gated) + 2
    // settings-tour-* conditional (calendar, telegram; lab-mode-toggle
    // FIRES for solo) = 38 gated out for solo.
    expect(soloCount).toBe(TOUR_STEP_ORDER.length - 38);
    // Lab+max: HE-3 still branch-gated (user hasn't picked the
    // overview branch yet at static evaluation time) + settings-tour-
    // lab-mode-toggle gates out for lab = 2 gated out.
    expect(labCount).toBe(TOUR_STEP_ORDER.length - 2);
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

// =============================================================================
// §6.16 Phase 2c Lab Mode tour cluster (Lab Mode redesign 2026-05-22).
// 12 new step ids inserted between the conditional walkthrough cluster
// (telegram / purchases / calendar / links) and `lab-cleanup`. All gate
// on `picks.account_type === "lab"`. The prompt step's branchOn handles
// the Later / Dismiss skip path by jumping straight to lab-cleanup.
// =============================================================================
const LAB_MODE_CLUSTER = [
  "lab-mode-prompt",
  "lab-mode-intro",
  "lab-mode-warp-to-demo",
  "lab-mode-activity",
  "lab-mode-gantt",
  "lab-mode-experiments",
  "lab-mode-purchases",
  "lab-mode-roadmaps",
  "lab-mode-methods",
  "lab-mode-notes",
  "lab-mode-search",
  "lab-mode-exit",
] as const;

describe("TOUR_STEP_ORDER — §6.16 lab-mode cluster (Lab Mode manager 2026-05-22)", () => {
  it("includes every lab-mode-* step id in cluster order", () => {
    const indices = LAB_MODE_CLUSTER.map((id) => TOUR_STEP_ORDER.indexOf(id));
    indices.forEach((idx, i) => {
      expect(idx, `${LAB_MODE_CLUSTER[i]} missing`).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(
          idx,
          `${LAB_MODE_CLUSTER[i]} must follow ${LAB_MODE_CLUSTER[i - 1]}`,
        ).toBe(indices[i - 1] + 1);
      }
    });
  });

  it("sits before lab-cleanup in TOUR_STEP_ORDER", () => {
    const exitIdx = TOUR_STEP_ORDER.indexOf("lab-mode-exit");
    const cleanupIdx = TOUR_STEP_ORDER.indexOf("lab-cleanup");
    expect(exitIdx).toBeGreaterThanOrEqual(0);
    expect(cleanupIdx).toBeGreaterThan(exitIdx);
  });

  it("gates every step on picks.account_type === 'lab'", () => {
    const lab = picks({ account_type: "lab" });
    const solo = picks({ account_type: "solo" });
    for (const id of LAB_MODE_CLUSTER) {
      expect(isStepGatedOut(id, solo), `${id} should hide for solo`).toBe(true);
      expect(isStepGatedOut(id, lab), `${id} should show for lab`).toBe(false);
    }
    // null picks → all hide.
    for (const id of LAB_MODE_CLUSTER) {
      expect(isStepGatedOut(id, null), `${id} should hide for null picks`).toBe(
        true,
      );
    }
  });

  it("solo walk skips the entire lab-mode cluster", () => {
    const visited = walkForward("welcome", picks({ account_type: "solo" }));
    for (const id of LAB_MODE_CLUSTER) {
      expect(visited).not.toContain(id);
    }
  });

  it("lab walk includes every lab-mode cluster step", () => {
    const visited = walkForward("welcome", picks({ account_type: "lab" }));
    for (const id of LAB_MODE_CLUSTER) {
      expect(visited).toContain(id);
    }
  });

  it("getNextStep on lab-mode-prompt with lab picks lands on lab-mode-intro", () => {
    // The branchOn affordances inside the prompt body override this
    // linear traversal — but getNextStep itself must keep walking the
    // order so a back-step from lab-mode-intro returns here.
    expect(
      getNextStep("lab-mode-prompt", picks({ account_type: "lab" })),
    ).toBe("lab-mode-intro");
  });

  it("getNextStep on lab-mode-exit with lab picks lands on lab-cleanup", () => {
    expect(
      getNextStep("lab-mode-exit", picks({ account_type: "lab" })),
    ).toBe("lab-cleanup");
  });
});

