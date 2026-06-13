"use client";

// BeakerBot Canvas panel (ai canvas bot, 2026-06-13).
//
// The docked, editable side panel that opens to the RIGHT of the BeakerBot chat
// when the model drafts note / method content. It replaces the old read-only
// Approve / Reject card in the chat. Visual target,
// docs/mockups/2026-06-13-beakerbot-canvas.html (the AFTER split-win, chat
// column + Canvas panel).
//
// Structure:
//   - Head: a Canvas mark + the active draft title badge + a close (collapse) x.
//   - Tab strip: one tab per open draft, each with an unsaved dot when the buffer
//     diverges from the model's draft. Switching tabs preserves each buffer.
//   - Body: the existing markdown editor (LiveMarkdownEditor), slimmed (no
//     internal toolbar, no internal Save button), with an Edit / Preview toggle
//     Canvas owns. The editor IS the editing surface, the draft mounts editing.
//   - Foot: Save (primary, the consent that replaces Approve, writes the edited
//     buffer) and Discard (the old Reject, throws the draft away with a confirm).
//
// No soft locks, the close button only collapses the panel (tabs and unsaved
// buffers persist, the chat pointer line reopens it). Discard asks first. A
// saved tab stays as a read-only, closeable record.
//
// House style, Icon only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import LiveMarkdownEditor from "@/components/LiveMarkdownEditor";
import {
  useCanvasStore,
  isTabDirty,
  type CanvasTab,
} from "@/lib/ai/canvas-store";

