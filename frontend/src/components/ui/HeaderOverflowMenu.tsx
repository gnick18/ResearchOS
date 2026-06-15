"use client";

// L3 header declutter (LiveMarkdownEditor redesign, 2026-06-14). The single
// "..." (more) overflow trigger that folds a record detail popup's SECONDARY
// header actions into one calm menu when the popup is expanded (the L3 calm
// shell). Built so the experiment + note popups share one dismissable menu
// instead of each hand-rolling an open-state + outside-click + Escape dance.
//
// Behaviour, matching the app-wide kebab convention (see ProjectCardKebab):
//   - trigger is the verified `more` glyph from the icon registry (the single
//     sanctioned icon source; the icon-guard test blocks new inline SVGs),
//     wrapped in the shared <Tooltip> (never a native title=).
//   - the panel is role="menu"; callers pass <button role="menuitem"> rows that
//     KEEP their exact handlers + data-testid / data-tour-target so automation
//     and tests still find them once the menu is opened.
//   - Escape closes the menu (via useEscapeToClose, which preventDefaults so the
//     innermost layer closes first and the popup behind it stays open).
//   - a mousedown-outside listener closes the menu.
//   - the menu NEVER traps focus: it is a plain dropdown, no focus loop, and the
//     three always-reachable exits (Done / fullscreen-collapse / Close) live in
//     the header OUTSIDE this menu, so folding actions in here can never create a
//     soft-lock.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons/Icon";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

export default function HeaderOverflowMenu({
  children,
  label = "More actions",
  testId,
  buttonClassName,
}: {
  /** The menu rows. Render <button role="menuitem"> (or labelled wrappers) that
   *  keep their own onClick + data-testid. Use `closeOnSelect` from context by
   *  wrapping handlers, or simply let the outside-click / Escape close it. */
  children: React.ReactNode;
  /** Trigger tooltip + aria-label. */
  label?: string;
  /** Optional data-testid for the trigger button. */
  testId?: string;
  /** Optional extra classes for the trigger button (sizing parity per popup). */
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Escape closes the menu first (the hook preventDefaults), leaving the popup
  // open. Bound only while the menu is open.
  useEscapeToClose(() => setOpen(false), open);

  // Click-outside closes the menu. Mirrors the ProjectCardKebab pattern.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <Tooltip label={label} placement="bottom">
        <button
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid={testId}
          onClick={() => setOpen((v) => !v)}
          className={
            buttonClassName ??
            "p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-sunken transition-colors"
          }
        >
          <Icon name="more" className="w-4 h-4" />
        </button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          // Selecting any row closes the menu. Each row keeps its own onClick;
          // this onClick fires on the bubble after the row handler, so the
          // action runs and then the menu folds away.
          onClick={() => setOpen(false)}
          className="absolute top-full right-0 mt-1 w-56 max-w-[80vw] rounded-xl border border-border bg-surface-raised py-1.5 shadow-lg z-50"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A quiet, non-actionable label row for the overflow menu (e.g. the "Phone
 * linked" status). Renders as a menu group label, not a clickable item.
 */
export function HeaderOverflowLabel({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-meta font-medium text-foreground-muted">
      {icon}
      <span>{children}</span>
    </div>
  );
}
