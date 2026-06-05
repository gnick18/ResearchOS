import { describe, it, expect, beforeEach, vi } from "vitest";

// No sidecar on disk -> openNote rebuilds from the mirror (the base note).
// All writes are no-ops; recordActor is best-effort so a bare mock is fine.
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readFileAsBlob: vi.fn(async () => null),
    readJson: vi.fn(async () => null),
    writeJson: vi.fn(async () => {}),
    writeFileFromBlob: vi.fn(async () => {}),
    ensureDir: vi.fn(async () => {}),
    deleteFile: vi.fn(async () => true),
  },
}));

import { openNote, _clearCache } from "../store";
import { getDevicePeerId, _resetDevicePeerCacheForTests } from "../device-peer";
import { setEntryContent } from "../note-doc";
import type { Note } from "@/lib/types";

function fixtureNote(): Note {
  return {
    id: 7,
    title: "attribution fixture",
    description: "",
    is_running_log: false,
    is_shared: false,
    created_at: "2026-05-01T10:00:00Z",
    entries: [
      {
        id: "e1",
        title: "Note",
        date: "2026-05-01",
        content: "body",
        created_at: "2026-05-01T10:00:00Z",
        updated_at: "2026-05-01T10:00:00Z",
      },
    ],
  } as Note;
}

describe("openNote attributes live edits to the device peer", () => {
  beforeEach(() => {
    _clearCache();
    _resetDevicePeerCacheForTests();
  });

  it("sets the device peer on the doc and a live edit's change carries it", async () => {
    const handle = await openNote(fixtureNote(), "mira");
    const devicePeer = getDevicePeerId();

    // The loaded doc's current peer is the device peer (not the random import
    // peer, not the seed peer 0).
    expect(handle.doc.peerId).toBe(devicePeer);
    expect(handle.doc.peerIdStr).toBe(devicePeer.toString());

    // A live edit commits under the device peer.
    setEntryContent(handle.doc, 0, "edited body");
    handle.doc.commit();

    const mine = handle.doc.getAllChanges().get(devicePeer.toString() as `${number}`);
    expect(mine && mine.length).toBeGreaterThan(0);
    // And the seed commit stays attributed to the fixed seed peer (0).
    expect(handle.doc.getAllChanges().get("0" as `${number}`)?.length ?? 0).toBeGreaterThan(0);
  });
});
