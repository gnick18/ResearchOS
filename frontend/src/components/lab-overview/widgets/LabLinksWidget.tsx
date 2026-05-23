"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { labLinksApi } from "@/lib/local-api";
import type { LabLink } from "@/lib/types";

/**
 * Lab Mode retirement R3 (R3 widget catalog manager, 2026-05-23):
 * canvas-surface "Lab links" widget. Surfaces lab-wide links (the
 * same set the dedicated `/links` page displays) inside the standard
 * Widget frame so the Lab Overview can mount it alongside the other
 * widgets.
 *
 * Compact UX (the canvas-default sizing is wide-but-short, w:6 h:4):
 *   - links grouped by category, like the standalone `/links` page
 *   - each link is a small card with title + hostname + preview color
 *   - opens in a new tab (target=_blank, rel=noopener) — the widget
 *     is for navigation, not editing. Creation / deletion lives on
 *     the `/links` page where the full editor exists.
 *
 * Sharing: `LabLink` already lives at the lab root (no per-user
 * sharing today — every member sees every link). The R1 unified
 * sharing migration adds `owner` + `shared_with` to LabLink; once
 * that lands we can layer a canRead filter here, mirroring
 * `LabNotesWidget`. Until then the widget reads the full lab list.
 */
export default function LabLinksWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { data: links = [], isLoading } = useQuery<LabLink[]>({
    queryKey: ["lab-links"],
    queryFn: labLinksApi.list,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const grouped = useMemo(() => {
    const byCategory = new Map<string, LabLink[]>();
    for (const link of links) {
      const cat = link.category || "Other";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(link);
    }
    // Sort categories alphabetically; "Other" goes last so the
    // uncategorized bucket doesn't dominate.
    const cats = Array.from(byCategory.keys()).sort((a, b) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
    return cats.map((c) => ({ category: c, links: byCategory.get(c)! }));
  }, [links]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600" />
        Loading lab links…
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">
        No lab links saved yet. Open <a href="/links" className="text-emerald-700 hover:underline">/links</a> to add one.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.map(({ category, links: catLinks }) => (
        <section key={category}>
          <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
            {category}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {catLinks.map((link) => (
              <LinkCard key={link.id} link={link} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function LinkCard({ link }: { link: LabLink }) {
  // Defensive URL parse — labLinks user-pasted URLs are not validated
  // before hitting the store. Failures fall back to the raw string so
  // the widget never crashes on a malformed link.
  let hostname = link.url;
  try {
    hostname = new URL(link.url).hostname;
  } catch {
    // ignore
  }
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-2 p-2 bg-white border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all min-w-0"
    >
      <div
        className="w-2 h-8 rounded-sm flex-shrink-0"
        style={{ backgroundColor: link.color || "#6b7280" }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 group-hover:text-blue-600 truncate" title={link.title}>
          {link.title}
        </p>
        <p className="text-[10px] text-gray-400 truncate" title={link.url}>
          {hostname}
        </p>
      </div>
    </a>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase A snapshot + expanded contract (Phase A redispatch manager, 2026-05-23)
// ─────────────────────────────────────────────────────────────────────────────
import StatTile from "./snapshot/StatTile";
import type { SnapshotTileProps } from "./types";

export function SnapshotTile(_props: SnapshotTileProps) {
  const { data: links = [], isLoading } = useQuery<LabLink[]>({
    queryKey: ["lab-links"],
    queryFn: labLinksApi.list,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const categories = new Set<string>();
  for (const link of links) categories.add(link.category || "Other");
  return (
    <StatTile
      icon={
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      }
      iconClassName="text-emerald-500"
      label="Lab links"
      stat={isLoading ? "—" : links.length}
      sub={
        links.length === 0
          ? "No links saved"
          : `${categories.size} categor${categories.size === 1 ? "y" : "ies"}`
      }
    />
  );
}

export const ExpandedView = LabLinksWidget;
