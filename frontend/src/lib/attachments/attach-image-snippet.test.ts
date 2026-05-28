// frontend/src/lib/attachments/attach-image-snippet.test.ts
//
// Pins the markdown-snippet encoding that fixed Grant's Telegram bug
// (telegram image path manager, 2026-05-27). A Telegram photo whose filename
// contains a space (phone document names, user-typed batch names) must insert
// a percent-encoded destination so CommonMark does not truncate the URL at the
// space and drop the image. The companion decode step lives in
// blob-url-resolver.test.ts; together they prove the round-trip renders.

import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const memBlobs = new Map<string, Blob>();
  return { memBlobs };
});

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    fileExists: vi.fn(async (path: string) => hoisted.memBlobs.has(path)),
    writeFileFromBlob: vi.fn(async (path: string, blob: Blob) => {
      hoisted.memBlobs.set(path, blob);
    }),
  },
}));

vi.mock("@/lib/attachments/image-events", () => ({
  imageEvents: { emitAttached: vi.fn() },
}));

vi.mock("@/lib/tasks/results-paths", () => ({
  taskResultsBase: (task: { id: number; owner: string }) =>
    `users/${task.owner}/results/task-${task.id}`,
}));

// attach-image imports notesApi (for the note helper); stub it so the module
// loads even though these tests only exercise attachImageToTask.
vi.mock("@/lib/local-api", () => ({
  notesApi: { get: vi.fn(), addEntry: vi.fn(), updateEntry: vi.fn() },
}));

import { attachImageToTask } from "./attach-image";

beforeEach(() => {
  hoisted.memBlobs.clear();
});

describe("attachImageToTask: spaced-filename markdown snippet", () => {
  it("percent-encodes spaces in the inserted markdown destination", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const result = await attachImageToTask({
      ownerUsername: "Grant",
      taskId: 5,
      basePath: "users/Grant/results/task-5/results",
      blob,
      suggestedFilename: "gel run 2.jpg",
      altText: "gel run",
    });
    // File lands at the literal (un-encoded) on-disk path.
    expect(result.absolutePath).toBe(
      "users/Grant/results/task-5/results/Images/gel run 2.jpg",
    );
    // relativePath stays literal (consumers that touch disk want the real name).
    expect(result.relativePath).toBe("Images/gel run 2.jpg");
    // The markdown snippet's destination is percent-encoded so CommonMark
    // parses the whole URL instead of truncating at the first space.
    expect(result.markdownSnippet).toBe(
      "\n![gel run](Images/gel%20run%202.jpg)\n",
    );
  });

  it("leaves space-free filenames unchanged in the snippet", async () => {
    const blob = new Blob([new Uint8Array([1])]);
    const result = await attachImageToTask({
      ownerUsername: "Grant",
      taskId: 5,
      basePath: "users/Grant/results/task-5/results",
      blob,
      suggestedFilename: "photo.jpg",
    });
    expect(result.markdownSnippet).toBe(
      "\n![photo.jpg](Images/photo.jpg)\n",
    );
  });
});
