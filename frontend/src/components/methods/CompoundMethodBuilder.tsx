"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

/**
 * Compound builder workspace. Used in two modes:
 *
 *  - "create": user picked the Compound tile in the new-method dialog;
 *    builder runs as the dialog's stage-2 view, persisting a fresh Method
 *    row on save (with method_type: "compound" + components array).
 *  - "edit": user opened an existing compound from the methods list;
 *    builder pre-fills its component list, saves rewrite it.
 *
 * Per Q-V1 lock, compounds are private-only in v2 — the "Make public"
 * toggle is hidden here. The sharing path lands in v2.1.
 *
 * Drag-reorder uses native HTML5 drag/drop (library-free per the brief).
 * The component-add sub-picker only shows the "pick existing method" path
 * in this chip; "inline-create-a-new-child" launches the user out to the
 * standalone new-method dialog. That's deliberate: per proposal section
 * 2.4.3 the recommendation is "build child first, attach by reference"
 * to avoid modal-on-modal-on-modal recursion, and gives us a tight LOC
 * budget here (well below the 1500 cap — file currently ~600 LOC).
 */

export interface CompoundMethodBuilderProps {
  /** Existing compound, when editing. Omit (or pass `null`) for create mode. */
  editing?: Method | null;
  /** Folders that already exist in the user's methods list — used as autocomplete. */
  existingFolders: string[];
  /** Folder pre-filled when the user came through "+ Add method" on a category. */
  prefilledFolder?: string;
  onClose: () => void;
  onSaved: (method: Method) => void;
}

