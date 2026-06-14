"use client";

// CalmPopupShell: the ONE shared chrome primitive every object detail popup
// inherits (UNIFIED_POPUP_CHROME_SPEC.md §4). It wraps LivingPopup (which owns
// the scrim / zoom / card / focus-trap) and adds the canonical "calm header
// anatomy" as slots so no popup hand-rolls its own header / tabs / footer /
// expand machinery any more:
//
//   header   = transparent .s-head: title + one .s-meta subline + a right
//              action cluster of AT MOST three ghost glyphs (an optional "..."
//              overflow, the Focus toggle, and Close).
//   tabs     = optional quiet .s-tabs row (multi-view objects only; omit -> no row)
//   footer   = transparent .s-foot: the ambient autosave line (left) + an
//              optional word/item count + a plain Done (right).
//   pill     = optional floating centered editing pill (fullscreen editor types)
//   rail     = optional fullscreen-only insert rail slot
//   children = the body, rendered on .s-scroll. A render-prop so the body can
//              read `isExpanded` (the editor tabs thread it down as `expanded`).
//
// The shell OWNS (lifted out of TaskDetailPopup + NoteDetailPopup so the logic
// lives once, per spec §4 / §6 step 1):
//   - `isExpanded` state + the `.ros-calm-surface` class applied at BOTH docked
//     and fullscreen (decision D1: calm at every size, no header band / divider).
//   - the Focus (⤢) toggle button and its flush-before-grow hook.
//   - the Escape state machine: the host passes ordered `escapeLayers` (e.g.
//     close history, then comments) that get a chance to consume Escape first;
//     then Escape shrinks a fullscreen shell; then it closes. Mirrors the
//     hand-rolled precedence the two popups used to each carry.
//   - the plain Done exit, so Done / the Focus collapse / the X are always three
//     reachable exits (no soft-lock, [[feedback_no_soft_locks]]).
//
// Cmd/Ctrl+Shift+F is NOT bound here: the editor (LiveMarkdownEditor) already
// owns that shortcut and routes it through its `onRequestExpand` prop, which the
// host wires to this shell's `onToggleExpand` (exposed via the render prop). So
// the shortcut keeps working without this shell re-binding it.
//
// Voice: no em-dashes, no emojis in copy, no mid-sentence colons. Icons come
// from the verified registry (the icon-guard test blocks new inline SVGs).

import { useCallback, useEffect, useRef, useState } from "react";

import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import LivingPopup from "@/components/ui/LivingPopup";
import type { OpenOrigin } from "@/lib/ui/create-popup-store";

/** The honest ambient save state the footer renders. `null` = the active body
 *  reports no save state (e.g. a read-only tab), so the footer shows no claim. */
export type CalmSaveState = "saving" | "unsaved" | "saved" | null;

export interface CalmPopupTab {
  /** Stable key compared against `activeTab`. */
  key: string;
  /** Visible label. */
  label: string;
  /** Optional data-tour-target / data-testid passthrough for automation. */
  tourTarget?: string;
  testId?: string;
}

export interface CalmPopupFooter {
  /** Honest ambient save state (lifted from the active editor body). */
  saveState?: CalmSaveState;
  /** Optional data-testid on the ambient save indicator (automation parity). */
  saveTestId?: string;
  /** Right-aligned Done button label. Omit `onDone` to hide the button. */
  doneLabel?: string;
  onDone?: () => void;
  /** Optional data-testid on the Done button (automation parity). */
  doneTestId?: string;
  /** Optional right-aligned count (e.g. "412 words"). */
  count?: React.ReactNode;
  /** Optional extra left-side ambient content (rare; most callers omit). */
  ambientExtra?: React.ReactNode;
}

export interface CalmPopupShellProps {
  open: boolean;
  onClose: () => void;
  /** Accessible label for the dialog. */
  label: string;
  /** Open point for LivingPopup's zoom. */
  origin?: OpenOrigin | null;

  // ── header slots ──────────────────────────────────────────────────────────
  /** .s-title content (left). Usually a heading or an inline-editable title. */
  title: React.ReactNode;
  /** .s-meta single subline (caller composes "date · author · status · tail"). */
  meta?: React.ReactNode;
  /** Optional leading header content rendered ABOVE the actions (PI buttons,
   *  badges) — kept as a slot so task-specific role affordances survive. */
  headerLead?: React.ReactNode;
  /** The single "..." overflow menu element (already built by the caller from
   *  HeaderOverflowMenu so each row keeps its exact handler + testid). The shell
   *  just places it first in the right cluster. Omit -> no overflow glyph. */
  overflow?: React.ReactNode;

