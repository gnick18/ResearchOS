"use client";

// BeakerChatRail (BeakerAI lane, 2026-06-12).
//
// The persistent left history rail in BeakerBot's AI (ask) mode, like a real
// chat app. Replaces the old clock-icon BeakerChatHistoryPanel: New chat on top,
// the past chats listed (the open one highlighted), a collapsible Archived
// section, and per-row rename / archive / delete on hover. Reopening loads the
// thread into the conversation store. The persistence backend (threads on disk)
// is unchanged, this is purely the rail UI.
//
// Every blocking affordance has a visible escape, inline rename has Save /
// Cancel, Delete uses an in-row confirm with Cancel.
//
// House style, Icon only, brand + semantic tokens, no emojis / em-dashes /
// mid-sentence colons.

import { useEffect, useState, useCallback } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  listThreads,
  loadThreadAction,
  renameThread,
  archiveThread,
  deleteThread,
  useConversationStore,
} from "@/lib/ai/conversation-store";
import type { StoredBeakerChat } from "@/lib/ai/beaker-chats-store";
import {
  listMacros,
  deleteMacro,
  createMacro,
  slugifyMacroName,
  ensureUniqueMacroName,
  type StoredMacro,
} from "@/lib/ai/beaker-macros-store";
import { useMacroUiStore } from "@/lib/ai/macro-ui-store";

function shortWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function BeakerChatRail() {
  const [chats, setChats] = useState<StoredBeakerChat[] | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Macros (the manager view in this rail). Loaded from disk and refreshed when
  // any macro is created / edited / duplicated / deleted (the revision counter).
  const [macros, setMacros] = useState<StoredMacro[] | null>(null);
  const [confirmDeleteMacroId, setConfirmDeleteMacroId] = useState<number | null>(
    null,
  );
  const macroRevision = useMacroUiStore((s) => s.revision);
  const openMacroEditor = useMacroUiStore((s) => s.openEditor);
  const notifyMacrosChanged = useMacroUiStore((s) => s.notifyMacrosChanged);
  useEffect(() => {
    void listMacros().then(setMacros);
  }, [macroRevision]);

  const handleRunMacro = (macro: StoredMacro) => {
    void useConversationStore.getState().runStoredMacro(macro);
  };
  const handleDuplicateMacro = async (macro: StoredMacro) => {
    const base = slugifyMacroName(`${macro.name}-copy`);
    const others = (macros ?? []).map((m) => m.name);
    await createMacro({
      name: ensureUniqueMacroName(base, others),
      description: macro.description,
      steps: macro.steps,
    });
    notifyMacrosChanged();
  };
  const handleDeleteMacro = async (id: number) => {
    await deleteMacro(id);
    setConfirmDeleteMacroId(null);
    notifyMacrosChanged();
  };

  // The open thread, reactive, so the matching row highlights and the list
  // refreshes when a fresh chat creates its thread on the first send.
  const currentThreadId = useConversationStore((s) => s.currentThreadId);

  const refresh = useCallback(async () => {
    setChats(await listThreads());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, currentThreadId]);

  const active = (chats ?? []).filter((c) => !c.archived);
  const archived = (chats ?? []).filter((c) => c.archived);

  const handleReopen = async (id: number) => {
    if (id === currentThreadId) return;
    await loadThreadAction(id);
  };
  const startRename = (chat: StoredBeakerChat) => {
    setRenamingId(chat.id);
    setRenameDraft(chat.title);
  };
  const commitRename = async (id: number) => {
    await renameThread(id, renameDraft);
    setRenamingId(null);
    await refresh();
  };
  const handleArchive = async (id: number, next: boolean) => {
    await archiveThread(id, next);
    await refresh();
  };
  const handleDelete = async (id: number) => {
    await deleteThread(id);
    setConfirmDeleteId(null);
    await refresh();
  };

  function renderRow(chat: StoredBeakerChat) {
    const isRenaming = renamingId === chat.id;
    const isConfirming = confirmDeleteId === chat.id;
    const isActive = chat.id === currentThreadId;

    if (isRenaming) {
      return (
        <li key={chat.id} data-testid="beaker-chat-row" className="px-1.5 py-0.5">
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void commitRename(chat.id);
            }}
          >
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              aria-label="Chat title"
              className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-meta text-foreground focus:border-brand-action focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Save title"
              className="flex h-6 w-6 flex-none items-center justify-center rounded text-brand-action hover:bg-surface-raised"
            >
              <Icon name="check" className="h-3.5 w-3.5" title="Save" />
            </button>
            <button
              type="button"
              aria-label="Cancel rename"
              onClick={() => setRenamingId(null)}
              className="flex h-6 w-6 flex-none items-center justify-center rounded text-foreground-muted hover:bg-surface-raised hover:text-foreground"
            >
              <Icon name="close" className="h-3.5 w-3.5" title="Cancel" />
            </button>
          </form>
        </li>
      );
    }

    return (
      <li
        key={chat.id}
        data-testid="beaker-chat-row"
        className={`group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 ${
          isActive
            ? "bg-brand-action/10 shadow-[inset_2px_0_0_var(--color-brand-action)]"
            : "hover:bg-surface-raised"
        }`}
      >
        <button
          type="button"
          data-testid="beaker-chat-reopen"
          onClick={() => void handleReopen(chat.id)}
          className="flex min-w-0 flex-1 flex-col items-start text-left"
        >
          <span
            className={`w-full truncate text-meta ${
              isActive ? "font-semibold text-foreground" : "text-foreground"
            }`}
          >
            {chat.title}
          </span>
          <span className="text-[10px] text-foreground-muted">
            {shortWhen(chat.updatedAt)}
          </span>
        </button>

        {isConfirming ? (
          <div className="flex flex-none items-center gap-1 text-[11px]">
            <button
              type="button"
              data-testid="beaker-chat-delete-confirm"
              onClick={() => void handleDelete(chat.id)}
              className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteId(null)}
              className="rounded border border-border px-1.5 py-0.5 text-foreground-muted hover:bg-surface-raised hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="hidden flex-none items-center gap-0.5 group-hover:flex">
            <Tooltip label="Rename" placement="bottom">
              <button
                type="button"
                data-testid="beaker-chat-rename"
                aria-label="Rename chat"
                onClick={() => startRename(chat)}
                className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
              >
                <Icon name="pencil" className="h-3.5 w-3.5" title="Rename" />
              </button>
            </Tooltip>
            <Tooltip label={chat.archived ? "Unarchive" : "Archive"} placement="bottom">
              <button
                type="button"
                data-testid="beaker-chat-archive"
                aria-label={chat.archived ? "Unarchive chat" : "Archive chat"}
                onClick={() => void handleArchive(chat.id, !chat.archived)}
                className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
              >
                <Icon
                  name={chat.archived ? "undo" : "box"}
                  className="h-3.5 w-3.5"
                  title={chat.archived ? "Unarchive" : "Archive"}
                />
              </button>
            </Tooltip>
            <Tooltip label="Delete" placement="bottom">
              <button
                type="button"
                data-testid="beaker-chat-delete"
                aria-label="Delete chat"
                onClick={() => setConfirmDeleteId(chat.id)}
                className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted hover:bg-surface-sunken hover:text-red-600"
              >
                <Icon name="trash" className="h-3.5 w-3.5" title="Delete" />
              </button>
            </Tooltip>
          </div>
        )}
      </li>
    );
  }

  return (
    <div
      data-testid="beaker-chat-rail"
      className="flex w-[212px] flex-none flex-col border-r border-border bg-surface-sunken"
    >
      <div className="p-2">
        <button
          type="button"
          data-testid="beaker-chat-new"
          onClick={() => useConversationStore.getState().newChat()}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-raised px-2 py-1.5 text-meta font-semibold text-foreground hover:border-brand-action hover:text-brand-action"
        >
          <Icon name="plus" className="h-3.5 w-3.5" title="" />
          New chat
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {chats === null ? (
          <p className="px-2 py-3 text-meta text-foreground-muted">Loading...</p>
        ) : active.length === 0 ? (
          <p className="px-2 py-3 text-meta text-foreground-muted">
            No chats yet. Your conversations will appear here.
          </p>
        ) : (
          <>
            <p className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-foreground-muted">
              Recent
            </p>
            <ul className="flex flex-col gap-0.5">{active.map(renderRow)}</ul>
          </>
        )}
      </div>

      {/* Macros manager. Lists the user's saved macros with Run / Edit /
          Duplicate / Delete. Author-from-scratch (an Add-step tool picker) is a
          follow-up, today macros are created by "Save as macro" on a run or by
          Duplicate. The disabled Lab macros row reserves the lab-shared home. */}
      <div className="border-t border-border">
        <div className="flex items-center gap-1.5 px-3 pb-1 pt-2">
          <Icon
            name="bolt"
            className="h-3 w-3 text-purple-600 dark:text-purple-300"
            title=""
          />
          <span className="text-[10px] font-bold uppercase tracking-wide text-purple-600 dark:text-purple-300">
            Macros
          </span>
        </div>
        {macros === null ? (
          <p className="px-3 pb-2 text-meta text-foreground-muted">Loading...</p>
        ) : macros.length === 0 ? (
          <p className="px-3 pb-2 text-[11px] leading-snug text-foreground-muted">
            No macros yet. Run something, then choose Save as macro to reuse it
            with one command.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5 px-1.5 pb-1.5">
            {macros.map((macro) => {
              const isConfirming = confirmDeleteMacroId === macro.id;
              return (
                <li
                  key={macro.id}
                  data-testid="beaker-macro-row"
                  className="group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-surface-raised"
                >
                  <button
                    type="button"
                    data-testid="beaker-macro-run"
                    onClick={() => handleRunMacro(macro)}
                    className="flex min-w-0 flex-1 flex-col items-start text-left"
                  >
                    <span className="w-full truncate text-meta font-semibold text-purple-600 dark:text-purple-300">
                      /{macro.name}
                    </span>
                    <span className="w-full truncate text-[10px] text-foreground-muted">
                      {macro.steps.length} step
                      {macro.steps.length === 1 ? "" : "s"}
                      {macro.description ? ` · ${macro.description}` : ""}
                    </span>
                  </button>

                  {isConfirming ? (
                    <div className="flex flex-none items-center gap-1 text-[11px]">
                      <button
                        type="button"
                        data-testid="beaker-macro-delete-confirm"
                        onClick={() => void handleDeleteMacro(macro.id)}
                        className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteMacroId(null)}
                        className="rounded border border-border px-1.5 py-0.5 text-foreground-muted hover:bg-surface-raised hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="hidden flex-none items-center gap-0.5 group-hover:flex">
                      <Tooltip label="Run macro" placement="bottom">
                        <button
                          type="button"
                          aria-label="Run macro"
                          onClick={() => handleRunMacro(macro)}
                          className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted hover:bg-surface-sunken hover:text-purple-600 dark:hover:text-purple-300"
                        >
                          <Icon name="bolt" className="h-3.5 w-3.5" title="Run" />
                        </button>
                      </Tooltip>
                      <Tooltip label="Edit" placement="bottom">
                        <button
                          type="button"
                          data-testid="beaker-macro-edit"
                          aria-label="Edit macro"
                          onClick={() =>
                            openMacroEditor({
                              macroId: macro.id,
                              name: macro.name,
                              description: macro.description,
                              steps: macro.steps,
                            })
                          }
                          className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                        >
                          <Icon name="pencil" className="h-3.5 w-3.5" title="Edit" />
                        </button>
                      </Tooltip>
                      <Tooltip label="Duplicate" placement="bottom">
                        <button
                          type="button"
                          aria-label="Duplicate macro"
                          onClick={() => void handleDuplicateMacro(macro)}
                          className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                        >
                          <Icon name="copy" className="h-3.5 w-3.5" title="Duplicate" />
                        </button>
                      </Tooltip>
                      <Tooltip label="Delete" placement="bottom">
                        <button
                          type="button"
                          aria-label="Delete macro"
                          onClick={() => setConfirmDeleteMacroId(macro.id)}
                          className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted hover:bg-surface-sunken hover:text-red-600"
                        >
                          <Icon name="trash" className="h-3.5 w-3.5" title="Delete" />
                        </button>
                      </Tooltip>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center gap-1.5 px-3 pb-2 pt-0.5 text-[10px] text-foreground-muted">
          <Icon name="lock" className="h-3 w-3" title="" />
          <span>Lab macros</span>
          <span className="rounded border border-border bg-surface px-1 py-px text-[9px] font-semibold uppercase tracking-wide">
            soon
          </span>
        </div>
      </div>

      {archived.length > 0 ? (
        <div className="border-t border-border">
          <button
            type="button"
            data-testid="beaker-chat-archived-toggle"
            onClick={() => setShowArchived((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-foreground-muted hover:text-foreground"
          >
            <Icon
              name={showArchived ? "chevronDown" : "chevronRight"}
              className="h-3 w-3"
              title=""
            />
            Archived ({archived.length})
          </button>
          {showArchived ? (
            <ul className="flex flex-col gap-0.5 px-1.5 pb-2">
              {archived.map(renderRow)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
