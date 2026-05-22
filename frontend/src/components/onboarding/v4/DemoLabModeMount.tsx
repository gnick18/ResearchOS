"use client";

/**
 * §6.16 (Lab Mode redesign 2026-05-22) — DemoLabModeMount.
 *
 * Cross-step host for the `<DemoLabModeViewer>` overlay. The viewer
 * persists across multiple tour sub-steps (lab-mode-warp-to-demo →
 * lab-mode-activity → ... → lab-mode-exit), so it can't live inside a
 * single step body's speech ReactNode (those unmount on step change).
 *
 * Instead, this host:
 *   - Mounts once at the V4 tour root (sibling of TourControllerProvider).
 *   - Listens for `lab-mode-tour:open` / `lab-mode-tour:close` window
 *     events dispatched by the step bodies.
 *   - Portals the viewer to `document.body` when open so it sits above
 *     every product surface (the live `/lab` route, AppShell, modals,
 *     anything else).
 *
 * Append-only contract: this file is new — does NOT modify the
 * TourController. The mount JSX is added at the end of V4MountForUser
 * so the existing TourController graph is untouched.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import DemoLabModeViewer from "./DemoLabModeViewer";

export const DEMO_LAB_MODE_EVENTS = {
  open: "lab-mode-tour:open",
  close: "lab-mode-tour:close",
} as const;

/** Dispatch on the window to open the demo viewer overlay. Idempotent —
 *  a second dispatch while the viewer is open is a no-op. Safe to call
 *  from inside a step body's onEnter / useEffect. */
export function openDemoLabModeViewer(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DEMO_LAB_MODE_EVENTS.open));
}

/** Dispatch on the window to close the demo viewer overlay. Idempotent —
 *  a second dispatch while the viewer is closed is a no-op. */
export function closeDemoLabModeViewer(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DEMO_LAB_MODE_EVENTS.close));
}

/**
 * Host that portals the viewer to document.body when open.
 *
 * Renders nothing while closed. Listens on window events for
 * open / close signals; also wires the viewer's own onExit to the
 * close-event dispatch so the exit button + Escape key drive the
 * same path the lab-mode-exit step body uses.
 */
export default function DemoLabModeMount() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Guard SSR: only call createPortal after the first client render so
  // the document handle is real. Same gate `InputLockOverlay` /
  // `TourPageLock` use.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => setOpen(true);
    const onClose = () => setOpen(false);
    window.addEventListener(DEMO_LAB_MODE_EVENTS.open, onOpen);
    window.addEventListener(DEMO_LAB_MODE_EVENTS.close, onClose);
    return () => {
      window.removeEventListener(DEMO_LAB_MODE_EVENTS.open, onOpen);
      window.removeEventListener(DEMO_LAB_MODE_EVENTS.close, onClose);
    };
  }, []);

  if (!mounted || !open) return null;
  return createPortal(
    <DemoLabModeViewer
      onExit={() => {
        // Dispatch the close event rather than calling setOpen
        // directly. That way any other listener (a step body's
        // onExit, a future analytics tag) sees the close too.
        closeDemoLabModeViewer();
      }}
    />,
    document.body,
  );
}
