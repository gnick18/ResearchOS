"use client";

// Shared popup-stack registry so blur never compounds when one popup opens on
// top of another (Grant 2026-06-06: "the layers of blur looked terrible. Not
// EVERYTHING needs a blur").
//
// The rule: only the BOTTOM-most open popup blurs the page behind it. Every
// popup stacked on top of it dims (so the lower layer recedes) but does NOT
// add its own backdrop-blur, so you never see blur-on-blur.
//
// Any popup, whether it is a LivingPopup or a bespoke fixed-overlay modal,
// opts in with one call: `const { isBottom } = usePopupLayer(isOpen)` and then
// applies its blur class only when `isBottom`. LivingPopup does this for every
// migrated popup automatically; a handful of not-yet-migrated modals that can
// stack (the sharing / identity popups) call it directly.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useId } from "react";
import { create } from "zustand";

interface PopupStackState {
  // Ordered by open time. stack[0] is the bottom-most (first opened) popup.
  stack: string[];
  push: (id: string) => void;
  remove: (id: string) => void;
}

const usePopupStackStore = create<PopupStackState>((set) => ({
  stack: [],
  push: (id) =>
    set((s) => (s.stack.includes(id) ? s : { stack: [...s.stack, id] })),
  remove: (id) => set((s) => ({ stack: s.stack.filter((x) => x !== id) })),
}));

/**
 * Register this popup as a layer while `active`, and learn whether it is the
 * bottom-most open popup. Only the bottom-most layer should apply a
 * backdrop-blur; stacked layers dim without re-blurring so blur never
 * compounds. Safe to call unconditionally (pass the popup's open/mounted flag).
 */
export function usePopupLayer(active: boolean): { isBottom: boolean } {
  const id = useId();
  const push = usePopupStackStore((s) => s.push);
  const remove = usePopupStackStore((s) => s.remove);
  // The bottom-most layer is the first one that opened. While nothing is
  // registered yet (the effect below has not run) treat ourselves as bottom so
  // a lone popup blurs on its very first paint with no flash.
  const isBottom = usePopupStackStore(
    (s) => s.stack.length === 0 || s.stack[0] === id,
  );

  useEffect(() => {
    if (!active) return;
    push(id);
    return () => remove(id);
  }, [active, id, push, remove]);

  return { isBottom };
}
