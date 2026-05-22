/**
 * Shared helpers for the §6.8 Gantt redesign sub-cluster (Gantt manager
 * 2026-05-22 — see ONBOARDING_V4_GANTT_REDESIGN.md).
 *
 * The redesign replaces the legacy 3-task BeakerBot-Boil/Brew/Sip chain
 * with a 2-task fake chain (A + B) plus the user's own existing
 * experiment. This file owns:
 *   - `spawnGanttRedesignFakeTasks` — creates Fake experiment A + B
 *     in the user's most recent project, idempotent on name.
 *   - `resolveFakeTaskIds` — resolves the ids of A + B for the
 *     subsequent step's cursor scripts.
 *   - `resolveUserExperiment` — resolves the user's experiment task
 *     (the one created in §6.5).
 *   - artifact-recording helpers for Phase 4 cleanup integration.
 *
 * Why a dedicated file:
 *   - Multiple new step bodies (`gantt-deps-beakerbot`, `gantt-deps-user`,
 *     `gantt-deps-cascade`) reference these helpers; co-locating in one
 *     step body would force the others to import a deep path that lies
 *     about ownership.
 *   - The cleanup-grid integration (each Fake task gets a
 *     `cleanup_default: "discard"` artifact entry) is fiddly enough that
 *     centralising it keeps the per-step bodies skinny.
 */
import { dependenciesApi, projectsApi, tasksApi } from "@/lib/local-api";
import { appQueryClient } from "@/lib/query-client";
import { patchOnboarding } from "@/lib/onboarding/sidecar";
import type { Project, Task } from "@/lib/types";
import { appendArtifact } from "./artifacts";

/** Stable display names for the two fake demo experiments. Exported so
 *  product-surface code (GanttChart) can stamp the right data-tour-target
 *  attribute on the matching bar element. */
export const GANTT_REDESIGN_FAKE_A_NAME = "Fake experiment A";
export const GANTT_REDESIGN_FAKE_B_NAME = "Fake experiment B";

/** Sky-500 — keeps the BeakerBot-spawned bars visually distinct from
 *  the user's own experiment color but still in-brand. */
export const GANTT_REDESIGN_FAKE_COLOR = "#0ea5e9";

interface FakeTaskHandles {
  projectId: number;
  fakeAId: number;
  fakeBId: number;
  /** True when this call actually created the tasks (vs found them
   *  already in place from an idempotent re-run). */
  spawned: boolean;
}

/** Today as YYYY-MM-DD. Matches Task.start_date format. */
function todayLocalDate(): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Pick the most-recently-created project for the active user. Mirrors
 *  the helper in on-enter-helpers.ts; duplicated here to keep this file
 *  self-contained for the new Gantt arc. */
async function resolveActiveProject(): Promise<Project | null> {
  try {
    const projects = await projectsApi.list();
    if (!projects.length) return null;
    const sorted = [...projects].sort((a, b) => {
      const cmp = (b.created_at ?? "").localeCompare(a.created_at ?? "");
      if (cmp !== 0) return cmp;
      return b.id - a.id;
    });
    return sorted[0] ?? null;
  } catch (err) {
    console.warn("[gantt-redesign] resolveActiveProject failed", err);
    return null;
  }
}

/**
 * Resolve the user's "existing experiment" — the one made on the
 * Workbench in §6.5. We pick the most-recently-created experiment in
 * the active project. Returns null when no experiment is found (test
 * harness short-circuit, or a user who skipped §6.5).
 */
export async function resolveUserExperiment(): Promise<Task | null> {
  try {
    const project = await resolveActiveProject();
    if (!project) return null;
    const tasks = await tasksApi.listByProject(project.id);
    const experiments = tasks.filter(
      (t) =>
        t.task_type === "experiment" &&
        t.name !== GANTT_REDESIGN_FAKE_A_NAME &&
        t.name !== GANTT_REDESIGN_FAKE_B_NAME,
    );
    if (!experiments.length) return null;
    // Sort by id desc — per-user ids are monotonic, so the largest id
    // is the most recently created.
    const sorted = [...experiments].sort((a, b) => b.id - a.id);
    return sorted[0] ?? null;
  } catch (err) {
    console.warn("[gantt-redesign] resolveUserExperiment failed", err);
    return null;
  }
}

