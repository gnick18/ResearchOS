// BeakerBot Canvas store (ai canvas bot, 2026-06-13).
//
// Canvas is the editable side panel docked to the right of the BeakerBot chat.
// When the model drafts note / method content (write_note, save_summary_as_note,
// draft_paper_summary, extract_paper_method), the agent loop pauses on a "draft"
// approval. Instead of rendering a read-only Approve / Reject card in the chat,
// that draft opens as an editable Canvas tab. The user fixes a word, a number,
// or a heading, then clicks Save. Saving IS the consent that replaces the old
// Approve, it resolves the approval with the EDITED content so the tool writes
// the user's text. Discard throws the draft away (the old Reject path).
//
// Why a dedicated store (not pendingApproval): the chat-side approval bridge in
// conversation-store carries one in-flight approval. Canvas needs richer,
// longer-lived state, multiple tabs, a per-tab edit buffer, a per-tab unsaved
// dot, panel open / closed, and a resolver per tab. Keeping it here, module
// level + Zustand (the same pattern as conversation-store), means the Canvas
// state survives the chat surface remounting (the BeakerSearch palette opening
// and closing) exactly like the conversation does.
//
// The bridge: conversation-store's requestApproval, on a kind:"draft" request,
// calls openCanvasDraft({ ...descriptor, resolve }). That adds a tab, focuses
// the panel, and returns. The agent loop's requestApproval promise stays pending
// until the user Saves (resolve a draft-save decision with the edited buffer) or
// Discards (resolve "skip"). The model still only narrates, Canvas is a
// deterministic editing surface over content the model proposed.
//
// No soft locks: closing the panel never loses a draft (the tabs persist, and
// reopening the panel shows them). Discard asks for a confirm before throwing a
// draft away. There is always a visible way back to an open draft.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { create } from "zustand";
import type { ApprovalDecision } from "@/lib/ai/tools/types";

// The editor mode for a Canvas tab, mirroring LiveMarkdownEditor's EditorMode.
// "inline" is the CodeMirror editing surface, "preview" renders the markdown.
export type CanvasEditorMode = "inline" | "preview";

// One draft open in Canvas. Each draft the model produces becomes a tab. The tab
// holds its own edit buffer so switching or closing other tabs never disturbs it.
export type CanvasTab = {
  /** Stable id, used as the tab key and for focus / close / save addressing. */
  id: string;
  /** The tool that raised this draft, for traceability (not shown prominently). */
  toolName: string;
  /** The tab title (from the draft title / note title), shown on the tab and the
   *  chat pointer line. Falls back to a generic label when the draft has none. */
  title: string;
  /** Whether saving CREATES a new note / method or APPENDS to an existing one. */
  mode: "create" | "append";
  /** For an append, the title of the existing note, for the footer copy. */
  noteTitle?: string;
  /** The model's original drafted content, kept so dirty can be computed and so a
   *  reset is possible. Never mutated after the tab opens. */
  original: string;
  /** The live edit buffer, what the editor shows and what Save commits. Starts
   *  equal to original. */
  buffer: string;
  /** The editor mode for this tab (inline edit vs preview). Per-tab so switching
   *  tabs restores each one's view. */
  editorMode: CanvasEditorMode;
  /** The resolver for the agent loop's in-flight draft approval. Save resolves a
   *  draft-save decision with the buffer; Discard resolves "skip". Set to null
   *  once resolved so a double-answer is a no-op and the tab becomes inert (a
   *  settled tab the user can still read and then close). */
  resolve: ((decision: ApprovalDecision) => void) | null;
  /** The settled outcome once the user acts, for the tab's post-save state. Null
   *  while pending. */
  settled: "saved" | "discarded" | null;
};

interface CanvasState {
  /** Whether the Canvas panel is docked open. Toggled by the close button and the
   *  chat pointer line's focus affordance. */
  open: boolean;
  /** All open draft tabs, in arrival order. */
  tabs: CanvasTab[];
  /** The id of the focused tab, or null when none. */
  activeTabId: string | null;
}

