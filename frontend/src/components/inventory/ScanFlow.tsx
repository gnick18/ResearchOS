"use client";

// The scan FLOW body (chunk 6, design 15.2-15.6). Lives inside a LivingPopup
// opened by the /inventory header "Scan" button. It hosts the BarcodeScanner,
// runs the pure resolver on each detected code, and renders the matching
// result surface from the approved mockup:
//
//   container / product-single -> the consume card (count one down, with Undo)
//   product-multi              -> the "which one did you use?" picker
//   unknown                    -> the register card (create new / link existing)
//
// Consume writes go through inventoryStocksApi.update so deriveInventoryStatus
// re-derives status in the data layer (we never recompute it here). When a
// consume crosses into low / empty we show the "now low" note and, best-effort,
// drop a needs-ordering line item via the existing reorder helper.
//
// House style: <Icon> only, Tooltip for icon-only buttons, brand + semantic
// dark-mode tokens, no emojis / em-dashes / mid-sentence colons. Reuses the
// inventory-ui helpers (containerWord, statusChipClass, formatDate,
// STATUS_LABEL).

import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import BarcodeScanner from "@/components/inventory/BarcodeScanner";
import {
  STATUS_LABEL,
  containerWord,
  formatDate,
} from "@/components/inventory/inventory-ui";
import {
  resolveBarcode,
  type BarcodeResolution,
} from "@/components/inventory/barcode-resolve";
import { lookupProductBarcode } from "@/lib/inventory/barcode-lookup";
import {
  inventoryItemsApi,
  inventoryStocksApi,
  purchasesApi,
} from "@/lib/local-api";
import { createReorderPurchase } from "@/lib/purchases/reorder-actions";
import type { InventoryItem, InventoryStock } from "@/lib/types";

/**
 * Best-effort dedup guard for the reorder drop. Returns true when a
 * needs-ordering purchase line already exists for this item, so the consume
 * path can skip creating a SECOND one. Without it, a scan -> undo -> scan cycle
 * re-crosses the low/empty threshold (undo restores the count but intentionally
 * does NOT unwind the first reorder) and would queue a duplicate purchase.
 * Matches by item name (case-insensitive); when both sides name a vendor they
 * must agree too. Reads the current user's own purchase lines only.
 */
async function reorderAlreadyQueued(
  itemName: string,
  vendor: string | null | undefined,
): Promise<boolean> {
  const name = itemName.trim().toLowerCase();
  if (!name) return false;
  const wantVendor = vendor?.trim().toLowerCase() || null;
  const existing = await purchasesApi.listAll();
  return existing.some((p) => {
    if (p.order_status !== "needs_ordering") return false;
    if (p.item_name.trim().toLowerCase() !== name) return false;
    const pVendor = p.vendor?.trim().toLowerCase() || null;
    // Only treat differing vendors as distinct when BOTH sides name one.
    if (wantVendor && pVendor && wantVendor !== pVendor) return false;
    return true;
  });
}

/** Owner to route a write through (mirrors the page's effectiveOwnerOf). */
function effectiveOwnerOf(
  item: InventoryItem,
  currentUser: string | null,
): string | undefined {
  return item.is_shared_with_me && item.owner !== currentUser
    ? item.owner
    : undefined;
}

/** The result of a single consume, used to render the card + Undo. */
interface ConsumeOutcome {
  item: InventoryItem;
  stock: InventoryStock;
  previousCount: number;
  newCount: number;
  /** When units_per_scan is set: the units remaining after the deduction. */
  previousUnits: number | undefined;
  newUnits: number | undefined;
  /** The re-derived status after the write (from the data layer). */
  newStatus: InventoryStock["status"];
  /** True when the write crossed into low or empty. */
  crossedLow: boolean;
  /** True when a needs-ordering line item was dropped best-effort. */
  reorderDropped: boolean;
}

type FlowState =
  | { phase: "scanning" }
  | { phase: "resolved"; resolution: BarcodeResolution }
  | { phase: "consumed"; outcome: ConsumeOutcome };