// Confirm dialog shown before Discard throws a draft away. Discard is the reject
// path (nothing is written), but a draft can hold real edits, so we confirm.
function DiscardConfirm({
  title,
  onConfirm,
  onCancel,
}: {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="beakerbot-canvas-discard-confirm"
      className="absolute inset-0 z-20 flex items-center justify-center bg-surface/80 p-4"
    >
      <div className="w-72 rounded-xl border border-border bg-surface px-5 py-4 shadow-2xl">
        <p className="text-body font-semibold text-foreground">Discard this draft?</p>
        <p className="mt-1 text-meta text-foreground-muted">
          {title} will be thrown away and nothing is written. You can ask
          BeakerBot to draft it again.
        </p>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="beakerbot-canvas-discard-cancel"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          >
            Keep editing
          </button>
          <button
            type="button"
            data-testid="beakerbot-canvas-discard-confirm-btn"
            onClick={onConfirm}
            className="flex items-center gap-1 rounded-md border border-red-400 bg-red-50 px-3 py-1.5 text-meta font-medium text-red-600 transition-colors hover:bg-red-100"
          >
            <Icon name="trash" className="h-3.5 w-3.5" title="Discard" />
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

function CanvasTabStrip({
  tabs,
  activeTabId,
}: {
  tabs: CanvasTab[];
  activeTabId: string | null;
}) {
  const focusTab = useCanvasStore((s) => s.focusTab);
  const closeTab = useCanvasStore((s) => s.closeTab);
  // A single tab needs no strip; the head badge already names it.
  if (tabs.length <= 1) return null;
  return (
    <div
      data-testid="beakerbot-canvas-tabs"
      className="flex items-center gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-1.5"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const dirty = isTabDirty(tab);
        return (
          <div
            key={tab.id}
            className={`flex flex-none items-center gap-1.5 rounded-md border px-2 py-1 text-meta transition-colors ${
              isActive
                ? "border-brand bg-brand/10 text-brand"
                : "border-border text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            <button
              type="button"
              data-testid="beakerbot-canvas-tab"
              onClick={() => focusTab(tab.id)}
              className="flex items-center gap-1.5 font-medium"
            >
              {dirty ? (
                <span
                  data-testid="beakerbot-canvas-tab-unsaved"
                  aria-label="Unsaved edits"
                  className="block h-1.5 w-1.5 flex-none rounded-full bg-brand"
                />
              ) : null}
              <span className="max-w-[10rem] truncate">{tab.title}</span>
            </button>
            {tab.settled !== null ? (
              <Tooltip label="Close tab">
                <button
                  type="button"
                  data-testid="beakerbot-canvas-tab-close"
                  onClick={() => closeTab(tab.id)}
                  aria-label="Close tab"
                  className="flex h-4 w-4 items-center justify-center rounded text-foreground-muted hover:text-foreground"
                >
                  <Icon name="close" className="h-3 w-3" title="Close tab" />
                </button>
              </Tooltip>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function BeakerBotCanvas() {
  const open = useCanvasStore((s) => s.open);
  const tabs = useCanvasStore((s) => s.tabs);
  const activeTabId = useCanvasStore((s) => s.activeTabId);
  const setBuffer = useCanvasStore((s) => s.setBuffer);
  const setEditorMode = useCanvasStore((s) => s.setEditorMode);
  const closePanel = useCanvasStore((s) => s.closePanel);
  const saveTab = useCanvasStore((s) => s.saveTab);
  const discardTab = useCanvasStore((s) => s.discardTab);

  // The tab pending a Discard confirm, or null.
  const [discardId, setDiscardId] = useState<string | null>(null);

  // The panel renders nothing when collapsed or empty. The chat pointer line is
  // the way back in.
  if (!open || tabs.length === 0) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const dirty = isTabDirty(activeTab);
  const isSettled = activeTab.settled !== null;
  const discardTarget = tabs.find((t) => t.id === discardId) ?? null;

  return (
    <div
      data-testid="beakerbot-canvas"
      className="relative flex w-[22rem] flex-none flex-col border-l border-border bg-surface-sunken"
    >
      {/* Head: Canvas mark, active draft title badge, collapse x. */}
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2.5">
        <span className="text-brand">
          <Icon name="file" className="h-4 w-4" title="Canvas" />
        </span>
        <span className="text-meta font-semibold text-foreground">Canvas</span>
        <span
          data-testid="beakerbot-canvas-title"
          className="ml-1 max-w-[10rem] truncate rounded-full bg-brand/10 px-2 py-0.5 text-meta font-medium text-brand"
        >
          {activeTab.title}
        </span>
        <Tooltip label="Collapse Canvas">
          <button
            type="button"
            data-testid="beakerbot-canvas-close"
            onClick={closePanel}
            aria-label="Collapse Canvas"
            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          >
            <Icon name="close" className="h-4 w-4" title="Collapse Canvas" />
          </button>
        </Tooltip>
      </div>

      {/* Tab strip (only when more than one draft is open). */}
      <CanvasTabStrip tabs={tabs} activeTabId={activeTab.id} />

      {/* Edit / Preview toggle Canvas owns (the editor's own toolbar is hidden). */}
      <div className="flex items-center gap-1.5 border-b border-border bg-surface px-3 py-1.5">
        <div className="inline-flex overflow-hidden rounded-md border border-border text-meta">
          <button
            type="button"
            data-testid="beakerbot-canvas-mode-edit"
            onClick={() => setEditorMode(activeTab.id, "inline")}
            aria-pressed={activeTab.editorMode === "inline"}
            className={`px-2.5 py-1 font-medium transition-colors ${
              activeTab.editorMode === "inline"
                ? "bg-brand/10 text-brand"
                : "text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            Edit
          </button>
          <button
            type="button"
            data-testid="beakerbot-canvas-mode-preview"
            onClick={() => setEditorMode(activeTab.id, "preview")}
            aria-pressed={activeTab.editorMode === "preview"}
            className={`border-l border-border px-2.5 py-1 font-medium transition-colors ${
              activeTab.editorMode === "preview"
                ? "bg-brand/10 text-brand"
                : "text-foreground-muted hover:bg-surface-sunken"
            }`}
          >
            Preview
          </button>
        </div>
        {dirty ? (
          <span
            data-testid="beakerbot-canvas-dirty"
            className="ml-1 flex items-center gap-1 text-meta text-foreground-muted"
          >
            <span className="block h-1.5 w-1.5 rounded-full bg-brand" />
            Unsaved edits
          </span>
        ) : null}
        {isSettled ? (
          <span className="ml-1 flex items-center gap-1 text-meta text-foreground-muted">
            <Icon name="check" className="h-3.5 w-3.5" title="Saved" />
            {activeTab.settled === "saved" ? "Saved" : "Discarded"}
          </span>
        ) : null}
      </div>

      {/* Body: the slimmed markdown editor. Keyed on the tab id so switching tabs
          remounts a clean editor on the new buffer (no carried-over CodeMirror
          internal state). */}
      <div
        data-testid="beakerbot-canvas-editor"
        className="flex-1 overflow-y-auto bg-surface px-3 py-2"
      >
        <LiveMarkdownEditor
          key={activeTab.id}
          value={activeTab.buffer}
          onChange={(v) => setBuffer(activeTab.id, v)}
          showToolbar={false}
          hideSaveButton
          autoStartEditing
          disabled={isSettled}
          recordType="note"
          mode={activeTab.editorMode}
          onModeChange={(m) => setEditorMode(activeTab.id, m)}
          placeholder="Edit the draft here, then Save."
        />
      </div>

      {/* Foot: Save (consent) + Discard (reject). A settled tab shows neither. */}
      {isSettled ? (
        <div className="border-t border-border bg-surface px-3 py-2.5 text-meta text-foreground-muted">
          This draft is {activeTab.settled === "saved" ? "saved" : "discarded"}.
          Close the tab when you are done.
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-border bg-surface px-3 py-2.5">
          <span className="flex-1 text-meta text-foreground-muted">
            {activeTab.mode === "create"
              ? "Save writes a new note. Editing is the consent."
              : `Save adds it${
                  activeTab.noteTitle ? ` to ${activeTab.noteTitle}` : ""
                }. Editing is the consent.`}
          </span>
          <button
            type="button"
            data-testid="beakerbot-canvas-discard"
            onClick={() => setDiscardId(activeTab.id)}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-meta font-medium text-foreground-muted transition-colors hover:bg-surface-sunken hover:text-foreground"
          >
            <Icon name="trash" className="h-3.5 w-3.5" title="Discard" />
            Discard
          </button>
          <button
            type="button"
            data-testid="beakerbot-canvas-save"
            onClick={() => saveTab(activeTab.id)}
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 flex items-center gap-1 rounded-md px-3 py-1.5 text-meta font-medium"
          >
            <Icon name="save" className="h-3.5 w-3.5" title="Save" />
            Save
          </button>
        </div>
      )}

      {/* Discard confirm overlay. */}
      {discardTarget ? (
        <DiscardConfirm
          title={discardTarget.title}
          onConfirm={() => {
            discardTab(discardTarget.id);
            setDiscardId(null);
          }}
          onCancel={() => setDiscardId(null)}
        />
      ) : null}
    </div>
  );
}
