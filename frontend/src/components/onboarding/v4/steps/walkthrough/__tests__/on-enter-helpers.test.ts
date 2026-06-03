// @vitest-environment jsdom
//
// tour-popup-resilience bot 2026-06-03: the file gained DOM-driven tests
// for ensureExperimentPopupOpen, so it runs under jsdom. The pre-existing
// goals/deps guards are DOM-free and unaffected (their popup-close prelude
// no-ops when no popup button is mounted, in node OR jsdom).
/**
 * Tests for the §6.10 onEnter helpers' defensive guards. Wave 1 sidecar
 * hardening manager (v2) 2026-05-22.
 *
 * Pins the defensive guards added by the v2 hardening pass:
 *
 *   - `onEnterGanttGoalsOverview`: when the goal-create branch lands a
 *     null id (typed but defensively guarded), the helper logs + skips
 *     the artifact persist instead of appending `"null"` to
 *     `wizard_resume_state.artifacts_created`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const projectsListMock = vi.fn();
const tasksListMock = vi.fn();
const goalsListMock = vi.fn();
const goalsCreateMock = vi.fn();
const depsCreateMock = vi.fn();
const fetchAllTasksMock = vi.fn().mockResolvedValue([]);
const patchOnboardingMock = vi.fn().mockResolvedValue(undefined);
const refetchQueriesMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/local-api", () => ({
  tasksApi: {
    listByProject: (id: number) => tasksListMock(id),
  },
  projectsApi: {
    list: () => projectsListMock(),
  },
  dependenciesApi: {
    create: (data: unknown) => depsCreateMock(data),
  },
  goalsApi: {
    list: () => goalsListMock(),
    create: (data: unknown) => goalsCreateMock(data),
  },
  fetchAllTasks: () => fetchAllTasksMock(),
}));

vi.mock("@/lib/onboarding/sidecar", () => ({
  patchOnboarding: (
    username: string,
    patch: (s: unknown) => unknown,
  ) => patchOnboardingMock(username, patch),
}));

vi.mock("@/lib/query-client", () => ({
  appQueryClient: {
    refetchQueries: () => refetchQueriesMock(),
  },
}));

vi.mock("@/lib/attachments/attach-image", () => ({
  attachImageToTask: vi.fn(),
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    fileExists: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock("@/lib/tasks/results-paths", () => ({
  taskNotesBase: ({ id }: { id: number }) =>
    `users/u/results/task-${id}/notes`,
}));

vi.mock("../lib/artifacts", () => ({
  appendArtifact: (cur: unknown) => cur,
  encodeTelegramImageId: (filename: string) => filename,
}));

// tour-popup-resilience bot 2026-06-03: isolate the popup-reopen DOM
// behavior from the experiment-create plumbing. ensureFirstExperimentExists
// is exercised by its own ensure-helpers tests; here we only assert the
// reopen helper's detect-open / row-click / tab-activate logic.
const ensureFirstExperimentExistsMock = vi
  .fn()
  .mockResolvedValue({ id: 1, name: "First experiment" });
vi.mock("../lib/ensure-helpers", () => ({
  ensureFirstExperimentExists: () => ensureFirstExperimentExistsMock(),
}));

import {
  onEnterGanttGoalsOverview,
  GANTT_DEMO_GOAL_NAME,
  ensureExperimentPopupOpen,
  withExperimentPopupOpen,
  ensureNewMethodModalOpen,
  withNewMethodModalOpen,
  ensureCategoryModalOpen,
  withCategoryModalOpen,
  ensureCreateExperimentModalOpen,
  withCreateExperimentModalOpen,
  rehydrateExperimentSubmitGate,
  ensureGanttSharePopupOpen,
  withGanttSharePopupOpen,
  ensureShareDialogOpen,
  withShareDialogOpen,
} from "../lib/on-enter-helpers";

describe("on-enter-helpers defensive guards (Wave 1 sidecar hardening v2)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    projectsListMock.mockReset();
    tasksListMock.mockReset();
    goalsListMock.mockReset();
    goalsCreateMock.mockReset();
    depsCreateMock.mockReset();
    fetchAllTasksMock.mockReset();
    fetchAllTasksMock.mockResolvedValue([]);
    patchOnboardingMock.mockClear();
    refetchQueriesMock.mockClear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  describe("onEnterGanttGoalsOverview createdId guard", () => {
    it("returns the existing goal id when one already exists (idempotent)", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo", created_at: "2026-01-01" },
      ]);
      goalsListMock.mockResolvedValue([
        { id: 99, project_id: 7, name: GANTT_DEMO_GOAL_NAME },
      ]);

      const result = await onEnterGanttGoalsOverview({ username: "alex" });

      expect(result).toBe(99);
      // No goal create on the idempotent path.
      expect(goalsCreateMock).not.toHaveBeenCalled();
    });

    it("returns null + does NOT persist artifact when goal create fails", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo", created_at: "2026-01-01" },
      ]);
      goalsListMock.mockResolvedValue([]);
      goalsCreateMock.mockRejectedValue(new Error("create blew up"));

      const result = await onEnterGanttGoalsOverview({ username: "alex" });

      expect(result).toBeNull();
      // patchOnboarding should NOT be invoked with a null id — the
      // guard skips the artifact persist when createdId stayed null.
      expect(patchOnboardingMock).not.toHaveBeenCalled();
    });

    // gantt-share fix manager (BUG 2): the goals step's authored body
    // closed a leftover popup in its onEnter, but the registry binding
    // overrides that onEnter with onEnterGanttGoalsOverview, so the close
    // was dead and the goals speech showed on top of Fake A's stale
    // popup. The close now lives in onEnterGanttGoalsOverview (the onEnter
    // the registry actually wires). The popup-close path uses
    // `typeof document === "undefined"` as its guard, so in this node-env
    // suite it is a safe no-op; the assertion here is that folding the
    // close into the helper did NOT break the goal-resolution path it
    // shares an onEnter with.
    it("still resolves the goal id with the popup-close prelude in place", async () => {
      projectsListMock.mockResolvedValue([
        { id: 7, name: "Demo", created_at: "2026-01-01" },
      ]);
      goalsListMock.mockResolvedValue([
        { id: 99, project_id: 7, name: GANTT_DEMO_GOAL_NAME },
      ]);
      const result = await onEnterGanttGoalsOverview({ username: "alex" });
      expect(result).toBe(99);
    });
  });
});

/**
 * tour-popup-resilience bot 2026-06-03: the experiment TaskDetailPopup is
 * opened by ONE step and every later §6.6/§6.7/§6.7d step lives inside it.
 * A mid-tour refresh closes the popup (portal state, not a route), so the
 * tour resumed on a popup-dependent step whose target no longer existed.
 * ensureExperimentPopupOpen reopens it by reusing the documented open path
 * (Experiments tab → ensure experiment → DOM-click the row).
 */