/**
 * Resolve the ids of fake A + B if they already exist in the user's
 * active project. Returns null for either when the task is missing.
 * Used by step bodies whose cursor scripts run AFTER the spawn step.
 */
export async function resolveFakeTaskIds(): Promise<{
  fakeAId: number | null;
  fakeBId: number | null;
  projectId: number | null;
}> {
  try {
    const project = await resolveActiveProject();
    if (!project) {
      return { fakeAId: null, fakeBId: null, projectId: null };
    }
    const tasks = await tasksApi.listByProject(project.id);
    const a = tasks.find((t) => t.name === GANTT_REDESIGN_FAKE_A_NAME);
    const b = tasks.find((t) => t.name === GANTT_REDESIGN_FAKE_B_NAME);
    return {
      fakeAId: a?.id ?? null,
      fakeBId: b?.id ?? null,
      projectId: project.id,
    };
  } catch (err) {
    console.warn("[gantt-redesign] resolveFakeTaskIds failed", err);
    return { fakeAId: null, fakeBId: null, projectId: null };
  }
}

/**
 * Spawn the two fake demo experiments (A + B) in the user's most recent
 * project. Idempotent on name: if the tasks already exist, returns the
 * existing ids. The caller is responsible for the dependency-edge
 * creation (the deps-beakerbot / deps-user step bodies own that).
 *
 * Each fake task is tracked in the sidecar's `artifacts_created` list
 * with `cleanup_default: "discard"` so the Phase 4 cleanup grid pre-
 * checks them for removal.
 */
export async function spawnGanttRedesignFakeTasks(
  ctx: { username: string | null },
): Promise<FakeTaskHandles | null> {
  const project = await resolveActiveProject();
  if (!project) {
    console.warn(
      "[gantt-redesign] spawnGanttRedesignFakeTasks: no active project; skip",
    );
    return null;
  }
  let existing: Task[];
  try {
    existing = await tasksApi.listByProject(project.id);
  } catch (err) {
    console.warn("[gantt-redesign] listByProject failed", err);
    return null;
  }
  const existingA = existing.find((t) => t.name === GANTT_REDESIGN_FAKE_A_NAME);
  const existingB = existing.find((t) => t.name === GANTT_REDESIGN_FAKE_B_NAME);
  if (existingA && existingB) {
    return {
      projectId: project.id,
      fakeAId: existingA.id,
      fakeBId: existingB.id,
      spawned: false,
    };
  }

  const today = todayLocalDate();
  let fakeAId: number;
  let fakeBId: number;

  try {
    if (existingA) {
      fakeAId = existingA.id;
    } else {
      const a = await tasksApi.create({
        project_id: project.id,
        name: GANTT_REDESIGN_FAKE_A_NAME,
        start_date: today,
        duration_days: 1,
        task_type: "experiment",
        sort_order: 100,
        experiment_color: GANTT_REDESIGN_FAKE_COLOR,
      });
      fakeAId = a.id;
    }
    if (existingB) {
      fakeBId = existingB.id;
    } else {
      const b = await tasksApi.create({
        project_id: project.id,
        name: GANTT_REDESIGN_FAKE_B_NAME,
        start_date: today,
        duration_days: 1,
        task_type: "experiment",
        sort_order: 101,
        experiment_color: GANTT_REDESIGN_FAKE_COLOR,
      });
      fakeBId = b.id;
    }
  } catch (err) {
    console.warn(
      "[gantt-redesign] spawn fake A/B tasks failed",
      err,
    );
    return null;
  }

  // Record artifacts for Phase 4 cleanup. Best-effort; failures don't
  // wedge the spawn.
  if (ctx.username) {
    for (const taskId of [fakeAId, fakeBId]) {
      try {
        await patchOnboarding(ctx.username, (cur) =>
          appendArtifact(cur, {
            type: "task",
            id: String(taskId),
            cleanup_default: "discard",
          }),
        );
      } catch (err) {
        console.warn(
          "[gantt-redesign] fake-task artifact persist failed",
          err,
        );
      }
    }
  }

  // Refresh the Gantt's task query so the new bars appear before the
  // next step's cursor script runs.
  try {
    await appQueryClient.refetchQueries({ queryKey: ["tasks"] });
  } catch (err) {
    console.warn("[gantt-redesign] post-spawn refetch failed", err);
  }

  return { projectId: project.id, fakeAId, fakeBId, spawned: true };
}

