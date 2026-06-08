"use client";

// Supplies v2 (SUPPLIES_V2_UNIFIED.md), chunk 4: the draft-order cart.
//
// Decision 2 keeps the order/cart batch: "Reorder" does not commit a purchase
// immediately, it adds a line to a DRAFT order. This context holds that draft
// in page-local state so the list rows, the detail panel, and the header cart
// chip all read and mutate one batch. Submit (in ReorderCartReview) turns the
// batch into one purchase task with one funding context.
//
// In-memory only for now (lean, per the brief); it lives for the life of the
// /supplies page mount. House style: no emojis / em-dashes / mid-sentence
// colons.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SupplyReorderSeed } from "@/lib/supplies/reorder";

export interface CartLine {
  /** The supply key (stable across owners), the dedup identity for the cart. */
  key: string;
  seed: SupplyReorderSeed;
}

interface ReorderCartValue {
  lines: CartLine[];
  count: number;
  has: (key: string) => boolean;
  /** Add a line. If the key is already in the cart this is a no-op so a double
   *  tap does not duplicate or silently change the prefilled quantity. */
  add: (key: string, seed: SupplyReorderSeed) => void;
  remove: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
}

const ReorderCartContext = createContext<ReorderCartValue | null>(null);

export function ReorderCartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);

  const has = useCallback(
    (key: string) => lines.some((l) => l.key === key),
    [lines],
  );

  const add = useCallback((key: string, seed: SupplyReorderSeed) => {
    setLines((prev) =>
      prev.some((l) => l.key === key) ? prev : [...prev, { key, seed }],
    );
  }, []);

  const remove = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    const q = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
    setLines((prev) =>
      prev.map((l) =>
        l.key === key ? { ...l, seed: { ...l.seed, quantity: q } } : l,
      ),
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<ReorderCartValue>(
    () => ({ lines, count: lines.length, has, add, remove, setQuantity, clear }),
    [lines, has, add, remove, setQuantity, clear],
  );

  return (
    <ReorderCartContext.Provider value={value}>
      {children}
    </ReorderCartContext.Provider>
  );
}

export function useReorderCart(): ReorderCartValue {
  const ctx = useContext(ReorderCartContext);
  if (!ctx) {
    throw new Error("useReorderCart must be used within a ReorderCartProvider");
  }
  return ctx;
}
