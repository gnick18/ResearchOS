"use client";

// SettingsShell (settings-build bot, 2026-06-11). The unified left-rail + content
// pane that replaces the old Personal / Lab Mode scroll-wall on /settings. It
// owns:
//   - a grouped section REGISTRY (passed in by the page so the page keeps owning
//     the loaded settings + the section components, all of which preserve their
//     existing behavior and wiring),
//   - the active-section state, read from and synced to a `?section=...` query
//     param (old `?tab=lab` deep-links map onto the first Lab section so they
//     keep working),
//   - the live search filter, which here narrows the RAIL to matching sections
//     by title / keywords (the in-pane SectionShell highlight still runs too).
//
// The shell renders ONE section's component in the pane at a time. The section
// components themselves live in the page and are unchanged, so every control
// reads and writes its store exactly as before.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import UserAvatar from "@/components/UserAvatar";
import {
  useSettingsSearch,
  matchesText,
} from "@/app/settings/search-context";

/** One section the shell can show in the content pane. */
export interface SettingsSectionDef {
  /** Stable id used in the `?section=` query and as the React key. */
  id: string;
  /** Rail group this section belongs to (matches a group label below). */
  group: string;
  /** Rail label + the pane title kicker. */
  title: string;
  /** The registry icon shown in the rail. */
  icon: IconName;
  /** Extra search terms so the rail filter can find a section by its rows. */
  keywords?: string;
  /** Small "new" / "lab" style flag chip on the rail item. */
  flag?: string;
  /** When greater than 0, the rail item shows a count pill plus an Apple-style
   *  attention dot, and the group heading inherits a dot. Used by the Members
   *  section to surface pending lab join requests without opening the section. */
  badgeCount?: number;
  /** Renders the section body in the pane. Reuses the existing components. */
  render: () => ReactNode;
}

/** A rail group with its ordered sections. */
export interface SettingsGroupDef {
  /** Group heading shown in the rail (YOU, WORKSPACE, etc.). */
  label: string;
  /** When set, a small "Lab heads" badge sits next to the heading. */
  labBadge?: boolean;
  sections: SettingsSectionDef[];
}

/**
 * Map an old `?tab=...` value onto a default section id so existing deep-links
 * (`/settings?tab=lab`, the "lab-mode" alias) keep landing somewhere sensible.
 * The new `?section=` query takes precedence when present.
 */
export function defaultSectionForTab(
  tab: string | null,
  groups: SettingsGroupDef[],
): string | null {
  if (tab === "lab" || tab === "lab-mode") {
    const lab = groups.find((g) => g.labBadge) ?? null;
    return lab?.sections[0]?.id ?? null;
  }
  return null;
}

