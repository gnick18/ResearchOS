"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Tooltip from "@/components/Tooltip";
import { StoreShell } from "@/components/store/StoreShell";
import { StoreSegment } from "@/components/store/StoreSegment";
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
import {
  filterTemplateView,
  filterTypeView,
  type MethodLibrarySegment,
} from "./method-library-filter";
import { resolveEnabledMethodTypes } from "@/lib/methods/method-type-enablement";
import { buildRequestMethodTypeUrl } from "@/lib/methods/request-method-type";
import type { Method } from "@/lib/types";

/**
 * Method library / extension store (Extension Store Phase B, store-shell bot,
 * 2026-05-29).
 *
 * Adopts the shared master/detail `StoreShell` so the method library and the
 * widget store read as ONE marketplace. A Types | Templates SEGMENT sits at
 * the top of the rail (in the shell's railHeaderSlot) and switches BOTH the
 * category set and the center kind:
 *   - TYPES: categories are the registry `category` field (Standard /
 *     Structured); items are method types you enable/disable here.
 *   - TEMPLATES: categories are the manifest domain values (Molecular biology,
 *     Analytical chemistry, ...); items are prebuilt protocols you copy.
 * The method-specific pieces stay here: the type toggle, the template "Use" /
 * "Enable" actions, and the catalog fetch. The shell owns the wide frame, the
 * rail, the detail pane, and the responsive collapse.
 *
 * Phase C makes the navigation real: the segment switches kinds, the search
 * box filters live (type label + description in Types, template title + tags
 * in Templates), categories narrow with live counts, and "Enabled only"
 * narrows the types list. A template whose underlying type is disabled stays
 * listed (discoverable); the gated action is Phase D's job. The detail pane
 * stays the Phase B placeholder (Phase D fills it).
 *
 * CONTRACT: the external open/close API ({ existingFolders, onClose, onUsed })
 * is unchanged so every caller keeps working.
 *
 * Method-type curation is account-AGNOSTIC (the docs scope PI-vs-member gating
 * to widgets, not method types). Disabling a type only hides it from the
 * new-method picker + the store-default template view; it never deletes or
 * breaks an existing method. Extensions remain code shipped in the reviewed
 * build; this shell is curation + a request stub, never a code loader.
 */

const SEGMENT_OPTIONS = [
  { id: "types", label: "Types" },
  { id: "templates", label: "Templates" },
];

/** Store item for the current segment: a method TYPE module in the Types view,
 *  or a protocol TEMPLATE catalog entry in the Templates view. The segment
 *  keeps the center list homogeneous; the union lets the shared renderers
 *  switch on `kind`. */
