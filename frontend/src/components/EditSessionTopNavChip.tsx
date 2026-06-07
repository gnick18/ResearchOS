"use client";

import { useEffect, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import {
  endEditSession,
  extendEditSession,
  formatRemaining,
} from "@/lib/lab/edit-session";
import { useEditSession } from "@/hooks/useEditSession";

/**
 * Lab head UX polish manager Bug 2 (2026-05-24): a persistent, compact
 * countdown chip that surfaces the active lab-head edit session in the
 * top nav.
 *
 * Why this exists: the timer used to live ONLY inside the per-record
 * popup banner (PiActions surface). Once the lab head closed that
 * popup or navigated to another page, the 5-minute countdown continued
 * ticking invisibly — they only discovered the session had expired
 * when the next write failed. This chip mirrors `useEditSession` at
 * the AppShell level so the countdown is visible from every page.
 *
 * Behavior:
 *   - Renders nothing unless `state === "unlocked"` (so no chrome in
 *     idle / locked states).
 *   - Click toggles a small popover with two actions: "Lock now" ends
 *     the session immediately; "Extend 5 min" resets the countdown
 *     without requiring re-auth.
 *   - The full-width amber `EditSessionBanner` continues to render
 *     directly below the header so the chip and the banner reinforce
 *     each other rather than competing.
 */
export default function EditSessionTopNavChip() {
  const session = useEditSession();
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popRef.current && !popRef.current.contains(target) &&
        btnRef.current && !btnRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (session.state !== "unlocked" || !session.active) return null;

  const remaining = formatRemaining(session.remainingMs);

  return (
    <div className="relative">
      <Tooltip
        label="Active lab-head edit session — click for actions"
        placement="bottom"
      >
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Edit session: ${remaining} remaining`}
          data-testid="edit-session-chip"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-meta font-medium transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="flex-shrink-0"
          >
            {/* Open padlock — signals an unlocked, time-bounded
                editing session. */}
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 9.9-1" />
          </svg>
          <span className="font-mono tabular-nums" data-testid="edit-session-chip-remaining">
            {remaining}
          </span>
        </button>
      </Tooltip>

      {open && (
        <div
          ref={popRef}
          role="menu"
          aria-label="Edit session actions"
          data-testid="edit-session-chip-menu"
          className="absolute right-0 mt-2 w-56 bg-surface-raised border border-border rounded-lg shadow-lg z-50 overflow-hidden"
        >
          <div className="px-3 py-2 bg-amber-50 border-b border-amber-100">
            <p className="text-meta text-amber-900">
              <span className="font-semibold">Edit session active</span>
            </p>
            <p className="text-meta text-amber-700 mt-0.5">
              <span className="font-mono tabular-nums">{remaining}</span>{" "}
              remaining for{" "}
              <span className="font-medium">@{session.active.username}</span>
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              extendEditSession();
            }}
            className="w-full text-left px-3 py-2 text-body text-foreground hover:bg-surface-sunken flex items-center gap-2"
            data-testid="edit-session-chip-extend"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="flex-shrink-0 text-foreground-muted"
            >
              <path d="M12 8v4l3 3" />
              <circle cx="12" cy="12" r="10" />
            </svg>
            Extend 5 min
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              endEditSession();
              setOpen(false);
            }}
            className="w-full text-left px-3 py-2 text-body text-foreground hover:bg-surface-sunken flex items-center gap-2 border-t border-border"
            data-testid="edit-session-chip-lock"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="flex-shrink-0 text-foreground-muted"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Lock now
          </button>
        </div>
      )}
    </div>
  );
}
