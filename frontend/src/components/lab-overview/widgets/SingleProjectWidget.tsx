"use client";

import { useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { labApi } from "@/lib/local-api";
import type { ViewerVisibleProject } from "@/lib/local-api";
import UserAvatar from "@/components/UserAvatar";
import Tooltip from "@/components/Tooltip";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { canRead } from "@/lib/sharing/unified";
import type { ExpandedViewProps, SnapshotTileProps, SidebarTileProps } from "./types";
import SidebarStatTile from "./snapshot/SidebarStatTile";

/**
 * Single-Project widget (project-widgets family, project-widgets,
 * 2026-05-29). Mirrors `TraineeNotesWidget`'s single-target pin, but for
 * a PROJECT: pin one project and the SnapshotTile shows its live status as
 * a rich card mirroring the old Home project cards: the project color + name,
 * percent-complete + a progress bar, and an Active / Overdue / Upcoming
 * counts row (Overdue red when > 0) plus the open-task count. Most useful for
 * a PI tracking a specific member's project; a member can pin their own.
 *
 * NAVIGATION (single-project-widget bot, 2026-05-29): a PINNED tile click
 * routes STRAIGHT to the full project page (`projectHref`), not the
 * ExpandedView popup, guarded so it never fires in edit/drag mode. The
 * popup is demoted to the pin-PICKER host: an UNPINNED tile click opens it,
 * and a pinned tile carries a small "Change project" affordance that
 * re-opens it.
 *
 * Per-instance config: `config.pinnedProject = { id, owner }`. Carries the
 * owner because project ids are namespaced per owner. Unset = the widget
 * shows its empty "pick a project" state.
 *
 * PRIVACY CONTRACT:
 *   The pin PICKER lists ONLY projects the viewer can see, via the SAME
 *   `canRead(record, viewer)` gate the Projects Overview widget uses over
 *   `labApi.getProjectsWithProgress` (every record carries its raw
 *   `{ owner, shared_with }`). A project shared with a DIFFERENT user (not
 *   the viewer, viewer not a lab_head) never appears in the picker. The
 *   pinned-project STATUS read runs the identical gate before rendering:
 *   even if a stale config points at a project the viewer can no longer
 *   read, the widget refuses to surface it and falls back to the picker.
 *   So privacy holds in BOTH the picker and the pinned-status view.
 */

const FOLDER_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const PIN_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z" />
  </svg>
);

const OPEN_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

/** "Change project" affordance: a two-way swap arrow. Lets a user re-open
 *  the pin picker for an ALREADY-pinned widget (the pinned-tile body click
 *  now navigates straight to the project, so this is the only re-pin path
 *  from the tile face). */
const SWAP_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

/** Collapse the user-settings AccountType into the unified-sharing Viewer
 *  shape (identical to LabNotesWidget / TraineeNotesWidget). */
function useViewer(): {
  username: string;
  account_type: "lab" | "lab_head";
} | null {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  return useMemo(() => {
    if (!currentUser) return null;
    return {
      username: currentUser,
      account_type:
        accountType === "lab_head" ? ("lab_head" as const) : ("lab" as const),
    };
  }, [currentUser, accountType]);
}

/**
 * The viewer-visible projects (the canRead-gated set), shared by the
 * picker + the pinned-status lookup off one React Query read. SAME query
 * key as ProjectsOverviewWidget so React Query dedupes the read.
 */
