// Shared overlay/Escape stack.
//
// Every dismissible surface (menu, dropdown, dialog, modal) registers with this
// stack while open. A single global keydown listener then closes ONLY the
// topmost registered layer on Escape, so one press closes exactly one layer
// regardless of how many listeners are bound at the window level.
//
// Why a separate registry from popup-stack? popup-stack.ts already handles
// blur/dim coordination for LivingPopup-based modals, and LivingPopup wires the
// Escape+isTop logic internally. This registry handles LIGHTWEIGHT surfaces that
// do NOT live inside a LivingPopup: nav dropdowns, plain menus, and any dialog
// that rolls its own Escape listener outside the LivingPopup/CalmPopupShell
// primitives. It is purely a priority queue, not a visual concern.
//
// Usage (plain hook):
//   useEscapeLayer(isOpen, () => setOpen(false));
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

export type CloseHandler = () => void;

interface OverlayEntry {
  id: number;
  onClose: CloseHandler;
}

let _nextId = 1;
const _stack: OverlayEntry[] = [];
let _listenerAttached = false;

function _handleEscape(e: KeyboardEvent): void {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const top = _stack[_stack.length - 1];
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  top.onClose();
}

function _ensureListener(): void {
  if (_listenerAttached || typeof window === "undefined") return;
  _listenerAttached = true;
  window.addEventListener("keydown", _handleEscape);
}

/**
 * Push a close handler onto the overlay stack. Returns `{ id, pop }` where
 * `pop` removes the entry. The entry stays at the same stack position even if
 * `onClose` is updated later via `updateOverlay`.
 */
export function pushOverlay(onClose: CloseHandler): { id: number; pop: () => void } {
  _ensureListener();
  const id = _nextId++;
  _stack.push({ id, onClose });
  return { id, pop: () => removeOverlay(id) };
}

/**
 * Swap the close handler for an existing entry without moving it in the stack.
 * Safe to call with a stale id (no-op when the entry is gone).
 */
export function updateOverlay(id: number, onClose: CloseHandler): void {
  const entry = _stack.find((e) => e.id === id);
  if (entry) entry.onClose = onClose;
}

/**
 * Remove an entry by id. Idempotent.
 */
export function removeOverlay(id: number): void {
  const idx = _stack.findIndex((e) => e.id === id);
  if (idx !== -1) _stack.splice(idx, 1);
}

/**
 * Current stack depth. Useful for tests and diagnostics.
 */
export function overlayStackDepth(): number {
  return _stack.length;
}

/**
 * Drain the stack completely. TESTS ONLY.
 */
export function _resetOverlayStack(): void {
  _stack.length = 0;
  // Do not detach the listener (harmless to leave, and avoids race in tests).
}

/**
 * Simulate an Escape keydown event against the registry directly, without a
 * DOM. The returned mock event object exposes `defaultPrevented` so tests can
 * verify that the registry marked it handled. TESTS ONLY.
 */
export function _simulateEscape(opts: { alreadyPrevented?: boolean } = {}): {
  defaultPrevented: boolean;
} {
  let _defaultPrevented = opts.alreadyPrevented ?? false;
  const mock = {
    key: "Escape" as const,
    get defaultPrevented() {
      return _defaultPrevented;
    },
    preventDefault() {
      _defaultPrevented = true;
    },
    stopPropagation() {
      // noop in tests
    },
  } satisfies Pick<
    KeyboardEvent,
    "key" | "defaultPrevented" | "preventDefault" | "stopPropagation"
  >;
  _handleEscape(mock as unknown as KeyboardEvent);
  return mock;
}
