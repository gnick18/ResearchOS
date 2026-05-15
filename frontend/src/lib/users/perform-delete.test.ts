import { describe, expect, it, vi } from "vitest";
import { performUserDelete, type PerformUserDeleteDeps } from "./perform-delete";

function makeDeps(overrides: Partial<PerformUserDeleteDeps> = {}): {
  deps: PerformUserDeleteDeps;
  spies: {
    deleteUser: ReturnType<typeof vi.fn>;
    setCurrentUser: ReturnType<typeof vi.fn>;
    setMainUserPersisted: ReturnType<typeof vi.fn>;
  };
} {
  const spies = {
    deleteUser: vi.fn(async () => ({ status: "ok" })),
    setCurrentUser: vi.fn(async () => {}),
    setMainUserPersisted: vi.fn(async () => ({ status: "ok" })),
  };
  const deps: PerformUserDeleteDeps = {
    currentUser: null,
    mainUser: null,
    deleteUser: spies.deleteUser,
    setCurrentUser: spies.setCurrentUser,
    setMainUserPersisted: spies.setMainUserPersisted,
    ...overrides,
  };
  return { deps, spies };
}

describe("performUserDelete", () => {
  it("runs the two-step deleteUser API in order regardless of which pointers match", async () => {
    const { deps, spies } = makeDeps({ currentUser: "alice", mainUser: "alice" });

    await performUserDelete("alice", deps);

    expect(spies.deleteUser).toHaveBeenCalledTimes(2);
    expect(spies.deleteUser.mock.calls[0]).toEqual(["alice", 1, true]);
    expect(spies.deleteUser.mock.calls[1]).toEqual(["alice", 2, true]);
  });

  it("clears the FileSystemProvider currentUser pointer when the deleted user is the active one", async () => {
    const { deps, spies } = makeDeps({ currentUser: "alice", mainUser: null });

    await performUserDelete("alice", deps);

    expect(spies.setCurrentUser).toHaveBeenCalledTimes(1);
    expect(spies.setCurrentUser).toHaveBeenCalledWith("");
  });

  it("does NOT clear currentUser when the deleted user is somebody else", async () => {
    // The original bug never affected this branch — but it would be a quiet
    // regression if a future refactor accidentally over-cleared. Pinning it.
    const { deps, spies } = makeDeps({ currentUser: "alice", mainUser: null });

    await performUserDelete("bob", deps);

    expect(spies.setCurrentUser).not.toHaveBeenCalled();
  });

  it("persists the mainUser clear to IndexedDB when the deleted user was the main user", async () => {
    // Pre-fix the component called local setMainUser(null) (React state) but
    // never persisted the clear to IndexedDB — so the stale pointer survived
    // a reload and got bootstrapped back as mainUser on next launch.
    const { deps, spies } = makeDeps({ currentUser: null, mainUser: "alice" });

    await performUserDelete("alice", deps);

    expect(spies.setMainUserPersisted).toHaveBeenCalledTimes(1);
    expect(spies.setMainUserPersisted).toHaveBeenCalledWith("");
  });

  it("does NOT clear mainUser when the deleted user is somebody else", async () => {
    const { deps, spies } = makeDeps({ currentUser: null, mainUser: "alice" });

    await performUserDelete("bob", deps);

    expect(spies.setMainUserPersisted).not.toHaveBeenCalled();
  });

  it("handles the deletion-from-picker case (no user currently logged in) without clearing anything", async () => {
    // When the picker is shown standalone (not as a modal over an active
    // session), both pointers are already null. The delete should run
    // cleanly without touching either clear-helper.
    const { deps, spies } = makeDeps({ currentUser: null, mainUser: null });

    await performUserDelete("alice", deps);

    expect(spies.deleteUser).toHaveBeenCalledTimes(2);
    expect(spies.setCurrentUser).not.toHaveBeenCalled();
    expect(spies.setMainUserPersisted).not.toHaveBeenCalled();
  });

  it("clears both pointers in one call when the deleted user is currentUser AND mainUser (typical solo-user case)", async () => {
    // Solo-user folders bootstrap mainUser from currentUser at connect
    // time, so for most users the two match. A self-delete should clear
    // both pointers in the same operation.
    const { deps, spies } = makeDeps({ currentUser: "alice", mainUser: "alice" });

    await performUserDelete("alice", deps);

    expect(spies.setCurrentUser).toHaveBeenCalledWith("");
    expect(spies.setMainUserPersisted).toHaveBeenCalledWith("");
  });

  it("clears currentUser even when mainUser is a different user (mid-session switch case)", async () => {
    // alice is the main user; she signed in as bob (e.g. a labmate's
    // borrowed account) and is now deleting bob from the picker. Only
    // currentUser should be cleared; mainUser stays alice.
    const { deps, spies } = makeDeps({ currentUser: "bob", mainUser: "alice" });

    await performUserDelete("bob", deps);

    expect(spies.setCurrentUser).toHaveBeenCalledWith("");
    expect(spies.setMainUserPersisted).not.toHaveBeenCalled();
  });
});
