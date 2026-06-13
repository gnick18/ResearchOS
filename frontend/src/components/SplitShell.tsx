"use client";

// The shared left-rail / main-pane SPLIT SHELL used by every data-heavy page
// (Sequences, Chemistry, Data Hub, Tree Studio). One implementation of the
// resizable divider + collapse-to-focus + width-persisted-across-reloads so a
// tweak (min width, nudge step, the divider look) lands everywhere at once
// instead of drifting across four hand-copied versions.
//
// The clamp math lives in lib/sequences/split-layout (kept dependency-free for
// its unit tests); this wraps it in the React state + handlers + chrome.
//
// Persistence writes ONLY on a real resize (drag end + keyboard nudge), never as
// a [width] effect: a mount-time [width] effect writes the default over the
// just-restored value before the restore's setState propagates (React 18
// StrictMode double-invokes mount effects with no re-render between), so the
// saved width never survives a reload. This is the bug the Sequences page
// already avoided; folding the other three onto this hook fixes it for them too.

import { useCallback, useEffect, useRef, useState } from "react";

import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import {
  clampListWidth,
  DEFAULT_LIST_WIDTH,
  LIST_MIN_WIDTH,
  LIST_MAX_WIDTH,
} from "@/lib/sequences/split-layout";

export interface SplitShell {
  /** Ref for the split CONTAINER (the flex row holding rail + divider + main).
   *  The clamp reads its live width so neither pane collapses on drag. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Current rail width in px. */
  width: number;
  /** Whether the rail is collapsed to focus the main pane. */
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  /** Spread onto the divider element (SplitDivider does this for you). */
  dividerHandlers: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  };
}

/** The resizable + collapsible left-rail shell, keyed to a per-page localStorage
 *  width key (e.g. "researchos:phylo:listWidth"). */
export function useSplitShell(storageKey: string): SplitShell {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(DEFAULT_LIST_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const draggingRef = useRef(false);
  // The latest clamped width during an active drag, persisted on drag end.
  const dragWidthRef = useRef<number | null>(null);

  // Restore the persisted width on mount, re-clamped against the live container
  // so a value saved on a wide window does not overflow a narrow one.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? Number.parseFloat(raw) : NaN;
    const container = containerRef.current?.getBoundingClientRect().width ?? 0;
    if (Number.isFinite(parsed)) setWidth(clampListWidth(parsed, container));
  }, [storageKey]);

  const persist = useCallback(
    (w: number) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, String(Math.round(w)));
      } catch {
        /* private mode / quota — non-fatal, the width just will not persist */
      }
    },
    [storageKey],
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (!containerRef.current) return;
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = clampListWidth(e.clientX - rect.left, rect.width);
    dragWidthRef.current = next;
    setWidth(next);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (dragWidthRef.current != null) {
        persist(dragWidthRef.current);
        dragWidthRef.current = null;
      }
    },
    [persist],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.shiftKey ? 48 : 16;
      const w = containerRef.current?.getBoundingClientRect().width ?? 0;
      setWidth((cur) => {
        const next = clampListWidth(
          cur + (e.key === "ArrowLeft" ? -step : step),
          w,
        );
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // Restore the page cursor / selection if unmounted mid-drag (navigation away
  // while dragging) rather than leaking them onto the next page.
  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        draggingRef.current = false;
      }
    };
  }, []);

  return {
    containerRef,
    width,
    collapsed,
    setCollapsed,
    dividerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
    },
  };
}

/** The drag handle between the rail and the main pane. Renders nothing when the
 *  rail is collapsed (there is no rail to resize). */
export function SplitDivider({
  shell,
  label = "Resize the list",
}: {
  shell: SplitShell;
  label?: string;
}) {
  if (shell.collapsed) return null;
  return (
    <Tooltip label="Drag to resize (or use arrow keys)">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={Math.round(shell.width)}
        aria-valuemin={LIST_MIN_WIDTH}
        aria-valuemax={LIST_MAX_WIDTH}
        tabIndex={0}
        {...shell.dividerHandlers}
        className="group relative mx-1 flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center focus:outline-none"
      >
        <span className="h-12 w-1 rounded-full bg-border transition-colors group-hover:bg-brand-action group-focus:bg-brand-action" />
      </div>
    </Tooltip>
  );
}

/** The pill that re-opens a collapsed rail, shown in the rail's place. */
export function RailReopenButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="mr-2 mt-1 flex h-9 w-7 shrink-0 items-center justify-center self-start rounded-md border border-border bg-surface-raised text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
      >
        <Icon name="chevronRight" className="h-4 w-4" />
      </button>
    </Tooltip>
  );
}
