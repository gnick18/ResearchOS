import { useEffect } from "react";

/**
 * Close a dialog / popup / drawer when the user presses Escape.
 *
 * Every dismissible overlay in the app should call this so Escape works
 * everywhere, uniformly. It binds a window-level keydown listener (only while
 * `enabled`) and calls `onClose` on Escape.
 *
 * NESTING: the handler bails when `event.defaultPrevented` is already set, and
 * calls `preventDefault()` when it acts. React runs child effects before parent
 * effects, so a nested (inner) dialog's listener registers and fires first,
 * marks the event handled, and the outer dialog's listener then bails. The net
 * effect is that Escape closes the innermost open layer first, one layer per
 * press, which is the expected modal behavior.
 *
 * @param onClose  Called when Escape is pressed while enabled.
 * @param enabled  Bind only when the overlay is actually open. Defaults to true
 *                 (for components that conditionally render and unmount instead
 *                 of toggling an `open` prop).
 */
export function useEscapeToClose(onClose: () => void, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onClose]);
}