describe("ensureExperimentPopupOpen (tour-popup-resilience)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    ensureFirstExperimentExistsMock.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  /** Mount a fake experiment popup tab-strip (the stable open-marker). */
  function mountPopup(): void {
    const strip = document.createElement("div");
    strip.setAttribute("data-tour-target", "experiment-tab-container");
    const notes = document.createElement("button");
    notes.setAttribute("data-tour-target", "experiment-notes-tab");
    const methods = document.createElement("button");
    methods.setAttribute("data-tour-target", "experiment-methods-tab");
    strip.appendChild(notes);
    strip.appendChild(methods);
    document.body.appendChild(strip);
  }

  it("no-ops when the popup is already open (canonical path)", async () => {
    mountPopup();
    await ensureExperimentPopupOpen();
    // Never tried to reopen: no experiment-create + no workbench-tab click.
    expect(ensureFirstExperimentExistsMock).not.toHaveBeenCalled();
  });

  it("reopens the popup by clicking the experiment row when closed", async () => {
    // Experiments-tab button (so switchWorkbenchTab has a target) + a row.
    const tabBtn = document.createElement("button");
    tabBtn.setAttribute("data-tour-target", "workbench-experiments-tab");
    document.body.appendChild(tabBtn);

    const row = document.createElement("div");
    row.setAttribute("data-tour-target", "workbench-experiment-row-1");
    let rowClicked = false;
    row.addEventListener("click", () => {
      rowClicked = true;
      // Simulate the popup mounting in response to the row click.
      mountPopup();
    });
    document.body.appendChild(row);

    await ensureExperimentPopupOpen();

    expect(ensureFirstExperimentExistsMock).toHaveBeenCalledTimes(1);
    expect(rowClicked).toBe(true);
    expect(
      document.querySelector('[data-tour-target="experiment-tab-container"]'),
    ).not.toBeNull();
  });

  it("activates the requested tab after a reopen", async () => {
    const tabBtn = document.createElement("button");
    tabBtn.setAttribute("data-tour-target", "workbench-experiments-tab");
    document.body.appendChild(tabBtn);

    let methodsTabClicked = false;
    const row = document.createElement("div");
    row.setAttribute("data-tour-target", "workbench-experiment-row-1");
    row.addEventListener("click", () => {
      mountPopup();
      const methods = document.querySelector(
        '[data-tour-target="experiment-methods-tab"]',
      );
      methods?.addEventListener("click", () => {
        methodsTabClicked = true;
      });
    });
    document.body.appendChild(row);

    await ensureExperimentPopupOpen("experiment-methods-tab");
    expect(methodsTabClicked).toBe(true);
  });

  it("does not throw when no row ever mounts (best-effort)", async () => {
    const tabBtn = document.createElement("button");
    tabBtn.setAttribute("data-tour-target", "workbench-experiments-tab");
    document.body.appendChild(tabBtn);
    // No row in the DOM -> waitForElement times out and we return quietly.
    await expect(ensureExperimentPopupOpen()).resolves.toBeUndefined();
  });

  it("withExperimentPopupOpen runs the reopen first, then the inner onEnter", async () => {
    mountPopup(); // already open -> reopen is a no-op
    const order: string[] = [];
    const inner = vi.fn(async () => {
      order.push("inner");
    });
    await withExperimentPopupOpen(inner)({ username: "alex" });
    expect(inner).toHaveBeenCalledWith({ username: "alex" });
    expect(order).toEqual(["inner"]);
  });
});

