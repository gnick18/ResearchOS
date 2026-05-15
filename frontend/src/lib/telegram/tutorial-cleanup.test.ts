// frontend/src/lib/telegram/tutorial-cleanup.test.ts
//
// Unit tests for the inbox auto-cleanup that fires when the guided
// tutorial ends. The fix story: a user runs the first-photo step of the
// tutorial, texts a real photo from their phone, the bot routes the
// photo to either the active task's `Images/` or the user's
// `users/<u>/inbox/Images/`. Before this helper the inbox photo
// persisted forever. Now each tutorial-mode write stamps
// `tutorial_test: true` in the sidecar and this helper scans + deletes
// inbox photos with that marker on tutorial-end.
//
// Scope guard tested here: task-routed tutorial photos keep the marker
// but MUST NOT be auto-deleted (the user explicitly opened a task
// popup, so destination was their choice).

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── In-memory FS mock ──────────────────────────────────────────────────
const memFs = new Map<string, unknown>();
// Tracks listFiles return so each test can stage a different inbox.
const inboxListing = new Map<string, string[]>();
const deleteCalls: string[] = [];
let deleteOverride: ((path: string) => Promise<boolean>) | null = null;

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    listFiles: vi.fn(async (dir: string) => inboxListing.get(dir) ?? []),
    deleteFile: vi.fn(async (path: string) => {
      deleteCalls.push(path);
      if (deleteOverride) return deleteOverride(path);
      memFs.delete(path);
      return true;
    }),
  },
}));

import { cleanupTutorialTestPhotos } from "./tutorial-cleanup";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";

const USER = "Grant";
const INBOX = `users/${USER}/inbox`;
const INBOX_IMAGES = `${INBOX}/Images`;

function seedInboxPhoto(name: string, sidecar: ImageSidecar | null): void {
  const existing = inboxListing.get(INBOX_IMAGES) ?? [];
  inboxListing.set(INBOX_IMAGES, [...existing, name]);
  memFs.set(`${INBOX_IMAGES}/${name}`, new Blob([new Uint8Array([1, 2, 3])]));
  if (sidecar !== null) {
    memFs.set(sidecarPath(INBOX, name), sidecar);
  }
}

beforeEach(() => {
  memFs.clear();
  inboxListing.clear();
  deleteCalls.length = 0;
  deleteOverride = null;
});

describe("cleanupTutorialTestPhotos", () => {
  it("deletes inbox photos + sidecars marked tutorial_test:true and leaves the rest alone", async () => {
    seedInboxPhoto("test-1.jpg", { tutorial_test: true, source: "telegram" });
    seedInboxPhoto("test-2.jpg", { tutorial_test: true, source: "telegram" });
    seedInboxPhoto("keeper.jpg", { source: "telegram", caption: "real photo" });

    const cleaned = await cleanupTutorialTestPhotos(USER);

    expect(cleaned).toBe(2);
    // Two image files + two sidecars removed.
    expect(deleteCalls.sort()).toEqual(
      [
        `${INBOX_IMAGES}/test-1.jpg`,
        `${INBOX_IMAGES}/test-2.jpg`,
        sidecarPath(INBOX, "test-1.jpg"),
        sidecarPath(INBOX, "test-2.jpg"),
      ].sort(),
    );
    // Unmarked photo + its sidecar are untouched.
    expect(memFs.has(`${INBOX_IMAGES}/keeper.jpg`)).toBe(true);
    expect(memFs.has(sidecarPath(INBOX, "keeper.jpg"))).toBe(true);
  });

  it("returns 0 and does not throw on an empty inbox", async () => {
    const cleaned = await cleanupTutorialTestPhotos(USER);
    expect(cleaned).toBe(0);
    expect(deleteCalls).toEqual([]);
  });

  it("does not delete a photo whose sidecar is missing (no marker visible)", async () => {
    // File exists in the listing, sidecar is missing (readJson returns null).
    seedInboxPhoto("orphan.jpg", null);
    const cleaned = await cleanupTutorialTestPhotos(USER);
    expect(cleaned).toBe(0);
    expect(deleteCalls).toEqual([]);
    expect(memFs.has(`${INBOX_IMAGES}/orphan.jpg`)).toBe(true);
  });

  it("scope guard: does not touch task-routed tutorial photos in users/<u>/results/...", async () => {
    // Pre-seed a tutorial-marked photo inside a task's Images/ dir. The
    // helper's scan is anchored at the inbox path, so the task path
    // never even gets listFiles'd.
    const taskBase = `users/${USER}/results/task-7`;
    const taskImages = `${taskBase}/Images`;
    inboxListing.set(taskImages, ["task-photo.jpg"]);
    memFs.set(`${taskImages}/task-photo.jpg`, new Blob([new Uint8Array([9])]));
    memFs.set(sidecarPath(taskBase, "task-photo.jpg"), {
      tutorial_test: true,
      source: "telegram",
    });

    const cleaned = await cleanupTutorialTestPhotos(USER);

    expect(cleaned).toBe(0);
    expect(deleteCalls).toEqual([]);
    // Task photo and sidecar both still present.
    expect(memFs.has(`${taskImages}/task-photo.jpg`)).toBe(true);
    expect(memFs.has(sidecarPath(taskBase, "task-photo.jpg"))).toBe(true);
  });

  it("survives a failed image delete: skips the file (returns 0), continues the scan, keeps the sidecar", async () => {
    seedInboxPhoto("bad.jpg", { tutorial_test: true, source: "telegram" });
    seedInboxPhoto("good.jpg", { tutorial_test: true, source: "telegram" });
    // Reject deleting the image for "bad.jpg" specifically (sidecar
    // delete would succeed in real life, but the helper bails on this
    // file before reaching the sidecar). All other deletes succeed.
    deleteOverride = async (path: string) => {
      if (path === `${INBOX_IMAGES}/bad.jpg`) return false;
      memFs.delete(path);
      return true;
    };

    const cleaned = await cleanupTutorialTestPhotos(USER);

    // good.jpg cleaned; bad.jpg counted as a failure and not deleted.
    expect(cleaned).toBe(1);
    // Sidecar for bad.jpg preserved so a retry can still see the marker.
    expect(memFs.has(sidecarPath(INBOX, "bad.jpg"))).toBe(true);
    // good.jpg + its sidecar are gone.
    expect(memFs.has(`${INBOX_IMAGES}/good.jpg`)).toBe(false);
    expect(memFs.has(sidecarPath(INBOX, "good.jpg"))).toBe(false);
  });
});
