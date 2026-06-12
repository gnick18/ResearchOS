"use client";

// Markdown embed hybrid, Phase 7 (P7-3). The in-place view switch.
//
// A small segmented control shown in a multi-view embed header (Data Hub table /
// plot / result, sequence map / bases). Selecting a view flips the rendered embed
// immediately. In the CM6 editor the parent threads an onViewChange that rewrites
// the source line, so the choice persists. In the read-only Preview no callback is
// passed, so the switch is ephemeral (it flips on screen, nothing is saved).
//
// Plain text labels only, no inline svg and no emoji, so the icon guard and the
// no-emoji rule both hold. Matches the .vswitch look in
// docs/mockups/2026-06-12-phase7-polish-decisions.html.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

export interface EmbedViewOption {
  /** The #ros view value, e.g. "map", "table", "plot". */
  value: string;
  /** The short button label, e.g. "Map", "Table". */
  label: string;
}

export interface EmbedViewSwitchProps {
  views: EmbedViewOption[];
  current: string;
  onSelect: (view: string) => void;
}

/** Render nothing when there is only one view (or none), a one-option switch is
 *  visual noise. Otherwise a tight segmented control of text-label buttons, the
 *  current one highlighted. The group carries aria-label so screen readers
 *  announce it as "View" rather than a nameless cluster of buttons. */
export default function EmbedViewSwitch({ views, current, onSelect }: EmbedViewSwitchProps) {
  if (views.length < 2) return null;
  return (
    <span
      role="group"
      aria-label="View"
      className="ml-auto inline-flex shrink-0 overflow-hidden rounded-lg border border-border"
    >
      {views.map((v) => {
        const on = v.value === current;
        return (
          <button
            key={v.value}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(v.value)}
            className={
              "border-l border-border px-2.5 py-1 text-meta font-bold transition-colors first:border-l-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-action " +
              (on
                ? "bg-brand-action text-white"
                : "bg-surface-sunken text-foreground-muted hover:text-foreground")
            }
          >
            {v.label}
          </button>
        );
      })}
    </span>
  );
}
