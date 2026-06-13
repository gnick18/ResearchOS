"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import Tooltip from "@/components/Tooltip";
import UserAvatar from "@/components/UserAvatar";

/**
 * Lab Head Phase 3 (lab head Phase 3 manager, 2026-05-23): announcements
 * surface for the Lab Inbox.
 *
 * Two modes:
 *   - PI view: composer + list of own + others' announcements, with
 *     Pin / Edit / Delete on own entries.
 *   - Member view: read-only list, pinned announcements floated to top.
 *
 * The composer is strictly lab_head-only (the `account_type === "lab_head"`
 * gate below) and posts directly. (The old PI edit-session / password gate
 * was removed with the PI edit-mode feature; a signed-in lab head is already
 * authenticated.)
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
  const queryClient = useQueryClient();
  const profileMap = useLabUserProfileMap();

  // `=== true` collapses the hook's loading `undefined` to `false`, exactly as
  // the prior `accountType === "lab_head"` did, keeping `isLabHead` a plain
  // boolean for the `canEdit` prop below.
  const isLabHead = useIsLabHead(currentUser) === true;

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
          onPosted={() => {
            void queryClient.invalidateQueries({ queryKey: LAB_ANNOUNCEMENTS_QUERY_KEY });
          }}
        />
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-meta text-foreground-muted">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600" />
          Loading announcements…
        </div>
      ) : sorted.length === 0 ? (
        // Phase B Batch B2 polish: friendlier empty state, framed as a
        // call to action for PIs and a calm "nothing here yet" for
        // members. Replaces the prior italic-gray one-liner.
        <div className="rounded-lg border border-dashed border-border bg-surface-sunken/40 px-4 py-6 text-center">
          <p className="text-body font-medium text-foreground">
            No announcements yet
          </p>
          <p className="mt-1 text-meta text-foreground-muted">
            {isLabHead
              ? "Start the conversation. Post the first announcement above and everyone in the lab will see it."
              : "Nothing from your PI yet. Check back later."}
          </p>
        </div>
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
                canEdit={isLabHead && currentUser === entry.author}
                sessionId={null}
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
  onPosted: () => void;
}

export function Composer({ username, onPosted }: ComposerProps) {
  const [text, setText] = useState("");
  const [pinned, setPinned] = useState(false);
  const [posting, setPosting] = useState(false);
  // Phase B Batch B2 polish: scroll the composer into view when a draft
  // is restored on mount. If the PI typed text, navigated away (to,
  // say, the popup's announcements list), and came back, the restored
  // draft should be visible rather than scrolled off-screen above the
  // freshly-rendered card list.
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [restoredDraftSignal, setRestoredDraftSignal] = useState(0);

  const canPost = text.trim().length > 0 && !posting;

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
        if (
          typeof candidate.text === "string" &&
          candidate.text.trim().length > 0
        ) {
          // Phase B Batch B2 polish: flag the restore so the next
          // render scrolls the composer into view.
          setRestoredDraftSignal((n) => n + 1);
        }
      },
    },
  );

  useEffect(() => {
    if (restoredDraftSignal === 0) return;
    const node = composerRef.current;
    if (!node) return;
    // Use rAF so the scroll happens after the textarea has been
    // populated with the restored text — otherwise the scroll lands
    // on a still-empty container.
    const id = requestAnimationFrame(() => {
      try {
        node.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        // jsdom in tests doesn't implement scrollIntoView — ignore.
      }
    });
    return () => cancelAnimationFrame(id);
  }, [restoredDraftSignal]);
  // Browser-level unsaved-changes prompt — fires on tab close / hard
  // navigation only when the composer has typed text the user hasn't
  // posted yet.
  useUnsavedChangesGuard(hasDraft && !posting);

  const handlePost = async () => {
    if (!canPost) return;
    setPosting(true);
    try {
      // pi-password bot (2026-06-02): no sessionId — the edit-session
      // gate was removed from this composer. postAnnouncement skips the
      // lab-audit entry when sessionId is omitted; attribution still
      // lives on entry.author.
      const entry = await postAnnouncement({
        author: username,
        text: text.trim(),
        pinned,
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
    <div
      ref={composerRef}
      className="border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg p-4 space-y-3 scroll-mt-2"
    >
      <textarea
        className="w-full min-h-[60px] text-body rounded-md border border-emerald-300 px-3 py-2 bg-surface-raised focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:bg-surface-sunken disabled:text-foreground-muted"
        placeholder={
          "Share an update with the lab, e.g. \"Lab meeting Friday 2pm, bring strain design notes.\""
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={posting}
        data-testid="lab-announcement-composer-textarea"
      />
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-meta text-foreground-muted cursor-pointer">
          <input
            type="checkbox"
            className="rounded text-emerald-600 dark:text-emerald-300 focus:ring-emerald-500"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            disabled={posting}
          />
          Pin to top
        </label>
        <button
          type="button"
          onClick={handlePost}
          disabled={!canPost}
          className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-meta font-medium hover:bg-emerald-700 disabled:bg-foreground-muted/20 disabled:cursor-not-allowed"
          data-testid="lab-announcement-composer-post"
        >
          {posting ? "Posting…" : "Post announcement"}
        </button>
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
    if (draft.trim().length === 0) return;
    setBusy(true);
    try {
      const nextText = draft.trim();
      const textChanged = nextText !== entry.text;
      // pi-password bot (2026-06-02): sessionId may be null now that the
      // edit-session gate was removed from this surface. updateAnnouncement
      // skips the lab-audit row when it's omitted.
      await updateAnnouncement({
        id: entry.id,
        author: entry.author,
        text: nextText,
        sessionId: sessionId ?? undefined,
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
    setBusy(true);
    try {
      await updateAnnouncement({
        id: entry.id,
        author: entry.author,
        pinned: !entry.pinned,
        sessionId: sessionId ?? undefined,
      });
      onMutated();
    } catch (err) {
      console.error("[announcement] pin toggle failed", err);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    // FOLLOW-UP (mira-batch1): the project's only "styled confirm" lives
    // local to LabRoster.tsx — not yet a shared primitive. Until one
    // lands, fall back to the native confirm() so the destructive path
    // still asks twice. Master can spawn the primitive-extraction chip.
    if (!confirm("Delete this announcement? Everyone in the lab will lose access to it.")) return;
    setBusy(true);
    try {
      await deleteAnnouncement({
        id: entry.id,
        author: entry.author,
        sessionId: sessionId ?? undefined,
      });
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
    ? "font-medium text-foreground"
    : "font-medium text-foreground-muted italic";

  return (
    <div
      className={`rounded-lg p-3 border ${
        entry.pinned
          ? "border-amber-300 bg-amber-50 dark:bg-amber-500/10"
          : "border-border bg-surface-sunken/40"
      }`}
      data-testid="lab-announcement-card"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 text-meta text-foreground-muted flex-wrap">
          <span className={authorClass}>{authorDisplayName}</span>
          {authorIsLabHead && (
            <span
              className="px-1.5 py-0.5 text-meta font-semibold rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200"
              title="PI"
            >
              PI
            </span>
          )}
          {entry.pinned && (
            <span className="px-1.5 py-0.5 text-meta font-semibold uppercase tracking-wide rounded bg-amber-200 text-amber-900">
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
                className="text-meta text-amber-700 dark:text-amber-300 hover:text-amber-900 hover:underline px-1.5 py-0.5 rounded disabled:opacity-50"
              >
                {entry.pinned ? "Unpin" : "Pin"}
              </button>
            </Tooltip>
            <Tooltip label="Edit text" placement="bottom">
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy}
                className="text-meta text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 hover:underline px-1.5 py-0.5 rounded disabled:opacity-50"
              >
                Edit
              </button>
            </Tooltip>
            <Tooltip label="Delete announcement" placement="bottom">
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="text-meta text-red-600 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 hover:underline px-1.5 py-0.5 rounded disabled:opacity-50"
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
            className="w-full min-h-[60px] text-body rounded-md border border-emerald-300 px-3 py-2 bg-surface-raised focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || draft.trim().length === 0}
              className="px-2 py-1 rounded-md bg-emerald-600 text-white text-meta font-medium hover:bg-emerald-700 disabled:bg-foreground-muted/20"
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
              className="px-2 py-1 rounded-md text-meta text-foreground-muted hover:bg-surface-sunken"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-body text-foreground whitespace-pre-wrap break-words">
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase B redesign (Phase B redesign manager, 2026-05-23): content-rich
// SnapshotTile that shows the most-recent announcements as stacked
// mini-cards instead of a hero-number "X new" headline. Grant pushback:
// the count-on-top shape was wrong; the content IS the signal here.
// ─────────────────────────────────────────────────────────────────────────────
// - SnapshotTile: 2-3 mini-cards (author avatar + name, 2-line body
//   preview, relative time) divided by hairline rows. A small "X new"
//   pill in the top-right corner when last-7-day count > 0.
// - SidebarTile: unchanged from Batch B2 (compact horizontal).
// - ExpandedView: alias of the body so the registry can import it.
import SidebarStatTile from "./snapshot/SidebarStatTile";
import type { SnapshotTileProps, SidebarTileProps } from "./types";

const MEGAPHONE_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 11l18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </svg>
);

function newThisWeek(entries: AnnouncementEntry[]): AnnouncementEntry[] {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return entries.filter((a) => {
    const t = new Date(a.created_at).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

function mostRecentN(
  entries: AnnouncementEntry[],
  n: number,
): AnnouncementEntry[] {
  return [...entries]
    .filter((e) => Number.isFinite(new Date(e.created_at).getTime()))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, n);
}

/**
 * SnapshotTile: quick-compose box for lab heads + read-only mini-cards
 * for members.
 *
 * Grant pushback on the Phase B redesign (2026-05-23): "I think the
 * announcement tile Square feature should be just like a type box to
 * send out announcements from there. Right? And then maybe if they
 * click on it, then they could see the full thing with all recent
 * announcements." The recent-announcements list still lives in the
 * popup ExpandedView body, so members + PIs can both reach it by
 * clicking through to the popup; the PI's CANVAS tile though is now
 * primarily a compose surface.
 *
 * Two branches:
 *   - PI surface (lab_head): a compact composer (textarea + Post). The
 *     SnapshotCanvas wraps every tile in a click-to-open handler, so
 *     interactive elements inside the composer call
 *     `e.stopPropagation()` to keep typing + the Post click local to
 *     the tile. A "View all >" link at the bottom intentionally lets
 *     the click bubble so the popup still opens.
 *   - Member surface: the original 3-card mini-stack (members can't
 *     post, so a compose box would be a tease).
 *
 * pi-password bot (2026-06-02): the edit-session gate was removed from
 * this tile composer alongside the popup composer. A signed-in lab head
 * is already password-authenticated at login, so the textarea + Post
 * button are always live for a PI. We keep the same draft-persistence
 * key so a draft typed on the tile survives navigating to the popup and
 * back (the popup composer reads the same `draftKey`).
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const profileMap = useLabUserProfileMap();
  const { currentUser } = useCurrentUser();
  const isLabHead = useIsLabHead(currentUser) === true;

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: LAB_ANNOUNCEMENTS_QUERY_KEY,
    queryFn: listAnnouncements,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const recent = useMemo(() => mostRecentN(announcements, 3), [announcements]);
  const weekCount = useMemo(
    () => newThisWeek(announcements).length,
    [announcements],
  );

  // PI surface → quick-compose. Member surface → recent-card stack.
  if (isLabHead) {
    return (
      <SnapshotComposer
        username={currentUser ?? ""}
        weekCount={weekCount}
      />
    );
  }

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-foreground-muted">
        <span aria-hidden="true" className="text-purple-500 flex-shrink-0">
          {MEGAPHONE_SVG}
        </span>
        <span className="text-meta uppercase tracking-wide font-medium">
          Announcements
        </span>
      </div>
      {weekCount > 0 && (
        <span
          className="absolute top-0 right-0 text-meta text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10 px-1.5 py-0.5 rounded-full font-medium"
          aria-label={`${weekCount} new this week`}
        >
          {weekCount} new
        </span>
      )}
      <div className="mt-2 flex-1 min-h-0 flex flex-col gap-2">
        {isLoading ? (
          <p className="text-meta text-foreground-muted italic m-auto">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="text-meta text-foreground-muted italic m-auto">
            No announcements yet
          </p>
        ) : (
          recent.map((entry, idx) => {
            const author =
              profileMap[entry.author]?.displayName?.trim() || entry.author;
            const body = entry.text.replace(/\s+/g, " ").trim().slice(0, 80);
            return (
              <div
                key={entry.id}
                className={`min-w-0 ${
                  idx < recent.length - 1
                    ? "pb-2 border-b border-border"
                    : ""
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <UserAvatar username={entry.author} size="xs" />
                  <span className="text-meta font-medium text-foreground truncate">
                    {author}
                  </span>
                </div>
                <p className="mt-0.5 text-meta text-foreground-muted leading-snug line-clamp-2 break-words">
                  {body}
                </p>
                <p className="mt-0.5 text-meta text-foreground-muted">
                  {formatRelative(entry.created_at)}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * PI-only quick-compose body for the SnapshotTile. Lives inside the
 * canvas tile so the PI can fire off an announcement without opening
 * the popup. Stops click propagation on the interactive area so the
 * canvas wrapper's click-to-open handler only fires on the bottom
 * "View all >" affordance (and on any whitespace below the composer).
 */
