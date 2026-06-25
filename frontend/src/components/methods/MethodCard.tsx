"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { filesApi } from "@/lib/local-api";
import type { Method } from "@/lib/types";
import { getMethodTypeMeta } from "@/lib/methods/method-type-registry";
import { sharedOwnerLabel } from "@/lib/methods/library-sections";
import { methodKey } from "@/lib/methods/lookup";
import SelectorCard from "@/components/selectors/SelectorCard";

/**
 * Rich method card for the redesigned method picker
 * (plans/SELECTOR_REDESIGN.md section 4). Replaces the old thin
 * name + badge + tag row with a card that previews "is this the one?" at a
 * glance: type pill, owner / sharing line, a content-excerpt hero, tags, and
 * a muted last-edited line. Selection is an explicit Attach button (not a
 * whole-row click) that flips to an Attached checkmark + ring.
 *
 * EXCERPT HERO (Method Picker FLAG B, excerpt-field sub-bot of HR): the card
 * hero prefers the persisted `method.excerpt` field, stamped at save time so
 * the card renders without any file read. When the field is absent
 * (pre-excerpt records, lazy backfill on next save), it falls back to the SAME
 * lazy filesApi.readFile the preview pane uses, and ONLY for the highlighted /
 * hovered card (`active`); failing that, the method type registry description
 * is the resting state. Forks are derived from an in-memory parent->children
 * map the picker builds at load time, walked recursively so a fork of a fork
 * of a fork still nests.
 */

/** First ~2 non-empty lines of markdown, stripped of heading / list syntax. */
function excerptFromMarkdown(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+/, "").trim())
    .filter((l) => l.length > 0 && !/^[-=*_]{3,}$/.test(l));
  const joined = lines.slice(0, 2).join(" ");
  return joined.length > 160 ? `${joined.slice(0, 160).trimEnd()}…` : joined;
}

/**
 * One-line resting summary for structured types. Mirrors the copy the
 * preview pane shows per type (MethodPicker MethodPreview, ~627-650) so the
 * card and the deep view stay consistent. Falls back to the registry
 * description for markdown / PDF / unknown.
 */
function restingSummary(method: Method): string {
  const type = method.method_type;
  const meta = getMethodTypeMeta(type);
  switch (type) {
    case "pcr":
      return "Thermocycler program and reaction recipe.";
    case "lc_gradient":
      return "Solvent gradient, column, flow, and ingredients.";
    case "plate":
      return "Well-plate layout with sample / control / blank regions.";
    case "cell_culture":
      return "Passaging schedule, media, and planned cadence.";
    case "mass_spec":
      return "Ionization mode, source / scan params, and calibration.";
    case "compound":
      return "A kit bundling several methods into one attachable unit.";
    case "qpcr_analysis":
      return "Cq readouts, melt-curve, and fold-change analysis.";
    case "coding_workflow":
      return "Reusable scripts and notebooks.";
    default:
      return meta.description ?? "Free-form protocol text.";
  }
}

export interface MethodCardProps {
  method: Method;
  /** Recursive parent->children fork map built once by the picker. */
  forkChildren: Map<number, Method[]>;
  /** Composite keys already attached / excluded; drives the Attached state. */
  attachedKeys: Set<string>;
  /** The method currently highlighted (keyboard / hover) — only it fetches. */
  isActive: boolean;
  /** Whole-card highlight tint when arrow-navigated to. */
  isHighlighted: boolean;
  /** Expanded fork disclosures, keyed by composite method key. */
  expandedForks: Set<string>;
  /** Nesting depth for the recursive indent (0 at top level). */
  depth?: number;
  /** Roving tabIndex for this card (0 = active grid cell, -1 = rest). */
  tabIndex?: number;
  /** Tour anchor for THIS card (only stamped on rendered top-level cards). */
  tourTarget?: string;
  /** True when the method's fork-parent is absent from the picker list. */
  orphanFork?: boolean;
  /**
   * Multi-attach (keep-open) mode: the whole card toggles a pending selection
   * instead of attaching immediately, and the per-card Attach button is
   * suppressed. Single-link mode leaves this false and behaves exactly as
   * before (highlight on click + the Attach action).
   */
  selectable?: boolean;
  /**
   * In selectable mode, the composite keys currently pending (toggled on).
   * Passed as a set (not a single bool) so nested fork cards can derive their
   * own pending state from the same source the picker owns.
   */
  pendingKeys?: Set<string>;
  /** In selectable mode, the toggle handler (select / unselect). */
  onToggleSelect?: (method: Method) => void;
  onAttach: (method: Method) => void;
  onHighlight: (method: Method) => void;
  onToggleForks: (method: Method) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  registerRef?: (key: string, el: HTMLButtonElement | null) => void;
}

