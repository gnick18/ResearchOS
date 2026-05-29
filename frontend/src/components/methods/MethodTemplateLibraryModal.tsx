"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import {
  fetchMethodCatalogManifest,
  fetchMethodCatalogTemplate,
  instantiateMethodFromTemplate,
  type MethodCatalogManifestEntry,
} from "@/lib/methods/method-catalog";
import {
  getMethodTypeMeta,
  type MethodTypeId,
} from "@/lib/methods/method-type-registry";
import type { Method } from "@/lib/types";

/**
 * Protocol template library (Extension Store Phase U1).
 *
 * A browse-and-use surface over the static `public/method-catalog/` catalog.
 * Templates are grouped by category and rendered as cards (title + method-type
 * badge/icon + description). "Use template" fetches the full payload and creates
 * a NORMAL, user-owned method in the chosen folder via
 * `instantiateMethodFromTemplate` (which routes through the existing
 * `methodsApi.create` + per-type API path), then hands the created method back
 * to the page so it can refresh the methods query and route the user to it.
 *
 * The catalog is an online convenience layer: if the manifest fetch fails
 * (offline / deploy unreachable), the panel shows a graceful unavailable state.
 * Everything else on the methods page keeps working.
 */
export function MethodTemplateLibraryModal({
  existingFolders,
  onClose,
  onUsed,
}: {
  existingFolders: string[];
  onClose: () => void;
  /** Fires after a template is instantiated into a new owned method. */
  onUsed: (created: Method) => void;
}) {
  const [entries, setEntries] = useState<MethodCatalogManifestEntry[] | null>(
    null,
  );
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [search, setSearch] = useState("");
  // The destination category for any template the user instantiates. Empty =
  // uncategorized. Mirrors the folder picker mental model from the create flow.
  const [destFolder, setDestFolder] = useState("");
  // Slug currently being instantiated (disables its button + shows progress).
  const [usingSlug, setUsingSlug] = useState<string | null>(null);
  const [useError, setUseError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    fetchMethodCatalogManifest()
      .then((manifest) => {
        if (cancelled) return;
        setEntries(manifest.templates);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on Escape, matching the project's modal convention.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((t) => {
      const haystack = [
        t.title,
        t.description,
        t.category,
        ...(t.tags ?? []),
        getMethodTypeMeta(t.method_type as MethodTypeId).label,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, search]);

  // Group filtered templates by category, preserving the manifest's curated
  // order within each group and ordering groups by first appearance.
  const grouped = useMemo(() => {
    const order: string[] = [];
    const byCategory = new Map<string, MethodCatalogManifestEntry[]>();
    for (const t of filtered) {
      if (!byCategory.has(t.category)) {
        byCategory.set(t.category, []);
        order.push(t.category);
      }
      byCategory.get(t.category)!.push(t);
    }
    return order.map((category) => ({
      category,
      templates: byCategory.get(category)!,
    }));
  }, [filtered]);

  const handleUse = useCallback(
    async (entry: MethodCatalogManifestEntry) => {
      if (usingSlug) return;
      setUsingSlug(entry.slug);
      setUseError(null);
      try {
        const template = await fetchMethodCatalogTemplate(entry.slug);
        const created = await instantiateMethodFromTemplate(template, {
          folderPath: destFolder.trim() || null,
        });
        onUsed(created);
      } catch {
        setUseError(
          `Could not create a method from "${entry.title}". Check your connection and try again.`,
        );
      } finally {
        setUsingSlug(null);
      }
    },
    [usingSlug, destFolder, onUsed],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Protocol templates
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Prebuilt methods you can copy into your library and edit freely.
            </p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              aria-label="Close template library"
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              ✕
            </button>
          </Tooltip>
        </div>

        {/* Controls: search + destination folder */}
        {loadState === "ready" && (
          <div className="flex flex-wrap items-end gap-3 px-6 py-3 border-b border-gray-100">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Search templates
              </label>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, type, or tag..."
                aria-label="Search templates"
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <div className="min-w-[200px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Add to category
              </label>
              <input
                type="text"
                list="template-dest-folders"
                value={destFolder}
                onChange={(e) => setDestFolder(e.target.value)}
                placeholder="Uncategorized"
                aria-label="Destination category"
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <datalist id="template-dest-folders">
                {existingFolders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">
          {loadState === "loading" && (
            <p className="text-sm text-gray-400 py-10 text-center">
              Loading templates...
            </p>
          )}

          {loadState === "error" && (
            <div className="border-2 border-dashed border-gray-200 rounded-lg p-10 text-center">
              <p className="text-sm text-gray-500">
                The template catalog is unavailable right now.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                It needs an internet connection. Everything else on this page
                keeps working offline.
              </p>
            </div>
          )}

          {loadState === "ready" && filtered.length === 0 && (
            <p className="text-sm text-gray-400 py-10 text-center">
              No templates match this search.
            </p>
          )}

          {loadState === "ready" && useError && (
            <p className="text-sm text-red-600 mb-4">{useError}</p>
          )}

          {loadState === "ready" &&
            grouped.map((group) => (
              <section key={group.category} className="mb-8 last:mb-0">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">
                  {group.category}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {group.templates.map((entry) => {
                    const meta = getMethodTypeMeta(
                      entry.method_type as MethodTypeId,
                    );
                    const Icon = meta.icon;
                    const isUsing = usingSlug === entry.slug;
                    return (
                      <div
                        key={entry.slug}
                        className="border border-gray-200 rounded-lg p-4 flex flex-col hover:shadow-sm transition-shadow"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h5 className="text-sm font-medium text-gray-900">
                            {entry.title}
                          </h5>
                          <span
                            className={`shrink-0 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${meta.color.bg} ${meta.color.text}`}
                          >
                            <Icon className="w-3 h-3" />
                            {meta.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1 flex-1">
                          {entry.description}
                        </p>
                        {entry.tags && entry.tags.length > 0 && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {entry.tags.map((tag) => (
                              <span
                                key={tag}
                                className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-3 flex justify-end">
                          <button
                            onClick={() => handleUse(entry)}
                            disabled={usingSlug !== null}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          >
                            {isUsing ? "Adding..." : "Use template"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}
