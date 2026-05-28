/**
 * Tour robustification helpers (tour robustification manager 2026-05-27).
 *
 * Centralised `ensureX` helpers that every artifact-dependent step can
 * call to make sure the demo's prerequisite exists at PLAYBACK time.
 *
 * Grant's hand-walk pattern: he seed-jumps to a step mid-tour (via dev
 * tools), refreshes the page, or starts a fresh user and skips into the
 * middle of the tour. Each time, the step assumes the prior steps'
 * artifacts (project, experiment, method, etc) exist. They don't, and
 * the step's cursor demo dead-ends.
 *
 * The exemplar: `workbench-create-experiment-open` (commit 2360f9db)
 * added an `ensureFirstProjectExists` helper that the cursor calls. If
 * no project exists, it creates "First Project" so the demo's project
 * select has a valid target. This file generalises that pattern.
 *
 * Each helper:
 *   1. Checks if the artifact exists.
 *   2. If yes, no-op (returns the existing id/handle).
 *   3. If no, creates a placeholder via the appropriate API.
 *   4. Returns the artifact id/handle for the cursor to use.
 *
 * Canonical tour flow (no skipping) hits the no-op branch of every
 * ensure helper. The ensure call is a fallback, not a duplicate-create.
 *
 * Co-located with the existing redesign-specific helpers
 * (gantt-redesign-helpers.ts, gantt-share-helpers.ts) so a future
 * contributor adding a new ensureX has one place to look.
 */
import {
  fetchAllTasks,
  methodsApi,
  projectsApi,
  tasksApi,
} from "@/lib/local-api";
import type { Method, Project, Task } from "@/lib/types";
import { appQueryClient } from "@/lib/query-client";

/** Placeholder project name BeakerBot creates when the user skipped
 *  §6.1. Matches the constant in WorkbenchCreateExperimentOpenStep.tsx
 *  so a re-entry from either path picks up the same placeholder. */
export const PLACEHOLDER_PROJECT_NAME = "First Project";

/** Placeholder experiment name BeakerBot creates when the user skipped
 *  §6.5. Matches FIRST_EXPERIMENT_NAME in WorkbenchCreateExperimentOpenStep. */
export const PLACEHOLDER_EXPERIMENT_NAME = "First experiment";

/** Placeholder method name BeakerBot creates when the user skipped
 *  §6.7c methods-create. Mirrors the FUNNY_METHOD_NAME constant so the
 *  attach step finds it whether the canonical flow or the ensure-helper
 *  fallback produced it. */
export const PLACEHOLDER_METHOD_NAME =
  "BeakerBot's Patent-Pending Coffee Brewing Protocol";

/** Date helper: today as YYYY-MM-DD, matching Task.start_date format. */
function todayLocalDate(): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Resolve the most-recently-created own (non-shared) non-Miscellaneous
 * project. Returns null when no qualifying project exists.
 *
 * "Most-recently-created" approximated as max(id); per-user ids are
 * monotonic so the largest id is the freshest.
 */
export async function resolveFirstProjectId(): Promise<number | null> {
  try {
    const projects = await projectsApi.list();
    const eligible = projects.filter(
      (p) =>
        !p.is_archived &&
        !p.is_shared_with_me &&
        p.name !== "Miscellaneous",
    );
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => b.id - a.id);
    return eligible[0].id;
  } catch {
    return null;
  }
}

/**
 * Ensure a non-Misc project exists so artifact-dependent steps have a
 * valid project to attach against. If one already exists, returns its
 * id (no-op create). Otherwise creates a placeholder via projectsApi.
 *
 * Returns null when the create fails (best-effort contract: a wedge
 * step is preferable to a thrown exception that crashes the cursor).
 */