function useViewerProjects(): {
  isLoading: boolean;
  projects: ViewerVisibleProject[];
} {
  const viewer = useViewer();

  const { data: all = [], isLoading } = useQuery<ViewerVisibleProject[]>({
    queryKey: ["lab", "projects-with-progress"],
    queryFn: () => labApi.getProjectsWithProgress(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const projects = useMemo(() => {
    if (!viewer) return [];
    // PRIVACY GATE: only projects the viewer can read survive. A project
    // shared with someone else never enters the picker or the lookup.
    return all
      .filter((p) =>
        canRead({ owner: p.owner, shared_with: p.shared_with }, viewer),
      )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, viewer]);

  return { isLoading, projects };
}

function progressPct(p: ViewerVisibleProject): number {
  if (p.taskTotal === 0) return 0;
  return Math.round((p.taskCompleted / p.taskTotal) * 100);
}

function projectHref(p: ViewerVisibleProject, currentUser: string | null): string {
  if (currentUser && p.owner === currentUser) {
    return `/workbench/projects/${p.id}`;
  }
  return `/workbench/projects/${p.id}?owner=${encodeURIComponent(p.owner)}`;
}

/** Find the pinned project in the (canRead-gated) visible set. Returns
 *  undefined if unpinned OR the pin points at a project the viewer can no
 *  longer read. Both cases fall back to the picker / empty state. */
function findPinned(
  projects: ViewerVisibleProject[],
  pin: { id: number; owner: string } | undefined,
): ViewerVisibleProject | undefined {
  if (!pin) return undefined;
  return projects.find((p) => p.id === pin.id && p.owner === pin.owner);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pin picker (rendered in the ExpandedView popup when onConfigChange wired)
// ─────────────────────────────────────────────────────────────────────────────

function PinConfigBar({
  projects,
  pinned,
  onConfigChange,
  config,
}: {
  projects: ViewerVisibleProject[];
  pinned: { id: number; owner: string } | undefined;
  onConfigChange: ExpandedViewProps["onConfigChange"];
  config: ExpandedViewProps["config"];
}) {
  if (!onConfigChange) return null;
  // Value encodes owner + id so the per-owner namespace round-trips.
  const value = pinned ? `${pinned.owner}::${pinned.id}` : "";
  return (
    <div className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
      <span aria-hidden="true" className="text-gray-400 flex-shrink-0">
        {PIN_SVG}
      </span>
      <label
        htmlFor="single-project-pin"
        className="text-xs font-medium text-gray-600 flex-shrink-0"
      >
        Pin project
      </label>
      <select
        id="single-project-pin"
        data-testid="single-project-pin-select"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) {
            onConfigChange({ ...(config ?? {}), pinnedProject: undefined });
            return;
          }
          const [owner, idStr] = v.split("::");
          onConfigChange({
            ...(config ?? {}),
            pinnedProject: { owner, id: Number(idStr) },
          });
        }}
        className="flex-1 min-w-0 text-xs rounded border border-gray-200 bg-white px-2 py-1 text-gray-800"
      >
        <option value="">Pick a project…</option>
        {projects.map((p) => (
          <option key={`${p.owner}::${p.id}`} value={`${p.owner}::${p.id}`}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ExpandedView (popup body)
// ─────────────────────────────────────────────────────────────────────────────

export default function SingleProjectWidget(props?: ExpandedViewProps) {
  const config = props?.config;
  const onConfigChange = props?.onConfigChange;
  const pin = config?.pinnedProject;

  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const profileMap = useLabUserProfileMap();
  const { isLoading, projects } = useViewerProjects();
  const pinned = findPinned(projects, pin);

  const ownerLabel = (owner: string) =>
    profileMap[owner]?.displayName?.trim() || owner;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
        Loading project…
      </div>
    );
  }

  // Empty / unpinned state (or stale pin the viewer can no longer read).
  if (!pinned) {
    return (
      <div className="h-full flex flex-col gap-3 min-h-0">
        <PinConfigBar
          projects={projects}
          pinned={undefined}
          onConfigChange={onConfigChange}
          config={config}
        />
        <p
          className="text-sm text-gray-400 italic m-auto"
          data-testid="single-project-empty"
        >
          {onConfigChange
            ? "Pick a project above to track it here."
            : "No project pinned yet."}
        </p>
      </div>
    );
  }

  const pct = progressPct(pinned);
  const isOther = pinned.owner !== currentUser;

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <PinConfigBar
        projects={projects}
        pinned={pin}
        onConfigChange={onConfigChange}
        config={config}
      />

      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: pinned.color }}
        />
        <span className="flex-1 min-w-0 text-base font-semibold text-gray-900 truncate">
          {pinned.name}
        </span>
        {isOther && (
          <Tooltip label={`Owned by ${ownerLabel(pinned.owner)}`} placement="top">
            <span className="flex-shrink-0">
              <UserAvatar username={pinned.owner} size="sm" />
            </span>
          </Tooltip>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 p-3 flex flex-col gap-3">
        <div>
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>Progress</span>
            <span className="tabular-nums font-medium text-gray-700">{pct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, backgroundColor: pinned.color }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-semibold tabular-nums text-gray-900">
              {pinned.taskIncomplete}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">
              Open
            </div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums text-gray-900">
              {pinned.taskCompleted}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">
              Done
            </div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums text-gray-900">
              {pinned.taskTotal}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">
              Total
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        data-testid="single-project-open"
        onClick={() => router.push(projectHref(pinned, currentUser))}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span aria-hidden="true">{OPEN_SVG}</span>
        Open project
      </button>
    </div>
  );
}

export const ExpandedView = SingleProjectWidget;

export const HELP_TEXT =
  "Tracks a single project at a glance: progress, plus its active, overdue, and upcoming task counts. Click the tile to jump straight to the full project; use Change project to re-pin. Pin any project you can see; a PI can pin a member's project to keep an eye on it. The picker only lists projects shared with you, so it never exposes a project you cannot already read.";

// ─────────────────────────────────────────────────────────────────────────────
// SnapshotTile: a rich, at-a-glance card mirroring the OLD project cards.
//   color dot + name · percent + progress bar · Active / Overdue / Upcoming
//   counts (Overdue red when > 0) + the open-task count.
// A PINNED tile click navigates STRAIGHT to the full project page (the old
// popup, a lone bar + a link, was useless). The picker stays reachable: an
// UNPINNED tile click bubbles to the canvas wrapper (opens the pin-picker
// popup), and a pinned tile gets a small "Change project" affordance that
// re-opens the picker.
// ─────────────────────────────────────────────────────────────────────────────

/** One labelled count in the Active / Overdue / Upcoming row. */
function CountStat({
  label,
  value,
  emphasizeWarn,
}: {
  label: string;
  value: number;
  /** Render in red when > 0 (used for Overdue). */
  emphasizeWarn?: boolean;
}) {
  const warn = emphasizeWarn && value > 0;
  return (
    <div className="min-w-0">
      <div
        className={`text-sm font-semibold tabular-nums leading-tight ${
          warn ? "text-red-600" : "text-gray-900"
        }`}
      >
        {value}
      </div>
      <div
        className={`text-[9px] uppercase tracking-wide leading-tight ${
          warn ? "text-red-400" : "text-gray-400"
        }`}
      >
        {label}
      </div>
    </div>
  );
}

/** Pixel movement between pointerdown and click above which we treat the
 *  gesture as a drag, not a navigation click. Belt-and-suspenders alongside
 *  the edit-mode `draggable` check (the canvas wrapper is `draggable` only
 *  in edit mode). */
const DRAG_SLOP_PX = 6;

export function SnapshotTile(props: SnapshotTileProps) {
  const pin = props.config?.pinnedProject;
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const { isLoading, projects } = useViewerProjects();
  const pinned = findPinned(projects, pin);

  // Drag-guard: remember where the pointer went down so a click that ends
  // far from its start (a drag-reorder gesture) doesn't fire navigation.
  const downAt = useRef<{ x: number; y: number } | null>(null);
  // True only between a real `pointerdown` on this tile and the click it
  // produces. The drag-guard consults this so a SYNTHETIC tour `.click()`
  // (no pointerdown) is never mistaken for a drag off a stale `downAt`.
  const pressed = useRef(false);

  const pct = pinned ? progressPct(pinned) : 0;

  /** Pinned tile body click → open the full project page directly, NOT the
   *  ExpandedView popup. Guards:
   *    1. "Change project" affordance: a click on (or inside) it must reach
   *       the canvas wrapper to open the pin-picker popup, so we bail
   *       WITHOUT stopping propagation.
   *    2. Edit mode: the canvas wrapper is `draggable="true"` only while
   *       editing layout, so we bail and a tile click in edit mode never
   *       navigates.
   *    3. Drag: bail if the pointer moved past the slop threshold (a
   *       reorder drag, not a click).
   *  On a real navigate click we `stopPropagation` so the wrapper's
   *  popup-open handler doesn't also fire (the popup is now the picker, not
   *  the primary destination of a pinned-tile click).
   *
   *  §6.1 tour NAV fix (newproject-modal-tour-fix bot, 2026-05-29): Grant's
   *  hand-verify showed the §6.1 `project-overview-nav` beat — where the
   *  cursor synthetically `.click()`s this tile — "closed right away" instead
   *  of navigating: the SnapshotCanvas wrapper's popup-open handler fired and
   *  the SnapshotTilePopup flashed. Root cause: the synthetic `el.click()`
   *  carries NO preceding `pointerdown`, so `downAt` held STALE coordinates
   *  from a prior real pointerdown on this tile; the drag-guard then read that
   *  stale delta as "moved too far" and bailed BEFORE `stopPropagation` +
   *  `router.push`, letting the click bubble to the wrapper, which opened the
   *  pin-picker popup. Fix: gate the drag-guard on a `pressed` flag that is
   *  only true between a real `pointerdown` and the click it produced. A
   *  synthetic click (pressed === false) can never be mistaken for a drag, so
   *  it always reaches the navigate path. The flag also clears the stale
   *  `downAt` read for real clicks that follow a drag on a sibling tile. */
  const onBodyClick = (e: React.MouseEvent) => {
    if (!pinned) return; // unpinned: let it bubble → wrapper opens the picker
    // Clicks on the change affordance bubble up to the wrapper untouched so
    // the picker opens; we just don't navigate for them.
    if ((e.target as HTMLElement).closest("[data-single-project-change]")) {
      return;
    }
    const editing =
      (e.currentTarget as HTMLElement).closest('[draggable="true"]') !== null;
    if (editing) return; // edit/drag mode: swallow, don't navigate
    // Drag-guard: only treat the gesture as a drag when a REAL pointerdown
    // started it on this tile (pressed.current) AND the pointer moved past the
    // slop threshold. A synthetic tour `.click()` has no pointerdown, so
    // pressed.current is false and it always falls through to navigation
    // rather than being read as a drag off a stale `downAt`.
    const start = downAt.current;
    const wasPressed = pressed.current;
    pressed.current = false; // consume the press for this click
    if (
      wasPressed &&
      start &&
      (Math.abs(e.clientX - start.x) > DRAG_SLOP_PX ||
        Math.abs(e.clientY - start.y) > DRAG_SLOP_PX)
    ) {
      return; // moved too far: this was a drag, not a click
    }
    // Navigate. stopPropagation keeps the SnapshotCanvas wrapper's popup-open
    // onClick from also firing (the popup is the pin-picker, not the primary
    // destination of a pinned-tile click).
    e.stopPropagation();
    router.push(projectHref(pinned, currentUser));
  };

  return (
    <div
      className="relative h-full overflow-hidden flex flex-col"
      onPointerDown={(e) => {
        downAt.current = { x: e.clientX, y: e.clientY };
        pressed.current = true;
      }}
      onClick={onBodyClick}
      // §6.1 tour anchor (dashboard-newproject-tour bot, 2026-05-29): when the
      // tile is pinned, the auto-created Single Project widget for the tour's
      // freshly made project carries a stable per-project tour target on the
      // navigable tile body. The `project-overview-nav` beat re-resolves
      // `[data-tour-target^='home-single-project-open-']` at playback and
      // clicks it; this element's onClick navigates straight to the project
      // page (matching Grant's "click the widget, land on the project" model).
      // Stamped only when pinned so the unpinned/empty tile (which opens the
      // pin picker, not a project) never matches the nav selector.
      data-tour-target={
        pinned ? `home-single-project-open-${pinned.owner}-${pinned.id}` : undefined
      }
    >
      <div className="flex items-center gap-1.5 text-gray-500">
        <span
          aria-hidden="true"
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: pinned ? pinned.color : "#cbd5e1" }}
        />
        <span className="text-[11px] font-semibold text-gray-700 truncate">
          {pinned ? pinned.name : "Project"}
        </span>
        {pinned && (
          <Tooltip label="Change project" placement="top">
            <button
              type="button"
              data-testid="single-project-change"
              data-single-project-change=""
              aria-label="Change project"
              // No handler of its own: the click bubbles up to the canvas
              // wrapper, which opens the pin-picker popup (the same popup the
              // unpinned tile opens). The root's navigate handler skips this
              // click because the target sits inside `data-single-project-
              // change`, so a pinned tile still re-pins via the picker
              // without navigating away.
              className="ml-auto flex-shrink-0 text-gray-300 hover:text-gray-500 transition-colors"
            >
              <span aria-hidden="true">{SWAP_SVG}</span>
            </button>
          </Tooltip>
        )}
      </div>
      <div className="mt-2 flex-1 min-h-0 flex flex-col justify-center gap-2">
        {isLoading ? (
          <p className="text-xs text-gray-400 italic">Loading…</p>
        ) : !pinned ? (
          <p className="text-xs text-gray-400 italic">No project pinned</p>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-semibold tabular-nums text-gray-900">
                {pct}%
              </span>
              <span className="text-xs text-gray-500">complete</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, backgroundColor: pinned.color }}
              />
            </div>
            <div className="grid grid-cols-3 gap-1">
              <CountStat label="Active" value={pinned.taskActive ?? 0} />
              <CountStat
                label="Overdue"
                value={pinned.taskOverdue ?? 0}
                emphasizeWarn
              />
              <CountStat label="Upcoming" value={pinned.taskUpcoming ?? 0} />
            </div>
            <p className="text-[10px] text-gray-400 tabular-nums">
              {pinned.taskIncomplete} task
              {pinned.taskIncomplete === 1 ? "" : "s"} open
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SidebarTile: slim row with the pinned project's progress.
// ─────────────────────────────────────────────────────────────────────────────

export function SidebarTile({ onClick }: SidebarTileProps) {
  // The sidebar surface carries no per-instance config; without a pin the
  // tile reads as a prompt to open + pin a project.
  return (
    <SidebarStatTile
      icon={FOLDER_SVG}
      iconClassName="text-blue-500"
      label="Pinned project"
      stat="—"
      sub="Open to pick a project"
      onClick={onClick}
    />
  );
}