export default function ScanFlow({
  items,
  stocks,
  currentUser,
  onClose,
  onRefresh,
  onCreateItemWithCode,
}: {
  items: InventoryItem[];
  stocks: InventoryStock[];
  currentUser: string | null;
  onClose: () => void;
  /** Re-fetch inventory after a write. */
  onRefresh: () => void;
  /** Open the Add item dialog with `product_barcode` pre-filled to the code. */
  onCreateItemWithCode: (code: string) => void;
}) {
  const [state, setState] = useState<FlowState>({ phase: "scanning" });
  const [busy, setBusy] = useState(false);

  // Set true on unmount so an in-flight consume() (which awaits the stock
  // update before dropping a reorder line item) doesn't create a "surprise"
  // reorder purchase after the user closes the scan popup. Mirrors
  // BarcodeScanner's own `cancelled` flag pattern.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const handleDetect = (code: string) => {
    const resolution = resolveBarcode(code, items, stocks);
    if (resolution.kind === "container" || resolution.kind === "product-single") {
      void consume(resolution.item, resolution.stock);
    } else {
      setState({ phase: "resolved", resolution });
    }
  };

  // Consume one scan's worth of `stock`. When `units_per_scan` is set on the
  // stock, deduct `units_per_scan` from `units_remaining` (clamped at 0) and
  // leave `container_count` untouched. When `units_per_scan` is not set, fall
  // back to decrementing `container_count` by 1 (the original behavior).
  const consume = async (item: InventoryItem, stock: InventoryStock) => {
    setBusy(true);
    try {
      const previousCount = Number.isFinite(stock.container_count)
        ? stock.container_count
        : 0;
      const owner = effectiveOwnerOf(item, currentUser);

      let patch: Parameters<typeof inventoryStocksApi.update>[1];
      let newCount: number;
      let previousUnits: number | undefined;
      let newUnits: number | undefined;

      const trackedByUnits =
        typeof stock.units_per_scan === "number" &&
        stock.units_per_scan > 0 &&
        typeof stock.units_remaining === "number";

      if (trackedByUnits) {
        // Units-per-scan path: deduct units_per_scan from units_remaining.
        previousUnits = stock.units_remaining as number;
        newUnits = Math.max(0, previousUnits - (stock.units_per_scan as number));
        newCount = previousCount; // container_count unchanged on a units deduction
        patch = { units_remaining: newUnits };
      } else {
        // Legacy path: decrement container_count by 1.
        newCount = Math.max(0, previousCount - 1);
        patch = { container_count: newCount };
      }

      const updated = await inventoryStocksApi.update(stock.id, patch, owner);
      const newStatus = updated?.status ?? stock.status;
      const crossedLow =
        (newStatus === "low" || newStatus === "empty") &&
        stock.status !== "low" &&
        stock.status !== "empty";

      // Best-effort reorder-queue drop ON crossing low/empty. Uses the EXISTING
      // createReorderPurchase helper (no new Purchases plumbing). Failures are
      // swallowed so a consume never fails because of the reorder side effect.
      let reorderDropped = false;
      if (crossedLow && currentUser && !cancelledRef.current) {
        try {
          // Skip the create if this item already has a needs-ordering line
          // (e.g. a prior scan -> undo -> scan cycle re-crossed the threshold).
          // It is still queued either way, so the "now low" note stays honest.
          if (await reorderAlreadyQueued(item.name, item.vendor)) {
            reorderDropped = true;
          } else {
            await createReorderPurchase(
              {
                item_name: item.name,
                vendor: item.vendor,
                cas: item.cas,
                link: item.url,
              },
              { currentUser },
            );
            reorderDropped = true;
          }
        } catch {
          reorderDropped = false;
        }
      }

      setState({
        phase: "consumed",
        outcome: {
          item,
          stock,
          previousCount,
          newCount,
          previousUnits,
          newUnits,
          newStatus,
          crossedLow,
          reorderDropped,
        },
      });
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  // Undo restores the previous count (or units_remaining for tracked stocks).
  // We do not unwind a reorder drop (the line item stays in the order pipeline,
  // which is the safe default).
  const undoConsume = async (outcome: ConsumeOutcome) => {
    setBusy(true);
    try {
      const owner = effectiveOwnerOf(outcome.item, currentUser);
      const undoPatch =
        outcome.previousUnits !== undefined
          ? { units_remaining: outcome.previousUnits }
          : { container_count: outcome.previousCount };
      await inventoryStocksApi.update(outcome.stock.id, undoPatch, owner);
      onRefresh();
      setState({ phase: "scanning" });
    } finally {
      setBusy(false);
    }
  };

  const scanAnother = () => setState({ phase: "scanning" });

  if (state.phase === "scanning") {
    return <BarcodeScanner onDetect={handleDetect} onClose={onClose} />;
  }

  if (state.phase === "consumed") {
    return (
      <ConsumeCard
        outcome={state.outcome}
        busy={busy}
        onUndo={() => undoConsume(state.outcome)}
        onScanAnother={scanAnother}
        onDone={onClose}
      />
    );
  }

  // phase === "resolved"
  const { resolution } = state;
  if (resolution.kind === "product-multi") {
    return (
      <MultiMatchPicker
        item={resolution.item}
        stocks={resolution.stocks}
        busy={busy}
        onUseOne={(stock) => consume(resolution.item, stock)}
        onScanAnother={scanAnother}
      />
    );
  }

  // unknown -> register
  return (
    <RegisterCard
      code={resolution.kind === "unknown" ? resolution.code : ""}
      items={items}
      currentUser={currentUser}
      busy={busy}
      setBusy={setBusy}
      onCreateItemWithCode={onCreateItemWithCode}
      onLinked={() => {
        onRefresh();
        onClose();
      }}
      onCancel={onClose}
    />
  );
}

// ── Consume card ──────────────────────────────────────────────────────────
function ConsumeCard({
  outcome,
  busy,
  onUndo,
  onScanAnother,
  onDone,
}: {
  outcome: ConsumeOutcome;
  busy: boolean;
  onUndo: () => void;
  onScanAnother: () => void;
  onDone: () => void;
}) {
  const { item, stock, previousCount, newCount, previousUnits, newUnits, newStatus, crossedLow, reorderDropped } =
    outcome;
  const word = containerWord(item.container_label);
  const metaParts: string[] = [];
  if (stock.lot_number) metaParts.push(`Lot ${stock.lot_number}`);
  if (stock.location_text) metaParts.push(stock.location_text);

  // Show units-ledger progress when the stock uses units_per_scan, otherwise
  // show the classic container count change.
  const trackedByUnits = previousUnits !== undefined && newUnits !== undefined;
  const unitLabel = stock.unit ?? "unit";

  return (
    <div className="p-5">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
          <Icon name="check" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-title font-semibold text-foreground">
            {item.name}
          </div>
          <div className="mt-0.5 text-meta text-foreground-muted">
            {metaParts.length > 0 ? `${metaParts.join(" · ")} · ` : ""}
            {stock.container_code ? (
              <>
                code{" "}
                <span className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-meta">
                  {stock.container_code}
                </span>
              </>
            ) : null}
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 text-body font-semibold">
            {trackedByUnits ? (
              <>
                Used {stock.units_per_scan} {unitLabel}
                {(stock.units_per_scan ?? 1) !== 1 ? "s" : ""}
                <span className="text-foreground-muted line-through">
                  {previousUnits}
                </span>
                <Icon
                  name="chevronDown"
                  className="h-3.5 w-3.5 -rotate-90 text-foreground-muted"
                />
                <span
                  className={
                    crossedLow
                      ? "text-amber-600 dark:text-amber-300"
                      : "text-emerald-600 dark:text-emerald-300"
                  }
                >
                  {newUnits} left
                </span>
              </>
            ) : (
              <>
                Used one {word}
                <span className="text-foreground-muted line-through">
                  {previousCount}
                </span>
                <Icon
                  name="chevronDown"
                  className="h-3.5 w-3.5 -rotate-90 text-foreground-muted"
                />
                <span
                  className={
                    crossedLow
                      ? "text-amber-600 dark:text-amber-300"
                      : "text-emerald-600 dark:text-emerald-300"
                  }
                >
                  {newCount} left
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Status note. When the consume crossed into low / empty, surface it and
          (best-effort) the reorder-queue drop. */}
      {crossedLow && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-foreground px-3 py-2.5 text-meta text-surface">
          <Icon name="check" className="h-4 w-4 flex-shrink-0" />
          <span>
            Counted down.{" "}
            <span className="opacity-80">
              Now {STATUS_LABEL[newStatus].toLowerCase()}
              {reorderDropped ? ", added to your reorder queue." : "."}
            </span>
          </span>
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            className="ml-auto font-semibold underline disabled:opacity-50"
          >
            Undo
          </button>
        </div>
      )}
      {!crossedLow && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-foreground px-3 py-2.5 text-meta text-surface">
          <Icon name="check" className="h-4 w-4 flex-shrink-0" />
          <span>Counted down.</span>
          <button
            type="button"
            onClick={onUndo}
            disabled={busy}
            className="ml-auto font-semibold underline disabled:opacity-50"
          >
            Undo
          </button>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onScanAnother}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-body text-foreground hover:bg-surface-sunken disabled:opacity-50"
        >
          <Icon name="scan" className="h-4 w-4" />
          Scan another
        </button>
        <button
          type="button"
          onClick={onDone}
          className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 rounded-lg px-4 py-2 text-body"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ── Multi-match picker ─────────────────────────────────────────────────────
function MultiMatchPicker({
  item,
  stocks,
  busy,
  onUseOne,
  onScanAnother,
}: {
  item: InventoryItem;
  stocks: InventoryStock[];
  busy: boolean;
  onUseOne: (stock: InventoryStock) => void;
  onScanAnother: () => void;
}) {
  const word = containerWord(item.container_label);
  return (
    <div className="p-5">
      <h2 className="text-title font-semibold text-foreground">
        Which one did you use?
      </h2>
      <p className="mt-1 text-meta text-foreground-muted">
        The product barcode{" "}
        <span className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-meta">
          {item.product_barcode}
        </span>{" "}
        matches {stocks.length} lots of {item.name}.
      </p>
      <div className="mt-3 space-y-2">
        {stocks.map((stock) => {
          const tail: string[] = [];
          if (stock.location_text) tail.push(stock.location_text);
          if (stock.expiration_date)
            tail.push(`expires ${formatDate(stock.expiration_date)}`);
          return (
            <button
              key={stock.id}
              type="button"
              onClick={() => onUseOne(stock)}
              disabled={busy}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-surface-sunken disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block text-body font-semibold text-foreground">
                  {stock.lot_number ? `Lot ${stock.lot_number}` : "Unlabeled lot"}
                </span>
                <span className="block text-meta text-foreground-muted">
                  {stock.container_count}{" "}
                  {stock.container_count === 1 ? word : `${word}s`}
                  {tail.length > 0 ? ` · ${tail.join(" · ")}` : ""}
                </span>
              </span>
              <span className="inline-flex flex-shrink-0 items-center gap-1 text-meta font-medium text-brand-action">
                Use one
                <Icon name="chevronDown" className="h-3.5 w-3.5 -rotate-90" />
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 border-t border-border pt-2.5 text-meta text-foreground-muted">
        Only happens for a manufacturer barcode shared across lots. A lab-applied
        per-container code points at exactly one, so it skips this step.
      </p>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onScanAnother}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-body text-foreground hover:bg-surface-sunken disabled:opacity-50"
        >
          <Icon name="scan" className="h-4 w-4" />
          Scan another
        </button>
      </div>
    </div>
  );
}

// ── Register card (unknown code) ───────────────────────────────────────────
function RegisterCard({
  code,
  items,
  currentUser,
  busy,
  setBusy,
  onCreateItemWithCode,
  onLinked,
  onCancel,
}: {
  code: string;
  items: InventoryItem[];
  currentUser: string | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onCreateItemWithCode: (code: string) => void;
  onLinked: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "link">("choose");
  const [search, setSearch] = useState("");

  // The optional manufacturer lookup is the bring-your-own-key bonus. It returns
  // null by default (no key), so this never auto-fills unless wired + a key is
  // set. Kept here so the seam is exercised; the result is otherwise unused.
  useMemo(() => {
    void lookupProductBarcode(code);
  }, [code]);

  const editableItems = useMemo(() => {
    // Only items the current user owns can have their product_barcode rebound
    // here without the share-permission dance; keep linking simple and own-only.
    const owned = items.filter((it) => it.owner === currentUser);
    const q = search.trim().toLowerCase();
    const sorted = [...owned].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    if (!q) return sorted.slice(0, 8);
    return sorted
      .filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          (it.vendor?.toLowerCase().includes(q) ?? false) ||
          (it.catalog_number?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 8);
  }, [items, currentUser, search]);

  const linkTo = async (item: InventoryItem) => {
    setBusy(true);
    try {
      await inventoryItemsApi.update(item.id, { product_barcode: code });
      onLinked();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-5">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
          <Icon name="scan" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-title font-semibold text-foreground">
            New code{" "}
            <span className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-meta">
              {code}
            </span>
          </div>
          <div className="mt-1 text-meta text-foreground-muted">
            Not in your inventory yet. What is it?
          </div>
        </div>
      </div>

      {mode === "choose" ? (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={() => onCreateItemWithCode(code)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-brand-action px-3 py-2.5 text-left ring-1 ring-brand-action hover:bg-surface-sunken"
          >
            <span>
              <span className="block text-body font-semibold text-foreground">
                Create a new item with this code
              </span>
              <span className="block text-meta text-foreground-muted">
                Opens Add item, the code is filled in.
              </span>
            </span>
            <Icon
              name="chevronDown"
              className="h-4 w-4 -rotate-90 text-brand-action"
            />
          </button>
          <button
            type="button"
            onClick={() => setMode("link")}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-surface-sunken"
          >
            <span>
              <span className="block text-body font-semibold text-foreground">
                Link this code to an existing item
              </span>
              <span className="block text-meta text-foreground-muted">
                Bind it to something you already track.
              </span>
            </span>
            <Icon
              name="chevronDown"
              className="h-4 w-4 -rotate-90 text-foreground-muted"
            />
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your items by name, vendor, catalog"
              className="w-full rounded-lg border border-border bg-surface-raised py-2 pl-9 pr-3 text-body text-foreground placeholder:text-foreground-muted/70 focus:outline-none focus:ring-2 focus:ring-brand-action"
            />
          </div>
          <div className="mt-2 space-y-1.5">
            {editableItems.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-meta text-foreground-muted">
                No matching items you own.
              </p>
            ) : (
              editableItems.map((it) => (
                <button
                  key={`${it.owner}:${it.id}`}
                  type="button"
                  onClick={() => linkTo(it)}
                  disabled={busy}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left hover:bg-surface-sunken disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium text-foreground">
                      {it.name}
                    </span>
                    <span className="block truncate text-meta text-foreground-muted">
                      {it.vendor ?? ""}
                      {it.product_barcode ? " · has a barcode already" : ""}
                    </span>
                  </span>
                  <span className="inline-flex flex-shrink-0 items-center gap-1 text-meta font-medium text-brand-action">
                    Link
                    <Icon name="chevronDown" className="h-3.5 w-3.5 -rotate-90" />
                  </span>
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            onClick={() => setMode("choose")}
            className="mt-2 text-meta font-medium text-brand-action hover:underline"
          >
            Back
          </button>
        </div>
      )}

      <p className="mt-3 border-t border-border pt-2.5 text-meta text-foreground-muted">
        Optional, add a Go-UPC key in Settings and a manufacturer barcode
        auto-fills the name and vendor. Off by default. Most lab reagents have no
        retail barcode, so this is a rare bonus, manual entry is the norm.
      </p>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-3 py-2 text-body text-foreground hover:bg-surface-sunken"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
