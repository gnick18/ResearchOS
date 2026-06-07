"use client";

// Shared popup-stack registry that decides which popup, if any, blurs the page
// behind it.
//
// Two rules from Grant (2026-06-06):
//   1. Little popups NEVER blur. A quick confirm, picker, or small dialog just
//      dims the page; it does not demand your full attention.
//   2. Only big, attention-demanding popups (Settings, your profile, an editor)
//      blur. And even then, blur never compounds: if two blurring popups stack,
//      only the bottom-most one blurs so you never see blur-on-blur.
//
// A popup opts into blur by passing `wantsBlur` (LivingPopup exposes this as its
// `blur` prop, default false). The hook returns `shouldBlur`, true only when
// this popup wants blur AND it is the bottom-most blur-wanting popup currently
// open. Little popups pass `wantsBlur=false` and so never blur.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useId } from "react";
import { create } from "zustand";

interface Layer {
  id: string;
  wantsBlur: boolean;
}

interface PopupStackState {
  // Ordered by open time. The first blur-wanting entry is the bottom-most one.
  stack: Layer[];
  push: (layer: Layer) => void;
  remove: (id: string) => void;
}

const usePopupStackStore = create<PopupStackState>((set) => ({
  stack: [],
  push: (layer) =>
    set((s) =>
      s.stack.some((l) => l.id === layer.id)
        ? s
        : { stack: [...s.stack, layer] },
    ),
  remove: (id) => set((s) => ({ stack: s.stack.filter((l) => l.id !== id) })),
}));

/**
 * Register this popup as a layer while `active`, declaring whether it is a big
 * attention-demanding popup that wants to blur (`wantsBlur`). Returns
 * `shouldBlur`, true only when this popup wants blur and is the bottom-most
 * blur-wanting popup open, so little popups never blur and blur never compounds.
 */
export function usePopupLayer(
  active: boolean,
  wantsBlur: boolean,
): { shouldBlur: boolean; shouldDim: boolean } {
  const id = useId();
  const push = usePopupStackStore((s) => s.push);
  const remove = usePopupStackStore((s) => s.remove);

  const shouldBlur = usePopupStackStore((s) => {
    if (!wantsBlur) return false;
    const firstBlur = s.stack.find((l) => l.wantsBlur);
    // Until our own effect registers us, no blur-wanting layer exists yet, so a
    // lone big popup blurs on first paint with no flash.
    return firstBlur ? firstBlur.id === id : true;
  });

  // The page dim (scrim) is owned by the BOTTOM-most popup of ANY kind. A popup
  // stacked on top must not paint its own scrim, or it dims the popup BELOW it
  // (the double-dim Grant hit). So only the first-opened layer dims; everything
  // above floats over it. Before our effect registers, a lone popup dims on
  // first paint with no flash.
  const shouldDim = usePopupStackStore((s) => {
    const bottom = s.stack[0];
    return bottom ? bottom.id === id : true;
  });

  useEffect(() => {
    if (!active) return;
    push({ id, wantsBlur });
    return () => remove(id);
  }, [active, id, wantsBlur, push, remove]);

  return { shouldBlur, shouldDim };
}