function TypePill({ method }: { method: Method }) {
  if (!method.method_type || method.method_type === "markdown") return null;
  const meta = getMethodTypeMeta(method.method_type);
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-meta font-medium ${meta.color.bg} ${meta.color.text}`}
    >
      {meta.shortLabel}
    </span>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export default function MethodCard({
  method,
  forkChildren,
  attachedKeys,
  isActive,
  isHighlighted,
  expandedForks,
  depth = 0,
  tabIndex,
  tourTarget,
  orphanFork = false,
  selectable = false,
  pendingKeys,
  onToggleSelect,
  onAttach,
  onHighlight,
  onToggleForks,
  onKeyDown,
  registerRef,
}: MethodCardProps) {
  const key = methodKey(method);
  const isAttached = attachedKeys.has(key);
  const isPending = pendingKeys?.has(key) ?? false;
  const children = forkChildren.get(method.id) ?? [];
  const hasForks = children.length > 0;
  const forksOpen = expandedForks.has(key);

  // Method Picker FLAG B: prefer the persisted excerpt, stamped at save time.
  // Trim guards against a whitespace-only stamp. When present the card needs
  // no file read at all.
  const persistedExcerpt = method.excerpt?.trim() || "";
  const hasPersistedExcerpt = persistedExcerpt.length > 0;

  // Lazy excerpt fallback — ONLY the highlighted/hovered card fetches, and
  // only when no persisted excerpt exists (pre-FLAG-B records, lazy backfill).
  // Shares the ["method-preview", id] cache key with the preview pane so a
  // hover here warms the deep view rather than double-reading. Markdown / text
  // files only; structured + PCR-family records keep their resting summary.
  const isMarkdownLike =
    !!method.source_path &&
    method.method_type !== "pdf" &&
    method.method_type !== "pcr" &&
    method.method_type !== "lc_gradient" &&
    method.method_type !== "plate" &&
    method.method_type !== "cell_culture" &&
    method.method_type !== "mass_spec" &&
    !method.source_path.toLowerCase().endsWith(".pdf");

  const { data: fileData } = useQuery({
    queryKey: ["method-preview", method.id],
    queryFn: () => filesApi.readFile(method.source_path!),
    enabled: isActive && isMarkdownLike && !hasPersistedExcerpt,
    staleTime: 5 * 60_000,
  });

  const excerpt = useMemo(() => {
    if (hasPersistedExcerpt) return persistedExcerpt;
    if (isMarkdownLike && fileData?.content) {
      const fromFile = excerptFromMarkdown(fileData.content);
      if (fromFile) return fromFile;
    }
    return restingSummary(method);
  }, [hasPersistedExcerpt, persistedExcerpt, isMarkdownLike, fileData?.content, method]);

  const ownerLabel = sharedOwnerLabel(method);
  const showPublicChip = method.is_public || method.owner === "public";
  const showSharedChip = method.is_shared_with_me === true;
  const isCompound = method.method_type === "compound";

  const attachAction = (
    <button
      type="button"
      onClick={() => onAttach(method)}
      disabled={isAttached}
      aria-label={isAttached ? `${method.name} attached` : `Attach ${method.name}`}
      className={[
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-meta font-medium transition-colors",
        isAttached
          ? "cursor-default bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300 ring-1 ring-blue-200"
          : "bg-brand-action text-white hover:bg-brand-action/90",
      ].join(" ")}
    >
      {isAttached ? (
        <>
          <CheckIcon className="h-3.5 w-3.5" />
          Attached
        </>
      ) : (
        "Attach"
      )}
    </button>
  );

  // Multi-attach (selectable) mode: the whole card is the toggle, so there is
  // no per-card Attach button. The action corner shows state instead. Already
  // attached methods get a muted, NON-interactive "Added" badge (the picker is
  // add-only; detach happens from the components list, not here). Pending and
  // resting methods get a toggle button that mirrors the card-level toggle, so
  // clicking either the badge or the card body flips the selection. Because the
  // SelectorCard action slot stops click propagation, the badge calls
  // onToggleSelect itself.
  const handleToggle = () => {
    if (isAttached) return; // add-only: already-added cards never toggle
    onToggleSelect?.(method);
  };
  const selectableIndicator = isAttached ? (
    <span
      aria-label={`${method.name} already added`}
      className="inline-flex cursor-default items-center gap-1 rounded-md bg-surface-sunken px-2 py-1 text-meta font-medium text-foreground-muted ring-1 ring-border"
    >
      <CheckIcon className="h-3.5 w-3.5" />
      Added
    </span>
  ) : (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={isPending}
      aria-label={
        isPending ? `Unselect ${method.name}` : `Select ${method.name}`
      }
      className={[
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-meta font-medium transition-colors",
        isPending
          ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300 ring-1 ring-blue-300"
          : "border border-dashed border-border text-foreground-muted hover:bg-surface-sunken",
      ].join(" ")}
    >
      {isPending ? (
        <>
          <CheckIcon className="h-3.5 w-3.5" />
          Selected
        </>
      ) : (
        "Select"
      )}
    </button>
  );

  const badges = (
    <>
      <TypePill method={method} />
      {isCompound &&
        (() => {
          const meta = getMethodTypeMeta("compound");
          return (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-meta font-medium ${meta.color.bg} ${meta.color.text}`}
            >
              Kit
            </span>
          );
        })()}
      {showPublicChip && (
        <span className="shrink-0 rounded-full bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 text-meta font-medium text-green-600 dark:text-green-300">
          Public
        </span>
      )}
      {showSharedChip && (
        <span className="shrink-0 rounded-full bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 text-meta font-medium text-indigo-600 dark:text-indigo-300">
          Shared with me
        </span>
      )}
      {hasForks && (
        <span
          role="button"
          tabIndex={-1}
          aria-expanded={forksOpen}
          aria-label={`${children.length} fork${children.length === 1 ? "" : "s"}, ${forksOpen ? "collapse" : "expand"}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleForks(method);
          }}
          className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 text-meta font-medium text-amber-600 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20"
        >
          <ChevronIcon open={forksOpen} />
          {children.length} fork{children.length === 1 ? "" : "s"}
        </span>
      )}
    </>
  );

  const subtitle = (
    <span>
      {showSharedChip || showPublicChip ? (
        <span className="text-foreground-muted">{ownerLabel}</span>
      ) : null}
      {(showSharedChip || showPublicChip) && excerpt ? (
        <span className="text-foreground-muted"> · </span>
      ) : null}
      <span className="text-foreground-muted">{excerpt}</span>
    </span>
  );

  const footer =
    (method.tags && method.tags.length > 0) ||
    method.last_edited_by ||
    orphanFork ? (
      <div className="flex flex-col gap-1">
        {orphanFork && (
          <span className="text-meta italic text-foreground-muted">
            forked from a method not in this list
          </span>
        )}
        {method.tags && method.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {method.tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-surface-sunken px-1.5 py-0.5 text-meta text-foreground-muted"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
        {method.last_edited_by && (
          <span className="text-meta text-foreground-muted">
            edited by {method.last_edited_by}
            {method.last_edited_at
              ? ` · ${new Date(method.last_edited_at).toLocaleDateString()}`
              : ""}
          </span>
        )}
      </div>
    ) : undefined;

  return (
    <div className={depth > 0 ? "border-l-2 border-amber-100 pl-3" : undefined}>
      <SelectorCard
        ref={(el) => registerRef?.(key, el)}
        data-tour-target={tourTarget}
        aria-label={`${method.name}${
          selectable
            ? isAttached
              ? " (added)"
              : isPending
                ? " (selected)"
                : ""
            : isAttached
              ? " (attached)"
              : ""
        }`}
        title={method.name}
        subtitle={subtitle}
        badges={badges}
        action={selectable ? selectableIndicator : attachAction}
        footer={footer}
        selected={
          selectable
            ? isPending || isHighlighted
            : isAttached || isHighlighted
        }
        dimmed={isAttached}
        tabIndex={tabIndex}
        // In selectable (multi-attach) mode the whole card toggles the pending
        // selection (and still previews via the picker's onToggleSelect, which
        // also sets the highlight). In single-link mode it only highlights, as
        // before. Already-added cards never toggle (add-only picker); we still
        // let them highlight to preview.
        onClick={
          selectable
            ? () => (isAttached ? onHighlight(method) : handleToggle())
            : () => onHighlight(method)
        }
        onMouseEnter={() => onHighlight(method)}
        onKeyDown={onKeyDown}
      />

      {hasForks && forksOpen && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {children.map((child) => (
            <MethodCard
              key={methodKey(child)}
              method={child}
              forkChildren={forkChildren}
              attachedKeys={attachedKeys}
              // Nested fork cards stay in the resting state (no auto-fetch);
              // hovering one makes it active via onHighlight like any card.
              isActive={false}
              isHighlighted={false}
              expandedForks={expandedForks}
              depth={depth + 1}
              // Nested cards enter the tab order only while expanded.
              tabIndex={-1}
              // Forks toggle too in selectable mode, deriving their own pending
              // state from the shared set.
              selectable={selectable}
              pendingKeys={pendingKeys}
              onToggleSelect={onToggleSelect}
              onAttach={onAttach}
              onHighlight={onHighlight}
              onToggleForks={onToggleForks}
              onKeyDown={onKeyDown}
              registerRef={registerRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}
