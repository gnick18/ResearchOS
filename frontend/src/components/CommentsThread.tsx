"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usersApi } from "@/lib/local-api";
import UserAvatar from "@/components/UserAvatar";
import MentionPicker from "@/components/MentionPicker";
import { useLabUserProfileMap, type LabUserProfile } from "@/hooks/useLabUserProfiles";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import {
  buildCommentTree,
  tokenizeComment,
  extractMentions,
} from "@/lib/comments/mentions";
import type { NoteComment, TaskComment } from "@/lib/types";

// NoteComment and TaskComment share an identical shape — `{id, author, text,
// created_at, parent_id?, mentions?}`. The component accepts either, keyed
// by `entityKind` only for the collapse-state disambiguation.
export type CommentLike = NoteComment | TaskComment;

interface CommentsThreadProps {
  // Which entity owns this thread. Drives the collapse-state map key and
  // — for the unshared-entity hint copy — the noun in the message. No
  // rendering branches besides that; comments look identical for both
  // entity kinds by design (Grant's "same component" clickable).
  entityKind: "note" | "task";
  entityId: number;
  // The owner's username, when known. Used for the collapse-map key so
  // tasks of id 5 owned by different users don't collide. For Notes the
  // owner is `note.username`. For self-owned entities, pass undefined or
  // the current user.
  entityOwner?: string;
  comments: CommentLike[];
  // Whether the entity is currently visible to the lab. Drives the
  // "Turn on sharing" hint and gates the comment input — comments on a
  // private entity would never be seen by anyone but the owner.
  isShared: boolean;
  // Copy for the "not shared" hint; lets us word it appropriately for
  // notes ("Turn on sharing to let lab mates comment.") vs tasks ("Share
  // this task to let lab mates comment.").
  notSharedHint?: string;
  // Hide the input + delete buttons. Used for view-only shared entities
  // (`shared_permission === "view"` on tasks) where the receiver should
  // see comments but not modify them.
  readOnly?: boolean;
  // Layout. "inline" (default) keeps the original collapsible block with its
  // own "Lab comments" header. "sidebar" renders just the thread body (no
  // border, no collapse chrome) for a docked right rail, where the rail itself
  // provides the header and scroll container.
  variant?: "inline" | "sidebar";
  // Focus the top-level comment composer on mount (right-click "Add a comment").
  autoFocusComposer?: boolean;
  // Async callbacks. The parent owns the mutation hooks + cache
  // invalidation; this component manages its own draft + pending state.
  //
  // Phase 2 (lab head Phase 2 manager): `onAdd` now accepts optional
  // `parent_id` + `mentions` so replies + @-mention dispatch flow through
  // the same callback shape every existing caller already uses. Pre-Phase-2
  // callers pass undefined and get the original top-level behavior.
  onAdd: (
    text: string,
    author: string,
    options?: { parent_id?: string | null; mentions?: string[] },
  ) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
}

// Session-scoped override map: tracks entities where the user has explicitly
// toggled the section away from its data-derived default. Composite key
// `${entityKind}:${owner ?? "self"}:${id}` so notes and tasks (and shared
// entities from different owners) keep independent collapse state.
const userCollapseMap = new Map<string, boolean>();