type LibraryItem =
  | { kind: "type"; module: MethodModuleMeta }
  | { kind: "template"; entry: MethodCatalogManifestEntry };

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
  const { currentUser } = useCurrentUser();
  const { raw: enabledRaw, setEnabled } = useEnabledMethodTypes(currentUser);
  const enabledSet = useMemo(
    () => resolveEnabledMethodTypes(enabledRaw),
    [enabledRaw],
  );
  const curating = currentUser !== null;

  const modules = useMemo(() => listMethodModules(), []);

  // ── Protocol-template catalog (async, data-only) ───────────────────────────
  const [entries, setEntries] = useState<MethodCatalogManifestEntry[] | null>(
    null,
  );
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  useEffect(() => {
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

  // ── Store frame state ──────────────────────────────────────────────────────
  // Default to the Types segment to preserve the old initial view and to avoid
  // opening on an async-loading template list. The selected category is per
  // segment, so switching the segment resets it to "All".
  const [segment, setSegment] = useState<MethodLibrarySegment>("types");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LibraryItem | null>(null);

  // Switching the segment swaps the category set + the item kind, so reset the
  // category to "All" and clear any selection (the selected item belongs to the
  // other kind).
  const handleSegmentChange = useCallback((id: string) => {
    setSegment(id as MethodLibrarySegment);
    setSelectedCategoryId(null);
    setSelected(null);
  }, []);

  // ── Template instantiation ("Use template") ────────────────────────────────
  const [destFolder, setDestFolder] = useState("");
  const [usingSlug, setUsingSlug] = useState<string | null>(null);
  const [useError, setUseError] = useState<string | null>(null);

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

  // ── Categories + items (per segment) ────────────────────────────────────────
  // Each segment runs its own pure filter (see method-library-filter.ts):
  // categories carry live counts reflecting search (+ enabled-only for Types),
  // and the center items are search + category filtered. Templates ignore
  // enabled-only so a template on a disabled type stays discoverable.
  const typeView = useMemo(
    () =>
      filterTypeView({
        modules,
        query: search,
        enabledOnly,
        enabledIds: enabledSet,
        selectedCategoryId,
      }),
    [modules, search, enabledOnly, enabledSet, selectedCategoryId],
  );
  const templateView = useMemo(
    () =>
      filterTemplateView({
        entries: entries ?? [],
        query: search,
        selectedCategoryId,
      }),
    [entries, search, selectedCategoryId],
  );

  const isTypes = segment === "types";
  const categories = isTypes ? typeView.categories : templateView.categories;
  const items = useMemo<LibraryItem[]>(
    () =>
      isTypes
        ? typeView.items.map((m) => ({ kind: "type", module: m }))
        : templateView.items.map((e) => ({ kind: "template", entry: e })),
    [isTypes, typeView.items, templateView.items],
  );

  // Empty-state copy: surfaces the template load state when the Templates view
  // would otherwise be blank.
  const emptyState =
    !isTypes && loadState === "loading"
      ? "Loading templates..."
      : !isTypes && loadState === "error"
        ? "The template catalog is unavailable right now. It needs an internet connection. Everything else on this page keeps working offline."
        : "No items match this filter.";

  return (
    <StoreShell<LibraryItem>
      title="Method library"
      subtitle="Choose which method types you use, and copy prebuilt protocols into your library."
      closeAriaLabel="Close method library"
      categories={categories}
      allLabel={isTypes ? "All types" : "All templates"}
      selectedCategoryId={selectedCategoryId}
      onSelectCategory={setSelectedCategoryId}
      railHeaderSlot={
        <StoreSegment
          options={SEGMENT_OPTIONS}
          value={segment}
          onChange={handleSegmentChange}
          ariaLabel="Browse method types or templates"
        />
      }
      searchSlot={<MethodSearchInput value={search} onChange={setSearch} />}
      enabledOnly={enabledOnly}
      onToggleEnabledOnly={setEnabledOnly}
      items={items}
      getItemKey={(it) =>
        it.kind === "type" ? `type:${it.module.id}` : `tpl:${it.entry.slug}`
      }
      selectedItem={selected}
      onSelectItem={setSelected}
      detailEmptyHint="Select a method type or template to see details."
      emptyState={emptyState}
      renderCard={(item, { selected: isSelected, onSelect }) => (
        <SelectableCard selected={isSelected} onSelect={onSelect}>
          {item.kind === "type" ? (
            <MethodTypeCard
              module={item.module}
              on={enabledSet.has(item.module.id)}
              curating={curating}
              onToggle={(next) => setEnabled(item.module.id, next)}
            />
          ) : (
            <ProtocolTemplateCard
              entry={item.entry}
              typeEnabled={enabledSet.has(item.entry.method_type as MethodTypeId)}
              isUsing={usingSlug === item.entry.slug}
              anyUsing={usingSlug !== null}
              onUse={() => handleUse(item.entry)}
              onEnableType={() =>
                setEnabled(item.entry.method_type as MethodTypeId, true)
              }
            />
          )}
        </SelectableCard>
      )}
      renderDetail={(item) => (
        <LibraryDetailPlaceholder item={item} enabledSet={enabledSet} />
      )}
      footerSlot={
        <LibraryFooter
          useError={useError}
          destFolder={destFolder}
          onDestFolderChange={setDestFolder}
          existingFolders={existingFolders}
        />
      }
      onClose={onClose}
    />
  );
}

/** Clickable wrapper that selects an item for the detail pane. Interactive
 *  controls inside (toggle / action buttons) stop propagation so they act
 *  without ALSO opening the detail. */
function SelectableCard({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer rounded-lg transition-shadow ${
        selected ? "ring-2 ring-blue-500 ring-offset-2" : ""
      }`}
    >
      {children}
    </div>
  );
}

// ── Method-type card (curation) ──────────────────────────────────────────────

function MethodTypeCard({
  module,
  on,
  curating,
  onToggle,
}: {
  module: MethodModuleMeta;
  on: boolean;
  /** False when signed out / pre-data-setup: the toggle can't persist. */
  curating: boolean;
  onToggle: (next: boolean) => void;
}) {
  const Icon = module.cosmetic.icon;
  return (
    <div className="h-full border border-gray-200 rounded-lg p-4 flex items-start gap-3 bg-white">
      <span
        className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg ${module.cosmetic.color.bg} ${module.cosmetic.color.text}`}
      >
        <Icon className="w-4 h-4" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-sm font-medium text-gray-900">
            {module.cosmetic.label}
          </h5>
          <Tooltip
            label={
              curating
                ? on
                  ? `Disable ${module.cosmetic.label}`
                  : `Enable ${module.cosmetic.label}`
                : "Sign in to change this"
            }
            placement="top"
          >
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={`${on ? "Disable" : "Enable"} ${module.cosmetic.label}`}
              disabled={!curating}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(!on);
              }}
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
        {module.cosmetic.description && (
          <p className="text-xs text-gray-500 mt-1">
            {module.cosmetic.description}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Protocol-template card ───────────────────────────────────────────────────

function ProtocolTemplateCard({
  entry,
  typeEnabled,
  isUsing,
  anyUsing,
  onUse,
  onEnableType,
}: {
  entry: MethodCatalogManifestEntry;
  typeEnabled: boolean;
  isUsing: boolean;
  anyUsing: boolean;
  onUse: () => void;
  onEnableType: () => void;
}) {
  const typeId = entry.method_type as MethodTypeId;
  const meta = getMethodTypeMeta(typeId);
  const Icon = meta.icon;
  return (
    <div className="h-full border border-gray-200 rounded-lg p-4 flex flex-col bg-white hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <h5 className="text-sm font-medium text-gray-900">{entry.title}</h5>
        <span
          className={`shrink-0 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${meta.color.bg} ${meta.color.text}`}
        >
          <Icon className="w-3 h-3" />
          {meta.label}
        </span>
      </div>
      <p className="text-xs text-gray-500 mt-1 flex-1">{entry.description}</p>
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
            <span className="text-[10px] text-amber-600">Type disabled</span>
          </Tooltip>
        )}
        {typeEnabled ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUse();
            }}
            disabled={anyUsing}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isUsing ? "Adding..." : "Use template"}
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEnableType();
            }}
            className="px-3 py-1.5 text-xs border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50"
          >
            Enable {meta.label}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Detail placeholder (Phase D fills this) ──────────────────────────────────

