/**
 * persist-entry-content -- content-writer routing tests.
 *
 * These guard the Loro-pilot invariant: when the CRDT owns note ENTRY content,
 * the legacy `notesApi.updateEntry({ content })` write is SUPPRESSED and the
 * Loro handle is flushed instead (so notes/<id>.json is written once, by the
 * mirror, not twice). Flag-off / handle-not-ready keeps the legacy write.
 *
 * Why a focused unit on the helper rather than a full NoteDetailPopup mount:
 * the popup pulls in the CM6 editor whose Loro binding needs a WASM binary
 * jsdom cannot execute (see InlineMarkdownEditor.loro.test.tsx). The
 * branch that actually decides the writer is extracted here so it can be
 * exercised deterministically. The live save-path UX (Save button, Cmd+S,
 * dirty state, sidecar + mirror on disk) is verified in a real browser.
 */

import { describe, it, expect, vi } from "vitest";
import { persistEntryContent } from "../persist-entry-content";

describe("persistEntryContent -- Loro owns content", () => {
  it("flushes the handle and does NOT run the legacy content write", async () => {
    const flushLoro = vi.fn().mockResolvedValue(undefined);
    const writeLegacyContent = vi.fn().mockResolvedValue({ id: 1 });

    const result = await persistEntryContent({
      loroOwnsContent: true,
      flushLoro,
      writeLegacyContent,
    });

    expect(flushLoro).toHaveBeenCalledTimes(1);
    expect(writeLegacyContent).not.toHaveBeenCalled();
    // No fresh Note from the API in Loro mode; caller must not try to use one.
    expect(result.wroteLegacy).toBe(false);
    expect(result.legacyResult).toBeNull();
  });

  it("awaits the flush before resolving (so close/flush paths can rely on it)", async () => {
    const order: string[] = [];
    const flushLoro = vi.fn().mockImplementation(async () => {
      await Promise.resolve();
      order.push("flushed");
    });

    await persistEntryContent({
      loroOwnsContent: true,
      flushLoro,
      writeLegacyContent: vi.fn(),
    });
    order.push("returned");

    expect(order).toEqual(["flushed", "returned"]);
  });
});

describe("persistEntryContent -- legacy owns content (flag off / handle not ready)", () => {
  it("runs the legacy content write and does NOT flush Loro", async () => {
    const flushLoro = vi.fn().mockResolvedValue(undefined);
    const updatedNote = { id: 7, title: "n" };
    const writeLegacyContent = vi.fn().mockResolvedValue(updatedNote);

    const result = await persistEntryContent({
      loroOwnsContent: false,
      flushLoro,
      writeLegacyContent,
    });

    expect(writeLegacyContent).toHaveBeenCalledTimes(1);
    expect(flushLoro).not.toHaveBeenCalled();
    expect(result.wroteLegacy).toBe(true);
    expect(result.legacyResult).toBe(updatedNote);
  });

  it("surfaces a null legacy result so callers can keep the entry dirty on failure", async () => {
    const result = await persistEntryContent({
      loroOwnsContent: false,
      flushLoro: vi.fn(),
      writeLegacyContent: vi.fn().mockResolvedValue(null),
    });

    // wroteLegacy true + null result is the "save failed, stay dirty" signal.
    expect(result.wroteLegacy).toBe(true);
    expect(result.legacyResult).toBeNull();
  });
});