  // ── tabs (optional) ─────────────────────────────────────────────────────────
  /** Omit -> no tab row (single-view objects). */
  tabs?: CalmPopupTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /** Optional data-tour-target on the tablist container. */
  tabsTourTarget?: string;

  // ── expand (Focus) ──────────────────────────────────────────────────────────
  /** Show the ⤢ Focus toggle. The shell owns `isExpanded`. Default true. */
  expandable?: boolean;
  /** Called AFTER the active editor buffer should be flushed, BEFORE the size
   *  grows. The host returns a promise that flushes its in-flight buffer so no
   *  text is lost across the transition. The shell awaits it then toggles. */
  onBeforeToggleExpand?: () => void | Promise<void>;
  /** Mirror the shell's expand state back to the host (the host threads it into
   *  its editor tabs as `expanded`). Fires on every change. */
  onExpandedChange?: (expanded: boolean) => void;
  /** The shell populates this ref (in an effect) with its flush-then-toggle
   *  expand function, so the host can wire LiveMarkdownEditor's onRequestExpand
   *  to `expandToggleRef.current()`. Lets the editor's Focus button + the
   *  Cmd/Ctrl+Shift+F shortcut drive the shell's expand. */
  expandToggleRef?: React.MutableRefObject<() => void>;
  /** data-tour-target on the Focus glyph (automation parity). */
  focusTourTarget?: string;
  /** data-tour-target on the Close glyph (automation parity). */
  closeTourTarget?: string;

  // ── escape precedence ───────────────────────────────────────────────────────
  /** Ordered intermediate Escape consumers (e.g. close history, then comments).
   *  Each returns true if it handled the press. Tried in order BEFORE the shell
   *  shrinks-a-fullscreen / closes. Lets the host keep its rail-close precedence
   *  while the shell owns the rest of the state machine. */
  escapeLayers?: Array<() => boolean>;

  // ── footer ──────────────────────────────────────────────────────────────────
  footer?: CalmPopupFooter;

  // ── optional editor chrome ──────────────────────────────────────────────────
  /** Floating centered editing pill (fullscreen only; the host composes it). */
  floatingPill?: React.ReactNode;
  /** Insert rail (fullscreen gutter; the host composes it). */
  insertRail?: React.ReactNode;

  // ── card knobs ──────────────────────────────────────────────────────────────
  /** Slim color band along the top edge (project accent). */
  accentColor?: string | null;
  /** Docked card max-width Tailwind class. Default max-w-5xl. */
  dockedWidthClassName?: string;
  /** Extra classes on the card. */
  cardClassName?: string;
  /** Forwarded to the card so LiveMarkdownEditor can find the drag-ring target. */
  dragRingTarget?: boolean;
  /** Drag handlers on the card (universal file drop). */
  onCardDragOver?: React.DragEventHandler;
  onCardDrop?: React.DragEventHandler;
  /** Content rendered between the header and the tab row (flag banners, restore
   *  errors) — stays out of the scroll body so it is always visible. */
  beforeBody?: React.ReactNode;

  /** The body, rendered on .s-scroll. The host reads the shell's expand state
   *  through `onExpandedChange` (mirror) and drives expand through
   *  `expandToggleRef`, so the body needs no render-prop context. */
  children: React.ReactNode;
}