export default function SettingsShell({
  groups,
  currentUser,
  roleLabel,
  headerExtra,
  railSearch,
  railFooter,
  initialSectionId,
}: {
  groups: SettingsGroupDef[];
  /** Drives the rail header avatar + name. */
  currentUser: string;
  /** Small role line under the name in the rail header (e.g. "Lab head"). */
  roleLabel?: string;
  /** Optional node rendered in the slim top bar (a compact title + the saved
   *  indicator). Kept short, the search now lives in the rail. */
  headerExtra?: ReactNode;
  /** Compact search input rendered at the top of the rail, where it filters the
   *  rail items. Replaces the old full-width search bar that ate the top of the
   *  screen. */
  railSearch?: ReactNode;
  /** Compact footer pinned to the bottom of the rail (the support ask + a small
   *  link row), the Linear / VS Code pattern. Stays at the foot of the sidebar
   *  while the section list above it scrolls. */
  railFooter?: ReactNode;
  /** Section to open on when there is no `?section=` / `?tab=` in the URL.
   *  Used when the shell is mounted inside a modal (no query to read), e.g.
   *  the ProfileSettingsModal opens straight on the profile section. */
  initialSectionId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { query, lower, active } = useSettingsSearch();

  // Flatten for lookup. The groups are the source of order.
  const allSections = useMemo(
    () => groups.flatMap((g) => g.sections),
    [groups],
  );

  // Resolve the active section. Precedence: `?section=` (if it points at a
  // section that actually exists for this user), then the `?tab=` fallback,
  // then the first section overall (the flagship AI usage, by group order).
  const sectionParam = searchParams.get("section");
  const tabParam = searchParams.get("tab");
  const resolvedActiveId = useMemo(() => {
    if (sectionParam) {
      const exact = allSections.find((s) => s.id === sectionParam);
      if (exact) return exact.id;
      // Tolerate hyphenated deep-links onto ids that concatenate words
      // without a separator (e.g. `ai-helper` -> `aihelper`, `lab-settings`
      // -> `labsettings`). Someone bookmarking or hand-typing the URL will
      // reach for the natural hyphenated form, so normalize before failing.
      const normalized = sectionParam.replace(/-/g, "");
      const aliased = allSections.find(
        (s) => s.id.replace(/-/g, "") === normalized,
      );
      if (aliased) return aliased.id;
    }
    const fromTab = defaultSectionForTab(tabParam, groups);
    if (fromTab && allSections.some((s) => s.id === fromTab)) return fromTab;
    if (
      initialSectionId &&
      allSections.some((s) => s.id === initialSectionId)
    ) {
      return initialSectionId;
    }
    return allSections[0]?.id ?? null;
  }, [sectionParam, tabParam, allSections, groups, initialSectionId]);

  const paneRef = useRef<HTMLDivElement>(null);

  const selectSection = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("section", id);
      // Drop the legacy tab param so the URL has one source of truth.
      params.delete("tab");
      const query = params.toString();
      router.replace(query ? `/settings?${query}` : "/settings", {
        scroll: false,
      });
    },
    [router, searchParams],
  );

  // Scroll the pane back to the top on a section change so a long previous
  // section doesn't leave the new one scrolled out of view.
  useEffect(() => {
    paneRef.current?.scrollTo({ top: 0 });
  }, [resolvedActiveId]);

  // Rail search: a section row stays visible when its title / keywords match,
  // OR the search is off. The active section always renders in the pane even
  // when filtered out of the rail (so a stale query doesn't blank the pane).
  const sectionMatches = useCallback(
    (s: SettingsSectionDef) =>
      !active || matchesText(lower, s.title, s.keywords),
    [active, lower],
  );

  const activeSection =
    allSections.find((s) => s.id === resolvedActiveId) ?? null;

  // When search is active, count how many sections across all groups match.
  // If none match, the pane shows a visible "No settings match" message
  // instead of silently clearing (the audit found a blank black panel with
  // no feedback when the query matched nothing).
  const anyGroupVisible = active
    ? groups.some((g) => g.sections.some(sectionMatches))
    : true;

  return (
    <div className="min-h-0 flex-1 flex flex-col bg-surface-sunken">
      {/* Slim top bar: a compact title + the saved indicator. The page's fixed
          close button (X) sits at the far right, so reserve right padding. */}
      {headerExtra && (
        <div className="shrink-0 border-b border-border bg-surface-raised py-2.5 pl-4 pr-16 sm:pl-6">
          {headerExtra}
        </div>
      )}
      {/* Full-bleed rail + pane filling the rest of the screen. No centered
          card; the rail is flush to the left edge and the pane fills the rest. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[256px_1fr]">
        {/* ── Rail ── */}
        <nav
          aria-label="Settings sections"
          className="flex min-h-0 flex-col border-b border-border bg-surface-raised md:border-b-0 md:border-r"
        >
          {/* Scrollable section list; the rail footer below stays pinned. */}
          <div className="flex-1 overflow-y-auto p-2.5">
            {/* Compact search at the top of the rail, where it filters the list. */}
            {railSearch && <div className="px-1 pt-1 pb-2.5">{railSearch}</div>}
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <UserAvatar username={currentUser} size="sm" />
              <div className="min-w-0 leading-tight">
                <p className="text-body font-bold text-foreground truncate">
                  {currentUser}
                </p>
                {roleLabel && (
                  <p className="text-meta text-foreground-muted truncate">
                    {roleLabel}
                  </p>
                )}
              </div>
            </div>

            {groups.map((group, groupIndex) => {
              const visibleSections = group.sections.filter(sectionMatches);
              if (visibleSections.length === 0) return null;
              // Bubble an attention dot to the group heading when any section in
              // the group is asking for attention, so a rail scrolled past the
              // section still signals it.
              const groupNeedsAttention = group.sections.some(
                (s) => (s.badgeCount ?? 0) > 0,
              );
              return (
                <div key={group.label} className="mt-3">
                  {/* Soft fading divider between rail groups (Popup Unifier
                      seam kit). First group has no divider above it. */}
                  {groupIndex > 0 && (
                    <div className="ros-seam-divider mb-3" aria-hidden="true" />
                  )}
                  <div className="flex items-center gap-1.5 px-2 pb-1.5">
                    <span className="text-meta font-bold uppercase tracking-wide text-foreground-muted">
                      {group.label}
                    </span>
                    {groupNeedsAttention && (
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-red-500"
                      />
                    )}
                    {group.labBadge && (
                      <span className="text-meta font-bold text-purple-600 dark:text-purple-300 bg-purple-100 dark:bg-purple-500/15 rounded px-1.5 py-px">
                        Lab heads
                      </span>
                    )}
                  </div>
                  {visibleSections.map((section) => {
                    const isActive = section.id === resolvedActiveId;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => selectSection(section.id)}
                        className={`flex items-center gap-2.5 w-full text-left rounded-lg px-2 py-1.5 text-body font-medium transition-colors ${
                          isActive
                            ? "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300"
                            : "text-foreground hover:bg-surface-sunken"
                        }`}
                      >
                        <Icon
                          name={section.icon}
                          className={`h-3.5 w-3.5 shrink-0 ${
                            isActive
                              ? "text-blue-600 dark:text-blue-300"
                              : "text-foreground-muted"
                          }`}
                        />
                        <span className="flex-1 truncate">{section.title}</span>
                        {section.flag && (
                          <span className="text-meta font-bold text-blue-600 dark:text-blue-300 bg-blue-100 dark:bg-blue-500/15 rounded px-1.5 py-px">
                            {section.flag}
                          </span>
                        )}
                        {(section.badgeCount ?? 0) > 0 && (
                          <>
                            {/* Count pill: how many items need the PI. */}
                            <span
                              className="min-w-[1.25rem] rounded-full bg-red-500 px-1.5 py-px text-center text-meta font-bold leading-tight text-white"
                              aria-label={`${section.badgeCount} pending`}
                            >
                              {section.badgeCount}
                            </span>
                            {/* Apple-style attention dot beside the pill. */}
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
                            />
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {/* Pinned to the bottom of the rail: the support ask + compact links. */}
          {railFooter && (
            <div className="shrink-0 border-t border-border p-3">{railFooter}</div>
          )}
          </nav>

        {/* ── Content pane: scrolls. No marketing footer here; the support ask
            and links live at the bottom of the rail instead. ── */}
        <div ref={paneRef} className="overflow-y-auto">
          <div className="mx-auto max-w-4xl px-6 py-8 sm:px-8">
            {active && !anyGroupVisible ? (
              // Search is active but nothing matched. Show a clear message
              // instead of a blank pane (audit finding: blank black panel with
              // no feedback).
              <div
                role="status"
                aria-live="polite"
                className="flex flex-col items-center justify-center gap-3 py-16 text-center"
              >
                <p className="text-title font-semibold text-foreground">
                  No settings match
                </p>
                <p className="text-body text-foreground-muted max-w-xs">
                  No section or setting matched{" "}
                  <span className="font-medium text-foreground">
                    &ldquo;{query}&rdquo;
                  </span>
                  . Try a different term, or clear the search to browse all
                  sections.
                </p>
              </div>
            ) : activeSection ? (
              <div key={activeSection.id} className="space-y-4">
                {activeSection.render()}
              </div>
            ) : (
              <p className="text-body text-foreground-muted">
                Pick a section from the left.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
