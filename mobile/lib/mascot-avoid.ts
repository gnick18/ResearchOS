/**
 * Mascot avoidance store. A tiny global registry of on-screen "keep-out"
 * rectangles (in window coordinates) that the floating BeakerBot reads to pick a
 * corner it will not cover. The shared Button primitive registers its measured
 * rect here automatically, so the mascot dodges real buttons on any screen with
 * no per-screen wiring.
 *
 * Plain module singleton (no context or provider) so it adds zero tree nesting
 * and only the mascot subscribes. Elements register and unregister imperatively
 * through the useMascotKeepOut hook.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { View } from 'react-native';

export interface KeepOutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const rects = new Map<string, KeepOutRect>();
const listeners = new Set<() => void>();
let version = 0;
let nextId = 0;

function emit() {
  version += 1;
  listeners.forEach((fn) => fn());
}

export function registerKeepOut(id: string, rect: KeepOutRect) {
  const prev = rects.get(id);
  if (
    prev &&
    prev.x === rect.x &&
    prev.y === rect.y &&
    prev.width === rect.width &&
    prev.height === rect.height
  ) {
    return; // unchanged, skip a needless emit + mascot recompute
  }
  rects.set(id, rect);
  emit();
}

export function unregisterKeepOut(id: string) {
  if (rects.delete(id)) emit();
}

export function subscribeKeepOut(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Monotonic version, stable between changes so useSyncExternalStore is happy. */
export function getKeepOutVersion(): number {
  return version;
}

export function getKeepOutRects(): KeepOutRect[] {
  return Array.from(rects.values());
}

/**
 * Attach to any view to register it as a keep-out zone while it is mounted.
 * Spread the returned ref and onLayout onto the element. Re-measures on every
 * layout so the mascot tracks the element's real window position.
 */
export function useMascotKeepOut() {
  const idRef = useRef<string>('');
  if (!idRef.current) idRef.current = `ko-${(nextId += 1)}`;
  const ref = useRef<View | null>(null);

  const onLayout = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    // measureInWindow lands the rect in the same window coordinate space the
    // mascot anchors use. A frame of delay lets layout settle on Android.
    requestAnimationFrame(() => {
      const current = ref.current;
      if (!current) return;
      current.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) {
          registerKeepOut(idRef.current, { x, y, width, height });
        }
      });
    });
  }, []);

  useEffect(() => {
    const id = idRef.current;
    return () => unregisterKeepOut(id);
  }, []);

  return { ref, onLayout };
}