export async function ensureFirstProjectExists(): Promise<number | null> {
  const existing = await resolveFirstProjectId();
  if (existing !== null) return existing;
  try {
    const created = await projectsApi.create({
      name: PLACEHOLDER_PROJECT_NAME,
      color: "#6B7280",
      weekend_active: false,
    });
    // experiment-create regression fix 2026-05-27 (Grant hand-walk):
    // After a fresh project create, the workbench page's react-query
    // cache for ["projects"] is stale, so TaskModal's `projects` prop
    // doesn't include the new project. The cursor's pickProject then
    // can't find an `<option value="<newId>">` to target, waitForElement
    // times out, the action drops silently, and the user sees the
    // Misc-stuck modal with the disabled Create Experiment button.
    // Invalidate the query so TaskModal re-renders with the option
    // before the cursor tries to pick it. Best-effort: if the
    // invalidate throws (no provider mounted, test harness, etc.) we
    // still return the id so the caller can decide what to do.
    try {
      await appQueryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch {
      // ignore; the create itself succeeded
    }
    return created.id;
  } catch {
    return null;
  }
}

/**
 * Resolve the most-recently-created experiment task in the active
 * project. Returns null when no experiment exists (or no project).
 *
 * Filters out the §6.8 Gantt redesign demo experiments (Fake A / Fake B)
 * and the §6.8 shared-experiment ("Make some coffee together") so the
 * resolver picks the user's actual first experiment, not a BeakerBot-
 * spawned demo bar.
 */
export async function resolveFirstExperiment(): Promise<Task | null> {
  try {
    const projectId = await resolveFirstProjectId();
    if (projectId === null) return null;
    const tasks = await tasksApi.listByProject(projectId);
    const experiments = tasks.filter(
      (t) =>
        t.task_type === "experiment" &&
        t.name !== "Fake experiment A" &&
        t.name !== "Fake experiment B" &&
        t.name !== "Make some coffee together",
    );
    if (experiments.length === 0) return null;
    const sorted = [...experiments].sort((a, b) => b.id - a.id);
    return sorted[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve any non-deleted experiment named PLACEHOLDER_EXPERIMENT_NAME
 * across ALL of the user's own tasks, regardless of which project (or
 * none) it lives in. Returns null when no such task exists.
 *
 * Activity-spam fix manager 2026-05-28: `resolveFirstExperiment` only
 * looks inside the single highest-id NON-Miscellaneous project. The §6.5
 * user-action flow lets the user file "First experiment" into
 * Miscellaneous or leave it Standalone (project_id 0) — both invisible to
 * `resolveFirstProjectId`. With the canonical experiment unresolvable,
 * every one of the ~10 downstream `ensureFirstExperimentExists` callers
 * (each Gantt + Method step's onEnter) fell through to the create branch
 * and minted a fresh duplicate, flooding the Lab activity feed with
 * identical "started experiment: First experiment" rows. This name-keyed,
 * project-agnostic lookup makes the helper genuinely idempotent on name —
 * the contract its own docstrings already claimed. Tasks are hard-deleted
 * (the file is removed), so anything a list returns is non-deleted.
 */
async function resolveExistingPlaceholderExperiment(): Promise<Task | null> {
  try {
    const all = await fetchAllTasks();
    const match = all.filter(
      (t) =>
        t.task_type === "experiment" &&
        !t.is_shared_with_me &&
        t.name === PLACEHOLDER_EXPERIMENT_NAME,
    );
    if (match.length === 0) return null;
    // Most-recently-created (max id) when several somehow exist, so a
    // pre-existing flood resolves to one stable target rather than churning.
    const sorted = [...match].sort((a, b) => b.id - a.id);
    return sorted[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Ensure the user's first experiment exists so steps that depend on it
 * (experiment-attach-method-*, gantt-existing-experiment, etc.) have a
 * row / bar to anchor against. First ensures a project exists (chains
 * to ensureFirstProjectExists); then creates a placeholder experiment
 * if none is found.
 *
 * Idempotency (activity-spam fix manager 2026-05-28): before creating,
 * we check BOTH the active-project resolver (`resolveFirstExperiment`,
 * which returns the user's real experiment when it lives in a non-Misc
 * project) AND a name-keyed global lookup that catches the placeholder
 * even when it sits in Miscellaneous / Standalone. Without the latter,
 * repeated calls across the tour spawned duplicate "First experiment"
 * tasks. See `resolveExistingPlaceholderExperiment`.
 *
 * Returns the resolved/created task, or null when neither path
 * succeeds.
 */
export async function ensureFirstExperimentExists(): Promise<Task | null> {
  const existing = await resolveFirstExperiment();
  if (existing !== null) return existing;
  // Name-keyed fallback: the §6.5 experiment may live in Miscellaneous or
  // be Standalone, both invisible to resolveFirstExperiment. Re-using it
  // here keeps re-entry / re-spawn from minting duplicates.
  const placeholder = await resolveExistingPlaceholderExperiment();
  if (placeholder !== null) return placeholder;
  const projectId = await ensureFirstProjectExists();
  if (projectId === null) return null;
  try {
    const created = await tasksApi.create({
      project_id: projectId,
      name: PLACEHOLDER_EXPERIMENT_NAME,
      start_date: todayLocalDate(),
      duration_days: 1,
      task_type: "experiment",
    });
    // Same stale-query fix as ensureFirstProjectExists above. The
    // workbench page's ["tasks", "own", ownProjectKeys] cache is the
    // primary consumer; the gantt page's ["tasks", projectId] is the
    // secondary. Broad invalidate by key prefix catches both.
    try {
      await appQueryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch {
      // ignore
    }
    return created;
  } catch {
    return null;
  }
}

/**
 * Resolve the most-recently-created own method. Returns null when no
 * own method exists (user skipped §6.7c).
 *
 * Filters out methods owned by other users (the lab-share path shows
 * shared methods in the list; we want the user's own when picking a
 * "first method").
 */
export async function resolveFirstMethod(): Promise<Method | null> {
  try {
    const methods = await methodsApi.list();
    // Own methods: not public, not shared-from-someone-else. The
    // `is_shared_with_me` overlay is set by fetchAllMethodsIncludingShared
    // for receiver-side reads; bare methodsApi.list returns the user's
    // own private + public namespace, so the filter is just "private +
    // not received".
    const own = methods.filter(
      (m) => !m.is_public && !m.is_shared_with_me,
    );
    if (own.length === 0) return null;
    const sorted = [...own].sort((a, b) => b.id - a.id);
    return sorted[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Ensure at least one own method exists so the attach-method step has a
 * candidate to pick. Creates a placeholder markdown method (the same
 * "BeakerBot's Patent-Pending Coffee Brewing Protocol" name §6.7c uses)
 * when none is found.
 *
 * Returns the resolved/created method, or null when create fails.
 */
export async function ensureFirstMethodExists(): Promise<Method | null> {
  const existing = await resolveFirstMethod();
  if (existing !== null) return existing;
  try {
    const created = await methodsApi.create({
      name: PLACEHOLDER_METHOD_NAME,
      method_type: "markdown",
      folder_path: "Methods",
    });
    // Same stale-query fix as the project + experiment helpers above.
    // The methods page + the experiment popup's methods picker both
    // pull from ["methods"]. Invalidating here makes the method appear
    // in the picker the moment the cursor opens it.
    try {
      await appQueryClient.invalidateQueries({ queryKey: ["methods"] });
    } catch {
      // ignore
    }
    return created;
  } catch {
    return null;
  }
}
