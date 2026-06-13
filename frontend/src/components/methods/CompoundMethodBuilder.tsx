"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePopupLayer } from "@/lib/ui/popup-stack";
import {
  methodsApi,
  fetchAllMethodsIncludingShared,
  usersApi,
} from "@/lib/local-api";
import type { CompoundComponent, Method } from "@/lib/types";
import {
  getMethodTypeMeta,
  getMethodTypesByCategory,
  type MethodTypeId,
} from "@/lib/methods/method-type-registry";
import {
  MAX_COMPOUND_DEPTH,
  validateCompoundComponents,
} from "@/lib/methods/compound-graph";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import { CompoundChildCreator } from "./CompoundChildCreator";
import { rollbackInlineCreatedChildren } from "./compound-builder-cleanup";

/**
 * Compound builder workspace — edits an existing compound method's component
 * list. Always opened with an `editing` target (the Phase 0d
 * compound-as-extension chip removed the standalone "create compound from
 * scratch" entry-point; new compounds are now created by the
 * `methodsApi.wrapAsCompound` helper, which produces an N=1 compound and
 * hands it to this builder for the user to add component #2 onward).
 *
 * Per Q-V1 lock, compounds are private-only in v2 — the "Make public"
 * toggle is hidden here. The sharing path lands in v2.1.
 *
 * Drag-reorder uses native HTML5 drag/drop (library-free per the brief).
 * The component-add sub-picker has two tabs per proposal section 2.4.3:
 *   - "Pick existing": fuzzy-search across the user's methods library.
 *   - "Create new": inline type-picker + per-type editor (excluding the
 *     Compound tile, to keep nested-compound creation out of this surface
 *     and avoid modal-on-modal-on-modal recursion). On save, the new method
 *     lands in the user's methods library AND attaches to this compound's
 *     components list — one coherent flow, no bounce-out to the methods
 *     page. Inline-create body lives in CompoundChildCreator.tsx so the
 *     builder stays focused on orchestration + drag-reorder.
 */

export interface CompoundMethodBuilderProps {
  /** The compound being edited. Required — there is no "build from scratch"
   *  entry-point after Phase 0d. */
  editing: Method;
  /** Folders that already exist in the user's methods list — used as autocomplete. */
  existingFolders: string[];
  onClose: () => void;
  onSaved: (method: Method) => void;
}

