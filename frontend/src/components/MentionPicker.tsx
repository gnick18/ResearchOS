"use client";

import { useEffect, useMemo, useRef } from "react";
import { useLabUserProfileMap, type LabUserProfile } from "@/hooks/useLabUserProfiles";
import UserAvatar from "@/components/UserAvatar";

interface MentionPickerProps {
  // The current "query" string — everything typed AFTER the active `@`
  // (no leading `@`). Empty string is valid; we filter to all members.
  query: string;
  // Anchor element to position the popover above. The component renders
  // as a floating div positioned just above the anchor's top edge.
  anchor: HTMLElement | null;
  // Notified when the user picks (or dismisses without picking).
  onPick: (username: string) => void;
  onClose: () => void;
  // Whether the picker is visible. Parent owns visibility so it can hide
  // the popover when the cursor moves away from a mention context.
  open: boolean;
  // The active row index, owned by the parent so it can wire arrow keys at
  // the textarea level (Enter / Esc) without React having to round-trip
  // through MentionPicker state.
  activeIdx: number;
  onActiveIdxChange: (idx: number) => void;
  // Notify parent of the filtered list length so its arrow-key handler can
  // clamp activeIdx correctly.
  onFilteredChange?: (filtered: LabUserProfile[]) => void;
}

/**
 * Lab Head Phase 2 (lab head Phase 2 manager, 2026-05-23) — @mention picker.
 *
 * When the comment composer detects an active `@` token, it mounts this
 * picker. The picker pulls the lab member list from the same
 * `useLabUserProfileMap` source the comment renderer uses, filters by the
 * typed query (case-insensitive substring match on username + displayName),
 * and lets the user pick with arrow keys + Enter or by clicking a row.
 *
 * Phase 6 (archived users): the membersQuery below intentionally pulls ALL
 * lab users. Once Phase 6 lands, the picker should filter out users with
 * `archived: true` set in `_onboarding.json` — see the brief. The TODO in
 * the `members` memo is the seam to wire that up. Leaving the picker
 * inclusive today means an archived user typed mid-sentence still has a
 * way to be selected (which is fine fallback behavior even after Phase 6,
 * since existing archived references stay intact).
 */
export default function MentionPicker({
  query,
  anchor,
  onPick,
  onClose,
  open,
  activeIdx,
  onActiveIdxChange,
  onFilteredChange,
}: MentionPickerProps) {
  const profileMap = useLabUserProfileMap();
  const popupRef = useRef<HTMLDivElement>(null);

  // Phase 6 TODO: when the archived-user filter lands, drop entries here
  // whose `_onboarding.json` has `archived: true`. The picker should only
  // surface active members for NEW mentions; existing references in older
  // comments will continue to render (the comment renderer doesn't gate
  // on archive state).
  const members = useMemo(() => {
    const list = Object.values(profileMap);
    return list.sort((a, b) => a.username.localeCompare(b.username));
  }, [profileMap]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      if (m.username.toLowerCase().includes(q)) return true;
      if (m.displayName && m.displayName.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [members, query]);

  // Bubble the filtered list to the parent so its keyboard handler can
  // clamp activeIdx.
  useEffect(() => {
    onFilteredChange?.(filtered);
  }, [filtered, onFilteredChange]);

  // Position the popover above the anchor. Computed at render time —
  // `getBoundingClientRect()` is fast and the anchor's position only
  // changes when the textarea reflows (which already re-renders us).
  // Avoids the setState-in-effect lint error per React's recommended
  // "derive instead of sync" pattern.
  const position = useMemo<{ left: number; top: number } | null>(() => {
    if (!open || !anchor) return null;
    const rect = anchor.getBoundingClientRect();
    return { left: rect.left, top: Math.max(8, rect.top - 200) };
    // `query` is included so the popover repositions when it shrinks the
    // anchor textarea via reflow (rare but real on tall replies). Anchor
    // ref identity is the primary trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchor, query]);

  // Click-outside dismisses.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        if (anchor && anchor.contains(e.target as Node)) return;
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, anchor]);

  if (!open || filtered.length === 0 || !position) return null;

  return (
    <div
      ref={popupRef}
      role="listbox"
      aria-label="Mention picker"
      className="fixed z-50 w-64 max-h-48 overflow-y-auto bg-white rounded-lg shadow-xl border border-gray-200"
      style={{ left: position.left, top: position.top }}
    >
      <ul className="py-1">
        {filtered.map((m, i) => {
          const isActive = i === activeIdx;
          const label = (m.displayName && m.displayName.trim()) || m.username;
          return (
            <li
              key={m.username}
              role="option"
              aria-selected={isActive}
              onMouseEnter={() => onActiveIdxChange(i)}
              // Prevent textarea blur on click so the cursor stays where
              // it was when the user is selecting a mention.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(m.username);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${
                isActive ? "bg-emerald-50" : "hover:bg-gray-50"
              }`}
            >
              <UserAvatar username={m.username} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-900 truncate">{label}</div>
                {m.displayName && m.displayName.trim() && (
                  <div className="text-xs text-gray-500 truncate">
                    @{m.username}
                  </div>
                )}
              </div>
              {m.account_type === "lab_head" && (
                <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800">
                  Lab Head
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
