"use client";

import Link from "@/components/FixtureLink";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/icons";
import Tooltip from "./Tooltip";
import { NavItem, HOME_HREF } from "@/lib/nav";
import { resolveNavLayout, NavLayout } from "@/lib/nav-layout";
import { useAppStore } from "@/lib/store";
import { patchUserSettings } from "@/lib/settings/user-settings";
import { isRecordingMode } from "@/lib/file-system/wiki-capture-mock";
import { useEscapeLayer } from "@/hooks/useEscapeLayer";

/**
 * The slim, drag-customizable global nav (design: docs/mockups/
 * 2026-06-12-nav-drag-customize.html). Renders a thin strip of inline tabs plus
 * a More overflow menu holding the rest. The inline-vs-More split is the user's
 * to set by dragging tabs between the bar and the More tray in an edit mode
 * entered by long-press, right-click, or the More menu's Customize item. There
 * is no persistent Edit button on the bar; a Done pill shows only while editing.
 *
 * Responsive auto-overflow: when the inline set does not fit a narrow window the
 * rightmost inline tabs spill into More for DISPLAY only, never mutating the
 * saved layout.
 */

type Zone = "inline" | "more";

interface DragState {
  href: string;
  fromZone: Zone;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean; // crossed the move threshold
}

const LONGPRESS_MS = 450;
const MOVE_TOL = 6;

