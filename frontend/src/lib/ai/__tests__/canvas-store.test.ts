// Canvas store tests (ai canvas bot, 2026-06-13).
//
// Pins the Canvas (editable draft panel) state machine that sits between the
// agent loop's draft approval and the user's Save / Discard. Each draft opens as
// a tab with its own edit buffer. Save resolves the loop's approval with the
// EDITED buffer (the consent), Discard resolves "skip" (the reject). Multiple
// tabs hold independent buffers; switching or closing one never disturbs another.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useCanvasStore,
  isTabDirty,
  resetCanvasModule,
} from "../canvas-store";
import type { ApprovalDecision } from "../tools/types";

beforeEach(() => {
  resetCanvasModule();
});

function openOne(
  id: string,
  title: string,
  content: string,
  resolve: (d: ApprovalDecision) => void,
) {
  useCanvasStore.getState().openDraft({
    id,
    toolName: "write_note",
    title,
    mode: "create",
    content,
    resolve,
  });
}

describe("canvas-store open + focus", () => {
  it("opens a draft as a tab, focuses it, and docks the panel", () => {
    openOne("t1", "qPCR summary", "Original.", vi.fn());
    const s = useCanvasStore.getState();
    expect(s.open).toBe(true);
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe("t1");
    expect(s.tabs[0].title).toBe("qPCR summary");
    expect(s.tabs[0].buffer).toBe("Original.");
  });

  it("collapsing the panel keeps the tabs and unsaved buffers (no soft-lock)", () => {
    openOne("t1", "Draft", "Original.", vi.fn());
    useCanvasStore.getState().setBuffer("t1", "Edited.");
    useCanvasStore.getState().closePanel();
    const s = useCanvasStore.getState();
    expect(s.open).toBe(false);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].buffer).toBe("Edited.");
    // The pointer line reopens it.
    useCanvasStore.getState().focusTab("t1");
    expect(useCanvasStore.getState().open).toBe(true);
  });
});

describe("canvas-store dirty tracking", () => {
  it("is clean when the buffer matches the original, dirty after an edit", () => {
    openOne("t1", "Draft", "Original.", vi.fn());
    expect(isTabDirty(useCanvasStore.getState().tabs[0])).toBe(false);
    useCanvasStore.getState().setBuffer("t1", "Edited.");
    expect(isTabDirty(useCanvasStore.getState().tabs[0])).toBe(true);
  });

  it("a settled tab is never dirty", () => {
    openOne("t1", "Draft", "Original.", vi.fn());
    useCanvasStore.getState().setBuffer("t1", "Edited.");
    useCanvasStore.getState().saveTab("t1");
    expect(isTabDirty(useCanvasStore.getState().tabs[0])).toBe(false);
  });
});

