"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import {
  deleteAnnouncement,
  listAnnouncements,
  postAnnouncement,
  updateAnnouncement,
  type AnnouncementEntry,
} from "@/lib/lab/announcements";
import {
  dispatchAnnouncementNotifications,
  purgeAnnouncementNotifications,
  refreshAnnouncementNotifications,
} from "@/lib/lab/pi-actions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useEditSession } from "@/hooks/useEditSession";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import RequestEditButton from "@/components/RequestEditButton";
import Tooltip from "@/components/Tooltip";

/**
 * Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): announcements
 * surface for the Lab Inbox.
 *
 * Two modes:
 *   - PI view: composer (gated by Phase 5 session edit mode) + list of
 *     own + others' announcements, with Pin / Edit / Delete on own entries.
 *   - Member view: read-only list, pinned announcements floated to top.
 *
 * The composer's "Post" button is enabled only when:
 *   1. the active user has account_type === "lab_head"
 *   2. the Phase 5 edit session is unlocked for the active user
 *
 * Otherwise the composer renders disabled with a Request Edit affordance
 * so the PI can unlock in-place.
 */
export const LAB_ANNOUNCEMENTS_QUERY_KEY = ["lab-announcements"] as const;

// Accepts WidgetProps but doesn't use them today — the existing
// composer + list rendering is identical inside the new Widget frame.
// Future enhancements (e.g. a compact sidebar variant) would key off
// `surface === "sidebar"`.
export default function AnnouncementsWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const session = useEditSession();
  const queryClient = useQueryClient();
  const profileMap = useLabUserProfileMap();

  const isLabHead = accountType === "lab_head";
  const sessionUnlocked =
    session.state === "unlocked" &&
    session.active?.username === currentUser &&
    isLabHead;

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: LAB_ANNOUNCEMENTS_QUERY_KEY,
    queryFn: listAnnouncements,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Pinned first (descending by created_at), then unpinned (also descending).
  const sorted = useMemo(() => {
    const pinned = announcements.filter((a) => a.pinned);
    const rest = announcements.filter((a) => !a.pinned);
    pinned.sort((a, b) => b.created_at.localeCompare(a.created_at));
    rest.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return [...pinned, ...rest];
  }, [announcements]);

  // R2 (R2 widget framework manager, 2026-05-23): the outer card chrome
  // moved into the canonical `<Widget>` frame (see `Widget.tsx`). The
  // body below renders inside that frame's content slot, so it's free
  // of card padding / border / shadow. The page-level header copy that
  // used to sit here ("Post short updates…") is now in the widget
  // catalog `description`.
  return (
    <div className="space-y-3">
      {isLabHead && (
        <Composer
          username={currentUser ?? ""}
          sessionUnlocked={sessionUnlocked}
          sessionId={sessionUnlocked ? (session.active?.id ?? null) : null}
          onPosted={() => {
            void queryClient.invalidateQueries({ queryKey: LAB_ANNOUNCEMENTS_QUERY_KEY });
          }}
        />
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600" />
          Loading announcements…
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          {isLabHead
            ? "No announcements yet. Post one above — everyone in the lab will see it."
            : "No announcements from your lab head yet."}
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((entry) => (
            <li key={entry.id}>
              <AnnouncementCard
                entry={entry}
                authorDisplayName={
                  profileMap[entry.author]?.displayName?.trim() || entry.author
                }
                authorIsKnown={!!profileMap[entry.author]}
                authorIsLabHead={
                  profileMap[entry.author]?.account_type === "lab_head"
                }
                canEdit={isLabHead && currentUser === entry.author && sessionUnlocked}
                sessionId={sessionUnlocked ? (session.active?.id ?? null) : null}
                onMutated={() => {
                  void queryClient.invalidateQueries({
                    queryKey: LAB_ANNOUNCEMENTS_QUERY_KEY,
                  });
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Composer ────────────────────────────────────────────────────────────

interface ComposerProps {
  username: string;
  sessionUnlocked: boolean;
  sessionId: string | null;
  onPosted: () => void;
}

function Composer({ username, sessionUnlocked, sessionId, onPosted }: ComposerProps) {
  const [text, setText] = useState("");
  const [pinned, setPinned] = useState(false);
  const [posting, setPosting] = useState(false);

  const canPost = sessionUnlocked && text.trim().length > 0 && !posting;

  // Mira Batch 1 polish (2026-05-23): persist the in-progress draft so
  // accidental navigation (or a hard refresh while the PI is composing)
  // doesn't lose the announcement body. Key by username so each PI
  // keeps their own draft. Mirrors the NewPurchaseModal + TaskModal
  // integration.
  const draftKey = `researchos:draft:lab-announcement:${username || "_anon"}`;
  const draftSnapshot = useMemo(() => ({ text, pinned }), [text, pinned]);
  const hasDraft = text.trim().length > 0;

  const { clearDraft } = useDraftPersistence<{ text: string; pinned: boolean }>(
    draftKey,
    draftSnapshot,
    hasDraft,
    {
      onRestore: (saved) => {
        // Defensive: handle legacy / partial shapes without throwing
        // (sessionStorage can outlive a code change).
        const candidate = saved as Partial<{ text: string; pinned: boolean }>;
        if (typeof candidate.text === "string") setText(candidate.text);
        if (typeof candidate.pinned === "boolean") setPinned(candidate.pinned);
      },
    },
  );
  // Browser-level unsaved-changes prompt — fires on tab close / hard
  // navigation only when the composer has typed text the user hasn't
  // posted yet.
  useUnsavedChangesGuard(hasDraft && sessionUnlocked && !posting);

  const handlePost = async () => {
    if (!canPost || !sessionId) return;
    setPosting(true);
    try {
      const entry = await postAnnouncement({
        author: username,
        text: text.trim(),
        pinned,
        sessionId,
      });
      // Notify every other lab member.
      await dispatchAnnouncementNotifications({
        author: username,
        announcementId: entry.id,
        text: entry.text,
      });
      setText("");
      setPinned(false);
      clearDraft();
      onPosted();
    } catch (err) {
      console.error("[announcement] post failed", err);
      alert("Failed to post announcement. See console for details.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-4 space-y-3">
      <textarea
        className="w-full min-h-[60px] text-sm rounded-md border border-emerald-300 px-3 py-2 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-gray-50 disabled:text-gray-400"
        placeholder={
          sessionUnlocked
            ? "Share an update with the lab — e.g. \"Lab meeting Friday 2pm, bring strain design notes.\""
            : "Unlock edit mode to post a lab announcement…"
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!sessionUnlocked || posting}
        data-testid="lab-announcement-composer-textarea"
      />
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            className="rounded text-emerald-600 focus:ring-emerald-500"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            disabled={!sessionUnlocked || posting}
          />
          Pin to top
        </label>
        {sessionUnlocked ? (
          <button
            type="button"
            onClick={handlePost}
            disabled={!canPost}
            className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            data-testid="lab-announcement-composer-post"
          >
            {posting ? "Posting…" : "Post announcement"}
          </button>
        ) : (
          <RequestEditButton
            username={username}
            targetLabel="lab announcements"
            variant="primary"
          />
        )}
      </div>
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────────

interface AnnouncementCardProps {
  entry: AnnouncementEntry;
  authorDisplayName: string;
  authorIsKnown: boolean;
  /** Whether the author currently has account_type === "lab_head".
   *  Mira Batch 1 polish (2026-05-23): the Lab Head badge used to render
   *  unconditionally; it now only renders when the author actually carries
   *  the role. Members who post historic announcements (or PIs who later
   *  demote themselves) no longer get a misleading badge. */
  authorIsLabHead: boolean;
  canEdit: boolean;
  sessionId: string | null;
  onMutated: () => void;
}

function AnnouncementCard({
  entry,
  authorDisplayName,
  authorIsKnown,
  authorIsLabHead,
  canEdit,
  sessionId,
  onMutated,
}: AnnouncementCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.text);
  const [busy, setBusy] = useState(false);

  // Reset draft when entry id changes (otherwise an external invalidation
  // refresh would leak the stale draft into a different row that landed
  // in the same React slot).
  useEffect(() => {
    setDraft(entry.text);
    setEditing(false);
  }, [entry.id, entry.text]);

  const handleSave = async () => {
    if (!sessionId || draft.trim().length === 0) return;
    setBusy(true);
    try {
      const nextText = draft.trim();
      const textChanged = nextText !== entry.text;
      await updateAnnouncement({
        id: entry.id,
        author: entry.author,
        text: nextText,
        sessionId,
      });
      // Mira Batch 1 polish (2026-05-23): when the body text changes,
      // re-emit a refreshed preview into every recipient's bell row so
      // the inline preview text matches the live announcement.
      if (textChanged) {
        await refreshAnnouncementNotifications({
          excludeAuthor: entry.author,
          announcementId: entry.id,
          text: nextText,
        });
      }
      setEditing(false);
      onMutated();
    } catch (err) {
      console.error("[announcement] update failed", err);
      alert("Failed to update announcement.");
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePin = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await updateAnnouncement({
        id: entry.id,
        author: entry.author,
        pinned: !entry.pinned,
        sessionId,
      });
      onMutated();
    } catch (err) {
      console.error("[announcement] pin toggle failed", err);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!sessionId) return;
    // FOLLOW-UP (mira-batch1): the project's only "styled confirm" lives
    // local to LabRoster.tsx — not yet a shared primitive. Until one
    // lands, fall back to the native confirm() so the destructive path
    // still asks twice. Master can spawn the primitive-extraction chip.
    if (!confirm("Delete this announcement? Everyone in the lab will lose access to it.")) return;
    setBusy(true);
    try {
      await deleteAnnouncement({ id: entry.id, author: entry.author, sessionId });
      // Mira Batch 1 polish (2026-05-23): purge the orphaned bell rows
      // that referenced this announcement so the inbox counter and the
      // announcements list stay aligned. Prior to this, clicking a
      // bell row for a deleted announcement led to a dead lookup.
      await purgeAnnouncementNotifications({
        excludeAuthor: entry.author,
        announcementId: entry.id,
      });
      onMutated();
    } catch (err) {
      console.error("[announcement] delete failed", err);
    } finally {
      setBusy(false);
    }
  };

  const authorClass = authorIsKnown
    ? "font-medium text-gray-700"
    : "font-medium text-gray-400 italic";

  return (
    <div
      className={`rounded-lg p-3 border ${
        entry.pinned
          ? "border-amber-300 bg-amber-50/60"
          : "border-gray-200 bg-gray-50/40"
      }`}
      data-testid="lab-announcement-card"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
          <span className={authorClass}>{authorDisplayName}</span>
          {authorIsLabHead && (
            <span
              className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800"
              title="Lab Head"
            >
              Lab Head
            </span>
          )}
          {entry.pinned && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-amber-200 text-amber-900">
              Pinned
            </span>
          )}
          <span>·</span>
          <span title={entry.created_at}>{formatRelative(entry.created_at)}</span>
        </div>
        {canEdit && !editing && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <Tooltip
              label={entry.pinned ? "Unpin" : "Pin to top"}
              placement="bottom"
            >
              <button
                type="button"
                onClick={handleTogglePin}
                disabled={busy}
                className="text-[11px] text-amber-700 hover:text-amber-900 hover:underline px-1.5 py-0.5 rounded disabled:opacity-50"
              >
                {entry.pinned ? "Unpin" : "Pin"}
              </button>
            </Tooltip>
            <Tooltip label="Edit text" placement="bottom">
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy}
                className="text-[11px] text-emerald-700 hover:text-emerald-900 hover:underline px-1.5 py-0.5 rounded disabled:opacity-50"
              >
                Edit
              </button>
            </Tooltip>
            <Tooltip label="Delete announcement" placement="bottom">
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="text-[11px] text-red-600 hover:text-red-800 hover:underline px-1.5 py-0.5 rounded disabled:opacity-50"
              >
                Delete
              </button>
            </Tooltip>
          </div>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            className="w-full min-h-[60px] text-sm rounded-md border border-emerald-300 px-3 py-2 bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || draft.trim().length === 0}
              className="px-2 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:bg-gray-300"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                // Mira Batch 1 polish (2026-05-23): if the draft
                // differs from the saved text, ask before discarding.
                // Skip the prompt when nothing has changed so a
                // mistaken Edit click is dismiss-with-one-click.
                const hasChanges = draft !== entry.text;
                if (
                  hasChanges &&
                  !confirm(
                    "Discard your edits to this announcement?",
                  )
                ) {
                  return;
                }
                setEditing(false);
                setDraft(entry.text);
              }}
              disabled={busy}
              className="px-2 py-1 rounded-md text-xs text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">
          {entry.text}
        </p>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}
