// Lab Head Phase 2 — @-mention parser + reply tree helpers.
// (lab head Phase 2 manager, 2026-05-23)
//
// Comments store their @-mention tokens inline in the `text` body as plain
// `@username` strings (same shape Slack / GitHub use). The renderer detects
// the pattern and styles each token as a chip; the notification dispatcher
// uses the extracted list to know who to notify. The denormalized
// `mentions[]` field on the comment exists so callers don't re-parse the
// body on every render — but the inline text is still the source of truth.

import type { NoteComment, TaskComment } from "@/lib/types";

/**
 * Allowed username pattern in our app: alphanumerics, underscores, hyphens.
 * Matches the user folder name validation in `users/<username>/`. We use a
 * conservative class here so an @mention in prose like
 *   "Check @alex@gmail.com later"
 * matches "@alex" (stops at the `@`) instead of swallowing the whole email
 * address — which would render the chip as `alex@gmail.com` and miss the
 * notification dispatch.
 *
 * Word-boundary lookbehind keeps tokens like "email@example" from matching
 * because the `@` there isn't preceded by start-of-string or whitespace /
 * punctuation. Without the lookbehind, "alex@example.com" would surface
 * "@example" as a mention which is never what the user meant.
 */
export const MENTION_REGEX = /(^|[\s.,;:!?(){}[\]"'`])@([a-zA-Z0-9_-]+)/g;

/**
 * Extract all @-mentions from a comment body. Returns a deduped list of
 * usernames in document order — duplicates collapse, so
 *   "@alex and @alex again"
 * yields ["alex"]. Caller filters by the actual lab member list afterwards
 * (we don't validate inside the parser because the picker already gates the
 * user choice at compose time, and historical comments may reference users
 * who have since been archived).
 */
export function extractMentions(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Reset lastIndex defensively — MENTION_REGEX is a module-level RegExp
  // and calling `.exec` mutates state across invocations.
  MENTION_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const username = match[2];
    if (!username) continue;
    if (seen.has(username)) continue;
    seen.add(username);
    out.push(username);
  }
  return out;
}

/**
 * Split a comment body into alternating plain-text and mention spans for
 * the renderer. The renderer maps over the array, wrapping mention spans
 * in a chip component and leaving the rest as plain text.
 *
 * Example: "Hi @alex, see @morgan's note" →
 *   [
 *     { kind: "text", value: "Hi " },
 *     { kind: "mention", value: "alex", prefix: "" },
 *     { kind: "text", value: ", see " },
 *     { kind: "mention", value: "morgan", prefix: "" },
 *     { kind: "text", value: "'s note" },
 *   ]
 *
 * The MENTION_REGEX captures a leading whitespace / punctuation character
 * before the `@`; we put it back in the text span so the visible spacing
 * around chips matches the user's input character-for-character.
 */
export type CommentSpan =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string };

export function tokenizeComment(text: string): CommentSpan[] {
  const out: CommentSpan[] = [];
  MENTION_REGEX.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const [, prefix, username] = match;
    if (!username) continue;
    // The match starts at the prefix character, so the @-sign is at
    // `match.index + prefix.length`.
    const atIndex = match.index + prefix.length;
    if (atIndex > cursor) {
      out.push({ kind: "text", value: text.slice(cursor, atIndex) });
    }
    out.push({ kind: "mention", value: username });
    cursor = atIndex + 1 + username.length; // @ + username chars
  }
  if (cursor < text.length) {
    out.push({ kind: "text", value: text.slice(cursor) });
  }
  return out;
}

/**
 * Group a flat list of comments by parent. Returns `{ roots, repliesByParent }`:
 *   - `roots`: comments with no parent_id (top-level)
 *   - `repliesByParent`: a map from parent comment id → ordered child list
 *
 * Replies to replies (grand-children) are flattened up to the nearest
 * top-level ancestor — Phase 2 explicitly caps threading at 1 level deep
 * per the brief. If a reply's parent_id points at another reply (not a
 * root), we promote it to a reply of the grand-parent so the UI never has
 * to render N-deep indents. If the parent doesn't exist in the list at all
 * (orphaned reply — parent was deleted), the reply gets promoted to root.
 */
export type CommentLike = TaskComment | NoteComment;

export interface CommentTree<T extends CommentLike> {
  roots: T[];
  repliesByParent: Map<string, T[]>;
}

export function buildCommentTree<T extends CommentLike>(
  comments: T[],
): CommentTree<T> {
  const byId = new Map<string, T>();
  for (const c of comments) byId.set(c.id, c);

  // Pass 1: resolve each non-root parent to its nearest top-level ancestor.
  // Walk up parent_id chains; stop at the first ancestor with no parent.
  // Caps at 8 hops to avoid infinite loops on malformed data.
  const effectiveParent = new Map<string, string | null>();
  for (const c of comments) {
    if (!c.parent_id) {
      effectiveParent.set(c.id, null);
      continue;
    }
    let cursor: string | null | undefined = c.parent_id;
    let depth = 0;
    let last: string | null = null;
    while (cursor && depth < 8) {
      const parent = byId.get(cursor);
      if (!parent) {
        // Parent vanished — orphan, treat as root.
        last = null;
        break;
      }
      last = parent.id;
      if (!parent.parent_id) break;
      cursor = parent.parent_id;
      depth += 1;
    }
    effectiveParent.set(c.id, last);
  }

  // Pass 2: bucket each comment under its effective parent (or roots).
  const roots: T[] = [];
  const repliesByParent = new Map<string, T[]>();
  for (const c of comments) {
    const parent = effectiveParent.get(c.id);
    if (!parent) {
      roots.push(c);
      continue;
    }
    const list = repliesByParent.get(parent);
    if (list) {
      list.push(c);
    } else {
      repliesByParent.set(parent, [c]);
    }
  }

  // Sort replies by created_at so the UI renders oldest-first under each
  // parent. Roots are sorted by the caller (the inbox feed wants newest
  // first, the in-record thread wants oldest first — same data, different
  // order, so we don't impose one here).
  for (const list of repliesByParent.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  return { roots, repliesByParent };
}

/**
 * Cheap preview for the bell notification row. Strips line breaks, caps
 * at 120 chars, and trims @username chips back to plain `@user` (no chip
 * rendering in the bell — just a readable summary).
 */
export function commentPreview(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1).trimEnd() + "…";
}