describe("canvas-store save = consent", () => {
  it("Save resolves the approval with a draft-save decision carrying the edited buffer", () => {
    const resolve = vi.fn();
    openOne("t1", "Draft", "Original.", resolve);
    useCanvasStore.getState().setBuffer("t1", "Edited in Canvas.");
    useCanvasStore.getState().saveTab("t1");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({
      kind: "draft-save",
      content: "Edited in Canvas.",
    });
    // The tab is now saved (a read-only record), not pending.
    const tab = useCanvasStore.getState().tabs[0];
    expect(tab.settled).toBe("saved");
    expect(tab.resolve).toBeNull();
  });

  it("Save with no edit resolves with the original content (saving as-is is fine)", () => {
    const resolve = vi.fn();
    openOne("t1", "Draft", "As drafted.", resolve);
    useCanvasStore.getState().saveTab("t1");
    expect(resolve).toHaveBeenCalledWith({
      kind: "draft-save",
      content: "As drafted.",
    });
  });

  it("a second Save on a settled tab is a no-op (no double-resolve)", () => {
    const resolve = vi.fn();
    openOne("t1", "Draft", "Original.", resolve);
    useCanvasStore.getState().saveTab("t1");
    useCanvasStore.getState().saveTab("t1");
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe("canvas-store discard = reject", () => {
  it("Discard resolves the approval with 'skip' and removes the tab", () => {
    const resolve = vi.fn();
    openOne("t1", "Draft", "Original.", resolve);
    useCanvasStore.getState().discardTab("t1");
    expect(resolve).toHaveBeenCalledWith("skip");
    const s = useCanvasStore.getState();
    expect(s.tabs).toHaveLength(0);
    // Panel collapses when the last tab is gone.
    expect(s.open).toBe(false);
  });
});

describe("canvas-store multi-tab", () => {
  it("holds multiple drafts with independent buffers; switching does not disturb others", () => {
    openOne("t1", "First", "First original.", vi.fn());
    openOne("t2", "Second", "Second original.", vi.fn());
    const s1 = useCanvasStore.getState();
    expect(s1.tabs).toHaveLength(2);
    // The newest is focused.
    expect(s1.activeTabId).toBe("t2");

    // Edit each tab independently.
    useCanvasStore.getState().setBuffer("t1", "First edited.");
    useCanvasStore.getState().setBuffer("t2", "Second edited.");
    useCanvasStore.getState().focusTab("t1");

    const s2 = useCanvasStore.getState();
    expect(s2.activeTabId).toBe("t1");
    expect(s2.tabs.find((t) => t.id === "t1")?.buffer).toBe("First edited.");
    expect(s2.tabs.find((t) => t.id === "t2")?.buffer).toBe("Second edited.");
    // Both still carry an unsaved dot.
    expect(isTabDirty(s2.tabs.find((t) => t.id === "t1")!)).toBe(true);
    expect(isTabDirty(s2.tabs.find((t) => t.id === "t2")!)).toBe(true);
  });

  it("saving one tab resolves only its approval; the other stays pending", () => {
    const resolve1 = vi.fn();
    const resolve2 = vi.fn();
    openOne("t1", "First", "First.", resolve1);
    openOne("t2", "Second", "Second.", resolve2);

    useCanvasStore.getState().saveTab("t1");
    expect(resolve1).toHaveBeenCalledTimes(1);
    expect(resolve2).not.toHaveBeenCalled();
    // The saved tab remains as a record; the pending one is untouched.
    const s = useCanvasStore.getState();
    expect(s.tabs.find((t) => t.id === "t1")?.settled).toBe("saved");
    expect(s.tabs.find((t) => t.id === "t2")?.settled).toBeNull();
  });

  it("a settled tab can be closed; a pending tab cannot (the loop is never abandoned)", () => {
    const resolve1 = vi.fn();
    const resolve2 = vi.fn();
    openOne("t1", "First", "First.", resolve1);
    openOne("t2", "Second", "Second.", resolve2);
    useCanvasStore.getState().saveTab("t1");

    // Closing the pending tab is a no-op.
    useCanvasStore.getState().closeTab("t2");
    expect(useCanvasStore.getState().tabs.find((t) => t.id === "t2")).toBeDefined();
    expect(resolve2).not.toHaveBeenCalled();

    // Closing the settled tab removes it without re-resolving.
    useCanvasStore.getState().closeTab("t1");
    expect(useCanvasStore.getState().tabs.find((t) => t.id === "t1")).toBeUndefined();
    expect(resolve1).toHaveBeenCalledTimes(1);
  });
});

describe("canvas-store reset", () => {
  it("resolves any still-pending tab 'skip' and clears everything", () => {
    const resolve = vi.fn();
    openOne("t1", "Draft", "Original.", resolve);
    useCanvasStore.getState().reset();
    expect(resolve).toHaveBeenCalledWith("skip");
    const s = useCanvasStore.getState();
    expect(s.tabs).toHaveLength(0);
    expect(s.open).toBe(false);
    expect(s.activeTabId).toBeNull();
  });

  it("does not re-resolve a tab that was already saved", () => {
    const resolve = vi.fn();
    openOne("t1", "Draft", "Original.", resolve);
    useCanvasStore.getState().saveTab("t1");
    useCanvasStore.getState().reset();
    // Only the save resolution fired; reset did not double-resolve.
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