/**
 * Create the A → user_experiment dependency edge. Used by the
 * `gantt-deps-beakerbot` step's onEnter so the cursor's visual drag
 * lands on top of a real dep that was already created in-data.
 * Idempotent: if the edge exists, no-op.
 *
 * Gantt fix manager R1 (P1 #9): also records a
 * `cleanup_default: "discard"` artifact for the dep edge so Phase 4
 * cleanup picks it up. Spec lines 238-239 require this.
 */
export async function createFakeAToUserDep(
  ctx: { username: string | null },
): Promise<void> {
  try {
    const { fakeAId, projectId } = await resolveFakeTaskIds();
    const userExp = await resolveUserExperiment();
    if (!fakeAId || !userExp || !projectId) return;
    const existing = await dependenciesApi.list(projectId);
    const already = existing.find(
      (d) => d.parent_id === fakeAId && d.child_id === userExp.id,
    );
    let edgeId: number | string;
    if (already) {
      edgeId = already.id;
    } else {
      const created = await dependenciesApi.create({
        parent_id: fakeAId,
        child_id: userExp.id,
        dep_type: "FS",
      });
      edgeId = created.id;
      await Promise.all([
        appQueryClient.refetchQueries({ queryKey: ["tasks"] }),
        appQueryClient.refetchQueries({ queryKey: ["dependencies"] }),
      ]);
    }
    if (ctx.username) {
      try {
        await patchOnboarding(ctx.username, (cur) =>
          appendArtifact(cur, {
            type: "dep_edge",
            id: String(edgeId),
            cleanup_default: "discard",
          }),
        );
      } catch (err) {
        console.warn(
          "[gantt-redesign] fake-A→user dep-edge artifact persist failed",
          err,
        );
      }
    }
  } catch (err) {
    console.warn("[gantt-redesign] createFakeAToUserDep failed", err);
  }
}

/**
 * Record the user→fake_b dep edge artifact for Phase 4 cleanup. Called
 * by the `gantt-deps-user` step's onExit so the user-created edge gets
 * the same discard-default treatment as the BeakerBot-created edge.
 * Best-effort + idempotent (appendArtifact dedupes on type:id).
 *
 * Gantt fix manager R1 (P1 #9).
 */
export async function recordUserToFakeBDepArtifact(
  ctx: { username: string | null },
): Promise<void> {
  if (!ctx.username) return;
  try {
    const { fakeBId, projectId } = await resolveFakeTaskIds();
    const userExp = await resolveUserExperiment();
    if (!fakeBId || !userExp || !projectId) return;
    const deps = await dependenciesApi.list(projectId);
    const edge = deps.find(
      (d) => d.parent_id === userExp.id && d.child_id === fakeBId,
    );
    if (!edge) return;
    await patchOnboarding(ctx.username, (cur) =>
      appendArtifact(cur, {
        type: "dep_edge",
        id: String(edge.id),
        cleanup_default: "discard",
      }),
    );
  } catch (err) {
    console.warn(
      "[gantt-redesign] recordUserToFakeBDepArtifact failed",
      err,
    );
  }
}

/**
 * Move Fake A forward by `days` days, triggering the cascade through
 * the dependency edges. Used by `gantt-deps-cascade`'s programmatic
 * companion to the cursor's visual drag.
 */
export async function moveFakeAForward(days: number): Promise<void> {
  try {
    const { fakeAId } = await resolveFakeTaskIds();
    if (!fakeAId) return;
    const newStart = new Date();
    newStart.setDate(newStart.getDate() + days);
    const iso = newStart.toISOString().slice(0, 10);
    await tasksApi.move(fakeAId, { new_start_date: iso, confirmed: true });
    await appQueryClient.refetchQueries({ queryKey: ["tasks"] });
  } catch (err) {
    console.warn("[gantt-redesign] moveFakeAForward failed", err);
  }
}