/**
 * tour-modal-resilience bot 2026-06-03: mirror the experiment-popup
 * resilience tests for the §6.4 New Method modal (CreateMethodModal),
 * the §6.4 New Category modal, and the §6.5 Create Experiment modal
 * (TaskModal). Each helper detects-open by a stable DOM anchor and, when
 * closed, reopens via the same trigger the tour's "open" bridge step
 * uses. Tests assert no-op-when-open, reopen-when-closed, and the
 * with*Open composer ordering.
 */
describe("ensureNewMethodModalOpen (tour-modal-resilience §6.4)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  /** Mount the New Method modal card (the stable open-marker). */
  function mountModal(): void {
    const card = document.createElement("div");
    card.setAttribute("data-tour-target", "methods-create-form");
    document.body.appendChild(card);
  }

  it("no-ops when the modal is already open", async () => {
    mountModal();
    // A trigger is present; if the helper tried to reopen it would click.
    const trigger = document.createElement("button");
    trigger.setAttribute("data-tour-target", "methods-new-method-button");
    let clicked = false;
    trigger.addEventListener("click", () => {
      clicked = true;
    });
    document.body.appendChild(trigger);

    await ensureNewMethodModalOpen();
    expect(clicked).toBe(false);
  });

  it("reopens by clicking + New Method when closed", async () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("data-tour-target", "methods-new-method-button");
    let clicked = false;
    trigger.addEventListener("click", () => {
      clicked = true;
      mountModal(); // simulate the modal mounting on the click
    });
    document.body.appendChild(trigger);

    await ensureNewMethodModalOpen();
    expect(clicked).toBe(true);
    expect(
      document.querySelector('[data-tour-target="methods-create-form"]'),
    ).not.toBeNull();
  });

  it("does not throw when no trigger ever mounts (best-effort)", async () => {
    await expect(ensureNewMethodModalOpen()).resolves.toBeUndefined();
  });

  it("withNewMethodModalOpen runs the reopen first, then the inner onEnter", async () => {
    mountModal(); // already open -> reopen no-op
    const inner = vi.fn(async () => undefined);
    await withNewMethodModalOpen(inner)({ username: "alex" });
    expect(inner).toHaveBeenCalledWith({ username: "alex" });
  });
});