export default function AppNavBar({
  navItems,
  pathname,
  tinted,
  currentUser,
  isSuppliesActive,
  layoutOverride,
}: {
  navItems: NavItem[];
  pathname: string | null;
  tinted: boolean;
  currentUser: string | null;
  isSuppliesActive: (item: NavItem) => boolean;
  /** A FIXED inline/More split that overrides the user's saved drag-layout. Set
   *  in the PI lab lens so the PI lineup (People, Lab Work, ...) is always inline
   *  in order, not buried in More by the researcher layout. While set, drag edits
   *  do not persist (they must not clobber the user's researcher layout). */
  layoutOverride?: NavLayout | null;
}) {
  const savedLayout = useAppStore((s) => s.navLayout);
  const setNavLayout = useAppStore((s) => s.setNavLayout);

  // Recording surface (?record=1): flatten the nav so every tab is inline and
  // directly clickable for the demo-video cursor (no collapsed More tray to open
  // first). Computed post-mount to avoid a hydration mismatch; always false for
  // real users, so the live nav is untouched.
  const [recording, setRecording] = useState(false);
  useEffect(() => setRecording(isRecordingMode()), []);

  // The reconciled split (saved layout intersected with the live nav set, or
  // the default split when nothing is saved). This is the SAVED arrangement;
  // responsive overflow is computed on top of it below. In recording mode every
  // item is forced inline so no nav target hides in the More tray.
  const resolved = useMemo(() => {
    // In the PI lab lens, the fixed PI lineup wins over the user's saved
    // researcher drag-layout, so the PI tabs sit inline in order instead of
    // falling into More (new hrefs default to More otherwise).
    const base = resolveNavLayout(navItems, layoutOverride ?? savedLayout);
    if (recording) return { inline: [...base.inline, ...base.more], more: [] };
    return base;
  }, [navItems, savedLayout, layoutOverride, recording]);

  const [editing, setEditing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  // The live drop target while dragging: a zone plus an index within it.
  const [dropTarget, setDropTarget] = useState<{
    zone: Zone;
    index: number;
  } | null>(null);

  // Right-click context menu position (null = closed).
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  // Close the More dropdown on Escape (topmost layer wins; the shared stack
  // ensures only one surface closes per press).
  useEscapeLayer(moreOpen && !editing, () => setMoreOpen(false));

  // How many inline tabs actually fit, for responsive presentational overflow.
  const [visibleInlineCount, setVisibleInlineCount] = useState<number>(
    resolved.inline.length,
  );

  const navRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLElement>>(new Map());
  const moreRowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const moreWrapRef = useRef<HTMLDivElement | null>(null);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- persistence -------------------------------------------------------
  const persist = useCallback(
    (next: NavLayout) => {
      // The lab lens uses a fixed override layout; never persist a drag over the
      // user's own (researcher) saved layout while it is in force.
      if (layoutOverride) return;
      setNavLayout(next);
      if (currentUser) {
        void patchUserSettings(currentUser, { navLayout: next });
      }
    },
    [setNavLayout, currentUser, layoutOverride],
  );

  // The current arrangement as plain href arrays (what we mutate while editing).
  const arrangement = useMemo<NavLayout>(
    () => ({
      inline: resolved.inline.map((i) => i.href),
      more: resolved.more.map((i) => i.href),
    }),
    [resolved],
  );

  // ---- responsive overflow measurement -----------------------------------
  // When NOT editing, measure how many inline tabs fit and spill the rest into
  // More for display. While editing we show every inline tab (no auto-overflow)
  // so the user can drag any of them.
  useLayoutEffect(() => {
    // No responsive spill while editing (drag any tab) or recording (every tab
    // stays inline + clickable for the cursor).
    if (editing || recording) {
      setVisibleInlineCount(resolved.inline.length);
      return;
    }
    const navEl = navRef.current;
    if (!navEl) return;
    const measure = () => {
      const inline = resolved.inline;
      if (inline.length === 0) {
        setVisibleInlineCount(0);
        return;
      }
      // No layout to measure against (SSR/first paint, or jsdom in tests where
      // clientWidth is always 0): show every inline tab rather than collapsing
      // all but Home into More. Real browsers report a real width on the next
      // ResizeObserver tick and the responsive split below takes over.
      if (navEl.clientWidth === 0) {
        setVisibleInlineCount(inline.length);
        return;
      }
      // Available width for the tab strip = the nav element width minus the
      // More button (reserve a fixed allowance so its presence never causes a
      // flip-flop). We sum measured tab widths until we run out of room.
      const moreAllowance = 84;
      const avail = navEl.clientWidth - moreAllowance;
      let used = 0;
      let fit = 0;
      for (const item of inline) {
        const el = tabRefs.current.get(item.href);
        const w = el ? el.getBoundingClientRect().width + 4 : 80;
        if (used + w > avail && fit > 0) break;
        used += w;
        fit += 1;
      }
      // Home (inline[0]) always stays inline.
      setVisibleInlineCount(Math.max(1, Math.min(fit, inline.length)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(navEl);
    return () => ro.disconnect();
  }, [editing, recording, resolved.inline]);

  // The displayed split: while editing, the full saved split. Otherwise, the
  // overflow-aware split (rightmost inline tabs that do not fit move to More).
  const displayInline = editing
    ? resolved.inline
    : resolved.inline.slice(0, visibleInlineCount);
  const overflowedInline = editing
    ? []
    : resolved.inline.slice(visibleInlineCount);
  const displayMore = editing
    ? resolved.more
    : [...overflowedInline, ...resolved.more];

  // ---- edit mode ---------------------------------------------------------
  const enterEdit = useCallback(() => {
    setEditing(true);
    setMoreOpen(true); // the More tray is the Hidden drop zone
    setCtxMenu(null);
  }, []);

  const exitEdit = useCallback(() => {
    setEditing(false);
    setMoreOpen(false);
    setDrag(null);
    setDropTarget(null);
  }, []);

  // Enter and Escape both CONFIRM and exit (no destructive cancel; the
  // arrangement saves live as the user drags). Skip when typing in a field.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        exitEdit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, exitEdit]);

  const resetToDefault = useCallback(() => {
    setNavLayout(null);
    if (currentUser) {
      void patchUserSettings(currentUser, { navLayout: undefined });
    }
  }, [setNavLayout, currentUser]);

  // ---- the move primitive: pull href from its list, insert into target ----
  const moveTab = useCallback(
    (href: string, toZone: Zone, index: number) => {
      const inline = arrangement.inline.filter((h) => h !== href);
      const more = arrangement.more.filter((h) => h !== href);
      const target = toZone === "inline" ? inline : more;
      const i = Math.max(0, Math.min(index, target.length));
      target.splice(i, 0, href);
      // Home is always forced first inline (resolveNavLayout re-enforces this on
      // read, but keep the saved shape clean too).
      persist({ inline, more });
    },
    [arrangement, persist],
  );

  // ---- pointer-based drag (touch-safe; not HTML5 dnd) --------------------
  const onTabPointerDown = useCallback(
    (e: React.PointerEvent, href: string, fromZone: Zone) => {
      if (e.button !== 0) return;
      if (editing) {
        // Begin a drag candidate.
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDrag({
          href,
          fromZone,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          active: false,
        });
        return;
      }
      // Not editing: a long-press on an inline tab enters edit mode.
      if (fromZone !== "inline") return;
      const startX = e.clientX;
      const startY = e.clientY;
      if (lpTimer.current) clearTimeout(lpTimer.current);
      lpTimer.current = setTimeout(() => {
        lpTimer.current = null;
        enterEdit();
      }, LONGPRESS_MS);
      // Cancel the long-press if the pointer moves too far (a scroll/swipe).
      const onMove = (ev: PointerEvent) => {
        if (
          Math.abs(ev.clientX - startX) > MOVE_TOL ||
          Math.abs(ev.clientY - startY) > MOVE_TOL
        ) {
          if (lpTimer.current) {
            clearTimeout(lpTimer.current);
            lpTimer.current = null;
          }
          cleanup();
        }
      };
      const cleanup = () => {
        if (lpTimer.current) {
          clearTimeout(lpTimer.current);
          lpTimer.current = null;
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
    [editing, enterEdit],
  );

  // While a drag is in progress, track the pointer to compute the drop target.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const moved =
        Math.abs(e.clientX - drag.startX) > MOVE_TOL ||
        Math.abs(e.clientY - drag.startY) > MOVE_TOL;
      if (moved && !drag.active) {
        setDrag((d) => (d ? { ...d, active: true } : d));
      }
      // Is the pointer over the More tray?
      const moreEl = moreWrapRef.current;
      if (moreEl) {
        const r = moreEl.getBoundingClientRect();
        if (
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom
        ) {
          // index within the hidden list: before the row under the pointer
          let index = arrangement.more.filter((h) => h !== drag.href).length;
          const rows = [...moreRowRefs.current.entries()];
          for (let i = 0; i < rows.length; i += 1) {
            const [rowHref, rowEl] = rows[i];
            if (rowHref === drag.href) continue;
            const rr = rowEl.getBoundingClientRect();
            if (e.clientY < rr.top + rr.height / 2) {
              index = arrangement.more
                .filter((h) => h !== drag.href)
                .indexOf(rowHref);
              break;
            }
          }
          setDropTarget({ zone: "more", index });
          return;
        }
      }
      // Otherwise compute an inline index from the tab strip.
      const stripHrefs = arrangement.inline.filter((h) => h !== drag.href);
      let index = stripHrefs.length;
      for (let i = 0; i < stripHrefs.length; i += 1) {
        const el = tabRefs.current.get(stripHrefs[i]);
        if (!el) continue;
        const rr = el.getBoundingClientRect();
        if (e.clientX < rr.left + rr.width / 2) {
          index = i;
          break;
        }
      }
      setDropTarget({ zone: "inline", index });
    };
    const onUp = () => {
      if (drag.active && dropTarget) {
        moveTab(drag.href, dropTarget.zone, dropTarget.index);
      }
      setDrag(null);
      setDropTarget(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, dropTarget, arrangement, moveTab]);

  // ---- right-click + outside-click handling ------------------------------
  const onBarContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({
      x: Math.min(e.clientX, window.innerWidth - 180),
      y: Math.min(e.clientY, window.innerHeight - 80),
    });
  }, []);

  useEffect(() => {
    if (!ctxMenu && !moreOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ctxMenu && !t.closest("[data-nav-ctxmenu]")) setCtxMenu(null);
      if (!editing && moreOpen && !t.closest("[data-nav-morewrap]")) {
        setMoreOpen(false);
      }
    };
    window.addEventListener("click", onDocClick);
    return () => window.removeEventListener("click", onDocClick);
  }, [ctxMenu, moreOpen, editing]);

  // ---- styling helpers ---------------------------------------------------
  const tabClass = (item: NavItem, active: boolean): string => {
    if (tinted) {
      return `px-2.5 py-1 text-[13px] rounded-full transition-colors shadow-sm ${
        active
          ? "bg-white text-gray-900 font-medium"
          : "bg-white/75 text-gray-700 hover:bg-white"
      }`;
    }
    return `px-2.5 py-1 text-[13px] rounded-lg transition-colors ${
      active
        ? "bg-accent-soft text-accent font-medium"
        : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
    }`;
  };

  const activeFor = (item: NavItem): boolean =>
    isSuppliesActive(item) || pathname === item.href;

  // ---- render ------------------------------------------------------------
  return (
    <>
      <nav
        ref={navRef}
        className="flex items-center gap-1 flex-1 min-w-0"
        onContextMenu={onBarContextMenu}
        aria-label="Primary"
      >
        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
          {displayInline.map((item, i) => {
            const active = activeFor(item);
            const isDragging = drag?.active && drag.href === item.href;
            const showInsBefore =
              editing &&
              drag?.active &&
              dropTarget?.zone === "inline" &&
              dropTarget.index ===
                arrangement.inline
                  .filter((h) => h !== drag.href)
                  .indexOf(item.href);
            return (
              <span key={item.href} className="flex items-center">
                {showInsBefore ? (
                  <span className="w-0.5 self-stretch my-1 rounded bg-accent" />
                ) : null}
                {editing ? (
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) tabRefs.current.set(item.href, el);
                      else tabRefs.current.delete(item.href);
                    }}
                    data-nav-edit-tab
                    onPointerDown={(e) =>
                      onTabPointerDown(e, item.href, "inline")
                    }
                    className={`px-2.5 py-1 text-[13px] rounded-lg border inline-flex items-center gap-1.5 cursor-grab select-none ${
                      isDragging ? "opacity-40" : ""
                    } ${
                      active
                        ? "border-accent text-accent bg-surface-raised"
                        : "border-border-strong text-foreground bg-surface-raised"
                    } ${
                      drag?.active ? "" : "nav-jiggle"
                    } ${i % 2 === 1 ? "nav-jiggle-b" : ""}`}
                  >
                    <Icon name="more" className="w-3 h-3 opacity-50" />
                    <span>{item.label}</span>
                  </button>
                ) : (
                  <Link
                    href={item.href}
                    ref={(el) => {
                      if (el) tabRefs.current.set(item.href, el as HTMLElement);
                      else tabRefs.current.delete(item.href);
                    }}
                    onPointerDown={(e) =>
                      onTabPointerDown(e, item.href, "inline")
                    }
                    {...(item.newTab
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    className={tabClass(item, active)}
                  >
                    {item.label}
                  </Link>
                )}
              </span>
            );
          })}
          {/* trailing inline drop indicator (append position) */}
          {editing &&
          drag?.active &&
          dropTarget?.zone === "inline" &&
          dropTarget.index ===
            arrangement.inline.filter((h) => h !== drag.href).length ? (
            <span className="w-0.5 self-stretch my-1 rounded bg-accent" />
          ) : null}
        </div>

        {/* More overflow menu */}
        <div className="relative flex-none" data-nav-morewrap>
          {displayMore.length > 0 || editing ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (editing) {
                  setMoreOpen(true);
                  return;
                }
                setMoreOpen((o) => !o);
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[13px] rounded-lg transition-colors ${
                tinted
                  ? "bg-white/75 text-gray-700 hover:bg-white shadow-sm"
                  : moreOpen
                    ? "bg-accent-soft text-accent"
                    : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
              }`}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
            >
              <span>More</span>
              <Icon
                name="chevronDown"
                className={`w-3 h-3 transition-transform ${
                  moreOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          ) : null}

          {moreOpen ? (
            <div
              ref={moreWrapRef}
              data-nav-morewrap
              role="menu"
              className={`absolute top-[calc(100%+7px)] right-0 min-w-[220px] bg-surface-overlay border rounded-xl ros-popover-shadow p-1.5 z-30 ${
                editing
                  ? dropTarget?.zone === "more" && drag?.active
                    ? "border-green-500 outline outline-2 outline-dashed outline-green-500"
                    : "border-accent"
                  : "border-border"
              }`}
            >
              <div className="px-2.5 pt-1.5 pb-2 text-[10.5px] font-extrabold tracking-wider uppercase text-foreground-faint">
                {editing ? "Hidden tabs" : "More"}
              </div>
              {editing ? (
                <div className="px-2.5 pb-1 text-[11px] text-foreground-faint text-center">
                  Drop a tab here to hide it
                </div>
              ) : null}
              {displayMore.length === 0 ? (
                <div className="px-2.5 py-2 text-[12px] text-foreground-faint text-center italic">
                  No hidden tabs
                </div>
              ) : (
                displayMore.map((item) => {
                  const active = activeFor(item);
                  const isDragging = drag?.active && drag.href === item.href;
                  if (editing) {
                    return (
                      <div
                        key={item.href}
                        ref={(el) => {
                          if (el) moreRowRefs.current.set(item.href, el);
                          else moreRowRefs.current.delete(item.href);
                        }}
                        data-nav-edit-tab
                        onPointerDown={(e) =>
                          onTabPointerDown(e, item.href, "more")
                        }
                        className={`flex items-center gap-2 px-2.5 py-2 text-[13px] font-semibold rounded-lg border cursor-grab select-none ${
                          isDragging ? "opacity-40" : ""
                        } ${
                          active
                            ? "text-accent border-border bg-surface-raised"
                            : "text-foreground-muted border-border bg-surface-raised"
                        }`}
                      >
                        <span>{item.label}</span>
                        <Icon
                          name="more"
                          className="w-3 h-3 ml-auto opacity-50"
                        />
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      role="menuitem"
                      {...(item.newTab
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className={`flex items-center gap-2 px-2.5 py-2 text-[13px] font-semibold rounded-lg ${
                        active
                          ? "text-accent bg-accent-soft"
                          : "text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })
              )}
              {!editing ? (
                <>
                  <div className="h-px bg-border my-1.5 mx-1" />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      enterEdit();
                    }}
                    role="menuitem"
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-[13px] font-semibold rounded-lg text-foreground-muted hover:text-accent hover:bg-surface-sunken"
                  >
                    <Icon name="list" className="w-[15px] h-[15px]" />
                    Customize tabs
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Done pill, present only while editing (not a persistent button) */}
        {editing ? (
          <div className="flex items-center gap-1.5 flex-none ml-1">
            <Tooltip label="Reset tabs to the default arrangement" placement="bottom">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  resetToDefault();
                }}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] font-semibold rounded-lg border border-border-strong bg-surface-raised text-foreground-muted hover:border-pin hover:text-pin"
              >
                <Icon name="refresh" className="w-3.5 h-3.5" />
                Reset
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                exitEdit();
              }}
              className="ros-btn-raise inline-flex items-center gap-1 px-3 py-1 text-[12px] font-bold rounded-lg border border-accent bg-accent text-white hover:brightness-110"
            >
              <Icon name="check" className="w-3.5 h-3.5" />
              Done
            </button>
          </div>
        ) : null}
      </nav>

      {/* right-click context menu */}
      {ctxMenu ? (
        <div
          data-nav-ctxmenu
          className="fixed min-w-[160px] bg-surface-overlay border border-border rounded-xl ros-popover-shadow p-1.5 z-[80]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              setCtxMenu(null);
              enterEdit();
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-[12.5px] font-semibold rounded-lg text-foreground hover:bg-surface-sunken"
          >
            <Icon name="list" className="w-[15px] h-[15px] text-foreground-muted" />
            Customize tabs
          </button>
        </div>
      ) : null}
    </>
  );
}
