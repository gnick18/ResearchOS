"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { methodsApi as rawMethodsApi, filesApi, pcrApi, lcGradientApi, usersApi, fetchAllMethodsIncludingShared } from "@/lib/local-api";
import type { MethodUpdate } from "@/lib/local-api";
import { fileService } from "@/lib/file-system/file-service";
import { fileEvents } from "@/lib/attachments/file-events";
import { migrateNoteImages } from "@/lib/notes/migrate-images";
import { createNewFileContent, hasLegacyStampFormat, normalizeStampFormat } from "@/lib/stamp-utils";
import AppShell from "@/components/AppShell";
import LiveMarkdownEditor from "@/components/LiveMarkdownEditor";
import RenderedMarkdown from "@/components/RenderedMarkdown";
import { InteractiveGradientEditor } from "@/components/InteractiveGradientEditor";
import MethodExperimentsSidebar from "@/components/MethodExperimentsSidebar";
import { useFileRenamePopup } from "@/components/FileRenamePopup";
import SharePopup from "@/components/SharePopup";
import Tooltip from "@/components/Tooltip";
import type {
  Method,
  PCRProtocol,
  PCRGradient,
  PCRIngredient,
  LCGradientColumn,
  LCGradientStep,
  LCIngredient,
} from "@/lib/types";
import LcViewer from "@/components/LcViewer";
import LcGradientEditor from "@/components/LcGradientEditor";
import {
  getMethodTypeMeta,
  getMethodTypesByCategory,
  type MethodTypeId,
} from "@/lib/methods/method-type-registry";

/**
 * When the current viewer is a receiver of a shared method with edit
 * permission, every mutation needs to write back to the OWNER's directory
 * (e.g. `users/Kritika/methods/1.json`), not the current user's. Plain own
 * methods (or read-only views) pass undefined and the writes go to the
 * current user's directory. Mirrors the pattern in TaskDetailPopup.
 */
function effectiveOwnerOf(method: Method): string | undefined {
  return method.is_shared_with_me && method.shared_permission === "edit"
    ? method.owner
    : undefined;
}

function ownerScopedMethodsApi(method: Method) {
  const owner = effectiveOwnerOf(method);
  return {
    ...rawMethodsApi,
    get: (id: number) => rawMethodsApi.get(id, owner),
    update: (id: number, data: MethodUpdate) => rawMethodsApi.update(id, data, owner),
    fork: (
      id: number,
      data: { new_name: string; new_source_path: string; deviations: string }
    ) => rawMethodsApi.fork(id, data, owner),
    // `delete` intentionally not owner-routed: only the original owner should
    // be able to destroy the file.
  };
}

// Unscoped methodsApi for read-only flows (list/create) that don't depend on
// a specific Method record. Mutating call sites should use the scoped wrapper
// keyed off the current method instead.
const methodsApi = rawMethodsApi;

