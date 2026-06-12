"use client";

// BeakerChatHistoryPanel (BeakerAI lane, 2026-06-12).
//
// The past-chats list behind the History clock in the BeakerSearch ask header.
// Lists persisted BeakerBot conversations in two sections (Active and
// Archived), and lets the user reopen, rename, archive / unarchive, and delete
// each one. Reopening loads the thread into the conversation store and closes
// the panel.
//
// Every blocking affordance has a visible escape, the panel has a close button,
// inline rename has Save / Cancel, and Delete uses an in-row confirm with a
// Cancel.
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
} from "@/lib/ai/conversation-store";
import type { StoredBeakerChat } from "@/lib/ai/beaker-chats-store";

// A short, friendly relative timestamp. Avoids a date library, the panel only
// needs a rough sense of recency.
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
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function BeakerChatHistoryPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [chats, setChats] = useState<StoredBeakerChat[] | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const all = await listThreads();
    setChats(all);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = (chats ?? []).filter((c) => !c.archived);
  const archived = (chats ?? []).filter((c) => c.archived);

  const handleReopen = async (id: number) => {
    await loadThreadAction(id);
    onClose();
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

  const handleArchive = async (id: number, archivedNext: boolean) => {
    await archiveThread(id, archivedNext);
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

    return (
      <li
        key={chat.id}
        data-testid="beaker-chat-row"
        className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2"
      >
        {isRenaming ? (
          <form
            className="flex flex-1 items-center gap-1.5"
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
              className="flex-1 rounded border border-border bg-surface px-2 py-1 text-body text-foreground focus:border-brand focus:outline-none"
            />
            <Tooltip label="Save" placement="bottom">
              <button
                type="submit"
                aria-label="Save title"
                className="flex h-6 w-6 items-center justify-center rounded text-brand hover:bg-surface-sunken"
              >
                <Icon name="check" className="h-4 w-4" title="Save" />
              </button>
            </Tooltip>
            <Tooltip label="Cancel" placement="bottom">
              <button
                type="button"
                aria-label="Cancel rename"
                onClick={() => setRenamingId(null)}
                className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
              >
                <Icon name="close" className="h-4 w-4" title="Cancel" />
              </button>
            </Tooltip>
          </form>
        ) : (
          <>
            <button
              type="button"
              data-testid="beaker-chat-reopen"
              onClick={() => void handleReopen(chat.id)}
              className="flex min-w-0 flex-1 flex-col items-start text-left"
            >
              <span className="w-full truncate text-body font-medium text-foreground">
                {chat.title}
              </span>
              <span className="text-meta text-foreground-muted">
                {shortWhen(chat.updatedAt)}
              </span>
            </button>

            {isConfirming ? (
              <div className="flex items-center gap-1.5 text-meta">
                <span className="text-foreground-muted">Delete?</span>
                <button
                  type="button"
                  data-testid="beaker-chat-delete-confirm"
                  onClick={() => void handleDelete(chat.id)}
                  className="rounded border border-red-300 bg-red-50 px-2 py-0.5 font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="rounded border border-border px-2 py-0.5 text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-none items-center gap-0.5">
                <Tooltip label="Rename" placement="bottom">
                  <button
                    type="button"
                    data-testid="beaker-chat-rename"
                    aria-label="Rename chat"
                    onClick={() => startRename(chat)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                  >
                    <Icon name="pencil" className="h-4 w-4" title="Rename" />
                  </button>
                </Tooltip>
                <Tooltip
                  label={chat.archived ? "Unarchive" : "Archive"}
                  placement="bottom"
                >
                  <button
                    type="button"
                    data-testid="beaker-chat-archive"
                    aria-label={chat.archived ? "Unarchive chat" : "Archive chat"}
                    onClick={() => void handleArchive(chat.id, !chat.archived)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
                  >
                    <Icon
                      name={chat.archived ? "undo" : "box"}
                      className="h-4 w-4"
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
                    className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-red-600"
                  >
                    <Icon name="trash" className="h-4 w-4" title="Delete" />
                  </button>
                </Tooltip>
              </div>
            )}
          </>
        )}
      </li>
    );
  }

  return (
    <div
      data-testid="beaker-chat-history-panel"
      className="flex max-h-[60vh] flex-col border-b border-border"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon name="history" className="h-4 w-4 text-foreground-muted" title="" />
        <span className="flex-1 text-body font-semibold text-foreground">
          Past chats
        </span>
        <Tooltip label="Close" placement="bottom">
          <button
            type="button"
            data-testid="beaker-chat-history-close"
            aria-label="Close past chats"
            onClick={onClose}
            className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
          >
            <Icon name="close" className="h-4 w-4" title="Close" />
          </button>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {chats === null ? (
          <p className="px-1 py-3 text-meta text-foreground-muted">
            Loading past chats...
          </p>
        ) : active.length === 0 && archived.length === 0 ? (
          <p
            data-testid="beaker-chat-empty"
            className="px-1 py-3 text-meta text-foreground-muted"
          >
            No past chats yet
          </p>
        ) : (
          <>
            {active.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {active.map(renderRow)}
              </ul>
            ) : null}

            {archived.length > 0 ? (
              <div className="mt-3">
                <p className="px-1 pb-1.5 text-meta font-medium uppercase tracking-wide text-foreground-muted">
                  Archived
                </p>
                <ul className="flex flex-col gap-1.5 opacity-75">
                  {archived.map(renderRow)}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