describe("ensureCategoryModalOpen (tour-modal-resilience §6.4)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  function mountModal(): void {
    const input = document.createElement("input");
    input.setAttribute("data-tour-target", "methods-category-name-input");
    document.body.appendChild(input);
  }

  it("no-ops when the category modal is already open", async () => {
    mountModal();
    const trigger = document.createElement("button");
    trigger.setAttribute("data-tour-target", "methods-add-category");
    let clicked = false;
    trigger.addEventListener("click", () => {
      clicked = true;
    });
    document.body.appendChild(trigger);

    await ensureCategoryModalOpen();
    expect(clicked).toBe(false);
  });

  it("reopens by clicking + New Category when closed", async () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("data-tour-target", "methods-add-category");
    let clicked = false;
    trigger.addEventListener("click", () => {
      clicked = true;
      mountModal();
    });
    document.body.appendChild(trigger);

    await ensureCategoryModalOpen();
    expect(clicked).toBe(true);
    expect(
      document.querySelector('[data-tour-target="methods-category-name-input"]'),
    ).not.toBeNull();
  });

  it("withCategoryModalOpen runs the reopen first, then the inner onEnter", async () => {
    mountModal();
    const inner = vi.fn(async () => undefined);
    await withCategoryModalOpen(inner)({ username: "alex" });
    expect(inner).toHaveBeenCalledWith({ username: "alex" });
  });
});

describe("ensureCreateExperimentModalOpen (tour-modal-resilience §6.5)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    fetchAllTasksMock.mockReset();
    fetchAllTasksMock.mockResolvedValue([]);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  /** Mount the Create Experiment modal name input (the open-marker). */
  function mountModal(): void {
    const input = document.createElement("input");
    input.setAttribute("data-tour-target", "workbench-experiment-name-input");
    document.body.appendChild(input);
  }

  /** Mount the Experiments-tab button + the +New Experiment trigger. */
  function mountTrigger(onClick: () => void): void {
    const tab = document.createElement("button");
    tab.setAttribute("data-tour-target", "workbench-experiments-tab");
    document.body.appendChild(tab);
    const trigger = document.createElement("button");
    trigger.setAttribute("data-tour-target", "workbench-new-experiment");
    trigger.addEventListener("click", onClick);
    document.body.appendChild(trigger);
  }

  it("no-ops when the modal is already open", async () => {
    mountModal();
    let clicked = false;
    mountTrigger(() => {
      clicked = true;
    });
    await ensureCreateExperimentModalOpen();
    expect(clicked).toBe(false);
  });

  it("reopens when closed AND no experiment exists yet (pre-create refresh)", async () => {
    fetchAllTasksMock.mockResolvedValue([]); // no experiment yet
    let clicked = false;
    mountTrigger(() => {
      clicked = true;
      mountModal();
    });
    await ensureCreateExperimentModalOpen();
    expect(clicked).toBe(true);
    expect(
      document.querySelector(
        '[data-tour-target="workbench-experiment-name-input"]',
      ),
    ).not.toBeNull();
  });

  it("SUPPRESSES the reopen once an experiment exists (post-create refresh)", async () => {
    // An experiment already landed on disk -> a fresh blank modal would
    // be confusing, so the helper must NOT reopen.
    fetchAllTasksMock.mockResolvedValue([
      { id: 5, task_type: "experiment", is_shared_with_me: false },
    ]);
    let clicked = false;
    mountTrigger(() => {
      clicked = true;
      mountModal();
    });
    await ensureCreateExperimentModalOpen();
    expect(clicked).toBe(false);
    expect(
      document.querySelector(
        '[data-tour-target="workbench-experiment-name-input"]',
      ),
    ).toBeNull();
  });

  it("does not throw when no trigger ever mounts (best-effort)", async () => {
    fetchAllTasksMock.mockResolvedValue([]);
    await expect(
      ensureCreateExperimentModalOpen(),
    ).resolves.toBeUndefined();
  });

  it("withCreateExperimentModalOpen runs the reopen first, then the inner onEnter", async () => {
    mountModal(); // already open -> reopen no-op
    const inner = vi.fn(async () => undefined);
    await withCreateExperimentModalOpen(inner)({ username: "alex" });
    expect(inner).toHaveBeenCalledWith({ username: "alex" });
  });
});

