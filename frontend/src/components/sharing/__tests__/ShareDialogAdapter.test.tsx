/**
 * Mira-Explorer P0 fix manager (2026-05-23): cascade-to-tasks test for
 * `ShareDialogAdapter`. The dialog renders a "Also share all tasks in
 * this project" checkbox for project records; before this fix the
 * adapter dropped the `options` second argument and the checkbox was
 * a dead UI element. These tests pin:
 *   1. The adapter's `onSave` now accepts the options arg.
 *   2. With `cascadeToTasks: true` and `recordType === "project"`, every
 *      task in the project gets the same per-recipient share calls.
 *   3. A failure on one task does NOT abort the whole cascade — the
 *      surviving tasks still get the share writes, and the aggregated
 *      failure surfaces via a thrown error so the dialog's existing
 *      error path renders it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { ShareDialogProps } from "../ShareDialog";
import type { SharedUser } from "@/lib/types";

// ── Mocks ────────────────────────────────────────────────────────────────
// `local-api` is the wire-up surface the adapter dispatches to. We mock
// the exact entries the adapter reaches into (sharingApi.* / tasksApi.*
// / methodsApi.*) and assert call shapes per scenario.
//
// `vi.hoisted` is required so the mock factories (which are hoisted to
// the top of the file by vitest) can reference these fns without
// running into TDZ. Otherwise the `vi.mock` factory runs BEFORE the
// `const x = vi.fn()` declaration evaluates.

const mocks = vi.hoisted(() => ({
  shareTask: vi.fn(),
  unshareTask: vi.fn(),
  shareProject: vi.fn(),
  unshareProject: vi.fn(),
  shareMethod: vi.fn(),
  unshareMethod: vi.fn(),
  shareNote: vi.fn(),
  shareLink: vi.fn(),
  shareGoal: vi.fn(),
  methodsApiUpdate: vi.fn(),
  tasksApiListByProject: vi.fn(),
  capturedOnSave: { current: null as
    | ((next: SharedUser[], options?: { cascadeToTasks?: boolean }) => Promise<void> | void)
    | null },
}));

vi.mock("@/lib/local-api", () => ({
  sharingApi: {
    shareTask: mocks.shareTask,
    unshareTask: mocks.unshareTask,
    shareProject: mocks.shareProject,
    unshareProject: mocks.unshareProject,
    shareMethod: mocks.shareMethod,
    unshareMethod: mocks.unshareMethod,
    shareNote: mocks.shareNote,
    shareLink: mocks.shareLink,
    shareGoal: mocks.shareGoal,
  },
  methodsApi: { update: mocks.methodsApiUpdate },
  tasksApi: { listByProject: mocks.tasksApiListByProject },
}));

// Stub the dialog itself: we just want to capture the `onSave` callback
// the adapter wires into it. The tests then invoke that callback
// directly to exercise the adapter's diff + dispatch logic without
// needing to drive the dialog UI.
vi.mock("../ShareDialog", () => ({
  default: (props: ShareDialogProps) => {
    mocks.capturedOnSave.current = props.onSave;
    return null;
  },
}));

const {
  shareTask,
  unshareTask,
  shareProject,
  unshareProject,
  shareMethod,
  unshareMethod,
  shareNote,
  shareLink,
  shareGoal,
  methodsApiUpdate,
  tasksApiListByProject,
} = mocks;

import ShareDialogAdapter from "../ShareDialogAdapter";

// ── Helpers ──────────────────────────────────────────────────────────────

beforeEach(() => {
  shareTask.mockReset();
  unshareTask.mockReset();
  shareProject.mockReset();
  unshareProject.mockReset();
  shareMethod.mockReset();
  unshareMethod.mockReset();
  shareNote.mockReset();
  shareLink.mockReset();
  shareGoal.mockReset();
  methodsApiUpdate.mockReset();
  tasksApiListByProject.mockReset();
  mocks.capturedOnSave.current = null;

  // Default: every share/unshare call succeeds.
  shareTask.mockResolvedValue({ status: "ok" });
  unshareTask.mockResolvedValue({ status: "ok" });
  shareProject.mockResolvedValue({ status: "ok" });
  unshareProject.mockResolvedValue({ status: "ok" });
  methodsApiUpdate.mockResolvedValue(null);
});

function makeTask(overrides: {
  id: number;
  name?: string;
  shared_with?: SharedUser[];
}) {
  return {
    id: overrides.id,
    name: overrides.name ?? `Task ${overrides.id}`,
    project_id: 42,
    shared_with: overrides.shared_with ?? [],
  };
}

function mountAdapter() {
  const onShared = vi.fn();
  render(
    <ShareDialogAdapter
      isOpen={true}
      onClose={() => {}}
      recordType="project"
      recordId={42}
      recordName="Test project"
      ownerUsername="alex"
      currentSharedWith={[]}
      onShared={onShared}
    />,
  );
  return { onShared };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("ShareDialogAdapter cascadeToTasks", () => {
  it("propagates the new recipients to every task in the project", async () => {
    tasksApiListByProject.mockResolvedValue([
      makeTask({ id: 1 }),
      makeTask({ id: 2 }),
      makeTask({ id: 3 }),
    ]);

    mountAdapter();
    expect(mocks.capturedOnSave.current).not.toBeNull();

    await act(async () => {
      await mocks.capturedOnSave.current!(
        [{ username: "bob", level: "edit" }],
        { cascadeToTasks: true },
      );
    });

    // Project itself gets shared once with bob.
    expect(shareProject).toHaveBeenCalledTimes(1);
    expect(shareProject).toHaveBeenCalledWith(42, {
      username: "bob",
      level: "edit",
    });

    // Tasks were enumerated by project id.
    expect(tasksApiListByProject).toHaveBeenCalledWith(42);

    // Every task got the same share write (3 tasks × 1 recipient).
    expect(shareTask).toHaveBeenCalledTimes(3);
    expect(shareTask).toHaveBeenNthCalledWith(1, 1, {
      username: "bob",
      level: "edit",
    });
    expect(shareTask).toHaveBeenNthCalledWith(2, 2, {
      username: "bob",
      level: "edit",
    });
    expect(shareTask).toHaveBeenNthCalledWith(3, 3, {
      username: "bob",
      level: "edit",
    });

    // No unshares fired (every task started empty).
    expect(unshareTask).not.toHaveBeenCalled();
  });

  it("does not cascade when cascadeToTasks is false / omitted", async () => {
    tasksApiListByProject.mockResolvedValue([makeTask({ id: 1 })]);
    mountAdapter();

    await act(async () => {
      await mocks.capturedOnSave.current!(
        [{ username: "bob", level: "edit" }],
        { cascadeToTasks: false },
      );
    });

    expect(shareProject).toHaveBeenCalledTimes(1);
    expect(tasksApiListByProject).not.toHaveBeenCalled();
    expect(shareTask).not.toHaveBeenCalled();
  });

  it("continues the cascade when one task fails, then surfaces the failure", async () => {
    tasksApiListByProject.mockResolvedValue([
      makeTask({ id: 1, name: "Task one" }),
      makeTask({ id: 2, name: "Task two" }),
      makeTask({ id: 3, name: "Task three" }),
    ]);
    // shareTask: succeed for tasks 1 + 3, fail for task 2.
    shareTask.mockImplementation(async (taskId: number) => {
      if (taskId === 2) {
        throw new Error("disk full");
      }
      return { status: "ok" };
    });

    mountAdapter();

    let thrown: Error | null = null;
    await act(async () => {
      try {
        await mocks.capturedOnSave.current!(
          [{ username: "bob", level: "edit" }],
          { cascadeToTasks: true },
        );
      } catch (err) {
        thrown = err as Error;
      }
    });

    // All three tasks were attempted (task 2's failure didn't abort).
    expect(shareTask).toHaveBeenCalledTimes(3);
    expect(shareTask).toHaveBeenNthCalledWith(1, 1, expect.any(Object));
    expect(shareTask).toHaveBeenNthCalledWith(2, 2, expect.any(Object));
    expect(shareTask).toHaveBeenNthCalledWith(3, 3, expect.any(Object));

    // Aggregated failure surfaced as a thrown error so the dialog's
    // catch block can render it in the existing error surface.
    expect(thrown).not.toBeNull();
    expect((thrown as unknown as Error).message).toMatch(/cascade/);
    expect((thrown as unknown as Error).message).toContain("Task two");
    expect((thrown as unknown as Error).message).toContain("disk full");
  });

  it("computes per-task diffs (skips recipients that already match)", async () => {
    // Task 1 already has bob@edit (no-op); task 2 needs the add.
    tasksApiListByProject.mockResolvedValue([
      makeTask({
        id: 1,
        shared_with: [{ username: "bob", level: "edit" }],
      }),
      makeTask({ id: 2 }),
    ]);

    mountAdapter();

    await act(async () => {
      await mocks.capturedOnSave.current!(
        [{ username: "bob", level: "edit" }],
        { cascadeToTasks: true },
      );
    });

    // Only task 2 needed the share write.
    expect(shareTask).toHaveBeenCalledTimes(1);
    expect(shareTask).toHaveBeenCalledWith(2, {
      username: "bob",
      level: "edit",
    });
  });

  it("removes per-task recipients that are absent from the new project list", async () => {
    // Project currently shared with bob; after-save list is empty (bob removed).
    // Both tasks already have bob — both should get an unshare.
    tasksApiListByProject.mockResolvedValue([
      makeTask({
        id: 1,
        shared_with: [{ username: "bob", level: "edit" }],
      }),
      makeTask({
        id: 2,
        shared_with: [{ username: "bob", level: "edit" }],
      }),
    ]);

    const onShared = vi.fn();
    render(
      <ShareDialogAdapter
        isOpen={true}
        onClose={() => {}}
        recordType="project"
        recordId={42}
        recordName="Test project"
        ownerUsername="alex"
        currentSharedWith={[{ username: "bob", level: "edit" }]}
        onShared={onShared}
      />,
    );

    await act(async () => {
      await mocks.capturedOnSave.current!([], { cascadeToTasks: true });
    });

    expect(unshareProject).toHaveBeenCalledTimes(1);
    expect(unshareProject).toHaveBeenCalledWith(42, "bob");
    expect(unshareTask).toHaveBeenCalledTimes(2);
    expect(unshareTask).toHaveBeenNthCalledWith(1, 1, "bob");
    expect(unshareTask).toHaveBeenNthCalledWith(2, 2, "bob");
  });
});