export default function CalmPopupShell({
  open,
  onClose,
  label,
  origin = null,
  title,
  meta,
  headerLead,
  overflow,
  tabs,
  activeTab,
  onTabChange,
  tabsTourTarget,
  expandable = true,
  onBeforeToggleExpand,
  onExpandedChange,
  expandToggleRef,
  focusTourTarget,
  closeTourTarget,
  escapeLayers,
  footer,
  floatingPill,
  insertRail,
  accentColor,
  dockedWidthClassName = "max-w-5xl",
  cardClassName,
  dragRingTarget,
  onCardDragOver,
  onCardDrop,
  beforeBody,
  children,
}: CalmPopupShellProps) {
  // ── lifted expand state (was copy-pasted in both popups) ───────────────────
  const [isExpanded, setIsExpanded] = useState(false);

  // "Latest value" refs so the long-lived event listener / async toggles read
  // current props/state without re-binding. Assigned in an effect (not during
  // render) to satisfy react-hooks/refs; the listener and toggles only fire from
  // user gestures, which always happen after the commit that set these refs.
  const onExpandedChangeRef = useRef(onExpandedChange);
  const onBeforeToggleRef = useRef(onBeforeToggleExpand);
  const escapeLayersRef = useRef(escapeLayers);
  const isExpandedRef = useRef(isExpanded);
  const onCloseRef = useRef(onClose);
  const footerOnDoneRef = useRef(footer?.onDone);
  useEffect(() => {
    onExpandedChangeRef.current = onExpandedChange;
    onBeforeToggleRef.current = onBeforeToggleExpand;
    escapeLayersRef.current = escapeLayers;
    isExpandedRef.current = isExpanded;
    onCloseRef.current = onClose;
    footerOnDoneRef.current = footer?.onDone;
  });

  useEffect(() => {
    onExpandedChangeRef.current?.(isExpanded);
  }, [isExpanded]);

  const toggleExpand = useCallback(() => {
    void (async () => {
      try {
        await onBeforeToggleRef.current?.();
      } catch {
        // Best-effort flush; draft persistence still holds the unsaved text.
      }
      setIsExpanded((prev) => !prev);
    })();
  }, []);

  // Publish the toggle to the host's ref (in an effect, never during render) so
  // the editor's Focus button + Cmd/Ctrl+Shift+F can call it. `toggleExpand` is
  // stable (empty-dep useCallback), so this runs once on mount.
  useEffect(() => {
    if (expandToggleRef) expandToggleRef.current = toggleExpand;
  }, [expandToggleRef, toggleExpand]);

  const handleDone = useCallback(() => {
    void (async () => {
      try {
        await onBeforeToggleRef.current?.();
      } catch {
        // Best-effort flush.
      }
      footerOnDoneRef.current?.();
      setIsExpanded(false);
    })();
  }, []);

  // ── lifted Escape state machine ────────────────────────────────────────────
  // Precedence: a focused text input owns Escape (drop edit, don't close); then
  // the host's intermediate layers (history, comments); then shrink a fullscreen
  // shell; then close. Mirrors the per-popup handlers we removed. LivingPopup's
  // own Escape is opted out by the host (closeOnEscape={false}) so this is the
  // single owner.
  useEffect(() => {
    if (!open) return;
    const isTextInputEl = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (el as HTMLElement).isContentEditable === true
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const active = typeof document !== "undefined" ? document.activeElement : null;
      if (isTextInputEl(active)) {
        // Let the field own the Escape (blur / drop edit). Not marked handled.
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      // Intermediate layers first (close history, then comments, ...).
      for (const layer of escapeLayersRef.current ?? []) {
        if (layer()) return;
      }
      if (isExpandedRef.current) {
        setIsExpanded(false);
        return;
      }
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The whole popup card carries `.ros-calm-surface` at BOTH sizes (D1): the
  // transparent header / tabs / footer read as one continuous paper (light) /
  // dark-room (dark) surface, never a banded card.
  const cardClass = [
    "ros-calm-surface pointer-events-auto rounded-2xl shadow-2xl w-full mx-4 flex flex-col transition-all duration-300 overflow-hidden",
    isExpanded
      ? "inset-4 max-w-none max-h-none h-[calc(100vh-2rem)]"
      : `${dockedWidthClassName} h-[90vh] max-h-[860px]`,
    cardClassName ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const saveState = footer?.saveState ?? null;

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label={label}
      blur
      card={false}
      selfSize
      // The shell owns Escape precedence + its own header close, so opt out of
      // LivingPopup's built-in Escape + corner X.
      closeOnEscape={false}
      showClose={false}
      origin={origin}
    >
      <div
        className={cardClass}
        style={{
          boxShadow:
            "0 1px 3px rgba(0,0,0,0.06), 0 20px 50px -10px rgba(0,0,0,0.25)",
        }}
        data-drag-ring-target={dragRingTarget ? "" : undefined}
        onClick={(e) => e.stopPropagation()}
        onDragOver={onCardDragOver}
        onDrop={onCardDrop}
      >
        {/* Slim project-accent band along the top edge (quiet identifier). */}
        {accentColor && (
          <div
            aria-hidden
            className="h-1 w-full flex-shrink-0"
            style={{ backgroundColor: accentColor }}
          />
        )}

        {/* Floating centered editing pill (fullscreen editor types). */}
        {floatingPill}

        {/* Header — transparent at every size (C1/D1): no bg band, no divider. */}
        <div className="s-head flex items-start justify-between gap-4 px-6 py-4 flex-wrap flex-shrink-0">
          <div className="s-titlewrap flex items-start min-w-0 flex-1">
            <div className="min-w-0 flex-1">
              <div
                className={`s-title font-extrabold text-foreground leading-tight ${
                  isExpanded ? "text-3xl" : "text-2xl"
                }`}
              >
                {title}
              </div>
              {meta != null && (
                <div className="s-meta mt-1 text-meta text-foreground-muted">
                  {meta}
                </div>
              )}
            </div>
          </div>

          {/* Right cluster: optional lead (role affordances) + the AT-MOST-three
              ghost glyphs (overflow, Focus, Close). Everything else demoted. */}
          <div className="s-acts flex items-center gap-1 flex-wrap justify-end">
            {headerLead}
            {overflow}
            {expandable && (
              <Tooltip label={isExpanded ? "Exit focus" : "Focus"} placement="bottom">
                <button
                  type="button"
                  onClick={() => toggleExpand()}
                  data-tour-target={focusTourTarget}
                  aria-label={isExpanded ? "Exit focus" : "Focus"}
                  aria-pressed={isExpanded}
                  className="iconbtn text-foreground-muted hover:text-brand-action hover:bg-surface-sunken p-1.5 rounded-lg transition-colors"
                >
                  <Icon name="focus" className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
            <Tooltip label="Close (Esc)" placement="bottom">
              <button
                type="button"
                onClick={onClose}
                data-tour-target={closeTourTarget}
                aria-label="Close"
                className="iconbtn text-foreground-muted hover:text-brand-action hover:bg-surface-sunken p-1.5 rounded-lg transition-colors"
              >
                <Icon name="x" className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Always-visible band between header and body (flag banners, errors). */}
        {beforeBody}

        {/* Tab row — quiet, transparent, present only for multi-view objects. */}
        {tabs && tabs.length > 0 && (
          <div
            className="s-tabs flex items-stretch gap-1 px-6 flex-shrink-0"
            data-tour-target={tabsTourTarget}
            role="tablist"
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onTabChange?.(tab.key)}
                  data-tour-target={tab.tourTarget}
                  data-testid={tab.testId}
                  className={`relative px-3.5 py-3 text-body font-medium transition-colors -mb-px ${
                    isActive
                      ? "text-blue-600 dark:text-blue-300"
                      : "text-foreground-muted hover:text-foreground"
                  }`}
                >
                  {tab.label}
                  <span
                    aria-hidden
                    className={`absolute left-2 right-2 -bottom-px h-1 rounded-t-full transition-colors ${
                      isActive ? "bg-blue-500" : "bg-transparent"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        )}

        {/* Body. Render-prop so the editor tabs can read `expanded`. */}
        <div className="s-scroll flex-1 overflow-hidden flex flex-col min-h-0">
          {children}
        </div>

        {/* Insert rail (fullscreen gutter; host-composed). */}
        {insertRail}

        {/* Footer — transparent ambient autosave line + count + Done (C2). */}
        {footer && (
          <div className="s-foot flex items-center gap-2 px-6 py-3 flex-shrink-0 text-meta text-foreground-muted">
            {saveState && (
              <span
                data-testid={footer.saveTestId}
                aria-live="polite"
                aria-atomic="true"
                className={`inline-flex items-center gap-1.5 font-medium ${
                  saveState === "unsaved"
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-foreground-muted"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${
                    saveState === "saving"
                      ? "bg-amber-400 animate-pulse"
                      : saveState === "unsaved"
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                />
                {saveState === "saving"
                  ? "Saving..."
                  : saveState === "unsaved"
                    ? "Unsaved changes"
                    : "Saved"}
              </span>
            )}
            {footer.ambientExtra}
            {(footer.count != null || footer.onDone) && (
              <span className="ml-auto inline-flex items-center gap-3">
                {footer.count != null && (
                  <span className="tabular-nums">{footer.count}</span>
                )}
                {footer.onDone && (
                  <button
                    type="button"
                    data-testid={footer.doneTestId}
                    onClick={handleDone}
                    className="px-3 py-1.5 text-meta font-medium rounded-lg bg-surface-sunken text-foreground hover:bg-foreground-muted/15 transition-colors"
                  >
                    {footer.doneLabel ?? "Done"}
                  </button>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </LivingPopup>
  );
}
