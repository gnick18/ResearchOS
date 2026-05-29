"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEnabledMethodTypes } from "@/hooks/useEnabledMethodTypes";
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
import {
  listMethodModules,
  type MethodModuleMeta,
} from "@/lib/methods/method-module";
import { resolveEnabledMethodTypes } from "@/lib/methods/method-type-enablement";
import { buildRequestMethodTypeUrl } from "@/lib/methods/request-method-type";
import type { Method } from "@/lib/types";

/**
 * Method library / extension store SHELL (Extension Store Phase U2).
 *
 * Extends the U1 "Protocol templates" browse surface into a tabbed store with
 * ONE entry point (the /methods header "Template library" button), per the
 * brief's cohesion requirement. Two tabs:
 *
 *   1. METHOD TYPES: browse every structured method type the build ships and
 *      enable/disable it for this account (the anti-clutter curation layer,
 *      METHOD doc §4.3). Disabling only hides a type from the new-method
 *      picker + the store-default template view; it never deletes or breaks
 *      an existing/shared method of that type. A "Request a new method type"
 *      affordance opens a prefilled GitHub issue (a STUB, not the U4
 *      contributor pipeline).
 *   2. PROTOCOL TEMPLATES: the U1 data-only catalog. Templates whose method
 *      type is currently DISABLED show an inline "Enable + use" affordance
 *      (enable-a-disabled-type-on-use) instead of being silently unusable.
 *
 * Method-type curation is account-AGNOSTIC: the docs scope PI-vs-member
 * gating to widgets (U3), not method types. Extensions remain code shipped in
 * the reviewed build; this shell is curation + a request stub, never a code
 * loader.
 */
type StoreTab = "types" | "templates";

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
  const [tab, setTab] = useState<StoreTab>("types");
  const { currentUser } = useCurrentUser();
  const { raw: enabledRaw, setEnabled } = useEnabledMethodTypes(currentUser);
  const enabledSet = useMemo(
    () => resolveEnabledMethodTypes(enabledRaw),
    [enabledRaw],
  );

  // Close on Escape, matching the project's modal convention.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Method library
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Choose which method types you use, and copy prebuilt protocols
              into your library.
            </p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              aria-label="Close method library"
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              &times;
            </button>
          </Tooltip>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-gray-100">
          <StoreTabButton
            label="Method types"
            active={tab === "types"}
            onClick={() => setTab("types")}
          />
          <StoreTabButton
            label="Protocol templates"
            active={tab === "templates"}
            onClick={() => setTab("templates")}
          />
        </div>

        {tab === "types" ? (
          <MethodTypesTab
            enabledSet={enabledSet}
            curating={currentUser !== null}
            onToggle={(id, on) => {
              void setEnabled(id, on);
            }}
          />
        ) : (
          <ProtocolTemplatesTab
            existingFolders={existingFolders}
            enabledSet={enabledSet}
            onEnableType={(id) => {
              void setEnabled(id, true);
            }}
            onUsed={onUsed}
          />
        )}
      </div>
    </div>
  );
}

function StoreTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-blue-600 text-blue-700"
          : "border-transparent text-gray-500 hover:text-gray-700"
      }`}
    >
      {label}
    </button>
  );
}

// ── Tab 1: Method types (curation) ───────────────────────────────────────────

function MethodTypesTab({
  enabledSet,
  curating,
  onToggle,
}: {
  enabledSet: Set<MethodTypeId>;
  /** False when signed out / pre-data-setup: toggles can't persist, so the
   *  switches render disabled. */
  curating: boolean;
  onToggle: (id: MethodTypeId, on: boolean) => void;
}) {
  const modules = listMethodModules();
  const [requestText, setRequestText] = useState("");

  // Group by cosmetic category, preserving registry order within each group.
  const grouped = useMemo(() => {
    const order: string[] = [];
    const byCat = new Map<string, MethodModuleMeta[]>();
    for (const m of modules) {
      const cat =
        m.cosmetic.category === "structured" ? "Structured methods" : "Standard methods";
      if (!byCat.has(cat)) {
        byCat.set(cat, []);
        order.push(cat);
      }
      byCat.get(cat)!.push(m);
    }
    return order.map((category) => ({ category, items: byCat.get(category)! }));
  }, [modules]);

  return (
    <div className="flex-1 overflow-auto p-6">
      <p className="text-sm text-gray-500 mb-4">
        Turn off the types you never use to keep the new-method picker short.
        Disabling a type only hides it from the picker and these templates; it
        never deletes or hides methods you already have.
      </p>

      {grouped.map((group) => (
        <section key={group.category} className="mb-6 last:mb-0">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">
            {group.category}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {group.items.map((m) => {
              const Icon = m.cosmetic.icon;
              const on = enabledSet.has(m.id);
              return (
                <div
                  key={m.id}
                  className="border border-gray-200 rounded-lg p-4 flex items-start gap-3"
                >
                  <span
                    className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg ${m.cosmetic.color.bg} ${m.cosmetic.color.text}`}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h5 className="text-sm font-medium text-gray-900">
                        {m.cosmetic.label}
                      </h5>
                      <Tooltip
                        label={
                          curating
                            ? on
                              ? `Disable ${m.cosmetic.label}`
                              : `Enable ${m.cosmetic.label}`
                            : "Sign in to change this"
                        }
                        placement="top"
                      >
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`${on ? "Disable" : "Enable"} ${m.cosmetic.label}`}
                          disabled={!curating}
                          onClick={() => onToggle(m.id, !on)}
                          className={`relative shrink-0 inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${
                            on ? "bg-blue-600" : "bg-gray-300"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              on ? "translate-x-4" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </Tooltip>
                    </div>
                    {m.cosmetic.description && (
                      <p className="text-xs text-gray-500 mt-1">
                        {m.cosmetic.description}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* Request a new method type (STUB: opens a prefilled GitHub issue) */}
      <section className="mt-8 border-t border-gray-100 pt-6">
        <h4 className="text-sm font-semibold text-gray-700 mb-1">
          Need a type that isn&apos;t here?
        </h4>
        <p className="text-xs text-gray-400 mb-3">
          Method types are built and reviewed on GitHub, then ship in an update.
          Describe what you need and we&apos;ll open an issue for you.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              What method type do you want?
            </label>
            <input
              type="text"
              value={requestText}
              onChange={(e) => setRequestText(e.target.value)}
              placeholder="e.g. Flow cytometry gating panel"
              aria-label="Describe the method type you want"
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          <a
            href={buildRequestMethodTypeUrl({ description: requestText })}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
          >
            Request a method type
          </a>
        </div>
      </section>
    </div>
  );
}

// ── Tab 2: Protocol templates (the U1 catalog) ───────────────────────────────

function ProtocolTemplatesTab({
  existingFolders,
  enabledSet,
  onEnableType,
  onUsed,
}: {
  existingFolders: string[];
  enabledSet: Set<MethodTypeId>;
  onEnableType: (id: MethodTypeId) => void;
  onUsed: (created: Method) => void;
}) {
  const [entries, setEntries] = useState<MethodCatalogManifestEntry[] | null>(
    null,
  );
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [search, setSearch] = useState("");
  const [destFolder, setDestFolder] = useState("");
  const [usingSlug, setUsingSlug] = useState<string | null>(null);
  const [useError, setUseError] = useState<string | null>(null);

  useEffect(() => {
    // Initial state is already "loading"; the effect runs once (empty deps),
    // so there's no need to re-set it here.
    let cancelled = false;
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
    <>
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
                  const typeId = entry.method_type as MethodTypeId;
                  const meta = getMethodTypeMeta(typeId);
                  const Icon = meta.icon;
                  const isUsing = usingSlug === entry.slug;
                  const typeEnabled = enabledSet.has(typeId);
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
                      <div className="mt-3 flex items-center justify-end gap-2">
                        {!typeEnabled && (
                          <Tooltip
                            label={`${meta.label} is disabled in your library`}
                            placement="top"
                          >
                            <span className="text-[10px] text-amber-600">
                              Type disabled
                            </span>
                          </Tooltip>
                        )}
                        {typeEnabled ? (
                          <button
                            onClick={() => handleUse(entry)}
                            disabled={usingSlug !== null}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          >
                            {isUsing ? "Adding..." : "Use template"}
                          </button>
                        ) : (
                          <button
                            onClick={() => onEnableType(typeId)}
                            className="px-3 py-1.5 text-xs border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50"
                          >
                            Enable {meta.label}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
      </div>
    </>
  );
}