function LibraryDetailPlaceholder({
  item,
  enabledSet,
}: {
  item: LibraryItem;
  enabledSet: Set<MethodTypeId>;
}) {
  if (item.kind === "type") {
    const on = enabledSet.has(item.module.id);
    const Icon = item.module.cosmetic.icon;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg ${item.module.cosmetic.color.bg} ${item.module.cosmetic.color.text}`}
            >
              <Icon className="w-4 h-4" />
            </span>
            <h4 className="text-base font-semibold text-gray-900 truncate">
              {item.module.cosmetic.label}
            </h4>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              on ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"
            }`}
          >
            {on ? "Enabled" : "Disabled"}
          </span>
        </div>
        {item.module.cosmetic.description && (
          <p className="text-sm text-gray-600 leading-snug">
            {item.module.cosmetic.description}
          </p>
        )}
        <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
          A sample rendering and full details arrive in the next update.
        </p>
      </div>
    );
  }

  const meta = getMethodTypeMeta(item.entry.method_type as MethodTypeId);
  const Icon = meta.icon;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-base font-semibold text-gray-900">
          {item.entry.title}
        </h4>
        <span
          className={`shrink-0 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${meta.color.bg} ${meta.color.text}`}
        >
          <Icon className="w-3 h-3" />
          {meta.label}
        </span>
      </div>
      {item.entry.description && (
        <p className="text-sm text-gray-600 leading-snug">
          {item.entry.description}
        </p>
      )}
      {item.entry.tags && item.entry.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {item.entry.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
        A read-only protocol preview arrives in the next update.
      </p>
    </div>
  );
}

// ── Search + footer ──────────────────────────────────────────────────────────

/** Search box for the rail. State is owned by the caller; the filtering runs
 *  per segment (type label + description in Types, template title + tags in
 *  Templates) via method-library-filter.ts. */
function MethodSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        Search library
      </label>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name, type, or tag..."
        aria-label="Search library"
        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      />
    </div>
  );
}

/** Footer slot: the template destination-folder control, any "Use template"
 *  error, and the request-a-new-type stub. */
function LibraryFooter({
  useError,
  destFolder,
  onDestFolderChange,
  existingFolders,
}: {
  useError: string | null;
  destFolder: string;
  onDestFolderChange: (v: string) => void;
  existingFolders: string[];
}) {
  const [requestText, setRequestText] = useState("");
  return (
    <div className="flex flex-col gap-6">
      {useError && <p className="text-sm text-red-600">{useError}</p>}

      <div className="min-w-[220px] max-w-sm">
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Add used templates to category
        </label>
        <input
          type="text"
          list="template-dest-folders"
          value={destFolder}
          onChange={(e) => onDestFolderChange(e.target.value)}
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

      <div className="border-t border-gray-100 pt-6">
        <h4 className="text-sm font-semibold text-gray-700 mb-1">
          Need a type that isn&apos;t here?
        </h4>
        <p className="text-xs text-gray-400 mb-3">
          Method types are built and reviewed on GitHub, then ship in an
          update. Describe what you need and we&apos;ll open an issue for you.
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
      </div>
    </div>
  );
}