function makeCollapseKey(
  entityKind: "note" | "task",
  entityId: number,
  entityOwner?: string,
): string {
  return `${entityKind}:${entityOwner ?? "self"}:${entityId}`;
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

export default function CommentsThread({
  entityKind,
  entityId,
  entityOwner,
  comments,
  isShared,
  notSharedHint,
  readOnly = false,
  onAdd,
  onDelete,
  variant = "inline",
  autoFocusComposer = false,
}: CommentsThreadProps) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  // Resolve the real author. In lab mode the "current user" is literally
  // the lab shared account, so we prefer `main_user` (the actual person on
  // this machine) when set; otherwise fall back to `current_user`.
  const { data: identity } = useQuery({
    queryKey: ["users", "identity"],
    queryFn: usersApi.getMainUser,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const author = identity?.main_user || identity?.current_user || "";
  const canComment = !readOnly && !!author && author !== "lab";

  // Lab Head Phase 1 (lab head Phase 1 manager, 2026-05-23): the per-comment
  // attribution row resolves each author's display name + account_type from
  // the lab user profile map. A missing lookup ("departed lab member")
  // renders the author name in gray with no badge — the demo fixture
  // doesn't have a departed user yet, but the fallback path lights up
  // automatically when one appears so Phase 2's full departure pipeline
  // doesn't need extra renderer changes here.
  const profileMap = useLabUserProfileMap();

  // Phase 2: build the threaded tree from the flat comments list. Roots
  // sort oldest-first inside the in-record view (the inbox-feed view
  // reverses them itself); replies sort oldest-first under their parent.
  const tree = useMemo(() => buildCommentTree(comments), [comments]);
  const sortedRoots = useMemo(
    () => tree.roots.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [tree.roots],
  );

  // Collapsible state. Default: collapsed when zero comments, expanded
  // otherwise. Once the user toggles, that choice wins until the entity
  // identity changes. The 0 -> 1 transition auto-expands an untouched
  // section because `userPreference` stays undefined and the derived value
  // flips with `comments.length`. When the entity changes between renders,
  // re-read the map in render (React's recommended "adjusting state on
  // prop change" pattern).
  const collapseKey = makeCollapseKey(entityKind, entityId, entityOwner);
  const [prevKey, setPrevKey] = useState(collapseKey);
  const [userPreference, setUserPreference] = useState<boolean | undefined>(
    () => userCollapseMap.get(collapseKey),
  );
  if (prevKey !== collapseKey) {
    setPrevKey(collapseKey);
    setUserPreference(userCollapseMap.get(collapseKey));
  }
  const collapsed =
    userPreference !== undefined ? userPreference : comments.length === 0;
  const toggleCollapse = () => {
    const next = !collapsed;
    userCollapseMap.set(collapseKey, next);
    setUserPreference(next);
  };

  const handleDelete = async (commentId: string) => {
    if (deleting) return;
    setDeleting(commentId);
    try {
      await onDelete(commentId);
    } finally {
      setDeleting(null);
    }
  };

  const threadBody = (
    <>
      {!isShared && notSharedHint && (
        <div className="text-meta text-foreground-muted bg-surface-sunken border border-border rounded-lg p-3 mb-3">
          {notSharedHint}
        </div>
      )}

      {comments.length === 0 ? (
        <div className="text-meta text-foreground-muted bg-surface-sunken border border-border rounded-lg px-3 py-4 text-center mb-3">
          No comments yet.
        </div>
      ) : (
        <ul className="space-y-3 mb-3">
          {sortedRoots.map((c) => {
            const replies = tree.repliesByParent.get(c.id) ?? [];
            return (
              <CommentRow
                key={c.id}
                comment={c}
                replies={replies}
                currentAuthor={author}
                profileMap={profileMap}
                readOnly={readOnly}
                isShared={isShared}
                canComment={canComment}
                deleting={deleting}
                onDelete={handleDelete}
                onAdd={onAdd}
                replyingTo={replyingTo}
                setReplyingTo={setReplyingTo}
                entityKind={entityKind}
                entityId={entityId}
                entityOwner={entityOwner}
              />
            );
          })}
        </ul>
      )}

      {isShared && !readOnly && (
        canComment ? (
          <CommentComposer
            placeholder={`Comment as ${author}…`}
            author={author}
            autoFocus={autoFocusComposer}
            draftKey={makeCommentDraftKey({
              author,
              entityKind,
              entityOwner,
              entityId,
              parentCommentId: null,
            })}
            onSubmit={async (text, mentions) => {
              await onAdd(text, author, { mentions });
            }}
          />
        ) : (
          <div className="text-meta text-gray-500 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3">
            Set a main user to comment as yourself (Settings → Main User).
          </div>
        )
      )}
    </>
  );

  // Sidebar variant: the docked rail supplies its own header + scroll, so render
  // the thread body directly with no inline collapse chrome.
  if (variant === "sidebar") {
    return <div className="px-4 py-4">{threadBody}</div>;
  }

  return (
    <div className="border-t border-border mt-4 pt-4 px-4 pb-4">
      <button
        type="button"
        onClick={toggleCollapse}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between gap-3 py-1 -mx-2 px-2 rounded-md hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h6m-7 9l4-4h10a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h1v4z" />
          </svg>
          <span className="text-body font-semibold text-foreground">
            Lab comments
            {comments.length > 0 && (
              <span className="ml-1 text-foreground-muted font-normal">({comments.length})</span>
            )}
          </span>
        </span>
        <svg
          className={`w-4 h-4 text-foreground-muted transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && <div className="mt-3">{threadBody}</div>}
    </div>
  );
}

// Per-user / per-record / per-parent comment draft key. Prevents three
// independent confusions:
//   1. Cross-user contamination (alex's draft showing up in mira's session)
//   2. Cross-record contamination (a draft on task #5 leaking into task #6)
//   3. Cross-thread contamination (a top-level draft leaking into a reply
//      under the same record, or two reply drafts under different parents
//      sharing storage)
// The `entityOwner ?? "self"` mirrors the collapse-key fallback so notes /
// tasks the user owns themselves namespace cleanly against shared-in copies.
function makeCommentDraftKey(opts: {
  author: string;
  entityKind: "note" | "task";
  entityOwner: string | undefined;
  entityId: number;
  parentCommentId: string | null;
}): string {
  const ownerSlug = opts.entityOwner ?? "self";
  const parentSlug = opts.parentCommentId ?? "root";
  return `researchos:draft:comment:${opts.author}:${opts.entityKind}:${ownerSlug}:${opts.entityId}:${parentSlug}`;
}

// ── Individual comment row + reply thread ────────────────────────────────

interface CommentRowProps {
  comment: CommentLike;
  replies: CommentLike[];
  currentAuthor: string;
  profileMap: Record<string, LabUserProfile>;
  readOnly: boolean;
  isShared: boolean;
  canComment: boolean;
  deleting: string | null;
  onDelete: (id: string) => Promise<void>;
  onAdd: CommentsThreadProps["onAdd"];
  replyingTo: string | null;
  setReplyingTo: (id: string | null) => void;
  // Entity identity is threaded through so each row can build a
  // per-record-per-parent draft key for its reply composer.
  entityKind: "note" | "task";
  entityId: number;
  entityOwner: string | undefined;
}

function CommentRow({
  comment,
  replies,
  currentAuthor,
  profileMap,
  readOnly,
  isShared,
  canComment,
  deleting,
  onDelete,
  onAdd,
  replyingTo,
  setReplyingTo,
  entityKind,
  entityId,
  entityOwner,
}: CommentRowProps) {
  const showReplyBox = replyingTo === comment.id;

  return (
    <li>
      <CommentBody
        comment={comment}
        currentAuthor={currentAuthor}
        profileMap={profileMap}
        readOnly={readOnly}
        deleting={deleting}
        onDelete={onDelete}
      />

      {(replies.length > 0 || showReplyBox || (isShared && !readOnly && canComment)) && (
        <div className="mt-2 ml-8 space-y-2 border-l-2 border-border pl-3">
          {replies.map((r) => (
            <CommentBody
              key={r.id}
              comment={r}
              currentAuthor={currentAuthor}
              profileMap={profileMap}
              readOnly={readOnly}
              deleting={deleting}
              onDelete={onDelete}
            />
          ))}

          {isShared && !readOnly && canComment && (
            showReplyBox ? (
              <div className="pt-1">
                <CommentComposer
                  placeholder={`Reply as ${currentAuthor}…`}
                  author={currentAuthor}
                  compact
                  draftKey={makeCommentDraftKey({
                    author: currentAuthor,
                    entityKind,
                    entityOwner,
                    entityId,
                    parentCommentId: comment.id,
                  })}
                  onCancel={() => setReplyingTo(null)}
                  onSubmit={async (text, mentions) => {
                    await onAdd(text, currentAuthor, {
                      parent_id: comment.id,
                      mentions,
                    });
                    setReplyingTo(null);
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setReplyingTo(comment.id)}
                className="text-meta text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 font-medium"
              >
                Reply
              </button>
            )
          )}
        </div>
      )}
    </li>
  );
}

interface CommentBodyProps {
  comment: CommentLike;
  currentAuthor: string;
  profileMap: Record<string, LabUserProfile>;
  readOnly: boolean;
  deleting: string | null;
  onDelete: (id: string) => Promise<void>;
}

function CommentBody({
  comment,
  currentAuthor,
  profileMap,
  readOnly,
  deleting,
  onDelete,
}: CommentBodyProps) {
  const mine = comment.author === currentAuthor;
  const profile = profileMap[comment.author];
  const departed = !profile;
  const displayName =
    (profile?.displayName && profile.displayName.trim()) || comment.author;
  const isPI = profile?.account_type === "lab_head";
  const nameClass = departed
    ? "font-medium text-foreground-muted italic"
    : "font-medium text-foreground";

  return (
    <div className="flex gap-2.5">
      <UserAvatar username={comment.author} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-meta text-foreground-muted">
          <span className={nameClass}>{displayName}</span>
          {isPI && !departed && (
            <span
              className="px-1.5 py-0.5 text-meta font-semibold rounded bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300"
              title="PI"
            >
              PI
            </span>
          )}
          <span>·</span>
          <span title={comment.created_at}>{formatRelative(comment.created_at)}</span>
          {mine && !readOnly && (
            <button
              type="button"
              onClick={() => onDelete(comment.id)}
              disabled={deleting === comment.id}
              className="ml-auto text-foreground-muted hover:text-red-600 disabled:opacity-50"
              title="Delete this comment"
            >
              delete
            </button>
          )}
        </div>
        <p className="text-body text-foreground whitespace-pre-wrap break-words">
          <CommentText text={comment.text} profileMap={profileMap} />
        </p>
      </div>
    </div>
  );
}

/**
 * Render a comment body with `@username` tokens replaced by styled chips.
 * Each chip renders as a non-interactive span (no profile page yet — see
 * Phase 3+) but is visually distinct so readers can scan for mentions.
 * Unknown users (typed by hand, not picked) still render as a chip with
 * the literal `@user` text — Slack-style; the picker is the happy path.
 */
function CommentText({
  text,
  profileMap,
}: {
  text: string;
  profileMap: Record<string, LabUserProfile>;
}) {
  const spans = useMemo(() => tokenizeComment(text), [text]);
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === "text") return <span key={i}>{s.value}</span>;
        const profile = profileMap[s.value];
        const displayName =
          (profile?.displayName && profile.displayName.trim()) || s.value;
        return (
          <span
            key={i}
            className="inline-flex items-center px-1 py-0 mx-0.5 rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium"
            // Phase 2 doesn't ship profile pages yet — the chip is a
            // styled non-interactive span. When a user-profile route lands
            // (Phase 5+) this becomes an <a href={`/users/${s.value}`}>.
            title={profile ? `@${s.value}` : `@${s.value} (unknown user)`}
          >
            @{displayName}
          </span>
        );
      })}
    </>
  );
}

// ── Composer w/ inline @-mention picker ──────────────────────────────────

interface CommentComposerProps {
  placeholder: string;
  author: string;
  // Compact = reply composer (lighter chrome, smaller textarea).
  compact?: boolean;
  // sessionStorage key for the in-progress draft. Built by
  // `makeCommentDraftKey` at the parent so it carries the author + the
  // entity (kind, owner, id) + the parent comment id (or "root"). Without
  // this, a long comment typed mid-thought + an F5 / nav-link click =
  // silent data loss.
  draftKey: string;
  onSubmit: (text: string, mentions: string[]) => Promise<void>;
  onCancel?: () => void;
  // Focus the textarea on mount. Used when the comments rail is opened via the
  // right-click "Add a comment" action so the user can type immediately.
  autoFocus?: boolean;
}

function CommentComposer({
  placeholder,
  compact = false,
  draftKey,
  onSubmit,
  onCancel,
  autoFocus = false,
}: CommentComposerProps) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
    // Focus once on mount; not on every autoFocus change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draft persistence: write the typed body to sessionStorage on every
  // keystroke (debounced inside the hook) so a refresh / SPA nav / tab
  // close doesn't drop the comment. Restores on mount. Mirrors the
  // NewPurchaseModal pattern: dirty = "user typed something", clearDraft
  // fires after successful submit. `useUnsavedChangesGuard` raises the
  // browser's "Leave site?" dialog on F5 / tab-close while posting is
  // false (no point prompting once the mutation is in flight; the post
  // will complete and the form clears).
  const isDirty = draft.trim().length > 0;
  const { clearDraft } = useDraftPersistence(draftKey, draft, isDirty, {
    onRestore: (saved) => {
      if (typeof saved !== "string") return;
      // Only hydrate when the composer is still untouched so we don't
      // clobber a partial typed value (the StrictMode double-mount case).
      setDraft((prev) => (prev.length === 0 ? saved : prev));
    },
  });
  useUnsavedChangesGuard(isDirty && !posting);

  // @-mention picker state. We detect an active `@` token by looking at
  // the character left of the cursor: if it's `@` (or the cursor is in
  // the middle of an `@foo` word), we open the picker with `foo` as the
  // query. The picker hides itself when the cursor moves off the token
  // (e.g. user types a space or a different non-mention char).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  // Anchor index in the textarea where the `@` lives. Used to splice the
  // chosen username back into the body on pick.
  const [atIndex, setAtIndex] = useState<number | null>(null);
  const [pickerActiveIdx, setPickerActiveIdx] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const filteredProfilesRef = useRef<LabUserProfile[]>([]);

  /**
   * Re-evaluate whether the picker should be open / what its query is,
   * based on the current cursor position. Called on every keystroke +
   * selection change. The active `@` is the LAST `@` that:
   *   - sits at the start of the textarea, OR
   *   - is preceded by whitespace / punctuation (per MENTION_REGEX rules)
   *   - has only `[a-zA-Z0-9_-]*` chars between it and the cursor
   * Otherwise the picker stays closed.
   */
  const updatePickerState = (value: string, cursor: number) => {
    // Scan backwards from cursor to find the nearest `@`. Stop early if we
    // hit whitespace or a non-username char (signals the token ended).
    let i = cursor - 1;
    let candidate: number | null = null;
    while (i >= 0) {
      const ch = value[i];
      if (ch === "@") {
        candidate = i;
        break;
      }
      // Allowed chars inside a username — `[a-zA-Z0-9_-]`. Anything else
      // means we walked out of the token.
      if (!/[a-zA-Z0-9_-]/.test(ch)) break;
      i -= 1;
    }
    if (candidate === null) {
      setPickerOpen(false);
      setAtIndex(null);
      return;
    }
    // Verify the @ is at start or preceded by whitespace / punctuation so
    // "foo@bar" doesn't trigger.
    if (candidate > 0) {
      const prev = value[candidate - 1];
      if (!/[\s.,;:!?(){}[\]"'`]/.test(prev)) {
        setPickerOpen(false);
        setAtIndex(null);
        return;
      }
    }
    const query = value.slice(candidate + 1, cursor);
    setAtIndex(candidate);
    setPickerQuery(query);
    setPickerOpen(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);
    const cursor = e.target.selectionStart ?? value.length;
    updatePickerState(value, cursor);
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const value = e.currentTarget.value;
    const cursor = e.currentTarget.selectionStart ?? value.length;
    updatePickerState(value, cursor);
  };

  const insertMention = (username: string) => {
    if (atIndex === null) return;
    const before = draft.slice(0, atIndex);
    // Find the end of the current @ token in the textarea body — the
    // contiguous `[a-zA-Z0-9_-]*` chars after the `@`.
    let end = atIndex + 1;
    while (end < draft.length && /[a-zA-Z0-9_-]/.test(draft[end])) end += 1;
    const after = draft.slice(end);
    // Add a trailing space so the user can keep typing without manually
    // separating the mention from the next word.
    const next = `${before}@${username} ${after}`;
    setDraft(next);
    setPickerOpen(false);
    setAtIndex(null);
    // Restore focus + place cursor right after the inserted mention +
    // trailing space.
    const cursorAfter = before.length + username.length + 2;
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(cursorAfter, cursorAfter);
    });
  };

  const handleSubmit = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const mentions = extractMentions(text);
      await onSubmit(text, mentions);
      setDraft("");
      // Drop the persisted draft now that the comment lives on disk —
      // leaving it would re-hydrate the same text the next time this
      // composer mounts.
      clearDraft();
    } finally {
      setPosting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Picker keyboard nav takes priority.
    if (pickerOpen && filteredCount > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPickerActiveIdx((idx) => Math.min(filteredCount - 1, idx + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPickerActiveIdx((idx) => Math.max(0, idx - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const active = filteredProfilesRef.current[pickerActiveIdx];
        if (active) insertMention(active.username);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPickerOpen(false);
        setAtIndex(null);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={handleChange}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={compact ? 1 : 2}
          className="flex-1 px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
        />
        <div className="flex flex-col gap-1 self-start">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!draft.trim() || posting}
            className="ros-btn-raise px-3 py-2 bg-emerald-600 text-white rounded-lg text-body hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {posting ? "Posting…" : compact ? "Reply" : "Post"}
          </button>
          {compact && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1 text-meta text-foreground-muted hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      <MentionPicker
        open={pickerOpen}
        query={pickerQuery}
        anchor={textareaRef.current}
        onPick={insertMention}
        onClose={() => setPickerOpen(false)}
        activeIdx={pickerActiveIdx}
        onActiveIdxChange={setPickerActiveIdx}
        onFilteredChange={(filtered) => {
          filteredProfilesRef.current = filtered;
          setFilteredCount(filtered.length);
          if (pickerActiveIdx >= filtered.length) {
            setPickerActiveIdx(Math.max(0, filtered.length - 1));
          }
        }}
      />
    </div>
  );
}