async function pickUniqueImageName(dirPath: string, desired: string): Promise<string> {
  const dot = desired.lastIndexOf(".");
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : "";
  let candidate = desired;
  let n = 1;
  while (await fileService.fileExists(`${dirPath}/${candidate}`)) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

export default function MethodsPage() {
  const queryClient = useQueryClient();
  const [viewingMethod, setViewingMethod] = useState<Method | null>(null);
  const [creating, setCreating] = useState(false);
  /** When the user lands on `/methods?createMethod=public`, the
   *  create-method modal opens with "Make this method public" pre-
   *  checked. Stays false the rest of the time. */
  const [forcePublicOnCreate, setForcePublicOnCreate] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [draggedMethod, setDraggedMethod] = useState<Method | null>(null);
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null);
  const [prefilledFolder, setPrefilledFolder] = useState<string>("");
  const [emptyCategories, setEmptyCategories] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  // Deep-link: `/methods?createMethod=public` auto-opens the create
  // modal with the public checkbox pre-checked. Used by the
  // `public-methods` onboarding tip's setupAction.
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams?.get("createMethod") !== "public") return;
    setCreating(true);
    setForcePublicOnCreate(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("createMethod");
    const query = next.toString();
    router.replace(query ? `/methods?${query}` : "/methods");
  }, [searchParams, router]);

  // Load empty categories from localStorage after hydration
  useEffect(() => {
    const saved = localStorage.getItem("emptyMethodCategories");
    if (saved) {
      setEmptyCategories(JSON.parse(saved));
    }
    setIsHydrated(true);
  }, []);

  const { data: methods = [] } = useQuery({
    queryKey: ["methods"],
    queryFn: fetchAllMethodsIncludingShared,
  });

  // Get current user for permission checks
  const { data: userData } = useQuery({
    queryKey: ["users"],
    queryFn: usersApi.list,
  });
  const currentUser = userData?.current_user || "";

  // Deep-link: `/methods?openMethod=<id>` opens the method detail panel
  // (`viewingMethod`) for the matching method once the methods list has
  // loaded, then strips just that param so a reload doesn't re-trigger.
  // Used by the Phase-4 tutorial sequencer to land on /methods with
  // the `public-methods` tip target (the Private/Public toggle button)
  // already in the DOM. Other params (notably `?tutorial=1`) pass
  // through untouched. Resolves the method from the current user's
  // own list first, then falls back to the public namespace so demo
  // IDs like `users/public/methods/1` work too.
  useEffect(() => {
    if (!searchParams) return;
    const wantsMethod = searchParams.get("openMethod");
    if (!wantsMethod) return;
    const mid = Number(wantsMethod);
    if (!Number.isFinite(mid)) return;
    const match =
      methods.find((m) => m.id === mid && m.owner === currentUser) ??
      methods.find((m) => m.id === mid && m.owner === "public") ??
      methods.find((m) => m.id === mid);
    if (!match) return;
    setViewingMethod(match);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("openMethod");
    const query = next.toString();
    router.replace(query ? `/methods?${query}` : "/methods");
  }, [searchParams, methods, currentUser, router]);

  // Save empty categories to localStorage when they change (only after hydration)
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem("emptyMethodCategories", JSON.stringify(emptyCategories));
    }
  }, [emptyCategories, isHydrated]);

  // Group methods by folder
  const grouped = methods.reduce<Record<string, Method[]>>((acc, m) => {
    const folder = m.folder_path || "Uncategorized";
    if (!acc[folder]) acc[folder] = [];
    acc[folder].push(m);
    return acc;
  }, {});

  // Get all existing folder names from methods
  const methodFolders = Array.from(
    new Set(methods.map((m) => m.folder_path).filter(Boolean))
  ) as string[];

  // Combine method folders with empty categories, removing any empty categories that now have methods
  // Also include "Uncategorized" if there are uncategorized methods
  const hasUncategorized = grouped["Uncategorized"] && grouped["Uncategorized"].length > 0;
  const allFolders = Array.from(
    new Set([
      ...methodFolders,
      ...emptyCategories,
      ...(hasUncategorized ? ["Uncategorized"] : [])
    ])
  ).filter((folder) => {
    // Keep the folder if it has methods OR if it's in emptyCategories and doesn't have methods yet
    // Special case: "Uncategorized" should only show when there are uncategorized methods
    if (folder === "Uncategorized") {
      return hasUncategorized;
    }
    const hasMethods = grouped[folder] && grouped[folder].length > 0;
    return hasMethods || emptyCategories.includes(folder);
  });

  // All existing folders for autocomplete (includes empty categories)
  const existingFolders = allFolders;

  // Clean up empty categories that now have methods (only after hydration)
  useEffect(() => {
    if (!isHydrated) return;
    const categoriesWithMethods = new Set(
      methods.map((m) => m.folder_path).filter(Boolean)
    );
    const stillEmpty = emptyCategories.filter(
      (cat) => !categoriesWithMethods.has(cat)
    );
    if (stillEmpty.length !== emptyCategories.length) {
      setEmptyCategories(stillEmpty);
    }
  }, [methods, emptyCategories, isHydrated]);

  // Handle drag and drop
  const handleDragStart = useCallback((method: Method) => {
    setDraggedMethod(method);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, folder: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetFolder(folder);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTargetFolder(null);
  }, []);

  const handleDrop = useCallback(
    async (targetFolder: string) => {
      if (!draggedMethod) return;
      
      // Don't do anything if dropping in the same folder
      const currentFolder = draggedMethod.folder_path || "Uncategorized";
      if (currentFolder === targetFolder) {
        setDraggedMethod(null);
        setDropTargetFolder(null);
        return;
      }

      try {
        // Update the method's folder_path. Use the owner-scoped API so when
        // the dragged method is shared-with-edit, the write lands in the
        // owner's directory.
        const newFolderPath = targetFolder === "Uncategorized" ? null : targetFolder;
        const scoped = ownerScopedMethodsApi(draggedMethod);
        await scoped.update(draggedMethod.id, {
          name: draggedMethod.name,
          source_path: draggedMethod.source_path ?? undefined,
          method_type: draggedMethod.method_type ?? undefined,
          folder_path: newFolderPath,
          parent_method_id: draggedMethod.parent_method_id,
          tags: draggedMethod.tags || [],
        });
        await queryClient.refetchQueries({ queryKey: ["methods"] });
      } catch {
        alert("Failed to move method");
      } finally {
        setDraggedMethod(null);
        setDropTargetFolder(null);
      }
    },
    [draggedMethod, queryClient]
  );

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm("Delete this method and all associated files?")) return;
      try {
        // Find the method to get its directory path
        const method = methods.find((m) => m.id === id);
        if (method && method.source_path) {
          // Handle PCR methods differently
          if (method.method_type === "pcr" && method.source_path.startsWith("pcr://protocol/")) {
            const pcrId = parseInt(method.source_path.replace("pcr://protocol/", ""));
            try {
              await pcrApi.delete(pcrId);
            } catch {
              // Non-fatal — PCR protocol might not exist
            }
          } else if (
            method.method_type === "lc_gradient" &&
            method.source_path.startsWith("lc_gradient://protocol/")
          ) {
            const lcId = parseInt(method.source_path.replace("lc_gradient://protocol/", ""));
            try {
              await lcGradientApi.delete(lcId);
            } catch {
              // Non-fatal — LC gradient protocol might not exist
            }
          } else {
            const methodDir = method.source_path.substring(
              0,
              method.source_path.lastIndexOf("/")
            );
            // Delete the method's directory (includes images)
            try {
              await filesApi.deleteDirectory(methodDir);
            } catch {
              // Non-fatal — directory might not exist
            }
          }
        }
        await methodsApi.delete(id);
        await queryClient.refetchQueries({ queryKey: ["methods"] });
        setViewingMethod(null);
      } catch {
        alert("Failed to delete method");
      }
    },
    [queryClient, methods]
  );

  const handleCategoryCreated = useCallback((categoryName: string, addMethodNow: boolean) => {
    setCreatingCategory(false);
    // Add to empty categories
    setEmptyCategories((prev) => {
      if (!prev.includes(categoryName)) {
        return [...prev, categoryName];
      }
      return prev;
    });
    if (addMethodNow) {
      setPrefilledFolder(categoryName);
      setCreating(true);
    }
  }, []);

  const handleMethodCreated = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ["methods"] });
    setCreating(false);
    setPrefilledFolder("");
  }, [queryClient]);

  return (
    <AppShell>
      <div
        className="flex-1 overflow-auto p-6"
        data-onboarding-target="methods-folder-tree"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-900">
            Method Library
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCreatingCategory(true)}
              className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              + New Category
            </button>
            <button
              onClick={() => setCreating(true)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + New Method
            </button>
          </div>
        </div>

        {/* Drop zone for Uncategorized at the top */}
        {draggedMethod && (
          <div
            className={`mb-4 p-4 border-2 border-dashed rounded-lg text-center transition-colors ${
              dropTargetFolder === "Uncategorized"
                ? "border-blue-400 bg-blue-50"
                : "border-gray-200"
            }`}
            onDragOver={(e) => handleDragOver(e, "Uncategorized")}
            onDragLeave={handleDragLeave}
            onDrop={() => handleDrop("Uncategorized")}
          >
            <span className="text-sm text-gray-400">
              Drop here to move to Uncategorized
            </span>
          </div>
        )}

        {/* Methods grouped by folder */}
        {allFolders
          .sort((a, b) => a.localeCompare(b))
          .map((folder) => {
            const folderMethods = grouped[folder] || [];
            const isEmpty = folderMethods.length === 0;
            return (
              <div
                key={folder}
                className={`mb-6 rounded-lg transition-colors ${
                  dropTargetFolder === folder ? "bg-blue-50 ring-2 ring-blue-300" : ""
                }`}
                onDragOver={(e) => handleDragOver(e, folder)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(folder)}
              >
                <div className="flex items-center justify-between mb-2 px-1">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                    {folder}
                  </h3>
                  {isEmpty && (
                    <button
                      onClick={() => {
                        setPrefilledFolder(folder);
                        setCreating(true);
                      }}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      + Add Method
                    </button>
                  )}
                </div>
                {isEmpty ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center">
                    <p className="text-sm text-gray-400">No methods in this category</p>
                    <p className="text-xs text-gray-300 mt-1">Drag a method here or click &quot;Add Method&quot; above</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {folderMethods.map((m) => (
                      <div
                        key={m.id}
                        draggable
                        onDragStart={() => handleDragStart(m)}
                        className={`bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow cursor-pointer ${
                          draggedMethod?.id === m.id ? "opacity-50" : ""
                        }`}
                        onClick={() => setViewingMethod(m)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-gray-300 cursor-grab active:cursor-grabbing">
                            ⋮⋮
                          </span>
                          <h4 className="text-sm font-medium text-gray-900">
                            {m.name}
                          </h4>
                        </div>
                        <p className="text-xs text-gray-400 mt-1 truncate">
                          {m.source_path}
                        </p>
                         <div className="flex items-center gap-2 mt-2">
                           {(() => {
                             const meta = getMethodTypeMeta(m.method_type);
                             return (
                               <span className={`text-[10px] px-2 py-0.5 rounded-full ${meta.color.bg} ${meta.color.text}`}>
                                 {meta.label}
                               </span>
                             );
                           })()}
                           {m.is_public && (
                             <span className="text-[10px] px-2 py-0.5 bg-green-50 text-green-600 rounded-full">
                               Public
                             </span>
                           )}
                           {m.parent_method_id && (
                             <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full">
                               Forked
                             </span>
                           )}
                         </div>
                        {m.tags && m.tags.length > 0 && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {m.tags.map((tag) => (
                              <span
                                key={tag}
                                className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

        {methods.length === 0 && !creating && (
          <div className="text-center py-16">
            <p className="text-lg text-gray-400 mb-2">No methods yet</p>
            <p className="text-sm text-gray-300 mb-6">
              Add your first protocol as Markdown or upload a PDF
            </p>
            <button
              onClick={() => setCreating(true)}
              className="px-6 py-3 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + New Method
            </button>
          </div>
        )}
      </div>

      {/* Create Category Modal */}
      {creatingCategory && (
        <CreateCategoryModal
          existingFolders={existingFolders}
          onClose={() => setCreatingCategory(false)}
          onCreated={handleCategoryCreated}
        />
      )}

      {/* Create Method Modal */}
      {creating && (
        <CreateMethodModal
          existingFolders={existingFolders}
          prefilledFolder={prefilledFolder}
          initialIsPublic={forcePublicOnCreate}
          onClose={() => {
            setCreating(false);
            setPrefilledFolder("");
            setForcePublicOnCreate(false);
          }}
          onCreated={handleMethodCreated}
        />
      )}

      {/* View Method Modal */}
      {viewingMethod && (
        <ViewMethodModal
          method={viewingMethod}
          currentUser={currentUser}
          onClose={() => setViewingMethod(null)}
          onDelete={handleDelete}
        />
      )}
    </AppShell>
  );
}

// ── Method Type Picker (Standard / Structured) ──────────────────────────────

/**
 * New-method type picker. Renders two grouped sections — Standard methods
 * (markdown/pdf) and Structured methods (PCR, plus future v1 types) — using
 * the cosmetic registry as the source of truth. Adding a new method type is
 * a registry edit; the section it lands in is determined by its `category`.
 */
function MethodTypeCategoryPicker({
  uploadType,
  onSelect,
}: {
  uploadType: MethodTypeId;
  onSelect: (id: MethodTypeId) => void;
}) {
  const standard = getMethodTypesByCategory("standard");
  const structured = getMethodTypesByCategory("structured");

  return (
    <div className="space-y-4">
      <MethodTypeSection
        heading="Standard methods"
        types={standard}
        selectedId={uploadType}
        onSelect={onSelect}
      />
      {structured.length > 0 && (
        <MethodTypeSection
          heading="Structured methods"
          types={structured}
          selectedId={uploadType}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function MethodTypeSection({
  heading,
  types,
  selectedId,
  onSelect,
}: {
  heading: string;
  types: ReturnType<typeof getMethodTypesByCategory>;
  selectedId: MethodTypeId;
  onSelect: (id: MethodTypeId) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-2">
        {heading}
      </label>
      <div className="flex flex-wrap gap-2">
        {types.map((meta) => {
          const Icon = meta.icon;
          const selected = selectedId === meta.id;
          return (
            <button
              key={meta.id}
              type="button"
              onClick={() => onSelect(meta.id)}
              className={`flex-1 min-w-[180px] text-left px-4 py-3 rounded-lg border transition-colors ${
                selected
                  ? `${meta.color.bg} ${meta.color.text} border-current font-medium`
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" />
                <span className="text-sm">{meta.label}</span>
              </div>
              {meta.description && (
                <p className={`mt-1 text-xs ${selected ? "" : "text-gray-400"}`}>
                  {meta.description}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Create Method Modal ──────────────────────────────────────────────────────

function CreateCategoryModal({
  existingFolders,
  onClose,
  onCreated,
}: {
  existingFolders: string[];
  onClose: () => void;
  onCreated: (categoryName: string, addMethodNow: boolean) => void;
}) {
  const [categoryName, setCategoryName] = useState("");

  const handleCreate = useCallback((addMethodNow: boolean) => {
    if (!categoryName.trim()) return;
    onCreated(categoryName.trim(), addMethodNow);
  }, [categoryName, onCreated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">
            New Category
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
        <div className="p-6">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Category Name
          </label>
          <input
            type="text"
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="e.g. Molecular Biology"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate(false);
            }}
          />
          {existingFolders.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-gray-400 mb-1">Existing categories:</p>
              <div className="flex flex-wrap gap-1">
                {existingFolders.map((folder) => (
                  <span
                    key={folder}
                    className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full"
                  >
                    {folder}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={() => handleCreate(false)}
            disabled={!categoryName.trim()}
            className="px-4 py-2 text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg disabled:opacity-50"
          >
            Create Empty
          </button>
          <button
            onClick={() => handleCreate(true)}
            disabled={!categoryName.trim()}
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            Create & Add Method
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateMethodModal({
  existingFolders,
  prefilledFolder,
  initialIsPublic = false,
  onClose,
  onCreated,
}: {
  existingFolders: string[];
  prefilledFolder?: string;
  /** When true, the "Make this method public" checkbox starts checked.
   *  Used by the `public-methods` onboarding tip's `setupAction` deep
   *  link (`/methods?createMethod=public`). */
  initialIsPublic?: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [uploadType, setUploadType] = useState<MethodTypeId>("markdown");
  const [name, setName] = useState("");
  const [folder, setFolder] = useState(prefilledFolder || "");
  const [tags, setTags] = useState("");
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [saving, setSaving] = useState(false);

  // Markdown state
  const [mdContent, setMdContent] = useState("");
  const [, setUploading] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();
  
  // Track uploaded image paths for cleanup on cancel
  const uploadedImagePathsRef = useRef<string[]>([]);

  // PDF state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // PCR state — standard PCR cycling defaults; user adjusts after Create.
  const [pcrGradient, setPcrGradient] = useState<PCRGradient>({
    initial: [{ name: "Initial denaturation", temperature: 95, duration: "3 min" }],
    cycles: [{
      repeats: 30,
      steps: [
        { name: "Denaturation", temperature: 95, duration: "15 sec" },
        { name: "Annealing", temperature: 60, duration: "30 sec" },
        { name: "Extension", temperature: 72, duration: "30 sec" },
      ],
    }],
    final: [{ name: "Final extension", temperature: 72, duration: "5 min" }],
    hold: { name: "Hold", temperature: 12, duration: "Indef." },
  });
  const [pcrIngredients, setPcrIngredients] = useState<PCRIngredient[]>([
    { id: "i1", name: "Buffer", concentration: "5x", amount_per_reaction: "" },
    { id: "i2", name: "dNTPs", concentration: "10 mM", amount_per_reaction: "" },
    { id: "i3", name: "Forward primer", concentration: "10 µM", amount_per_reaction: "" },
    { id: "i4", name: "Reverse primer", concentration: "10 µM", amount_per_reaction: "" },
    { id: "i5", name: "Polymerase", concentration: "2 U/µL", amount_per_reaction: "" },
    { id: "i6", name: "Template DNA", concentration: "", amount_per_reaction: "" },
    { id: "i7", name: "Nuclease-free H2O", concentration: "—", amount_per_reaction: "" },
    { id: "i8", name: "Total", concentration: "", amount_per_reaction: "" },
  ]);
  const [pcrNotes, setPcrNotes] = useState("");

  // LC gradient state — sensible reverse-phase HPLC defaults (5%→95%
  // acetonitrile over 25 min, 0.3 mL/min). User can refine after Create.
  const [lcGradientSteps, setLcGradientSteps] = useState<LCGradientStep[]>(
    () => lcGradientApi.getDefaultGradientSteps(),
  );
  const [lcColumn, setLcColumn] = useState<LCGradientColumn>(() =>
    lcGradientApi.getDefaultColumn(),
  );
  const [lcWavelength, setLcWavelength] = useState<number | null>(214);
  const [lcDescription, setLcDescription] = useState<string | null>(null);
  const [lcIngredients, setLcIngredients] = useState<LCIngredient[]>(() =>
    lcGradientApi.getDefaultIngredients(),
  );

  const slug = name
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");

  const handleImageUpload = useCallback(
    async (files: FileList | File[]) => {
      if (!slug) {
        alert("Enter a method name first");
        return;
      }
      setUploading(true);
      setUploadWarning(null);
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;

        // Show rename popup and wait for user decision
        const renamedFile = await requestRename(file);
        if (!renamedFile) {
          continue; // User cancelled
        }

        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const imageName = `${Date.now()}-${renamedFile.name.replace(/\s+/g, "_")}`;
          const imagePath = `methods/${slug}/Images/${imageName}`;

          try {
            const response = await filesApi.uploadImage(
              imagePath,
              base64,
              `Upload image for method: ${name}`
            );
            // Track uploaded image for potential cleanup on cancel
            uploadedImagePathsRef.current.push(imagePath);
            const imageMarkdown = `\n![${renamedFile.name}](./Images/${imageName})\n`;
            setMdContent((prev) => prev + imageMarkdown);
            if (response.warning) {
              setUploadWarning(response.warning);
            }
          } catch {
            alert(`Failed to upload ${renamedFile.name}`);
          }
        };
        reader.readAsDataURL(renamedFile);
      }
      setUploading(false);
    },
    [slug, name, requestRename]
  );

  const handleFileUpload = useCallback(
    async (files: FileList | File[]) => {
      if (!slug) {
        alert("Enter a method name first");
        return;
      }
      const methodBase = `methods/${slug}`;
      const filesDir = `${methodBase}/Files`;
      setUploading(true);
      setUploadWarning(null);
      for (const file of Array.from(files)) {
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        try {
          const finalName = await pickUniqueImageName(filesDir, renamedFile.name);
          const destPath = `${filesDir}/${finalName}`;
          await fileService.writeFileFromBlob(destPath, renamedFile);
          uploadedImagePathsRef.current.push(destPath);
          fileEvents.emitAttached({ basePath: methodBase, relativePath: `Files/${finalName}` });
        } catch {
          alert(`Failed to upload ${renamedFile.name}`);
        }
      }
      setUploading(false);
    },
    [slug, requestRename]
  );
  
  // Cleanup function to delete uploaded images when canceling
  const handleCancel = useCallback(async () => {
    const uploadedPaths = uploadedImagePathsRef.current;
    if (uploadedPaths.length > 0) {
      // Delete the entire method folder if we uploaded any images
      const methodDir = `methods/${slug}`;
      try {
        await filesApi.deleteDirectory(methodDir);
      } catch {
        // Non-fatal — directory might not exist or already be deleted
      }
    }
    onClose();
  }, [slug, onClose]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length > 0) handleImageUpload(files);
    },
    [handleImageUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);

    try {
      if (uploadType === "markdown") {
        const sourcePath = `methods/${slug}/${slug}.md`;
        // Auto-stamp new method files the same way notes/results files get
        // stamped on creation. If the user pasted markdown into the modal,
        // prepend the stamp; otherwise the stamp is the only content.
        const stampedScaffold = createNewFileContent(
          name.trim(),
          folder.trim() || "Methods",
          "method"
        );
        const body = mdContent ? `${stampedScaffold}\n${mdContent}` : stampedScaffold;
        await filesApi.writeFile(sourcePath, body, `Create method: ${name}`);
        // Create the method record
        await methodsApi.create({
          name: name.trim(),
          source_path: sourcePath,
          method_type: "markdown",
          folder_path: folder.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          is_public: isPublic,
        });
      } else if (uploadType === "pdf" && pdfFile) {
        // Upload PDF
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(pdfFile);
        });
        const sourcePath = `methods/${slug}/${pdfFile.name}`;
        const response = await filesApi.uploadImage(sourcePath, base64, `Upload PDF: ${name}`);
        if (response.warning) {
          setUploadWarning(response.warning);
        }

        // Create the method record
        await methodsApi.create({
          name: name.trim(),
          source_path: sourcePath,
          method_type: "pdf",
          folder_path: folder.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          is_public: isPublic,
        });
      } else if (uploadType === "pcr") {
        const protocol = await pcrApi.create({
          name: name.trim(),
          gradient: pcrGradient,
          ingredients: pcrIngredients,
          notes: pcrNotes || null,
          folder_path: folder.trim() || null,
          is_public: isPublic,
        });
        await methodsApi.create({
          name: name.trim(),
          source_path: `pcr://protocol/${protocol.id}`,
          method_type: "pcr",
          folder_path: folder.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          is_public: isPublic,
        });
      } else if (uploadType === "lc_gradient") {
        const protocol = await lcGradientApi.create({
          name: name.trim(),
          description: lcDescription,
          gradient_steps: lcGradientSteps,
          column: lcColumn,
          detection_wavelength_nm: lcWavelength,
          ingredients: lcIngredients,
          folder_path: folder.trim() || null,
          is_public: isPublic,
        });
        await methodsApi.create({
          name: name.trim(),
          source_path: `lc_gradient://protocol/${protocol.id}`,
          method_type: "lc_gradient",
          folder_path: folder.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          is_public: isPublic,
        });
      }
      onCreated();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to create method";
      alert(msg);
    } finally {
      setSaving(false);
    }
  }, [name, slug, uploadType, mdContent, pdfFile, folder, tags, isPublic, pcrGradient, pcrIngredients, pcrNotes, lcGradientSteps, lcColumn, lcWavelength, lcDescription, lcIngredients, onCreated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">
            New Method
          </h3>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={handleCancel}
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              ✕
            </button>
          </Tooltip>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {/* Upload type picker — grouped into Standard / Structured.
                Structured types own a per-type protocol record alongside
                the Method row; standard types just point at a file. */}
            <MethodTypeCategoryPicker
              uploadType={uploadType}
              onSelect={setUploadType}
            />

            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Method Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Western Blot Protocol"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
            </div>

            {/* Folder + Tags */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Folder (optional)
                </label>
                <input
                  type="text"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="e.g. Molecular Biology"
                  list="existing-folders"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <datalist id="existing-folders">
                  {existingFolders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Tags (comma-separated, optional)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. protein, gel"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Public/Private Toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isPublic"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="isPublic" className="text-sm text-gray-700">
                Make this method public (visible to all lab members)
              </label>
            </div>

            {/* Markdown editor */}
            {uploadType === "markdown" && (
              <div>
                <label className="text-xs font-medium text-gray-500 mb-2 block">
                  Method Content
                </label>
                <div
                  className="border border-gray-200 rounded-lg overflow-hidden"
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                >
                  <LiveMarkdownEditor
                    value={mdContent}
                    onChange={setMdContent}
                    placeholder={`# ${name || "Method Name"}\n\n## Materials\n- Item 1\n- Item 2\n\n## Steps\n1. First step\n2. Second step`}
                    onImageDrop={handleImageUpload}
                    onFileDrop={handleFileUpload}
                    allowAnyFileType={true}
                    imageBasePath={`methods/${slug}`}
                    showToolbar={true}
                  />
                </div>
                {uploadWarning && (
                  <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                    <span className="text-amber-500">⚠️</span>
                    <div className="flex-1">
                      <p className="text-sm text-amber-800">{uploadWarning}</p>
                    </div>
                    <Tooltip label="Dismiss warning" placement="bottom">
                      <button
                        onClick={() => setUploadWarning(null)}
                        className="text-amber-400 hover:text-amber-600"
                      >
                        ✕
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
            )}

            {/* PDF upload */}
            {uploadType === "pdf" && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">
                  Upload PDF
                </label>
                <div
                  onClick={() => pdfInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
                >
                  {pdfFile ? (
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {pdfFile.name}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPdfFile(null);
                        }}
                        className="mt-2 text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-500">
                        Click to select a PDF file
                      </p>
                    </div>
                  )}
                </div>
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) setPdfFile(e.target.files[0]);
                  }}
                />
                <p className="text-xs text-gray-400 mt-2">
                  PDF methods can be viewed but not edited inline. Step
                  deviations will be saved as a separate Markdown file.
                </p>
                {uploadWarning && (
                  <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                    <span className="text-amber-500">⚠️</span>
                    <div className="flex-1">
                      <p className="text-sm text-amber-800">{uploadWarning}</p>
                    </div>
                    <Tooltip label="Dismiss warning" placement="bottom">
                      <button
                        onClick={() => setUploadWarning(null)}
                        className="text-amber-400 hover:text-amber-600"
                      >
                        ✕
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>
            )}

            {/* LC Gradient editor */}
            {uploadType === "lc_gradient" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">
                  LC gradient protocols store the solvent gradient (%A/%B over time + flow), column geometry, detection wavelength, and ingredient list.
                </p>
                <LcGradientEditor
                  gradientSteps={lcGradientSteps}
                  onGradientStepsChange={setLcGradientSteps}
                  column={lcColumn}
                  onColumnChange={setLcColumn}
                  detectionWavelengthNm={lcWavelength}
                  onDetectionWavelengthChange={setLcWavelength}
                  description={lcDescription}
                  onDescriptionChange={setLcDescription}
                  ingredients={lcIngredients}
                  onIngredientsChange={setLcIngredients}
                />
              </div>
            )}

            {/* PCR editor */}
            {uploadType === "pcr" && (
              <div className="space-y-4">
                <p className="text-xs text-gray-400">
                  PCR protocols store thermal cycler gradients and reaction recipes.
                </p>
                
                {/* Interactive Gradient Editor */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">
                    Thermal Gradient
                  </h4>
                  <InteractiveGradientEditor
                    gradient={pcrGradient}
                    onChange={setPcrGradient}
                  />
                </div>

                {/* Reaction Recipe */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">
                    Reaction Recipe
                  </h4>
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-600">Ingredient</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-600">Concentration</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-600">Amount/Rx</th>
                          <th className="px-2 py-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pcrIngredients.map((ing, i) => (
                          <tr key={ing.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                            <td className="px-4 py-2">
                              {ing.name === "Total" ? (
                                <span className="font-medium text-gray-700">{ing.name}</span>
                              ) : (
                                <input
                                  type="text"
                                  value={ing.name}
                                  onChange={(e) => {
                                    const newIngredients = [...pcrIngredients];
                                    newIngredients[i] = { ...ing, name: e.target.value };
                                    setPcrIngredients(newIngredients);
                                  }}
                                  className="w-full px-2 py-1 border border-gray-200 rounded text-gray-700"
                                />
                              )}
                            </td>
                            <td className="px-4 py-2">
                              {ing.name === "Total" ? (
                                <span className="text-gray-500">-</span>
                              ) : (
                                <input
                                  type="text"
                                  value={ing.concentration}
                                  onChange={(e) => {
                                    const newIngredients = [...pcrIngredients];
                                    newIngredients[i] = { ...ing, concentration: e.target.value };
                                    setPcrIngredients(newIngredients);
                                  }}
                                  className="w-full px-2 py-1 border border-gray-200 rounded text-gray-500"
                                  placeholder="e.g. 10x"
                                />
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="text"
                                value={ing.amount_per_reaction}
                                onChange={(e) => {
                                  const newIngredients = [...pcrIngredients];
                                  newIngredients[i] = { ...ing, amount_per_reaction: e.target.value };
                                  setPcrIngredients(newIngredients);
                                }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-gray-500"
                                placeholder="e.g. 2.5"
                              />
                            </td>
                            <td className="px-2 py-2">
                              {ing.name !== "Total" && (
                                <Tooltip label="Remove ingredient" placement="left">
                                  <button
                                    onClick={() => {
                                      setPcrIngredients(pcrIngredients.filter((item) => item.id !== ing.id));
                                    }}
                                    className="text-gray-400 hover:text-red-500 text-sm"
                                  >
                                    ✕
                                  </button>
                                </Tooltip>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button
                      onClick={() => {
                        const newId = String(Date.now());
                        // Insert before Total row if it exists
                        const totalIndex = pcrIngredients.findIndex((ing) => ing.name === "Total");
                        if (totalIndex >= 0) {
                          const newIngredients = [
                            ...pcrIngredients.slice(0, totalIndex),
                            { id: newId, name: "", concentration: "", amount_per_reaction: "" },
                            ...pcrIngredients.slice(totalIndex),
                          ];
                          setPcrIngredients(newIngredients);
                        } else {
                          setPcrIngredients([
                            ...pcrIngredients,
                            { id: newId, name: "", concentration: "", amount_per_reaction: "" },
                          ]);
                        }
                      }}
                      className="w-full py-2 text-xs text-blue-600 hover:bg-blue-50 border-t border-gray-200"
                    >
                      + Add Ingredient
                    </button>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">
                    Notes (optional)
                  </h4>
                  <textarea
                    value={pcrNotes}
                    onChange={(e) => setPcrNotes(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Any additional notes..."
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-gray-100">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={
              saving ||
              !name.trim() ||
              (uploadType === "pdf" && !pdfFile) ||
              (uploadType === "markdown" && !mdContent.trim())
            }
            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {saving ? "Saving..." : "Create Method"}
          </button>
        </div>
      </div>
      <FileRenamePopup />
    </div>
  );
}

// ── View Method Modal ────────────────────────────────────────────────────────

function ViewMethodModal({
  method,
  currentUser,
  onClose,
  onDelete,
}: {
  method: Method;
  currentUser: string;
  onClose: () => void;
  onDelete: (id: number) => void;
}) {
  // Render the appropriate viewer with the experiments sidebar
  const renderViewer = () => {
    if (method.method_type === "pdf") {
      return <PdfViewer method={method} currentUser={currentUser} onClose={onClose} onDelete={onDelete} />;
    }
    if (method.method_type === "pcr") {
      return <PcrViewer method={method} currentUser={currentUser} onClose={onClose} onDelete={onDelete} />;
    }
    if (method.method_type === "lc_gradient") {
      return <LcViewer method={method} currentUser={currentUser} onClose={onClose} onDelete={onDelete} />;
    }
    return <MarkdownMethodViewer method={method} currentUser={currentUser} onClose={onClose} onDelete={onDelete} />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="flex bg-white rounded-xl shadow-2xl max-w-[calc(4rem+4rem+72rem)] w-full mx-4 max-h-[85vh]">
        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden rounded-l-xl">
          {renderViewer()}
        </div>
        {/* Experiments sidebar */}
        <MethodExperimentsSidebar methodId={method.id} methodName={method.name} />
      </div>
    </div>
  );
}

// ── Method Name Editor Component ───────────────────────────────────────────────

function MethodNameEditor({
  method,
  onNameUpdated,
}: {
  method: Method;
  onNameUpdated: (newName: string) => void;
}) {
  const queryClient = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(method.name);
  const [saving, setSaving] = useState(false);

  // Owner-aware view: shared-with-edit methods write back to the owner's dir.
  const scopedMethodsApi = useMemo(() => ownerScopedMethodsApi(method), [method]);

  const handleSaveName = useCallback(async () => {
    if (!name.trim() || name === method.name) {
      setEditingName(false);
      setName(method.name);
      return;
    }
    setSaving(true);
    try {
      await scopedMethodsApi.update(method.id, { name: name.trim() });
      await queryClient.refetchQueries({ queryKey: ["methods"] });
      onNameUpdated(name.trim());
      setEditingName(false);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to rename method";
      alert(msg);
      setName(method.name);
    } finally {
      setSaving(false);
    }
  }, [name, method.id, method.name, queryClient, onNameUpdated, scopedMethodsApi]);

  if (editingName) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSaveName();
            if (e.key === "Escape") {
              setName(method.name);
              setEditingName(false);
            }
          }}
          className="px-2 py-1 text-sm font-semibold border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
          disabled={saving}
        />
        <button
          onClick={handleSaveName}
          disabled={saving || !name.trim()}
          className="px-2 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "..." : "Save"}
        </button>
        <button
          onClick={() => {
            setName(method.name);
            setEditingName(false);
          }}
          className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group">
      <h3 className="text-sm font-semibold text-gray-900">{method.name}</h3>
      <Tooltip label="Rename method" placement="bottom">
        <button
          onClick={() => setEditingName(true)}
          className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-opacity"
        >
          ✏️
        </button>
      </Tooltip>
    </div>
  );
}

// ── Markdown Method Viewer ───────────────────────────────────────────────────

function MarkdownMethodViewer({
  method,
  currentUser,
  onClose,
  onDelete,
}: {
  method: Method;
  currentUser: string;
  onClose: () => void;
  onDelete: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const [currentMethod, setCurrentMethod] = useState(method);
  const [content, setContent] = useState("");
  // Snapshot of the on-disk content as of the last successful read or save.
  // Cancel resets `content` back to this; Save updates this after writing so
  // subsequent unsaved-change detection compares against the new baseline.
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [, setUploading] = useState(false);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [showSharePopup, setShowSharePopup] = useState(false);
  const { requestRename, PopupComponent: FileRenamePopup } = useFileRenamePopup();

  const hasUnsavedChanges = content !== originalContent && !loading;

  // Owner-aware view: shared-with-edit methods write back to the owner's dir.
  const scopedMethodsApi = useMemo(() => ownerScopedMethodsApi(currentMethod), [currentMethod]);

  const methodDir = currentMethod.source_path?.substring(0, currentMethod.source_path.lastIndexOf("/")) || "";

  const handleEditImageUpload = useCallback(
    async (files: FileList | File[]) => {
      if (!methodDir) return;
      setUploading(true);
      setUploadWarning(null);
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;

        // Show rename popup and wait for user decision
        const renamedFile = await requestRename(file);
        if (!renamedFile) {
          continue; // User cancelled
        }

        try {
          const finalName = await pickUniqueImageName(`${methodDir}/Images`, renamedFile.name);
          await fileService.writeFileFromBlob(`${methodDir}/Images/${finalName}`, renamedFile);
          setContent((prev) => prev + `\n![${renamedFile.name}](Images/${finalName})\n`);
        } catch {
          alert(`Failed to upload ${renamedFile.name}`);
        }
      }
      setUploading(false);
    },
    [methodDir, requestRename]
  );

  const handleEditFileUpload = useCallback(
    async (files: FileList | File[]) => {
      if (!methodDir) return;
      const filesDir = `${methodDir}/Files`;
      setUploading(true);
      setUploadWarning(null);
      for (const file of Array.from(files)) {
        const renamedFile = await requestRename(file);
        if (!renamedFile) continue;
        try {
          const finalName = await pickUniqueImageName(filesDir, renamedFile.name);
          await fileService.writeFileFromBlob(`${filesDir}/${finalName}`, renamedFile);
          fileEvents.emitAttached({ basePath: methodDir, relativePath: `Files/${finalName}` });
        } catch {
          alert(`Failed to upload ${renamedFile.name}`);
        }
      }
      setUploading(false);
    },
    [methodDir, requestRename]
  );

  useEffect(() => {
    if (!method.source_path) {
      setContent("*Method file not found.*");
      setLoading(false);
      return;
    }
    let cancelled = false;
    const sourcePath = method.source_path;
    (async () => {
      try {
        const file = await filesApi.readFile(sourcePath);
        const raw = file.content;
        const dir = sourcePath.substring(0, sourcePath.lastIndexOf("/"));
        const slug = dir.split("/").pop() || dir;
        const legacyOwner = method.owner || method.created_by || undefined;
        const canMigrate = !method.is_public || method.created_by === currentUser;
        if (!canMigrate) {
          if (!cancelled) {
            setContent(raw);
            setOriginalContent(raw);
            setLoading(false);
          }
          return;
        }
        const { content: migrated, didMigrate } = await migrateNoteImages(raw, slug, dir, legacyOwner);
        // Lazy-normalize legacy stamp formats so the closing marker stops
        // leaking into the rendered preview.
        const stampNormalized = hasLegacyStampFormat(migrated)
          ? normalizeStampFormat(migrated)
          : migrated;
        const stampDidNormalize = stampNormalized !== migrated;
        if (didMigrate || stampDidNormalize) {
          await filesApi.writeFile(sourcePath, stampNormalized, `Migrate image references for: ${method.name}`);
        }
        if (!cancelled) {
          setContent(stampNormalized);
          setOriginalContent(stampNormalized);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setContent("*Method file not found.*");
          setOriginalContent("*Method file not found.*");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [method.source_path, method.owner, method.created_by, method.is_public, method.name, currentUser]);

  const handleSave = useCallback(async () => {
    if (!method.source_path) return;
    setSaving(true);
    try {
      await filesApi.writeFile(
        method.source_path,
        content,
        `Update method: ${method.name}`
      );
      // Update the baseline so subsequent unsaved-change checks compare
      // against the just-saved content.
      setOriginalContent(content);
      setEditing(false);
    } catch {
      alert("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [content, method.source_path, method.name]);

  // Cancel discards in-memory edits by reverting `content` to the snapshot
  // captured on read (or last successful save). Without this, clicking Cancel
  // would leave `content` mutated; re-clicking Edit (without remounting the
  // popup) would resurrect the dirty edits.
  const handleCancel = useCallback(() => {
    setContent(originalContent);
    setEditing(false);
  }, [originalContent]);

  // Check if current user can modify this method (owner of private method, or creator of public method)
  const canModify = !currentMethod.is_public || currentMethod.created_by === currentUser;

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <MethodNameEditor method={currentMethod} onNameUpdated={(newName) => setCurrentMethod({ ...currentMethod, name: newName })} />
            <p className="text-xs text-gray-400 mt-0.5">{currentMethod.source_path}</p>
          </div>
          <div className="flex items-center gap-2">
            {!editing ? (
              <>
                {canModify && (
                  <button
                    onClick={() => setShowSharePopup(true)}
                    data-onboarding-target="public-methods"
                    className={`px-3 py-1.5 text-xs rounded-lg ${
                      currentMethod.is_public
                        ? "bg-green-50 text-green-600 hover:bg-green-100"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                    title="Share method"
                  >
                    {currentMethod.is_public ? "🌐 Public" : "🔒 Private"}
                  </button>
                )}
                {!currentMethod.is_public && (
                  <button
                    onClick={() => setEditing(true)}
                    className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                  >
                    Edit
                  </button>
                )}
              </>
            ) : (
              <>
                {hasUnsavedChanges && (
                  <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
                )}
                <button
                  onClick={handleCancel}
                  className="px-3 py-1.5 text-xs text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    hasUnsavedChanges
                      ? "text-white bg-blue-600 hover:bg-blue-700"
                      : "text-gray-400 bg-gray-200 cursor-not-allowed"
                  } disabled:opacity-50`}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            )}
            {canModify && (
              <button
                onClick={() => onDelete(currentMethod.id)}
                className="px-3 py-1.5 text-xs text-red-500 rounded-lg hover:bg-red-50"
              >
                Delete
              </button>
            )}
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 text-lg ml-2"
              >
                ✕
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-6 text-sm text-gray-400 animate-pulse">
              Loading...
            </p>
          ) : editing ? (
            <div className="p-6">
              <LiveMarkdownEditor
                value={content}
                onChange={setContent}
                placeholder="Edit method content..."
                onImageDrop={handleEditImageUpload}
                onFileDrop={handleEditFileUpload}
                allowAnyFileType={true}
                imageBasePath={methodDir}
                showToolbar={true}
              />
              {uploadWarning && (
                <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                  <span className="text-amber-500">⚠️</span>
                  <div className="flex-1">
                    <p className="text-sm text-amber-800">{uploadWarning}</p>
                  </div>
                  <button
                    onClick={() => setUploadWarning(null)}
                    className="text-amber-400 hover:text-amber-600"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          ) : (
            <RenderedMarkdown
              content={content}
              basePath={currentMethod.source_path?.substring(0, currentMethod.source_path.lastIndexOf("/")) || ""}
              className="p-6 prose prose-sm prose-gray max-w-none"
            />
          )}
        </div>
      </div>
      <FileRenamePopup />
      
      {/* Share Popup */}
      {showSharePopup && (
        <SharePopup
          isOpen={showSharePopup}
          onClose={() => setShowSharePopup(false)}
          itemType="method"
          itemId={currentMethod.id}
          itemName={currentMethod.name}
          currentOwner={currentMethod.owner || currentMethod.created_by || currentUser}
          currentSharedWith={currentMethod.shared_with || []}
          isPublic={currentMethod.is_public}
          onShared={() => {
            queryClient.refetchQueries({ queryKey: ["methods"] });
            // Update local state
            scopedMethodsApi.get(currentMethod.id).then((updatedMethod) => {
              if (updatedMethod) setCurrentMethod(updatedMethod);
            });
          }}
        />
      )}
    </>
  );
}

// ── PDF Viewer ───────────────────────────────────────────────────────────────

function PdfViewer({
  method,
  currentUser,
  onClose,
  onDelete,
}: {
  method: Method;
  currentUser: string;
  onClose: () => void;
  onDelete: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const [currentMethod, setCurrentMethod] = useState(method);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSharePopup, setShowSharePopup] = useState(false);

  // Owner-aware view: shared-with-edit methods route reads to the owner's dir.
  const scopedMethodsApi = useMemo(() => ownerScopedMethodsApi(currentMethod), [currentMethod]);

  // Check if current user can modify this method (owner of private method, or creator of public method)
  const canModify = !currentMethod.is_public || currentMethod.created_by === currentUser;

  useEffect(() => {
    // Read the PDF as base64 from disk, then create a blob URL
    if (!method.source_path) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- short-circuit when no source path means we can't load anything
      setLoading(false);
      return;
    }
    filesApi
      .readFile(method.source_path)
      .then((file) => {
        // The content comes back as base64 for binary files
        try {
          const binary = atob(file.content);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: "application/pdf" });
          setPdfUrl(URL.createObjectURL(blob));
        } catch {
          // If content is not base64, it might be a URL or text
          setPdfUrl(null);
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [method.source_path]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <MethodNameEditor method={currentMethod} onNameUpdated={(newName) => setCurrentMethod({ ...currentMethod, name: newName })} />
            <p className="text-xs text-gray-400 mt-0.5">
              PDF — {currentMethod.source_path}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canModify && !currentMethod.is_shared_with_me && (
              <button
                onClick={() => setShowSharePopup(true)}
                data-onboarding-target="public-methods"
                className={`px-3 py-1.5 text-xs rounded-lg ${
                  currentMethod.is_public
                    ? "bg-green-50 text-green-600 hover:bg-green-100"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                title="Share method"
              >
                {currentMethod.is_public ? "🌐 Public" : "🔒 Private"}
              </button>
            )}
            {canModify && (
              <button
                onClick={() => onDelete(currentMethod.id)}
                className="px-3 py-1.5 text-xs text-red-500 rounded-lg hover:bg-red-50"
              >
                Delete
              </button>
            )}
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 text-lg ml-2"
              >
                ✕
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <p className="p-6 text-sm text-gray-400 animate-pulse">
              Loading PDF...
            </p>
          ) : pdfUrl ? (
            <iframe
              src={pdfUrl}
              className="w-full h-full min-h-[600px]"
              title={method.name}
            />
          ) : (
            <div className="p-6 text-center">
              <p className="text-sm text-gray-500">
                Unable to display PDF. The file may not exist yet.
              </p>
            </div>
          )}
        </div>
      </div>
      
      {/* Share Popup */}
      {showSharePopup && (
        <SharePopup
          isOpen={showSharePopup}
          onClose={() => setShowSharePopup(false)}
          itemType="method"
          itemId={currentMethod.id}
          itemName={currentMethod.name}
          currentOwner={currentMethod.owner || currentMethod.created_by || currentUser}
          currentSharedWith={currentMethod.shared_with || []}
          isPublic={currentMethod.is_public}
          onShared={() => {
            queryClient.refetchQueries({ queryKey: ["methods"] });
            // Update local state
            scopedMethodsApi.get(currentMethod.id).then((updatedMethod) => {
              if (updatedMethod) setCurrentMethod(updatedMethod);
            });
          }}
        />
      )}
    </>
  );
}

// ── PCR Viewer ───────────────────────────────────────────────────────────────

function PcrViewer({
  method,
  currentUser,
  onClose,
  onDelete,
}: {
  method: Method;
  currentUser: string;
  onClose: () => void;
  onDelete: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const [currentMethod, setCurrentMethod] = useState(method);
  const [protocol, setProtocol] = useState<PCRProtocol | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gradient, setGradient] = useState<PCRGradient | null>(null);
  const [ingredients, setIngredients] = useState<PCRIngredient[]>([]);
  const [notes, setNotes] = useState("");
  const [editingRecipe, setEditingRecipe] = useState(false);
  const [showSharePopup, setShowSharePopup] = useState(false);

  // Owner-aware view: shared-with-edit methods route reads to the owner's dir.
  const scopedMethodsApi = useMemo(() => ownerScopedMethodsApi(currentMethod), [currentMethod]);

  // Extract PCR protocol ID from the source_path (format: pcr://protocol/{id})
  const pcrId = method.source_path?.startsWith("pcr://protocol/")
    ? parseInt(method.source_path.replace("pcr://protocol/", ""))
    : null;

  useEffect(() => {
    if (!pcrId) {
      setLoading(false);
      return;
    }
    
    // Route the read explicitly to the method's namespace. Without this,
    // a private protocol whose id collides with a public one would shadow
    // the intended record (per-user id spaces are NOT globally unique).
    // `method.owner` is "public" for public methods, the receiver's user
    // for owned methods, and the original owner for shared methods.
    const protocolOwner = method.owner || undefined;
    pcrApi.get(pcrId, protocolOwner)
      .then((data) => {
        if (!data) {
          setLoading(false);
          return;
        }
        setProtocol(data);
        setGradient(data.gradient ?? null);
        setIngredients(Array.isArray(data.ingredients) ? data.ingredients : []);
        setNotes(data.notes || "");
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [pcrId, method.owner]);

  // Thread the same namespace used for the read at :1838 so the write lands
  // in the matching directory. Public methods carry `method.owner === ""`, so
  // `|| undefined` collapses to the legacy private-then-public fallback.
  const protocolOwnerForUpdate = method.owner || undefined;

  // Auto-save gradient changes
  const handleGradientChange = useCallback(async (newGradient: PCRGradient) => {
    setGradient(newGradient);

    // Auto-save after a short delay
    if (!pcrId) return;

    try {
      await pcrApi.update(pcrId, {
        name: protocol?.name || method.name,
        gradient: newGradient,
        ingredients,
        notes: notes || null,
      }, protocolOwnerForUpdate);
      await queryClient.refetchQueries({ queryKey: ["methods"] });
    } catch {
      // Silent fail for auto-save
    }
  }, [pcrId, protocol, method.name, ingredients, notes, queryClient, protocolOwnerForUpdate]);

  const handleSaveRecipe = useCallback(async () => {
    if (!pcrId || !gradient) return;
    setSaving(true);
    try {
      await pcrApi.update(pcrId, {
        name: protocol?.name || method.name,
        gradient,
        ingredients,
        notes: notes || null,
      }, protocolOwnerForUpdate);
      setEditingRecipe(false);
      await queryClient.refetchQueries({ queryKey: ["methods"] });
    } catch {
      alert("Failed to save reaction recipe");
    } finally {
      setSaving(false);
    }
  }, [pcrId, protocol, method.name, gradient, ingredients, notes, queryClient, protocolOwnerForUpdate]);

  // Check if current user can modify this method (owner of private method, or creator of public method)
  const canModify = !currentMethod.is_public || currentMethod.created_by === currentUser;

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <MethodNameEditor method={currentMethod} onNameUpdated={(newName) => setCurrentMethod({ ...currentMethod, name: newName })} />
            <p className="text-xs text-gray-400 mt-0.5">
              PCR Protocol
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canModify && !currentMethod.is_shared_with_me && (
              <button
                onClick={() => setShowSharePopup(true)}
                data-onboarding-target="public-methods"
                className={`px-3 py-1.5 text-xs rounded-lg ${
                  currentMethod.is_public
                    ? "bg-green-50 text-green-600 hover:bg-green-100"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                title="Share method"
              >
                {currentMethod.is_public ? "🌐 Public" : "🔒 Private"}
              </button>
            )}
            {canModify && (
              <button
                onClick={() => onDelete(currentMethod.id)}
                className="px-3 py-1.5 text-xs text-red-500 rounded-lg hover:bg-red-50"
              >
                Delete
              </button>
            )}
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 text-lg ml-2"
              >
                ✕
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-sm text-gray-400 animate-pulse">
              Loading PCR protocol...
            </p>
          ) : !protocol ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500">
                PCR protocol not found. It may have been deleted.
              </p>
            </div>
          ) : gradient ? (
            <div className="space-y-6">
              {/* Interactive Gradient Editor - Always visible with Edit Cycle button */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3">
                  Thermal Gradient
                </h4>
                <InteractiveGradientEditor
                  gradient={gradient}
                  onChange={handleGradientChange}
                />
              </div>
              
              {/* Reaction Recipe */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-700">
                    Reaction Recipe
                  </h4>
                  {editingRecipe ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingRecipe(false)}
                        className="px-3 py-1.5 text-xs text-gray-600 rounded-lg hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveRecipe}
                        disabled={saving}
                        className="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Save Recipe"}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingRecipe(true)}
                      className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                    >
                      Edit Recipe
                    </button>
                  )}
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Ingredient</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Concentration</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Amount/Rx</th>
                        {editingRecipe && <th className="px-2 py-2 w-8"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {ingredients.map((ing, i) => (
                        <tr key={ing.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                          <td className="px-4 py-2">
                            {ing.name === "Total" ? (
                              <span className="font-medium text-gray-700">{ing.name}</span>
                            ) : editingRecipe ? (
                              <input
                                type="text"
                                value={ing.name}
                                onChange={(e) => {
                                  const newIngredients = [...ingredients];
                                  newIngredients[i] = { ...ing, name: e.target.value };
                                  setIngredients(newIngredients);
                                }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-gray-700"
                              />
                            ) : (
                              <span className="text-gray-700 font-medium">{ing.name}</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {ing.name === "Total" ? (
                              <span className="text-gray-500">-</span>
                            ) : editingRecipe ? (
                              <input
                                type="text"
                                value={ing.concentration}
                                onChange={(e) => {
                                  const newIngredients = [...ingredients];
                                  newIngredients[i] = { ...ing, concentration: e.target.value };
                                  setIngredients(newIngredients);
                                }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-gray-500"
                                placeholder="e.g. 10x"
                              />
                            ) : (
                              <span className="text-gray-500">{ing.concentration || "-"}</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {editingRecipe ? (
                              <input
                                type="text"
                                value={ing.amount_per_reaction}
                                onChange={(e) => {
                                  const newIngredients = [...ingredients];
                                  newIngredients[i] = { ...ing, amount_per_reaction: e.target.value };
                                  setIngredients(newIngredients);
                                }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-gray-500"
                                placeholder="e.g. 2.5"
                              />
                            ) : (
                              <span className="text-gray-500">{ing.amount_per_reaction || "-"}</span>
                            )}
                          </td>
                          {editingRecipe && ing.name !== "Total" && (
                            <td className="px-2 py-2">
                              <Tooltip label="Remove ingredient" placement="left">
                                <button
                                  onClick={() => {
                                    setIngredients(ingredients.filter((item) => item.id !== ing.id));
                                  }}
                                  className="text-gray-400 hover:text-red-500 text-sm"
                                >
                                  ✕
                                </button>
                              </Tooltip>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {editingRecipe && (
                    <button
                      onClick={() => {
                        const newId = String(Date.now());
                        // Insert before Total row if it exists
                        const totalIndex = ingredients.findIndex((ing) => ing.name === "Total");
                        if (totalIndex >= 0) {
                          const newIngredients = [
                            ...ingredients.slice(0, totalIndex),
                            { id: newId, name: "", concentration: "", amount_per_reaction: "" },
                            ...ingredients.slice(totalIndex),
                          ];
                          setIngredients(newIngredients);
                        } else {
                          setIngredients([
                            ...ingredients,
                            { id: newId, name: "", concentration: "", amount_per_reaction: "" },
                          ]);
                        }
                      }}
                      className="w-full py-2 text-xs text-blue-600 hover:bg-blue-50 border-t border-gray-200"
                    >
                      + Add Ingredient
                    </button>
                  )}
                </div>
              </div>
              
              {/* Notes */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-700">
                    Notes
                  </h4>
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Any additional notes..."
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      
      {/* Share Popup */}
      {showSharePopup && (
        <SharePopup
          isOpen={showSharePopup}
          onClose={() => setShowSharePopup(false)}
          itemType="method"
          itemId={currentMethod.id}
          itemName={currentMethod.name}
          currentOwner={currentMethod.owner || currentMethod.created_by || currentUser}
          currentSharedWith={currentMethod.shared_with || []}
          isPublic={currentMethod.is_public}
          onShared={() => {
            queryClient.refetchQueries({ queryKey: ["methods"] });
            // Update local state
            scopedMethodsApi.get(currentMethod.id).then((updatedMethod) => {
              if (updatedMethod) setCurrentMethod(updatedMethod);
            });
          }}
        />
      )}
    </>
  );
}