export function CompoundMethodBuilder({
  editing,
  existingFolders,
  prefilledFolder,
  onClose,
  onSaved,
}: CompoundMethodBuilderProps) {
  const [name, setName] = useState(editing?.name ?? "");
  const [folder, setFolder] = useState(editing?.folder_path ?? prefilledFolder ?? "");
  const [tags, setTags] = useState((editing?.tags ?? []).join(", "));
  // Initialize an editable copy of the components array, sorted by ordering.
  const [components, setComponents] = useState<CompoundComponent[]>(() => {
    const list = editing?.components ?? [];
    return [...list].sort((a, b) => a.ordering - b.ordering);
  });
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Drag-reorder state — index of the row currently being dragged.
  const [dragIndex, setDragIndex] = useState<number | null>(null);

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
      editing ? { id: editing.id, owner: editing.owner } : { id: -1, owner: currentUser },
    );
  }, [components, allMethods, editing, currentUser]);

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
          ? "This compound contains a cycle. Remove the offending component first."
          : validation.reason === "depth_exceeded"
            ? `Nesting exceeds ${MAX_COMPOUND_DEPTH} levels. Flatten an inner compound and try again.`
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
      if (editing) {
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
      } else {
        const created = await methodsApi.create({
          name: name.trim(),
          source_path: null,
          method_type: "compound",
          folder_path: folder.trim() || null,
          tags: tagList,
          is_public: false, // Q-V1 lock: compounds are private-only in v2.
          components,
        });
        onSaved(created);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save compound method.";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [name, folder, tags, components, validation, editing, onSaved]);

  // Esc closes the modal.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">
            {editing ? "Edit compound method" : "Build compound method"}
          </h3>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <p className="text-xs text-gray-500">
            A compound method bundles existing methods into one attachable
            unit. Open it on an experiment and every component renders inline
            with its own editor — per-task edits are saved against this
            compound, not the source methods.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Compound name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. "Assay X full kit"'
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Folder (optional)
              </label>
              <input
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="e.g. Assays"
                list="compound-builder-folders"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <datalist id="compound-builder-folders">
                {existingFolders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Tags (comma-separated, optional)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. kit, assay"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Per Q-V1 lock: no public toggle for compounds in v2. */}
          <p className="text-xs text-gray-400 italic">
            Compound methods are private in v2; cross-user sharing arrives in v2.1.
          </p>

          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-500">Components</label>
              <span className="text-xs text-gray-400">
                Drag rows by the handle to reorder.
              </span>
            </div>
            <ComponentList
              components={components}
              allMethods={allMethods}
              currentUser={currentUser}
              compoundOwner={editing?.owner ?? currentUser}
              dragIndex={dragIndex}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onRemove={handleRemoveComponent}
              onLabelChange={handleLabelChange}
            />
            <button
              onClick={() => setShowPicker(true)}
              className="mt-3 w-full px-4 py-2 text-sm border border-dashed border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              + Add component
            </button>
          </div>

          {/* Inline validation feedback. Save remains disabled until clean. */}
          {!validation.ok && components.length > 0 && (
            <div className="border border-red-200 bg-red-50 rounded p-3">
              <div className="text-xs font-medium text-red-700">
                {validation.reason === "cycle"
                  ? "Cycle detected"
                  : validation.reason === "depth_exceeded"
                    ? "Nested too deep"
                    : "Component missing"}
              </div>
              <div className="text-sm text-red-900 mt-1">
                {validation.reason === "cycle" &&
                  `Components form a cycle in the composition graph. Remove the loop before saving.`}
                {validation.reason === "depth_exceeded" &&
                  `Compounds can nest up to ${MAX_COMPOUND_DEPTH} levels. Flatten an inner kit before saving.`}
                {validation.reason === "orphan_reference" &&
                  `Component method ${validation.details.orphan?.method_id} (owner ${validation.details.orphan?.owner}) no longer exists. Remove it before saving.`}
              </div>
            </div>
          )}
          {saveError && (
            <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-900">
              {saveError}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !validation.ok}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving..." : editing ? "Save changes" : "Create compound"}
          </button>
        </div>
      </div>
      {showPicker && (
        <ComponentPicker
          allMethods={allMethods}
          currentUser={currentUser}
          editingCompoundId={editing?.id}
          existingComponents={components}
          onCancel={() => setShowPicker(false)}
          onPick={handleAddComponent}
        />
      )}
    </div>
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
      <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center">
        <p className="text-sm text-gray-400">No components yet</p>
        <p className="text-xs text-gray-300 mt-1">
          Click &ldquo;+ Add component&rdquo; below to attach existing methods.
        </p>
      </div>
    );
  }
  return (
    <ul className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
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
            className={`flex items-center gap-3 px-3 py-2.5 bg-white ${
              isDragging ? "opacity-40" : ""
            } ${isOrphan ? "bg-amber-50" : ""}`}
          >
            <span
              className="text-gray-300 cursor-grab active:cursor-grabbing select-none"
              title="Drag to reorder"
            >
              ⋮⋮
            </span>
            <span className="text-xs text-gray-400 w-5">{idx + 1}.</span>
            <Icon className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={c.label ?? ""}
                  onChange={(e) => onLabelChange(idx, e.target.value)}
                  placeholder={child?.name ?? `Method ${c.method_id}`}
                  className="text-sm bg-transparent border-b border-transparent hover:border-gray-200 focus:border-blue-400 focus:outline-none px-1 py-0.5 min-w-[180px] flex-1"
                />
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.color.bg} ${meta.color.text}`}>
                  {meta.shortLabel}
                </span>
                {isOrphan && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                    Deleted
                  </span>
                )}
              </div>
              {child && (
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {child.name} · owner {owner} · id {c.method_id}
                </div>
              )}
            </div>
            <Tooltip label="Remove component" placement="left">
              <button
                onClick={() => onRemove(idx)}
                className="text-gray-400 hover:text-red-500 text-sm px-2 py-1"
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
// "Create new" tab. The Create-new tab in this chip simply tells the user
// to use the main + New Method dialog and then come back — keeps modal-
// on-modal recursion off the table for the foundation chip. (The 1500 LOC
// cap is comfortable here; future chips can promote Create-new to inline
// editor launchers if needed.)

interface ComponentPickerProps {
  allMethods: Method[];
  currentUser: string;
  editingCompoundId: number | undefined;
  existingComponents: CompoundComponent[];
  onCancel: () => void;
  onPick: (method: Method) => void;
}

function ComponentPicker({
  allMethods,
  currentUser,
  editingCompoundId,
  existingComponents,
  onCancel,
  onPick,
}: ComponentPickerProps) {
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
        if (editingCompoundId !== undefined && m.id === editingCompoundId) {
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

  // Esc closes the picker
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const structured = getMethodTypesByCategory("structured");
  const standard = getMethodTypesByCategory("standard");
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Add component</h3>
          <Tooltip label="Cancel" placement="bottom">
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="p-4 border-b border-gray-100 space-y-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search methods by name or folder..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setTypeFilter("all")}
              className={`text-xs px-2 py-1 rounded-full border ${
                typeFilter === "all"
                  ? "bg-blue-50 border-blue-300 text-blue-700"
                  : "border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              All types
            </button>
            {[...standard, ...structured].map((meta) => (
              <button
                key={meta.id}
                onClick={() => setTypeFilter(meta.id)}
                className={`text-xs px-2 py-1 rounded-full border inline-flex items-center gap-1 ${
                  typeFilter === meta.id
                    ? `${meta.color.bg} ${meta.color.text} border-current`
                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
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
            <p className="text-sm text-gray-400 text-center py-8">
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
                          ? "border-gray-100 bg-gray-50 cursor-not-allowed opacity-60"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-medium text-gray-900 flex-1">
                          {m.name}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${meta.color.bg} ${meta.color.text}`}
                        >
                          {meta.shortLabel}
                        </span>
                        {alreadyAttached && (
                          <span className="text-[10px] text-gray-400 italic">
                            already added
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
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
        <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-400">
          To create a new method, close this dialog and use the
          &ldquo;+ New Method&rdquo; button on the methods page, then come back
          here to attach it.
        </div>
      </div>
    </div>
  );
}