// tour-submit-gate bot 2026-06-03: the refresh-after-create soft-block on
// the §6.5d `workbench-create-experiment-submit` beat. The manual-advance
// is gated on `disabledUntilEvent: tour:experiment-created`, which fires
// once at create time. On a refresh AFTER the experiment was created, the
// event already fired pre-reload, so the gate never satisfies and the
// button stays permanently disabled. `rehydrateExperimentSubmitGate`
// re-dispatches `tour:experiment-created` (with the existing id) on enter
// ONLY when an experiment already exists on disk, which re-satisfies the
// gate. The CANONICAL fresh run (no experiment) must NOT dispatch, so the
// button stays disabled until the user genuinely clicks Create Experiment.
describe("rehydrateExperimentSubmitGate (refresh-after-create gate fix)", () => {
  beforeEach(() => {
    fetchAllTasksMock.mockReset();
    fetchAllTasksMock.mockResolvedValue([]);
  });

  it("REFRESH-AFTER-CREATE: re-dispatches tour:experiment-created with the existing experiment id when one exists on disk", async () => {
    fetchAllTasksMock.mockResolvedValue([
      { id: 42, task_type: "experiment", is_shared_with_me: false },
    ]);
    const events: Array<{ id?: number }> = [];
    const handler = (evt: Event) => {
      events.push((evt as CustomEvent<{ id?: number }>).detail);
    };
    window.addEventListener("tour:experiment-created", handler);
    try {
      await rehydrateExperimentSubmitGate();
    } finally {
      window.removeEventListener("tour:experiment-created", handler);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id: 42 });
  });

  it("REFRESH-AFTER-CREATE: picks the most-recently-created (max id) experiment, project-agnostic", async () => {
    // Several own experiments across projects / Standalone. The gate
    // re-dispatch carries the highest id so it resolves to one stable
    // artifact target rather than churning.
    fetchAllTasksMock.mockResolvedValue([
      { id: 7, task_type: "experiment", is_shared_with_me: false },
      { id: 99, task_type: "experiment", is_shared_with_me: false },
      { id: 12, task_type: "list", is_shared_with_me: false },
    ]);
    const events: Array<{ id?: number }> = [];
    const handler = (evt: Event) => {
      events.push((evt as CustomEvent<{ id?: number }>).detail);
    };
    window.addEventListener("tour:experiment-created", handler);
    try {
      await rehydrateExperimentSubmitGate();
    } finally {
      window.removeEventListener("tour:experiment-created", handler);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id: 99 });
  });

  it("CANONICAL FRESH RUN: does NOT dispatch when no experiment exists on disk (button stays gated until the real create event)", async () => {
    fetchAllTasksMock.mockResolvedValue([]);
    const events: Array<{ id?: number }> = [];
    const handler = (evt: Event) => {
      events.push((evt as CustomEvent<{ id?: number }>).detail);
    };
    window.addEventListener("tour:experiment-created", handler);
    try {
      await rehydrateExperimentSubmitGate();
    } finally {
      window.removeEventListener("tour:experiment-created", handler);
    }
    expect(events).toHaveLength(0);
  });

  it("CANONICAL FRESH RUN: ignores shared experiments (is_shared_with_me) so a borrowed experiment never un-gates the user's own create", async () => {
    fetchAllTasksMock.mockResolvedValue([
      { id: 5, task_type: "experiment", is_shared_with_me: true },
    ]);
    const events: Array<{ id?: number }> = [];
    const handler = (evt: Event) => {
      events.push((evt as CustomEvent<{ id?: number }>).detail);
    };
    window.addEventListener("tour:experiment-created", handler);
    try {
      await rehydrateExperimentSubmitGate();
    } finally {
      window.removeEventListener("tour:experiment-created", handler);
    }
    expect(events).toHaveLength(0);
  });

  it("best-effort: swallows a fetchAllTasks failure and does not dispatch", async () => {
    fetchAllTasksMock.mockRejectedValue(new Error("disk gone"));
    const events: unknown[] = [];
    const handler = () => events.push(1);
    window.addEventListener("tour:experiment-created", handler);
    try {
      await expect(rehydrateExperimentSubmitGate()).resolves.toBeUndefined();
    } finally {
      window.removeEventListener("tour:experiment-created", handler);
    }
    expect(events).toHaveLength(0);
  });
});