function SnapshotComposer({
  username,
  weekCount,
}: {
  username: string;
  weekCount: number;
}) {
  const queryClient = useQueryClient();

  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [justSent, setJustSent] = useState(false);

  // Mirror the popup Composer's draft-persistence key so a draft typed
  // on the canvas tile survives navigating to the popup and back.
  const draftKey = `researchos:draft:lab-announcement:${username || "_anon"}`;
  const draftSnapshot = useMemo(() => ({ text, pinned: false }), [text]);
  const hasDraft = text.trim().length > 0;
  const { clearDraft } = useDraftPersistence<{ text: string; pinned: boolean }>(
    draftKey,
    draftSnapshot,
    hasDraft,
    {
      onRestore: (saved) => {
        const candidate = saved as Partial<{ text: string }>;
        if (typeof candidate.text === "string") setText(candidate.text);
      },
    },
  );

  // Browser-level unsaved-changes prompt while the PI has unposted text.
  useUnsavedChangesGuard(hasDraft && !posting);

  const canPost = hasDraft && !posting;

  const handlePost = async (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.stopPropagation();
    if (!canPost) return;
    setPosting(true);
    try {
      // pi-password bot (2026-06-02): no sessionId — edit-session gate
      // removed. Audit row is skipped; attribution stays on entry.author.
      const entry = await postAnnouncement({
        author: username,
        text: text.trim(),
        pinned: false,
      });
      await dispatchAnnouncementNotifications({
        author: username,
        announcementId: entry.id,
        text: entry.text,
      });
      setText("");
      clearDraft();
      setJustSent(true);
      // Brief "Sent" confirmation that fades after a short delay.
      window.setTimeout(() => setJustSent(false), 1500);
      void queryClient.invalidateQueries({
        queryKey: LAB_ANNOUNCEMENTS_QUERY_KEY,
      });
    } catch (err) {
      console.error("[announcement] tile-post failed", err);
      alert("Failed to post announcement. See console for details.");
    } finally {
      setPosting(false);
    }
  };

  // Stops the wrapper's click-to-open handler on the interactive area.
  const stopClick = (e: React.MouseEvent | React.KeyboardEvent) =>
    e.stopPropagation();

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-foreground-muted min-w-0">
          <span aria-hidden="true" className="text-purple-500 flex-shrink-0">
            {MEGAPHONE_SVG}
          </span>
          <span className="text-meta uppercase tracking-wide font-medium truncate">
            Post an announcement
          </span>
        </div>
        {weekCount > 0 && (
          <span
            className="text-meta text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
            aria-label={`${weekCount} new this week`}
          >
            {weekCount} new
          </span>
        )}
      </div>

      {/* Interactive composer area. stopPropagation so typing and the
          Post click don't trigger the wrapper's click-to-open. */}
      <div
        className="mt-2 flex-1 min-h-0 flex flex-col gap-1.5"
        onClick={stopClick}
        onKeyDown={stopClick}
      >
        <textarea
          className="flex-1 min-h-0 w-full text-meta rounded-md border border-purple-200 dark:border-purple-500/30 px-2 py-1.5 bg-surface-raised focus:ring-1 focus:ring-purple-500 focus:border-purple-500 focus:outline-none resize-none disabled:bg-surface-sunken disabled:text-foreground-muted disabled:cursor-not-allowed"
          placeholder="Share a quick update with the lab…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={posting}
          data-testid="lab-announcement-snapshot-textarea"
        />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handlePost}
            disabled={!canPost}
            className="px-2.5 py-1 rounded-md bg-purple-600 text-white text-meta font-medium hover:bg-purple-700 disabled:bg-foreground-muted/20 disabled:cursor-not-allowed flex-shrink-0"
            data-testid="lab-announcement-snapshot-post"
          >
            {posting ? "Posting…" : justSent ? "Sent" : "Post"}
          </button>
          {/* Click the link to bubble up and open the popup. The link
              is intentionally OUTSIDE the stopPropagation div so the
              outer wrapper picks up the click. */}
        </div>
      </div>

      {/* "View all" hint area — outside stopPropagation, so click here
          opens the popup the same way clicking any non-interactive
          part of the tile does. */}
      <p className="mt-1 text-meta text-purple-700 dark:text-purple-300 font-medium text-right">
        View all →
      </p>
    </div>
  );
}

