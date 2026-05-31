"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Tooltip from "@/components/Tooltip";
import { purchasesApi, fetchAllProjectsIncludingShared } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  MISC_CATEGORY_LABEL,
  isMiscProject,
} from "@/lib/purchases/misc-project";
import { createReorderPurchase } from "@/lib/purchases/reorder-actions";
import type { CatalogItem } from "@/lib/types";

/**
 * Quick reorder capture (reorder-loop sub-bot, 2026-05-31).
 *
 * Feature 1 of the reorder loop: a global "we are out of X, flag it for
 * reorder" affordance in the AppShell floating cluster. One tap opens a
 * small modal with an item field that AUTOCOMPLETES from the item_catalog
 * (typing "Q5" surfaces past purchases), optional quantity + note, and a
 * destination project (defaults to the per-user Miscellaneous bucket).
 *
 * On submit it creates a `PurchaseItem` in `order_status: "needs_ordering"`,
 * pre-filling vendor / cas / link / price from the matched catalog item, and
 * the new order enters the normal needs-ordering -> approval -> ordered flow.
 * No special path.
 *
 * ZERO data-shape change: the write goes through the shared
 * `createReorderPurchase` action (existing tasksApi + purchasesApi create),
 * the autocomplete reuses `purchasesApi.searchCatalog`, and the project
 * picker reuses `fetchAllProjectsIncludingShared`.
 *
 * Mirrors CalculatorsButton: an inline-SVG icon button (pointer-events-auto,
 * Tooltip) plus a pointer-events-auto / data-tour-popup-occluding modal.
 */

function ReorderIcon({ className = "w-5 h-5" }: { className?: string }) {
  // Cart with a small recurring-arrow hint - "flag this for reorder".
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      <line x1="16" y1="6" x2="22" y2="6" />
      <line x1="19" y1="3" x2="19" y2="9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export default function QuickReorderButton() {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <Tooltip label="Quick reorder" placement="top">
        <button
          type="button"
          onClick={() => setShowModal(true)}
          aria-label="Quick reorder"
          data-tour-target="quick-reorder-button"
          className="pointer-events-auto w-12 h-12 rounded-full bg-white border border-gray-200 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center text-gray-600 hover:text-gray-900"
        >
          <ReorderIcon />
        </button>
      </Tooltip>

      {showModal && <QuickReorderModal onClose={() => setShowModal(false)} />}
    </>
  );
}

interface QuickReorderFormState {
  name: string;
  quantity: string;
  note: string;
  /** Either MISC_CATEGORY_LABEL (route to the hidden _misc_purchases
   *  project) or the stringified id of a real current-user project. */
  category: string;
}

function QuickReorderModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  const [form, setForm] = useState<QuickReorderFormState>({
    name: "",
    quantity: "1",
    note: "",
    category: MISC_CATEGORY_LABEL,
  });
  // The catalog match backing the current item name (vendor / cas / link /
  // price prefill). Cleared whenever the typed name no longer matches.
  const [matched, setMatched] = useState<CatalogItem | null>(null);
  const [suggestions, setSuggestions] = useState<CatalogItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemFieldRef = useRef<HTMLDivElement>(null);

  // Real current-user projects for the destination picker. Hidden projects
  // (the misc bucket) are filtered out; the synthetic "Miscellaneous" row
  // routes there under the hood (same shape as NewPurchaseModal).
  const { data: allProjects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: () => fetchAllProjectsIncludingShared(),
  });
  const userProjects = useMemo(
    () =>
      allProjects.filter(
        (p) =>
          !p.is_archived &&
          !p.is_shared_with_me &&
          !isMiscProject(p) &&
          (currentUser === "" || p.owner === currentUser),
      ),
    [allProjects, currentUser],
  );

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Close the suggestions dropdown on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (itemFieldRef.current && !itemFieldRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Catalog autocomplete: debounce on the typed name. searchCatalog matches
  // on item_name OR cas, so typing "Q5" or a CAS number both surface past
  // purchases.
  useEffect(() => {
    const q = form.name.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await purchasesApi.searchCatalog(q);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
        // If the typed value is an exact name match, lock the prefill in
        // even without an explicit click (mirrors NewPurchaseModal).
        const exact = results.find(
          (r) => r.item_name.trim().toLowerCase() === q.toLowerCase(),
        );
        setMatched(exact ?? null);
      } catch {
        setSuggestions([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [form.name]);

  const handlePick = (cat: CatalogItem) => {
    setForm((prev) => ({ ...prev, name: cat.item_name }));
    setMatched(cat);
    setShowSuggestions(false);
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError("Item name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Resolve the destination: a real project id, else the Misc bucket.
      let projectId: number | undefined;
      if (form.category !== MISC_CATEGORY_LABEL) {
        const parsed = Number.parseInt(form.category, 10);
        if (Number.isFinite(parsed) && parsed > 0) projectId = parsed;
      }

      await createReorderPurchase(
        {
          item_name: name,
          quantity: Number.parseInt(form.quantity, 10) || 1,
          notes: form.note.trim() || null,
          // Prefill from the catalog match when the typed name matches a
          // past purchase. A free-typed name (no match) creates a bare
          // needs-ordering item, which is exactly the "we are out of X"
          // flow.
          vendor: null,
          cas: matched?.cas ?? null,
          link: matched?.link ?? null,
          price_per_unit: matched?.price_per_unit ?? 0,
        },
        { projectId, currentUser },
      );

      // Refresh the surfaces the /purchases page reads.
      void queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });

      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to flag the reorder.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      // pointer-events-auto: this modal renders inside AppShell's
      // pointer-events-none floating cluster, so without the override the
      // backdrop + buttons would silently no-op. Mirrors CalculatorsModal.
      className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-auto"
      data-tour-popup-occluding="quick-reorder-modal"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <form
        onSubmit={handleSave}
        className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-600">
              <ReorderIcon className="w-4 h-4" />
            </span>
            Quick reorder
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-500">
            Out of something? Flag it for reorder in one step. It lands in your
            purchases as &ldquo;needs ordering&rdquo; and follows the normal
            approval flow.
          </p>

          {error && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              {error}
            </div>
          )}

          <div ref={itemFieldRef} className="relative">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Item
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, name: e.target.value }));
                // A manual edit invalidates the prior match until the
                // debounced search re-resolves it.
                setMatched(null);
              }}
              onFocus={() => {
                if (suggestions.length > 0) setShowSuggestions(true);
              }}
              placeholder="e.g. Q5 Polymerase"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              autoFocus
              data-tour-target="quick-reorder-item"
            />
            {/* Catalog suggestions */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-10 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                {suggestions.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handlePick(cat)}
                    className="w-full text-left px-3 py-2 hover:bg-amber-50 border-b border-gray-50 last:border-b-0"
                  >
                    <p className="text-sm font-medium text-gray-900">
                      {cat.item_name}
                    </p>
                    <p className="text-xs text-gray-400">
                      ${(cat.price_per_unit ?? 0).toFixed(2)}
                      {cat.cas ? ` · ${cat.cas}` : ""}
                    </p>
                  </button>
                ))}
              </div>
            )}
            {matched && (
              <p className="text-xs text-emerald-600 mt-1">
                Matched a past purchase, price and link will be filled in.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Quantity
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={form.quantity}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    quantity: e.target.value.replace(/\D/g, ""),
                  }))
                }
                placeholder="1"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label
                htmlFor="quick-reorder-destination"
                className="block text-xs font-medium text-gray-500 mb-1"
              >
                Destination
              </label>
              <select
                id="quick-reorder-destination"
                value={form.category}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, category: e.target.value }))
                }
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
              >
                <option value={MISC_CATEGORY_LABEL}>{MISC_CATEGORY_LABEL}</option>
                {userProjects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Note (optional)
            </label>
            <input
              type="text"
              value={form.note}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, note: e.target.value }))
              }
              placeholder="e.g. running low, need before Friday"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !form.name.trim()}
            className="px-4 py-2 text-sm text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-tour-target="quick-reorder-submit"
          >
            {saving ? "Flagging…" : "Flag for reorder"}
          </button>
        </div>
      </form>
    </div>
  );
}
