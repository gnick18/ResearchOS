import { describe, it, expect } from "vitest";
import { isDirectoryHandleMissing } from "./handle-liveness";

// Build a fake directory handle whose values() iterator's first next() behaves
// as given, so we can drive the probe without a real File System Access handle.
function handleWith(
  next: () => Promise<IteratorResult<unknown>>,
): FileSystemDirectoryHandle {
  return {
    values: () => ({
      next,
      [Symbol.asyncIterator]() {
        return this;
      },
    }),
  } as unknown as FileSystemDirectoryHandle;
}

function namedError(name: string): Error {
  return Object.assign(new Error(name), { name });
}

describe("isDirectoryHandleMissing", () => {
  it("returns false for a present folder that has entries", async () => {
    const handle = handleWith(() =>
      Promise.resolve({ done: false, value: {} }),
    );
    expect(await isDirectoryHandleMissing(handle)).toBe(false);
  });

  it("returns false for a present but empty folder", async () => {
    const handle = handleWith(() =>
      Promise.resolve({ done: true, value: undefined }),
    );
    expect(await isDirectoryHandleMissing(handle)).toBe(false);
  });

  it("returns true when the read throws NotFoundError (folder moved/deleted)", async () => {
    const handle = handleWith(() => Promise.reject(namedError("NotFoundError")));
    expect(await isDirectoryHandleMissing(handle)).toBe(true);
  });

  it("returns false for an unrelated error, so it never hijacks the flow", async () => {
    const handle = handleWith(() => Promise.reject(namedError("AbortError")));
    expect(await isDirectoryHandleMissing(handle)).toBe(false);
  });
});
