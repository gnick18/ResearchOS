import { describe, expect, it, vi } from "vitest";
import { rollbackInlineCreatedChildren } from "./compound-builder-cleanup";

describe("rollbackInlineCreatedChildren", () => {
  it("calls deleteFn once per id, in order, when cancelling with N inline children", async () => {
    const calls: number[] = [];
    const deleteFn = vi.fn(async (id: number) => {
      calls.push(id);
    });

    await rollbackInlineCreatedChildren([7, 11, 13], { deleteFn });

    expect(calls).toEqual([7, 11, 13]);
    expect(deleteFn).toHaveBeenCalledTimes(3);
  });

  it("is a no-op when there are no inline-created children", async () => {
    const deleteFn = vi.fn(async () => {});
    await rollbackInlineCreatedChildren([], { deleteFn });
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("only deletes the ids it receives — caller controls which children to roll back", async () => {
    // Simulates the "user reused an existing method as a child + also
    // inline-created one new child + then cancelled" case. The builder
    // tracks only the new-create's id (42) and passes that here; the
    // reused existing-method id (8) is never seen by this helper, so
    // it can never be deleted.
    const deleteFn = vi.fn(async () => {});
    await rollbackInlineCreatedChildren([42], { deleteFn });
    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(deleteFn).toHaveBeenCalledWith(42);
  });

  it("swallows per-id errors and continues cleaning up the remaining ids", async () => {
    const calls: number[] = [];
    const deleteFn = vi.fn(async (id: number) => {
      calls.push(id);
      if (id === 11) throw new Error("simulated disk failure");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await rollbackInlineCreatedChildren([7, 11, 13], { deleteFn });

    expect(calls).toEqual([7, 11, 13]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
