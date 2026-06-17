import { useEffect, useRef } from "react";
import {
  pushOverlay,
  updateOverlay,
  removeOverlay,
} from "@/lib/ui/overlay-stack";

/**
 * Register a dismissible layer in the shared overlay/Escape stack.
 *
 * While `isOpen` is true, this layer sits in the stack. Pressing Escape fires
 * `onClose` ONLY on the topmost layer, so one press closes exactly one
 * surface even when many listeners coexist at the window level.
 *
 * Coordinate surfaces that live OUTSIDE a LivingPopup (menus, nav dropdowns,
 * and any dialog with a rolled-its-own Escape listener). LivingPopup handles
 * its own Escape via popup-stack; do NOT also call this hook from inside
 * LivingPopup children, or the close will fire twice.
 *
 * @param isOpen  Register only while the surface is open.
 * @param onClose Called when Escape is pressed and this layer is topmost.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
export function useEscapeLayer(isOpen: boolean, onClose: () => void): void {
  // Hold the registration id across renders so we can update the handler in
  // place (keeps stack position) instead of pop+push on every render where
  // onClose changes identity.
  const idRef = useRef<number | null>(null);

  // A ref copy of onClose so the update-in-place inside the first effect can
  // always reach the latest closure without re-running the push/pop effect.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Push when isOpen becomes true; pop on cleanup or when it becomes false.
  useEffect(() => {
    if (!isOpen) return;
    const { id, pop } = pushOverlay(() => onCloseRef.current());
    idRef.current = id;
    return () => {
      pop();
      idRef.current = null;
    };
  }, [isOpen]);

  // Keep the stored handler current when onClose identity changes while open.
  // This runs on every render but is just a ref write + a Map lookup (cheap).
  useEffect(() => {
    if (idRef.current !== null) {
      updateOverlay(idRef.current, () => onCloseRef.current());
    }
  });
}