/**
 * gantt-share-resilience bot 2026-06-03: the §6.8 lab-mode share cluster's
 * mid-cluster surfaces are a Gantt TaskDetailPopup (opened from a Gantt
 * bar) and the ShareDialog opened from inside it. A mid-cluster refresh
 * closes them (portal state, not a route). ensureGanttSharePopupOpen
 * reopens the popup by clicking the cluster's open bar;
 * ensureShareDialogOpen reopens the whole chain (bar → popup → Share
 * button → dialog). Mirrors the ensureExperimentPopupOpen tests.
 */
describe("ensureGanttSharePopupOpen (gantt-share-resilience §6.8)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  /** Mount a fake task popup (the close button is the stable open-marker). */
  function mountPopup(): void {
    const close = document.createElement("button");
    close.setAttribute("data-tour-target", "task-popup-close");
    document.body.appendChild(close);
  }

  /** Mount a Gantt bar that opens the popup on click. */
  function mountBar(barTarget: string): HTMLElement {
    const bar = document.createElement("div");
    bar.setAttribute("data-tour-target", barTarget);
    document.body.appendChild(bar);
    return bar;
  }

  it("no-ops when a popup is already open (canonical path)", async () => {
    mountPopup();
    let clicked = false;
    const bar = mountBar("gantt-bar-fake-a");
    bar.addEventListener("click", () => {
      clicked = true;
    });
    await ensureGanttSharePopupOpen("gantt-bar-fake-a");
    expect(clicked).toBe(false);
  });

  it("reopens the popup by clicking the Gantt bar when closed", async () => {
    const bar = mountBar("gantt-bar-fake-a");
    let clicked = false;
    bar.addEventListener("click", () => {
      clicked = true;
      mountPopup(); // simulate TaskDetailPopup mounting on the bar click
    });
    await ensureGanttSharePopupOpen("gantt-bar-fake-a");
    expect(clicked).toBe(true);
    expect(
      document.querySelector('[data-tour-target="task-popup-close"]'),
    ).not.toBeNull();
  });

  it("reopens the SHARED-experiment popup via its own bar target", async () => {
    const bar = mountBar("gantt-bar-shared-experiment");
    let clicked = false;
    bar.addEventListener("click", () => {
      clicked = true;
      mountPopup();
    });
    await ensureGanttSharePopupOpen("gantt-bar-shared-experiment");
    expect(clicked).toBe(true);
  });

  it("does not throw when the bar never mounts (best-effort)", async () => {
    await expect(
      ensureGanttSharePopupOpen("gantt-bar-fake-a"),
    ).resolves.toBeUndefined();
  });

  it("withGanttSharePopupOpen runs the reopen first, then the inner onEnter", async () => {
    mountPopup(); // already open -> reopen no-op
    const inner = vi.fn(async () => undefined);
    await withGanttSharePopupOpen("gantt-bar-fake-a", inner)({ username: "alex" });
    expect(inner).toHaveBeenCalledWith({ username: "alex" });
  });
});