// The default-exported body above IS the expanded view.
export const ExpandedView = AnnouncementsWidget;

/**
 * Lab overview PI tooltips (Chip B, lab overview PI tooltips manager,
 * 2026-05-25): tile-header help-badge copy. Lives next to the widget
 * body it explains; the registry references this export so the copy
 * surfaces in the "?" badge that auto-opens once on Mira's first
 * /lab-overview visit.
 */
export const HELP_TEXT =
  "Lab-wide bulletin board. PIs post pinned announcements that every member sees on their home page; members can react but only PIs can compose.";

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: LAB_ANNOUNCEMENTS_QUERY_KEY,
    queryFn: listAnnouncements,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const total = announcements.length;
  // Phase B Batch B2: badge stat is the unread-style count rendered as
  // a small pill so the sidebar row reads inbox-like. We treat "new
  // this week" as a proxy for unread since the announcements model
  // doesn't track per-user read state today.
  const count = useMemo(() => newThisWeek(announcements).length, [announcements]);
  return (
    <SidebarStatTile
      icon={MEGAPHONE_SVG}
      iconClassName="text-purple-500"
      label="Announcements"
      stat={
        isLoading ? (
          "—"
        ) : count > 0 ? (
          <span className="inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 text-meta font-semibold tabular-nums">
            {count}
          </span>
        ) : (
          <span className="text-foreground-muted text-meta">{total}</span>
        )
      }
      onClick={onClick}
    />
  );
}
