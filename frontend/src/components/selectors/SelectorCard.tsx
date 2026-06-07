"use client";

import { forwardRef, type ReactNode } from "react";

/**
 * Shared rich-card shell for the selector family (method picker + the
 * eventual widget palette). The redesign brief (plans/SELECTOR_REDESIGN.md
 * section 2) calls for ONE card shape across both selectors so they read as
 * one component family: a hero/preview region on top, a name + subtitle, a
 * badge cluster, and an explicit action slot in a fixed corner.
 *
 * Presentation-only. This component owns NO data shape and NO selection
 * logic; callers drive the visual state via the `selected` / `dimmed` flags
 * and fill the slots. Keeping the chrome here means MethodCard and the
 * widget card cannot drift apart.
 *
 * The card itself is a real <button> in a roving-focus grid (accessibility
 * section of the brief). The primary action lives in the `action` slot as a
 * separate control; the card-level button is the navigation/focus target.
 * Anything live/preview in the hero must be marked aria-hidden +
 * pointer-events-none by the caller.
 */

export interface SelectorCardProps {
  /** Top hero / preview region. Fixed-ish height keeps the grid even. */
  hero?: ReactNode;
  /** Primary line — the thing's name. */
  title: ReactNode;
  /** One-line context under the title (owner line, description excerpt). */
  subtitle?: ReactNode;
  /** Inline badge cluster rendered next to the title (type pill, chips). */
  badges?: ReactNode;
  /** Action slot pinned to the card's action corner (Attach button, etc.). */
  action?: ReactNode;
  /** Extra footer content (tags, last-edited line). */
  footer?: ReactNode;
  /** Selected / attached visual state — adds the blue ring. */
  selected?: boolean;
  /** Muted state — e.g. already attached and excluded; lowers contrast. */
  dimmed?: boolean;
  /** Forwarded to the card button so callers can stamp tour anchors. */
  "data-tour-target"?: string;
  /** Roving-focus tabIndex (0 for the active cell, -1 for the rest). */
  tabIndex?: number;
  /** Card-level click — navigation / highlight, NOT the primary action. */
  onClick?: () => void;
  onMouseEnter?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  /** Accessible label for the card button when the title is decorative. */
  "aria-label"?: string;
  className?: string;
}

const SelectorCard = forwardRef<HTMLButtonElement, SelectorCardProps>(
  function SelectorCard(
    {
      hero,
      title,
      subtitle,
      badges,
      action,
      footer,
      selected = false,
      dimmed = false,
      tabIndex,
      onClick,
      onMouseEnter,
      onKeyDown,
      className,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        data-tour-target={rest["data-tour-target"]}
        aria-label={rest["aria-label"]}
        tabIndex={tabIndex}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onKeyDown={onKeyDown}
        className={[
          "group relative flex w-full flex-col overflow-hidden rounded-xl border bg-surface-raised text-left transition-shadow",
          selected
            ? "border-blue-300 ring-2 ring-blue-400"
            : "border-border hover:ring-1 hover:ring-blue-200 hover:shadow-sm",
          dimmed ? "opacity-60" : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {hero != null && (
          // The hero is decorative / preview content. It must never steal
          // focus or fire its own clicks from inside the card, so it is
          // pointer-events-none + aria-hidden per the brief's guardrails.
          <div
            aria-hidden="true"
            className="pointer-events-none relative h-16 shrink-0 overflow-hidden border-b border-border bg-surface-sunken/60 px-3 py-2"
          >
            {hero}
          </div>
        )}

        <div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="min-w-0 truncate text-body font-semibold text-foreground">
                  {title}
                </span>
                {badges}
              </div>
              {subtitle != null && (
                <span className="truncate text-meta text-foreground-muted">
                  {subtitle}
                </span>
              )}
            </div>
            {action != null && (
              // The action slot is interactive; stop the card-level click
              // from also firing when the user hits the button directly.
              <div
                className="shrink-0"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {action}
              </div>
            )}
          </div>
          {footer}
        </div>
      </button>
    );
  },
);

export default SelectorCard;