describe("ensureShareDialogOpen (gantt-share-resilience §6.8)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  function mountPopup(withShareButton: boolean): void {
    const close = document.createElement("button");
    close.setAttribute("data-tour-target", "task-popup-close");
    document.body.appendChild(close);
    if (withShareButton) {
      const share = document.createElement("button");
      share.setAttribute("data-tour-target", "task-popup-share-button");
      share.addEventListener("click", () => {
        const dialog = document.createElement("div");
        dialog.setAttribute("data-tour-target", "share-dialog");
        document.body.appendChild(dialog);
      });
      document.body.appendChild(share);
    }
  }

  it("no-ops when the share dialog is already open (canonical path)", async () => {
    mountPopup(true);
    const dialog = document.createElement("div");
    dialog.setAttribute("data-tour-target", "share-dialog");
    document.body.appendChild(dialog);
    let shareClicked = false;
    document
      .querySelector('[data-tour-target="task-popup-share-button"]')
      ?.addEventListener("click", () => {
        shareClicked = true;
      });
    await ensureShareDialogOpen();
    expect(shareClicked).toBe(false);
  });

  it("reopens the dialog by clicking the popup's Share button when the popup is open but the dialog is closed", async () => {
    mountPopup(true); // popup open, share button wired to mount the dialog
    await ensureShareDialogOpen();
    expect(
      document.querySelector('[data-tour-target="share-dialog"]'),
    ).not.toBeNull();
  });

  it("reopens the whole chain (bar -> popup -> Share button -> dialog) when everything is closed", async () => {
    // Only the Gantt bar is present; clicking it mounts the popup (with a
    // wired Share button) which then mounts the dialog on its own click.
    const bar = document.createElement("div");
    bar.setAttribute("data-tour-target", "gantt-bar-fake-a");
    bar.addEventListener("click", () => {
      mountPopup(true);
    });
    document.body.appendChild(bar);

    await ensureShareDialogOpen();
    expect(
      document.querySelector('[data-tour-target="task-popup-close"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-tour-target="share-dialog"]'),
    ).not.toBeNull();
  });

  it("does not throw when the popup can't be reopened (best-effort)", async () => {
    // No bar, no popup -> the popup reopen times out and we return quietly
    // without clicking into nothing.
    await expect(ensureShareDialogOpen()).resolves.toBeUndefined();
    expect(
      document.querySelector('[data-tour-target="share-dialog"]'),
    ).toBeNull();
  });

  it("withShareDialogOpen runs the reopen first, then the inner onEnter", async () => {
    mountPopup(true);
    const dialog = document.createElement("div");
    dialog.setAttribute("data-tour-target", "share-dialog");
    document.body.appendChild(dialog); // already open -> reopen no-op
    const inner = vi.fn(async () => undefined);
    await withShareDialogOpen(inner)({ username: "alex" });
    expect(inner).toHaveBeenCalledWith({ username: "alex" });
  });
});