export function CompoundMethodBuilder({
  editing,
  existingFolders,
  onClose,
  onSaved,
}: CompoundMethodBuilderProps) {
  const [name, setName] = useState(editing.name);
  const [folder, setFolder] = useState(editing.folder_path ?? "");
  const [tags, setTags] = useState((editing.tags ?? []).join(", "));
  // Initialize an editable copy of the components array, sorted by ordering.
  const [components, setComponents] = useState<CompoundComponent[]>(() => {
    const list = editing.components ?? [];
    return [...list].sort((a, b) => a.ordering - b.ordering);
  });
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Drag-reorder state — index of the row currently being dragged.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // IDs of child methods created via the "Create new" tab during this
  // builder session. Used to roll back orphan records on cancel — the
  // save path leaves this list alone since persisted compounds reference
  // these children directly. Existing children attached via "Pick existing"
  // are NOT tracked here and never get deleted on cancel.
  const [inlineCreatedIds, setInlineCreatedIds] = useState<number[]>([]);

  const queryClient = useQueryClient();
  // Load all methods so we can resolve the child references for display
  // and so the picker has a complete list.
  const { data: allMethods = [] } = useQuery({
    queryKey: ["methods"],
    queryFn: fetchAllMethodsIncludingShared,
  });

  const { data: userData } = useQuery({
    queryKey: ["users"],
    queryFn: usersApi.list,
  });
  const currentUser = userData?.current_user || "";

  // Re-validate the in-progress component graph whenever it changes.
  // Save is hard-blocked when validation fails.
  const validation = useMemo(() => {
    return validateCompoundComponents(
      components,
      allMethods,
      { id: editing.id, owner: editing.owner },
    );
  }, [components, allMethods, editing]);

  const handleAddComponent = useCallback(
    (method: Method) => {
      setComponents((prev) => [
        ...prev,
        {
          method_id: method.id,
          // null = same user as the compound; only set explicit owner when
          // crossing namespaces (e.g. attaching a public child).
          owner: method.owner === currentUser ? null : method.owner,
          ordering: prev.length,
        },
      ]);
      setShowPicker(false);
    },
    [currentUser],
  );

  // Inline-created child: the picker's "Create new" tab fires this once the
  // child's methodsApi.create call has resolved. We optimistically inject the
  // new Method into the cached "methods" list so validateCompoundComponents
  // doesn't flag the just-added component as an orphan before the refetch
  // settles, then kick the refetch so subsequent renders see the source of
  // truth from disk.
  const handleInlineChildCreated = useCallback(
    (method: Method) => {
      queryClient.setQueryData<Method[]>(["methods"], (prev) =>
        prev ? [...prev, method] : [method],
      );
      void queryClient.refetchQueries({ queryKey: ["methods"] });
      setInlineCreatedIds((prev) => [...prev, method.id]);
      handleAddComponent(method);
    },
    [queryClient, handleAddComponent],
  );

  // Cancel-path funnel: Escape, X button, and the Cancel button all route
  // through here so inline-created children get cleaned up exactly once,
  // regardless of which exit the user takes. Cleanup is best-effort and
  // never blocks the close — see compound-builder-cleanup.ts.
  const handleCancel = useCallback(() => {
    if (inlineCreatedIds.length > 0) {
      void rollbackInlineCreatedChildren(inlineCreatedIds).finally(() => {
        void queryClient.refetchQueries({ queryKey: ["methods"] });
      });
    }
    onClose();
  }, [inlineCreatedIds, onClose, queryClient]);

  const handleRemoveComponent = useCallback((idx: number) => {
    setComponents((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((c, i) => ({ ...c, ordering: i })),
    );
  }, []);

  const handleLabelChange = useCallback((idx: number, label: string) => {
    setComponents((prev) =>
      prev.map((c, i) =>
        i === idx ? { ...c, label: label.trim() ? label : undefined } : c,
      ),
    );
  }, []);

  // Drag-reorder handlers — native HTML5 DnD. The handle on each row marks
  // itself draggable; on drop we splice the array.
  const handleDragStart = useCallback((idx: number) => {
    setDragIndex(idx);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (targetIdx: number) => {
      if (dragIndex === null || dragIndex === targetIdx) {
        setDragIndex(null);
        return;
      }
      setComponents((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(targetIdx, 0, moved);
        return next.map((c, i) => ({ ...c, ordering: i }));
      });
      setDragIndex(null);
    },
    [dragIndex],
  );

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setSaveError("Name is required.");
      return;
    }
    if (!validation.ok) {
      setSaveError(
        validation.reason === "cycle"
          ? "This kit contains a cycle. Remove the offending component first."
          : validation.reason === "depth_exceeded"
            ? `Nesting exceeds ${MAX_COMPOUND_DEPTH} levels. Flatten an inner kit and try again.`
            : "One of the referenced methods no longer exists. Remove it and try again.",
      );
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      // Compounds always carry `source_path: null` (components live inline,
      // no parallel protocol record per proposal section 2.1.1).
      const updated = await methodsApi.update(
        editing.id,
        {
          name: name.trim(),
          folder_path: folder.trim() || null,
          tags: tagList,
          components,
        },
        // Pass through the existing owner so receivers editing a shared
        // compound write back to the owner's dir.
        editing.is_shared_with_me && editing.shared_permission === "edit"
          ? editing.owner
          : undefined,
      );
      if (updated) onSaved(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save kit.";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [name, folder, tags, components, validation, editing, onSaved]);

  // CompoundMethodBuilder keeps its PARENT mount-gate ({editingCompound && ...})
  // because all of its form state (name / folder / tags / components) is seeded
  // from the `editing` prop on mount; always-rendering would strand stale state
  // from a previously-edited compound. So `open` is a constant true here and the
  // parent unmount drives the close (LivingPopup unifies the entrance + blur +
  // X; only the zoom-OUT exit is skipped). Escape / scrim / X all route through
  // handleCancel so inline-created children are rolled back.
  return (
    <>
    <LivingPopup
      open
      onClose={handleCancel}
      label="Edit kit"
      widthClassName="max-w-3xl"
      card={false}
      // While the "Add component" sub-modal is open it owns Escape (its own
      // window handler closes just the picker), so we stand the builder's Escape
      // down. LivingPopup's stack-based isTop guard would also defer to the
      // picker (it registers in the popup stack on top), but gating here makes
      // the precedence explicit at the call site.
      closeOnEscape={!showPicker}
    >
      <div className="bg-surface-raised rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-title font-semibold text-foreground">
            Edit kit
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <p className="text-meta text-foreground-muted">
            A kit bundles existing methods into one attachable
            unit. Open it on an experiment and every component renders inline
            with its own editor; per-task edits are saved against this
            kit, not the source methods.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-meta font-medium text-foreground-muted mb-1">
                Kit name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. "Assay X full kit"'
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-meta font-medium text-foreground-muted mb-1">
                Folder (optional)
              </label>
              <input
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="e.g. Assays"
                list="compound-builder-folders"
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <datalist id="compound-builder-folders">
                {existingFolders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="block text-meta font-medium text-foreground-muted mb-1">
              Tags (comma-separated, optional)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. kit, assay"
              className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Per Q-V1 lock: no public toggle for compounds in v2. */}
          <p className="text-meta text-foreground-muted italic">
            Kits are private in v2; cross-user sharing arrives in v2.1.
          </p>

          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-meta font-medium text-foreground-muted">Components</label>
              <span className="text-meta text-foreground-muted">
                Drag rows by the handle to reorder.
              </span>
            </div>
            <ComponentList
              components={components}
              allMethods={allMethods}
              currentUser={currentUser}
              compoundOwner={editing.owner || currentUser}
              dragIndex={dragIndex}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onRemove={handleRemoveComponent}
              onLabelChange={handleLabelChange}
            />
            <button
              onClick={() => setShowPicker(true)}
              className="mt-3 w-full px-4 py-2 text-body border border-dashed border-border text-foreground-muted rounded-lg hover:bg-surface-sunken"
            >
              + Add component
            </button>
          </div>

          {/* Inline validation feedback. Save remains disabled until clean. */}
          {!validation.ok && components.length > 0 && (
            <div className="border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 rounded p-3">
              <div className="text-meta font-medium text-red-700 dark:text-red-300">
                {validation.reason === "cycle"
                  ? "Cycle detected"
                  : validation.reason === "depth_exceeded"
                    ? "Nested too deep"
                    : "Component missing"}
              </div>
              <div className="text-body text-red-900 mt-1">
                {validation.reason === "cycle" &&
                  `Components form a cycle in the composition graph. Remove the loop before saving.`}
                {validation.reason === "depth_exceeded" &&
                  `Kits can nest up to ${MAX_COMPOUND_DEPTH} levels. Flatten an inner kit before saving.`}
                {validation.reason === "orphan_reference" &&
                  `Component method ${validation.details.orphan?.method_id} (owner ${validation.details.orphan?.owner}) no longer exists. Remove it before saving.`}
              </div>
            </div>
          )}
          {saveError && (
            <div className="border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 rounded p-3 text-body text-red-900">
              {saveError}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !validation.ok}
            className="px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </LivingPopup>
    {/* The "Add component" sub-modal stays on its OWN bespoke fixed-inset-0
        overlay (NOT migrated to LivingPopup) and renders as a SIBLING of the
        builder popup, outside its transformed card. Reason it is left unmigrated
        (popup-migration batch 5 decision): a nested LivingPopup would render
        inside the builder card's transform, which clips a fixed-inset-0 overlay
        (recipe rule 8).
        Escape coordination: a single Escape closes JUST the picker, not the
        builder underneath. The builder passes closeOnEscape={!showPicker} above,
        standing its handler down while the picker is open, and the picker's own
        window handler (hardened to preventDefault + stopPropagation) closes just
        the picker. LivingPopup's stack-based isTop guard reinforces this, the
        picker registers in the popup stack on top, so the builder defers to it.
        Rendering it as a fragment sibling keeps it above the builder's z-[400]
        scrim (its own z-[65]) while the builder's blurred scrim shows through
        behind it. Master to decide if a stacked-popup primitive is wanted. */}
    {showPicker && (
      <ComponentPicker
        allMethods={allMethods}
        currentUser={currentUser}
        editingCompoundId={editing.id}
        existingComponents={components}
        existingFolders={existingFolders}
        onCancel={() => setShowPicker(false)}
        onPick={handleAddComponent}
        onCreatedInline={handleInlineChildCreated}
      />
    )}
    </>
  );
}

// ── Component list ──────────────────────────────────────────────────────────

interface ComponentListProps {
  components: CompoundComponent[];
  allMethods: Method[];
  currentUser: string;
  compoundOwner: string;
  dragIndex: number | null;
  onDragStart: (idx: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (idx: number) => void;
  onRemove: (idx: number) => void;
  onLabelChange: (idx: number, label: string) => void;
}

function ComponentList({
  components,
  allMethods,
  compoundOwner,
  dragIndex,
  onDragStart,
  onDragOver,
  onDrop,
  onRemove,
  onLabelChange,
}: ComponentListProps) {
  if (components.length === 0) {
    return (
      <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
        <p className="text-body text-foreground-muted">No components yet</p>
        <p className="text-meta text-foreground-muted mt-1">
          Click &ldquo;+ Add component&rdquo; below to attach existing methods.
        </p>
      </div>
    );
  }
  return (
    <ul className="border border-border rounded-lg overflow-hidden divide-y divide-gray-100">
      {components.map((c, idx) => {
        const owner = c.owner ?? compoundOwner;
        const child = allMethods.find((m) => m.id === c.method_id && m.owner === owner);
        const meta = getMethodTypeMeta(child?.method_type ?? null);
        const Icon = meta.icon;
        const isDragging = dragIndex === idx;
        const isOrphan = !child;
        return (
          <li
            key={`${owner}:${c.method_id}:${idx}`}
            draggable
            onDragStart={() => onDragStart(idx)}
            onDragOver={onDragOver}
            onDrop={() => onDrop(idx)}
            className={`flex items-center gap-3 px-3 py-2.5 bg-surface-raised ${
              isDragging ? "opacity-40" : ""
            } ${isOrphan ? "bg-amber-50 dark:bg-amber-500/10" : ""}`}
          >
            <span
              className="text-foreground-muted cursor-grab active:cursor-grabbing select-none"
              title="Drag to reorder"
            >
              ⋮⋮
            </span>
            <span className="text-meta text-foreground-muted w-5">{idx + 1}.</span>
            <Icon className="w-4 h-4 text-foreground-muted flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={c.label ?? ""}
                  onChange={(e) => onLabelChange(idx, e.target.value)}
                  placeholder={child?.name ?? `Method ${c.method_id}`}
                  className="text-body bg-transparent border-b border-transparent hover:border-border focus:border-blue-400 focus:outline-none px-1 py-0.5 min-w-[180px] flex-1"
                />
                <span className={`text-meta px-1.5 py-0.5 rounded ${meta.color.bg} ${meta.color.text}`}>
                  {meta.shortLabel}
                </span>
                {isOrphan && (
                  <span className="text-meta px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
                    Deleted
                  </span>
                )}
              </div>
              {child && (
                <div className="text-meta text-foreground-muted mt-0.5">
                  {child.name} · owner {owner} · id {c.method_id}
                </div>
              )}
            </div>
            <Tooltip label="Remove component" placement="left">
              <button
                onClick={() => onRemove(idx)}
                className="text-foreground-muted hover:text-red-500 text-body px-2 py-1"
              >
                ✕
              </button>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

// ── Component picker (sub-modal) ────────────────────────────────────────────
//
// Per proposal section 2.4.3 the picker has a "Pick existing" tab + an
// "Create new" tab. Both live in the same modal — the tab swaps the body —
// so we don't stack a third modal layer on top of the builder. The
// "Create new" body is delegated to CompoundChildCreator which owns the
// per-type state + save flow (mirrors CreateMethodModal's per-type dispatch,
// minus the compound tile to keep recursion off the table).

interface ComponentPickerProps {
  allMethods: Method[];
  currentUser: string;
  editingCompoundId: number;
  existingComponents: CompoundComponent[];
  existingFolders: string[];
  onCancel: () => void;
  onPick: (method: Method) => void;
  onCreatedInline: (method: Method) => void;
}

type PickerTab = "pick" | "create";

function ComponentPicker({
  allMethods,
  currentUser,
  editingCompoundId,
  existingComponents,
  existingFolders,
  onCancel,
  onPick,
  onCreatedInline,
}: ComponentPickerProps) {
  // Stacks on the builder's LivingPopup (z-[400]), so blur only when bottom-most
  // to avoid compounding on the blur already behind it.
  const { shouldBlur } = usePopupLayer(true, true);
  const [tab, setTab] = useState<PickerTab>("pick");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<MethodTypeId | "all">("all");
  const existingKeys = useMemo(
    () =>
      new Set(
        existingComponents.map(
          (c) => `${c.owner ?? currentUser}:${c.method_id}`,
        ),
      ),
    [existingComponents, currentUser],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allMethods
      .filter((m) => {
        // Exclude the compound itself to prevent immediate self-reference;
        // deeper cycles are caught by validateCompoundComponents.
        if (m.id === editingCompoundId) {
          return false;
        }
        if (typeFilter !== "all" && m.method_type !== typeFilter) return false;
        if (!needle) return true;
        const folder = m.folder_path ?? "";
        return (
          m.name.toLowerCase().includes(needle) ||
          folder.toLowerCase().includes(needle)
        );
      })
      .slice(0, 100); // cap to keep the list scannable
  }, [allMethods, query, typeFilter, editingCompoundId]);

  // Esc closes the picker. Mirrors useEscapeToClose: bail if already handled
  // (e.g. an overlay nested inside the picker), and mark it handled when we act
  // so the builder underneath does not also react to the same press.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const structured = getMethodTypesByCategory("structured");
  const standard = getMethodTypesByCategory("standard");
  return (
    <div
      // z-[450] sits ABOVE the builder's LivingPopup (z-[400]) so this
      // sub-modal stacks on top. It is rendered as a fragment sibling of the
      // builder popup (see CompoundMethodBuilder's render note) rather than
      // migrated to LivingPopup, to avoid the nested-Escape + transform-clip
      // pitfalls of two stacked LivingPopups.
      className={`fixed inset-0 z-[450] flex items-center justify-center bg-black/40 ${
        shouldBlur ? "backdrop-blur-sm" : ""
      }`}
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27).
      data-tour-popup-occluding="compound-method-add-component"
    >
      <div className="bg-surface-raised rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-title font-semibold text-foreground">Add component</h3>
          <Tooltip label="Cancel" placement="bottom">
            <button
              onClick={onCancel}
              className="text-foreground-muted hover:text-foreground text-heading"
            >
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="px-6 pt-3 flex gap-1 border-b border-border">
          <PickerTabButton
            active={tab === "pick"}
            onClick={() => setTab("pick")}
            label="Pick existing"
          />
          <PickerTabButton
            active={tab === "create"}
            onClick={() => setTab("create")}
            label="Create new"
          />
        </div>
        {tab === "pick" && (
          <>
            <div className="p-4 border-b border-border space-y-3">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search methods by name or folder..."
                className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => setTypeFilter("all")}
                  className={`text-meta px-2 py-1 rounded-full border ${
                    typeFilter === "all"
                      ? "bg-blue-50 dark:bg-blue-500/10 border-blue-300 text-blue-700 dark:text-blue-300"
                      : "border-border text-foreground-muted hover:bg-surface-sunken"
                  }`}
                >
                  All types
                </button>
                {[...standard, ...structured].map((meta) => (
                  <button
                    key={meta.id}
                    onClick={() => setTypeFilter(meta.id)}
                    className={`text-meta px-2 py-1 rounded-full border inline-flex items-center gap-1 ${
                      typeFilter === meta.id
                        ? `${meta.color.bg} ${meta.color.text} border-current`
                        : "border-border text-foreground-muted hover:bg-surface-sunken"
                    }`}
                  >
                    <meta.icon className="w-3 h-3" />
                    {meta.shortLabel}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {filtered.length === 0 ? (
                <p className="text-body text-foreground-muted text-center py-8">
                  No methods match this filter.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {filtered.map((m) => {
                    const meta = getMethodTypeMeta(m.method_type ?? null);
                    const Icon = meta.icon;
                    const alreadyAttached = existingKeys.has(`${m.owner}:${m.id}`);
                    return (
                      <li key={`${m.owner}:${m.id}`}>
                        <button
                          onClick={() => onPick(m)}
                          disabled={alreadyAttached}
                          className={`w-full text-left px-3 py-2 rounded-lg border ${
                            alreadyAttached
                              ? "border-border bg-surface-sunken cursor-not-allowed opacity-60"
                              : "border-border hover:bg-surface-sunken"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-foreground-muted" />
                            <span className="text-body font-medium text-foreground flex-1">
                              {m.name}
                            </span>
                            <span
                              className={`text-meta px-1.5 py-0.5 rounded ${meta.color.bg} ${meta.color.text}`}
                            >
                              {meta.shortLabel}
                            </span>
                            {alreadyAttached && (
                              <span className="text-meta text-foreground-muted italic">
                                already added
                              </span>
                            )}
                          </div>
                          <div className="text-meta text-foreground-muted mt-0.5">
                            {m.folder_path ?? "Uncategorized"} · owner {m.owner} ·
                            id {m.id}
                            {m.is_public ? " · public" : ""}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="px-6 py-3 border-t border-border text-meta text-foreground-muted">
              Want a brand-new method? Switch to the &ldquo;Create new&rdquo;
              tab above to build one inline and attach it in one step.
            </div>
          </>
        )}
        {tab === "create" && (
          <div className="flex-1 overflow-hidden flex flex-col px-6 py-4">
            <CompoundChildCreator
              existingFolders={existingFolders}
              onCancel={onCancel}
              onCreated={onCreatedInline}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PickerTabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-body rounded-t-md border-b-2 transition-colors ${
        active
          ? "border-blue-500 text-blue-700 dark:text-blue-300 font-medium"
          : "border-transparent text-foreground-muted hover:text-foreground hover:bg-surface-sunken"
      }`}
    >
      {label}
    </button>
  );
}
