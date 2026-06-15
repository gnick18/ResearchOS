"use client";

import { useEffect, useState } from "react";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";

/**
 * Wraps a fixed-width (w-64) left rail (DailyTasksSidebar / CalendarSidebar) and
 * makes it hide-able: a subtle chevron tab on the rail's right edge slides the
 * whole rail off to the left (a negative margin reclaims the space so the main
 * content fills in), and a thin handle at the screen's left edge pulls it back.
 * The collapsed state persists in localStorage so it sticks across reloads.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

const COLLAPSE_KEY = "researchos:sidebar-collapsed";
// w-64 = 16rem. Used as the negative margin that slides the rail out of view.
const RAIL_WIDTH = "16rem";

export default function CollapsibleSidebar({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Defer reading localStorage to an effect so the first server/client render
  // matches (expanded), avoiding a hydration flash; then settle to the stored
  // value without animating that initial settle.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration from a pure localStorage read on mount; deferred to an effect (not lazy init) so SSR/client first render match.
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // localStorage unavailable (private mode edge); stay expanded.
    }
    setHydrated(true);
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // best-effort persistence
      }
      return next;
    });
  };

  return (
    <div className="relative flex flex-shrink-0">
      {/* The rail. Slides left via a negative margin when collapsed, which also
          reclaims its flex space so <main> widens. The transition is suppressed
          until hydration so the stored-state settle on load does not animate. */}
      <div
        className={`h-full ${hydrated ? "transition-[margin-left] duration-300 ease-in-out" : ""}`}
        style={{ marginLeft: collapsed ? `-${RAIL_WIDTH}` : "0" }}
        aria-hidden={collapsed}
      >
        {children}
      </div>

      {/* Hide tab: a subtle chevron on the rail's right edge, shown when open.
          Faint by default, brightens on hover. Vertically centered so it clears
          the rail's own top-right controls. */}
      {!collapsed && (
        <Tooltip label="Hide sidebar">
          <button
            type="button"
            onClick={toggle}
            aria-label="Hide sidebar"
            className="group absolute top-1/2 -translate-y-1/2 -right-3 z-30 flex h-12 w-6 items-center justify-center rounded-r-md border border-l-0 border-border bg-surface-raised text-foreground-muted opacity-40 shadow-sm transition-opacity hover:opacity-100"
          >
            <Icon name="chevronLeft" className="h-3 w-3" />
          </button>
        </Tooltip>
      )}

      {/* Pull-back handle: a thin full-height strip at the screen's left edge
          when collapsed. Widens + brightens on hover and reveals a chevron, so
          it reads as something to pull the rail back out with. */}
      {collapsed && (
        <Tooltip label="Show sidebar">
          <button
            type="button"
            onClick={toggle}
            aria-label="Show sidebar"
            className="group absolute inset-y-0 left-0 z-30 flex w-2 items-center justify-center border-r border-border bg-surface-raised text-foreground-muted transition-[width,background-color] hover:w-5 hover:bg-surface-sunken"
          >
            <Icon
              name="chevronRight"
              className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100"
            />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