interface CanvasActions {
  /**
   * Open a new draft as a Canvas tab and focus it. Called by conversation-store's
   * requestApproval bridge. The resolve callback is the agent loop's approval
   * resolver, held so Save / Discard can answer it.
   */
  openDraft: (input: {
    id: string;
    toolName: string;
    title: string;
    mode: "create" | "append";
    noteTitle?: string;
    content: string;
    resolve: (decision: ApprovalDecision) => void;
  }) => void;
  /** Update a tab's edit buffer as the user types. */
  setBuffer: (tabId: string, value: string) => void;
  /** Switch a tab's editor mode (inline edit vs preview). */
  setEditorMode: (tabId: string, mode: CanvasEditorMode) => void;
  /** Focus a tab and make sure the panel is open. */
  focusTab: (tabId: string) => void;
  /** Open the panel (no tab change). */
  openPanel: () => void;
  /** Close (collapse) the panel without losing tabs or unsaved buffers. */
  closePanel: () => void;
  /**
   * Save a tab. Resolves its approval with a draft-save decision carrying the
   * edited buffer, so the tool writes the user's text. Marks the tab saved. The
   * tab stays as a closeable, read-only tab so the user has a record; it is no
   * longer pending. No-op when the tab does not exist or is already settled.
   */
  saveTab: (tabId: string) => void;
  /**
   * Discard a tab. Resolves its approval with "skip" (the reject path, the model
   * is told the user declined). Removes the tab entirely. No-op when the tab does
   * not exist or is already settled.
   */
  discardTab: (tabId: string) => void;
  /**
   * Close a settled tab (saved or discarded) without re-resolving. A pending tab
   * cannot be closed this way, the user must Save or Discard first so the loop is
   * never left dangling. Removes the tab; closes the panel when it was the last.
   */
  closeTab: (tabId: string) => void;
  /** Reset all Canvas state. Used when the conversation is cleared / a new chat
   *  starts. Any still-pending tab is resolved "skip" so the loop does not hang. */
  reset: () => void;
}

type CanvasStore = CanvasState & CanvasActions;

// A monotonically increasing fallback id source, only used if a caller does not
// pass an id. Real callers pass a stable id from the approval request.
let canvasCounter = 0;
function nextCanvasId(): string {
  canvasCounter += 1;
  return `canvas-${canvasCounter}-${Date.now()}`;
}

/** Whether a tab has unsaved edits (buffer diverged from the original draft). A
 *  settled tab is never dirty. Pure, exported for tests and the unsaved-dot UI. */
export function isTabDirty(tab: CanvasTab): boolean {
  if (tab.settled !== null) return false;
  return tab.buffer !== tab.original;
}

const DEFAULT_CANVAS_TITLE = "Untitled draft";

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  open: false,
  tabs: [],
  activeTabId: null,

  openDraft: ({ id, toolName, title, mode, noteTitle, content, resolve }) => {
    const tabId = id || nextCanvasId();
    const tab: CanvasTab = {
      id: tabId,
      toolName,
      title: title.trim() || DEFAULT_CANVAS_TITLE,
      mode,
      ...(noteTitle ? { noteTitle } : {}),
      original: content,
      buffer: content,
      editorMode: "inline",
      resolve,
      settled: null,
    };
    set((state) => ({
      open: true,
      tabs: [...state.tabs, tab],
      activeTabId: tabId,
    }));
  },

  setBuffer: (tabId, value) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, buffer: value } : t,
      ),
    }));
  },

  setEditorMode: (tabId, mode) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, editorMode: mode } : t,
      ),
    }));
  },

  focusTab: (tabId) => {
    set({ activeTabId: tabId, open: true });
  },

  openPanel: () => set({ open: true }),

  closePanel: () => set({ open: false }),

  saveTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.settled !== null) return;
    // Resolve the loop's approval with the EDITED buffer. This is the consent
    // that replaces the old Approve, and it carries the user's edits to the tool.
    tab.resolve?.({ kind: "draft-save", content: tab.buffer });
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, resolve: null, settled: "saved" as const, original: t.buffer }
          : t,
      ),
    }));
  },

  discardTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.settled !== null) return;
    // Resolve the loop's approval with "skip", the reject path. The model is told
    // the user declined and offers to revise.
    tab.resolve?.("skip");
    set((state) => {
      const remaining = state.tabs.filter((t) => t.id !== tabId);
      return {
        tabs: remaining,
        activeTabId:
          state.activeTabId === tabId
            ? (remaining[remaining.length - 1]?.id ?? null)
            : state.activeTabId,
        // Keep the panel open if other tabs remain; collapse when none are left.
        open: remaining.length > 0 ? state.open : false,
      };
    });
  },

  closeTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    // Only settled tabs can be closed without an explicit Save / Discard, so a
    // pending loop approval is never abandoned.
    if (!tab || tab.settled === null) return;
    set((state) => {
      const remaining = state.tabs.filter((t) => t.id !== tabId);
      return {
        tabs: remaining,
        activeTabId:
          state.activeTabId === tabId
            ? (remaining[remaining.length - 1]?.id ?? null)
            : state.activeTabId,
        open: remaining.length > 0 ? state.open : false,
      };
    });
  },

  reset: () => {
    // Resolve any still-pending tab "skip" so the agent loop's await does not
    // dangle forever after a fresh chat / clear.
    for (const t of get().tabs) {
      if (t.settled === null) t.resolve?.("skip");
    }
    set({ open: false, tabs: [], activeTabId: null });
  },
}));

// ---- Test helpers -------------------------------------------------------------

/** Reset module-level Canvas state for tests. */
export function resetCanvasModule(): void {
  canvasCounter = 0;
  useCanvasStore.setState({ open: false, tabs: [], activeTabId: null });
}
