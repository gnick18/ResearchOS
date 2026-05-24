"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * popup-close hook (popup-close hook manager, 2026-05-24):
 * lets a widget body close the SnapshotTilePopup that owns it BEFORE
 * navigating to a different route.
 *
 * The problem this solves: SnapshotTilePopup is mounted by the parent
 * surface (SnapshotCanvas, CustomizableSidebar, SidebarWidgetRail,
 * ToolsLauncher) and the parent owns the open/close state. The child
 * ExpandedView body has no way to close itself, so a plain `<Link>`
 * inside the body fires the navigation while the popup stays mounted.
 * The user navigates, hits back, and finds the popup still on top of
 * the underlying page. Mild jank, flagged by several Phase B chips
 * (RecentActivityWidget "View full activity", PiActionsWidget rows,
 * LabPurchasesWidget "+N more on /purchases", etc.).
 *
 * Shape: a React context that exposes `closePopup()`. SnapshotTilePopup
 * wraps its `children` slot in `<PopupActionsProvider closePopup={onClose}>`,
 * so every consumer mounted inside a popup automatically receives a
 * working closer. Bodies rendered OUTSIDE a popup (e.g. the inline
 * canvas tile body before any popup opens) get the no-op default, so
 * `closePopup()` is always safe to call without a wrapper check.
 *
 * Usage:
 *   const { closePopup } = usePopupActions();
 *   <Link href="/calendar" onClick={() => closePopup()}>
 *     Open full calendar
 *   </Link>
 */

interface PopupActions {
  /** Close the popup that owns this subtree. No-op when called outside
   *  a popup (i.e. when no `PopupActionsProvider` is an ancestor). */
  closePopup: () => void;
}

const NOOP_ACTIONS: PopupActions = {
  closePopup: () => {},
};

const PopupActionsContext = createContext<PopupActions>(NOOP_ACTIONS);

export function PopupActionsProvider({
  closePopup,
  children,
}: {
  closePopup: () => void;
  children: ReactNode;
}) {
  return (
    <PopupActionsContext.Provider value={{ closePopup }}>
      {children}
    </PopupActionsContext.Provider>
  );
}

export function usePopupActions(): PopupActions {
  return useContext(PopupActionsContext);
}
