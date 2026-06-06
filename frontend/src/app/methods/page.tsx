"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  methodsApi as rawMethodsApi,
  filesApi,
  pcrApi,
  lcGradientApi,
  plateApi,
  cellCultureApi,
  massSpecApi,
  codingWorkflowApi,
  qpcrAnalysisApi,
  usersApi,
  fetchAllMethodsIncludingShared,
} from "@/lib/local-api";
import type { MethodUpdate } from "@/lib/local-api";
import { fileService } from "@/lib/file-system/file-service";
import { fileEvents } from "@/lib/attachments/file-events";
import { imageEvents } from "@/lib/attachments/image-events";
import { migrateNoteImages } from "@/lib/notes/migrate-images";
import { hasLegacyStampFormat, normalizeStampFormat } from "@/lib/stamp-utils";
import AppShell from "@/components/AppShell";
import LiveMarkdownEditor from "@/components/LiveMarkdownEditor";
import RenderedMarkdown from "@/components/RenderedMarkdown";
import { InteractiveGradientEditor } from "@/components/InteractiveGradientEditor";
import MethodExperimentsSidebar from "@/components/MethodExperimentsSidebar";
import { useFileRenamePopup } from "@/components/FileRenamePopup";
import UnifiedShareDialog from "@/components/sharing/UnifiedShareDialog";
import ReceivedFromBadge from "@/components/ReceivedFromBadge";
import Tooltip from "@/components/Tooltip";
import type {
  Method,
  PCRProtocol,
  PCRGradient,
  PCRIngredient,
  Task,
} from "@/lib/types";
import LcViewer from "@/components/LcViewer";
import PlateViewer from "@/components/PlateViewer";
import CellCultureViewer from "@/components/CellCultureViewer";
import MassSpecViewer from "@/components/MassSpecViewer";
import CodingWorkflowViewer from "@/components/CodingWorkflowViewer";
import QpcrAnalysisViewer from "@/components/QpcrAnalysisViewer";
import { getMethodTypeMeta } from "@/lib/methods/method-type-registry";
import { deriveExcerptFromMarkdown } from "@/lib/methods/excerpt";
import { CreateMethodModal } from "@/components/methods/CreateMethodModal";
import { MethodTemplateLibraryModal } from "@/components/methods/MethodTemplateLibraryModal";
import {
  DeleteMethodConfirm,
  findAffectedCompounds,
  type AffectedCompound,
} from "@/components/methods/DeleteMethodConfirm";
import { CompoundMethodBuilder } from "@/components/methods/CompoundMethodBuilder";
import CompoundMethodTabContent from "@/components/methods/CompoundMethodTabContent";
import { WrapAsCompoundAction } from "@/components/methods/WrapAsCompoundAction";
import { ConvertCompoundToSingleAction } from "@/components/methods/ConvertCompoundToSingleAction";
import { GlobeIcon, LockIcon, PencilIcon } from "@/lib/utils/icons";
import { useMethodPermissions } from "@/hooks/useMethodPermissions";
import { isWholeLabShared } from "@/lib/sharing/unified";
import {
  groupOwnMethodsByFolder,
  groupSharedMethodsByOwner,
  isSharedMethod,
  matchesMethodSearch,
  partitionMethodsByOwnership,
} from "@/lib/methods/library-sections";

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

/** Inline SVG for the "Template library" header button (stacked-cards glyph).
 *  Custom inline SVG per the project's no-emoji / no-lucide icon convention. */
function TemplateLibraryIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="4" width="13" height="16" rx="2" />
      <path d="M19 7v13a1 1 0 0 1-1 1H8" />
      <line x1="6.5" y1="8.5" x2="12.5" y2="8.5" />
      <line x1="6.5" y1="12" x2="12.5" y2="12" />
    </svg>
  );
}

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
  // Pending compound-aware delete confirmation. When set, the three-button
  // DeleteMethodConfirm modal is shown; the affected-compounds list is
  // pre-computed at click time so the modal stays presentational.
  const [pendingDelete, setPendingDelete] = useState<{
    method: Method;
    affected: AffectedCompound[];
  } | null>(null);
  // Pending compound edit (the methods page now uses the same builder for
  // both create and edit flows).
  const [editingCompound, setEditingCompound] = useState<Method | null>(null);
  /** When the user lands on `/methods?createMethod=public`, the
   *  create-method modal opens with the whole-lab sharing pre-
   *  selected. Maps to
   *  `shared_with: [{ username: "*", level: "read" }]` at save time
   *  (R1d). Stays false the rest of the time. */
  const [forceWholeLabOnCreate, setForceWholeLabOnCreate] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  // Protocol template library (Extension Store Phase U1). Opens a browse panel
  // over the static method catalog; "Use template" creates an owned method.
  const [browsingTemplates, setBrowsingTemplates] = useState(false);
  const [draggedMethod, setDraggedMethod] = useState<Method | null>(null);
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null);
  const [prefilledFolder, setPrefilledFolder] = useState<string>("");
  const [emptyCategories, setEmptyCategories] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  // Live search query, filters across BOTH the "My Methods" and
  // "Shared with Lab" sections. Empty string disables the filter.
  // Sticks at the top of the page so the user can scan both sections
  // at once.
  const [searchQuery, setSearchQuery] = useState("");

  // Deep-link: `/methods?createMethod=public` auto-opens the create
  // modal with the whole-lab sharing pre-selected.
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams?.get("createMethod") !== "public") return;
    setCreating(true);
    setForceWholeLabOnCreate(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("createMethod");
    const query = next.toString();
    router.replace(query ? `/methods?${query}` : "/methods");
  }, [searchParams, router]);

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

  // Load empty categories from localStorage AFTER currentUser is known so
  // the value is scoped per-user. The legacy unscoped key
  // (`emptyMethodCategories`) leaked across user-profile switches in the
  // same browser: e.g. typing "Toodaloo" while logged in as user A would
  // resurrect "TOODALOO" as a pre-filled empty category for a brand-new
  // user B in the same browser. Per-user scoping closes that leak.
  // Folder-switches reset the load via the currentUser dep.
  useEffect(() => {
    if (!currentUser) return;
    const saved = localStorage.getItem(`emptyMethodCategories:${currentUser}`);
    setEmptyCategories(saved ? JSON.parse(saved) : []);
    setIsHydrated(true);
  }, [currentUser]);

  // Deep-link: `/methods?openMethod=<id>` opens the method detail panel
  // (`viewingMethod`) for the matching method once the methods list has
  // loaded, then strips just that param so a reload doesn't re-trigger.
  // Other params pass through untouched. Resolves the method from the
  // current user's own list first, then falls back to the public
  // namespace so demo IDs like `users/public/methods/1` work too.
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

  // Save empty categories to localStorage when they change (only after
  // hydration). Keyed by currentUser so the value is scoped per-user; see
  // the load effect above for the leak this prevents.
  useEffect(() => {
    if (!isHydrated || !currentUser) return;
    localStorage.setItem(
      `emptyMethodCategories:${currentUser}`,
      JSON.stringify(emptyCategories),
    );
  }, [emptyCategories, isHydrated, currentUser]);

  // One-shot cleanup: nuke the legacy unscoped key after the per-user key
  // has been read. Prevents an old bookmark or external script from
  // resurrecting cross-user category leaks. Safe to run on every mount;
  // localStorage.removeItem on a missing key is a no-op.
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("emptyMethodCategories");
    }
  }, []);

  // Partition methods into "My Methods" (own private records authored by
  // the current user) and "Shared with Lab" (everything else: public
  // namespace methods + methods explicitly shared with me). The split
  // fixes the pre-2026-05-26 bug where public methods inherited their
  // owner's `folder_path` and bled categories like "Molecular Biology"
  // into a brand-new user's library.
  const { own: ownMethods, shared: sharedMethods } = useMemo(
    () => partitionMethodsByOwnership(methods, currentUser),
    [methods, currentUser],
  );

  // Apply the live search across both sections. Empty query is a no-op
  // (returns the full lists). The filtered lists drive both the grouped
  // rendering AND the empty-section copy.
  const filteredOwnMethods = useMemo(
    () => ownMethods.filter((m) => matchesMethodSearch(m, searchQuery)),
    [ownMethods, searchQuery],
  );
  const filteredSharedMethods = useMemo(
    () => sharedMethods.filter((m) => matchesMethodSearch(m, searchQuery)),
    [sharedMethods, searchQuery],
  );

  // Group "My Methods" by `folder_path`, the existing category-driven
  // layout, but ONLY for methods the user owns. Public methods no
  // longer appear here, so their owner's category names never enter
  // the grouping keys.
  const ownGrouped = useMemo(
    () => groupOwnMethodsByFolder(filteredOwnMethods),
    [filteredOwnMethods],
  );

  // Group "Shared with Lab" by owner-name instead of folder_path so the
  // owner's private taxonomy doesn't leak into the receiver's library
  // (the original bug). v1 sub-grouping; flat would have worked too, but
  // owner-grouping gives receivers a cue about who shared each method.
  const sharedGrouped = useMemo(
    () => groupSharedMethodsByOwner(filteredSharedMethods),
    [filteredSharedMethods],
  );

  // Folder list for the "My Methods" section. Empty categories the
  // user created go alongside the folders inferred from their owned
  // methods. "Uncategorized" appears only when the user actually has
  // uncategorized methods of their own (not when a shared method
  // happens to be uncategorized).
  const ownMethodFolders = Array.from(
    new Set(ownMethods.map((m) => m.folder_path).filter(Boolean))
  ) as string[];
  const hasOwnUncategorized = (ownGrouped["Uncategorized"]?.length ?? 0) > 0;
  const allFolders = Array.from(
    new Set([
      ...ownMethodFolders,
      ...emptyCategories,
      ...(hasOwnUncategorized ? ["Uncategorized"] : []),
    ]),
  ).filter((folder) => {
    // Keep the folder if it has own methods OR if it's an empty category.
    // "Uncategorized" only shows when the user has uncategorized own methods.
    if (folder === "Uncategorized") return hasOwnUncategorized;
    const hasMethods = (ownGrouped[folder]?.length ?? 0) > 0;
    return hasMethods || emptyCategories.includes(folder);
  });

  // All existing folders for autocomplete (includes empty categories).
  // Drives the CreateMethodModal / CreateCategoryModal "existing folders"
  // hints, so they only suggest folders the user has personally
  // organized, not folders from shared methods.
  const existingFolders = allFolders;

  // Clean up empty categories that now have methods (only after
  // hydration). Counts the user's OWN methods only, so a public
  // method that happens to share a folder name does NOT auto-clear
  // a user's empty category. Matches the new two-section layout
  // where empty categories belong exclusively to "My Methods".
  useEffect(() => {
    if (!isHydrated) return;
    const categoriesWithMethods = new Set(
      ownMethods.map((m) => m.folder_path).filter(Boolean),
    );
    const stillEmpty = emptyCategories.filter(
      (cat) => !categoriesWithMethods.has(cat),
    );
    if (stillEmpty.length !== emptyCategories.length) {
      setEmptyCategories(stillEmpty);
    }
  }, [ownMethods, emptyCategories, isHydrated]);

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

      // Defensive guard: shared method cards are non-draggable in the
      // new two-section layout. If a drag event ever reaches here for a
      // shared method, bail without writing. Uses `isSharedMethod` so
      // the user's own published-public methods (created_by === me,
      // owner === "public") stay draggable within My Methods.
      if (currentUser && isSharedMethod(draggedMethod, currentUser)) {
        setDraggedMethod(null);
        setDropTargetFolder(null);
        return;
      }

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
    [draggedMethod, queryClient, currentUser]
  );

  // Cascading per-type deletion logic (PCR + LC + plate + cell_culture
  // protocol records, plus the markdown/PDF method directory). Extracted
  // from the original inline handleDelete so the compound cascade can call
  // it once per affected method.
  const deleteOneMethod = useCallback(
    async (method: Method) => {
      if (method.source_path) {
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
        } else if (
          method.method_type === "plate" &&
          method.source_path.startsWith("plate://protocol/")
        ) {
          const plateId = parseInt(method.source_path.replace("plate://protocol/", ""));
          try {
            await plateApi.delete(plateId);
          } catch {
            // Non-fatal — plate protocol might not exist
          }
        } else if (
          method.method_type === "cell_culture" &&
          method.source_path.startsWith("cell_culture://protocol/")
        ) {
          const ccId = parseInt(method.source_path.replace("cell_culture://protocol/", ""));
          try {
            await cellCultureApi.delete(ccId);
          } catch {
            // Non-fatal — cell culture schedule might not exist
          }
        } else if (
          method.method_type === "mass_spec" &&
          method.source_path.startsWith("mass_spec://protocol/")
        ) {
          const msId = parseInt(method.source_path.replace("mass_spec://protocol/", ""));
          try {
            await massSpecApi.delete(msId);
          } catch {
            // Non-fatal — mass spec protocol might not exist
          }
        } else if (
          method.method_type === "coding_workflow" &&
          method.source_path.startsWith("coding_workflow://protocol/")
        ) {
          const cwId = parseInt(
            method.source_path.replace("coding_workflow://protocol/", ""),
          );
          try {
            await codingWorkflowApi.delete(cwId);
          } catch {
            // Non-fatal — coding workflow protocol might not exist
          }
        } else if (
          method.method_type === "qpcr_analysis" &&
          method.source_path.startsWith("qpcr_analysis://protocol/")
        ) {
          const qpcrId = parseInt(method.source_path.replace("qpcr_analysis://protocol/", ""));
          try {
            await qpcrAnalysisApi.delete(qpcrId);
          } catch {
            // Non-fatal — qPCR analysis protocol might not exist
          }
        } else {
          const methodDir = method.source_path.substring(0, method.source_path.lastIndexOf("/"));
          try {
            await filesApi.deleteDirectory(methodDir);
          } catch {
            // Non-fatal — directory might not exist
          }
        }
      }
      // Compounds carry source_path: null and have no parallel protocol
      // record to clean up — the components array lives inline on the
      // method row.
      await methodsApi.delete(method.id);
    },
    [],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      const method = methods.find((m) => m.id === id);
      if (!method) return;
      // Compound-aware: when this method is referenced by any compound,
      // route through the three-button DeleteMethodConfirm modal (Q-A4
      // lock). The common case (no references) falls through to today's
      // simple confirm — no extra friction.
      const affected = findAffectedCompounds(method.id, method.owner, methods);
      if (affected.length > 0) {
        setPendingDelete({ method, affected });
        return;
      }
      if (!confirm("Delete this method and all associated files?")) return;
      try {
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
          } else if (
            method.method_type === "plate" &&
            method.source_path.startsWith("plate://protocol/")
          ) {
            const plateId = parseInt(method.source_path.replace("plate://protocol/", ""));
            try {
              await plateApi.delete(plateId);
            } catch {
              // Non-fatal — plate protocol might not exist
            }
          } else if (
            method.method_type === "cell_culture" &&
            method.source_path.startsWith("cell_culture://protocol/")
          ) {
            const ccId = parseInt(method.source_path.replace("cell_culture://protocol/", ""));
            try {
              await cellCultureApi.delete(ccId);
            } catch {
              // Non-fatal — cell culture schedule might not exist
            }
          } else if (
            method.method_type === "mass_spec" &&
            method.source_path.startsWith("mass_spec://protocol/")
          ) {
            const msId = parseInt(method.source_path.replace("mass_spec://protocol/", ""));
            try {
              await massSpecApi.delete(msId);
            } catch {
              // Non-fatal — mass spec protocol might not exist
            }
          } else if (
            method.method_type === "coding_workflow" &&
            method.source_path.startsWith("coding_workflow://protocol/")
          ) {
            const cwId = parseInt(
              method.source_path.replace("coding_workflow://protocol/", ""),
            );
            try {
              await codingWorkflowApi.delete(cwId);
            } catch {
              // Non-fatal — coding workflow protocol might not exist
            }
          } else if (
            method.method_type === "qpcr_analysis" &&
            method.source_path.startsWith("qpcr_analysis://protocol/")
          ) {
            const qpcrId = parseInt(method.source_path.replace("qpcr_analysis://protocol/", ""));
            try {
              await qpcrAnalysisApi.delete(qpcrId);
            } catch {
              // Non-fatal — qPCR analysis protocol might not exist
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

  // Handlers for the three-button DeleteMethodConfirm modal. "Just delete"
  // drops the method but leaves the affected compounds intact (their
  // renderers display the orphan band where the deleted child was);
  // "Cascade" drops the method AND every affected compound row.
  const handleJustDelete = useCallback(async () => {
    if (!pendingDelete) return;
    try {
      await deleteOneMethod(pendingDelete.method);
      await queryClient.refetchQueries({ queryKey: ["methods"] });
      setViewingMethod(null);
    } catch {
      alert("Failed to delete method");
    } finally {
      setPendingDelete(null);
    }
  }, [pendingDelete, deleteOneMethod, queryClient]);

  const handleCascadeDelete = useCallback(async () => {
    if (!pendingDelete) return;
    try {
      // Delete the target method first; then every compound that
      // referenced it. The renderer's normalize path would mark the
      // affected compounds with orphan bands if we left them — but the
      // user picked "cascade" specifically to avoid that.
      await deleteOneMethod(pendingDelete.method);
      for (const aff of pendingDelete.affected) {
        const compound = methods.find((m) => m.id === aff.id && m.owner === aff.owner);
        if (!compound) continue;
        try {
          await deleteOneMethod(compound);
        } catch {
          // Non-fatal — best-effort cascade
        }
      }
      await queryClient.refetchQueries({ queryKey: ["methods"] });
      setViewingMethod(null);
    } catch {
      alert("Failed to delete methods");
    } finally {
      setPendingDelete(null);
    }
  }, [pendingDelete, methods, deleteOneMethod, queryClient]);

  // Retire a PUBLIC (lab-wide) method (delete-affordances bot, 2026-05-29).
  // Public methods are ownerless once published (owner === "public",
  // shared_with carries "*" at level "read"), so the unified canWrite gate
  // returns false for EVERY viewer — there was no way to remove an unwanted
  // public method (e.g. one whose creator was a since-deleted user, which is
  // exactly the ghost Grant hit). This reuses the existing delete path
  // (deleteOneMethod -> methodsApi.delete, which hard-deletes the public
  // record via publicMethodsStore.delete) and gates the lab-wide action
  // behind an explicit confirm naming the impact. PERMISSION CHOICE (FLAG
  // for Grant): any lab member may retire a public method; the friction is a
  // strong confirm rather than a lab_head/PI restriction, since any member
  // can publish one in the first place. Restricting to lab_head/PI is a
  // one-line change here if Grant prefers it.
  const handleRetirePublicMethod = useCallback(
    async (method: Method) => {
      const ok = confirm(
        `Retire "${method.name}" from the lab?\n\n` +
          "This is a public, lab-wide method. Retiring it removes it for " +
          "everyone in the lab, not just you. This cannot be undone.",
      );
      if (!ok) return;
      try {
        await deleteOneMethod(method);
        await queryClient.refetchQueries({ queryKey: ["methods"] });
        setViewingMethod(null);
      } catch {
        alert("Failed to retire method");
      }
    },
    [deleteOneMethod, queryClient],
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
    // The onboarding v4 §6.4 demo step (`methods-category`) used to
    // advance on this DOM event. That step was retired in tour
    // simplification pass 3 2026-06-03 (CASE 1: categories are free-text
    // folders, no record needed), so there is no tour listener anymore.
    // Kept as a harmless unconditional dispatch in case any future
    // listener wants the signal; the cost is one ignored `dispatchEvent`
    // call when nothing is listening.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tour:methods-category-created", {
          detail: { categoryName },
        }),
      );
    }
    if (addMethodNow) {
      setPrefilledFolder(categoryName);
      setCreating(true);
    }
  }, []);

  const handleMethodCreated = useCallback(
    async (extendedCompound?: Method) => {
      await queryClient.refetchQueries({ queryKey: ["methods"] });
      setCreating(false);
      setPrefilledFolder("");
      // Phase 0e: "Save & extend into kit" in CreateMethodModal returns the
      // freshly-created compound so we can open the builder pre-populated
      // with the just-created method as the first child.
      if (extendedCompound) {
        setEditingCompound(extendedCompound);
      }
    },
    [queryClient],
  );

  // Extension Store Phase D (store-detail bot, 2026-05-30): the SINGLE
  // use-template post-action, shared by both entry points so they behave
  // identically. Whether the library was opened standalone (browsing) or from
  // inside the New Method builder, using a template refetches, closes whatever
  // opened it, and opens the freshly-created method in the viewer.
  const handleTemplateUsed = useCallback(
    async (created: Method) => {
      await queryClient.refetchQueries({ queryKey: ["methods"] });
      setBrowsingTemplates(false);
      setCreating(false);
      setPrefilledFolder("");
      setViewingMethod(created);
    },
    [queryClient],
  );

  // Renders a single method card. Shared between the My Methods and
  // Shared with Lab sections so the markup, badges, and click target
  // stay identical. The only behavioral difference is `isDraggable`,
  // which we disable for shared methods (per brief: "shared methods
  // should not be draggable into the user's own categories").
  const renderMethodCard = (m: Method, isDraggable: boolean) => (
    <div
      key={`${m.owner}-${m.id}`}
      draggable={isDraggable}
      onDragStart={isDraggable ? () => handleDragStart(m) : undefined}
      className={`bg-surface-raised border border-border rounded-lg p-4 hover:shadow-sm transition-shadow cursor-pointer ${
        draggedMethod?.id === m.id && draggedMethod?.owner === m.owner ? "opacity-50" : ""
      }`}
      onClick={() => setViewingMethod(m)}
    >
      <div className="flex items-center gap-2">
        {isDraggable ? (
          <span className="text-foreground-muted cursor-grab active:cursor-grabbing">
            ⋮⋮
          </span>
        ) : null}
        <h4 className="text-body font-medium text-foreground flex-1">{m.name}</h4>
        {/* Retire-from-lab control for PUBLIC methods (delete-affordances
            bot, 2026-05-29). Public methods are ownerless, so the unified
            write gate hides every per-viewer Delete button — leaving a stale
            public method (e.g. one authored by a since-deleted user) with no
            way to remove it. This card-level control routes through the
            confirm-gated handleRetirePublicMethod. stopPropagation keeps the
            card's open-on-click from also firing. */}
        {m.is_public && (
          <Tooltip label="Retire from lab" placement="left">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleRetirePublicMethod(m);
              }}
              className="flex-shrink-0 p-1 text-foreground-muted hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors"
              aria-label={`Retire ${m.name} from the lab`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>
      <p className="text-meta text-foreground-muted mt-1 truncate">{m.source_path}</p>
      <div className="flex items-center gap-2 mt-2">
        {(() => {
          const meta = getMethodTypeMeta(m.method_type);
          return (
            <span
              className={`text-meta px-2 py-0.5 rounded-full ${meta.color.bg} ${meta.color.text}`}
            >
              {meta.label}
            </span>
          );
        })()}
        {(m.is_public || isWholeLabShared(m.shared_with)) && (
          <span className="text-meta px-2 py-0.5 bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-300 rounded-full">
            Public
          </span>
        )}
        {m.parent_method_id && (
          <span className="text-meta px-2 py-0.5 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300 rounded-full">
            Forked
          </span>
        )}
      </div>
      {m.tags && m.tags.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {m.tags.map((tag) => (
            <span
              key={tag}
              className="text-meta px-1.5 py-0.5 bg-surface-sunken text-foreground-muted rounded"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  // True when the page should show the "no methods yet" empty state,
  // i.e. the user has nothing of their own AND nothing shared with
  // them. We keep this distinct from `methods.length === 0` so the
  // empty-state copy doesn't shout at someone who can already see
  // a healthy Shared with Lab section.
  const sharedSectionIsEmpty = filteredSharedMethods.length === 0;
  const ownSectionIsEmpty = filteredOwnMethods.length === 0 && allFolders.length === 0;

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-heading font-semibold text-foreground">
            Method Library
          </h2>
          <div className="flex items-center gap-2">
            {/* Cross-section search. Filters BOTH My Methods and Shared
                with Lab. Empty input is a no-op (no filter applied). */}
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search methods..."
              aria-label="Search methods"
              className="px-3 py-1.5 text-body border border-border rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <button
              onClick={() => {
                setCreatingCategory(true);
                // Onboarding v4 §6.4: the `methods-category-open`
                // sub-step used to wait for this DOM event to advance.
                // That step was retired in tour simplification pass 3
                // 2026-06-03 (CASE 1), so there is no tour listener now.
                // Cheap no-op dispatch when nothing is listening.
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("tour:methods-category-modal-opened"),
                  );
                }
              }}
              data-tour-target="methods-add-category"
              className="px-3 py-1.5 text-body border border-border text-foreground rounded-lg hover:bg-surface-sunken"
            >
              + New Category
            </button>
            <button
              onClick={() => setBrowsingTemplates(true)}
              data-tour-target="methods-template-library-button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-body border border-border text-foreground rounded-lg hover:bg-surface-sunken"
            >
              <TemplateLibraryIcon className="w-4 h-4" />
              Template library
            </button>
            <button
              onClick={() => setCreating(true)}
              data-tour-target="methods-new-method-button"
              className="px-3 py-1.5 text-body bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + New Method
            </button>
          </div>
        </div>

        {/* ── Section 1: My Methods ─────────────────────────────────── */}
        {/* The user's own private methods grouped by their personal
            categories. + New Method and + New Category live in the
            page header above and only ever populate THIS section. */}
        <section
          data-tour-target="methods-section-my"
          className="mb-10"
        >
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-heading font-semibold text-foreground">My Methods</h3>
            <p className="text-meta text-foreground-muted">
              Methods you created, in your own categories.
            </p>
          </div>

          {/* Drop zone for Uncategorized at the top of My Methods. Only
              renders when a draggable (i.e. own) method is in flight. */}
          {draggedMethod && (
            <div
              className={`mb-4 p-4 border-2 border-dashed rounded-lg text-center transition-colors ${
                dropTargetFolder === "Uncategorized"
                  ? "border-blue-400 bg-blue-50 dark:bg-blue-500/10"
                  : "border-border"
              }`}
              onDragOver={(e) => handleDragOver(e, "Uncategorized")}
              onDragLeave={handleDragLeave}
              onDrop={() => handleDrop("Uncategorized")}
            >
              <span className="text-body text-foreground-muted">
                Drop here to move to Uncategorized
              </span>
            </div>
          )}

          {ownSectionIsEmpty ? (
            <div className="border-2 border-dashed border-border rounded-lg p-10 text-center">
              <p className="text-body text-foreground-muted mb-2">
                {searchQuery
                  ? "No methods of yours match this search."
                  : "You haven't created any methods yet."}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => setCreating(true)}
                  className="mt-2 px-4 py-2 text-body bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  + New Method
                </button>
              )}
            </div>
          ) : (
            allFolders
              .slice()
              .sort((a, b) => a.localeCompare(b))
              .map((folder) => {
                const folderMethods = ownGrouped[folder] || [];
                const isEmpty = folderMethods.length === 0;
                return (
                  <div
                    key={folder}
                    className={`mb-6 rounded-lg transition-colors ${
                      dropTargetFolder === folder
                        ? "bg-blue-50 dark:bg-blue-500/10 ring-2 ring-blue-300"
                        : ""
                    }`}
                    onDragOver={(e) => handleDragOver(e, folder)}
                    onDragLeave={handleDragLeave}
                    onDrop={() => handleDrop(folder)}
                  >
                    <div className="flex items-center justify-between mb-2 px-1">
                      <h4 className="text-meta font-bold text-foreground-muted uppercase tracking-widest">
                        {folder}
                      </h4>
                      {isEmpty && (
                        <button
                          onClick={() => {
                            setPrefilledFolder(folder);
                            setCreating(true);
                          }}
                          className="text-meta text-blue-600 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300"
                        >
                          + Add Method
                        </button>
                      )}
                    </div>
                    {isEmpty ? (
                      <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                        <p className="text-body text-foreground-muted">
                          No methods in this category
                        </p>
                        <p className="text-meta text-foreground-muted mt-1">
                          Drag a method here or click &quot;Add Method&quot; above
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {folderMethods.map((m) => renderMethodCard(m, true))}
                      </div>
                    )}
                  </div>
                );
              })
          )}
        </section>

        {/* ── Section 2: Shared with Lab ─────────────────────────────── */}
        {/* Public methods + methods explicitly shared with this user.
            Grouped by OWNER (lab member username, or "Lab" for the
            public namespace), NOT by the owner's folder_path. Drag is
            disabled, the receiver cannot move shared methods into
            their own categories or rename someone else's folders. */}
        <section data-tour-target="methods-section-shared" className="mt-8">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-heading font-semibold text-foreground">
              Shared with Lab
            </h3>
            <p className="text-meta text-foreground-muted">
              Shared across your lab. Anyone can use or copy them; only the
              owner can edit.
            </p>
          </div>

          {sharedSectionIsEmpty ? (
            <div className="border-2 border-dashed border-border rounded-lg p-10 text-center">
              <p className="text-body text-foreground-muted">
                {searchQuery
                  ? "No shared methods match this search."
                  : "No methods shared with you yet."}
              </p>
            </div>
          ) : (
            Object.keys(sharedGrouped)
              .slice()
              .sort((a, b) => a.localeCompare(b))
              .map((ownerLabel) => {
                const groupMethods = sharedGrouped[ownerLabel] || [];
                return (
                  <div key={`shared-${ownerLabel}`} className="mb-6 rounded-lg">
                    <div className="flex items-center justify-between mb-2 px-1">
                      <h4 className="text-meta font-bold text-foreground-muted uppercase tracking-widest">
                        {ownerLabel}
                      </h4>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {groupMethods.map((m) => renderMethodCard(m, false))}
                    </div>
                  </div>
                );
              })
          )}
        </section>

        {methods.length === 0 && !creating && (
          <div className="text-center py-16">
            <p className="text-title text-foreground-muted mb-2">No methods yet</p>
            <p className="text-body text-foreground-muted mb-6">
              Add your first protocol as Markdown or upload a PDF
            </p>
            <button
              onClick={() => setCreating(true)}
              className="px-6 py-3 text-body bg-blue-600 text-white rounded-lg hover:bg-blue-700"
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
          initialWholeLab={forceWholeLabOnCreate}
          onClose={() => {
            setCreating(false);
            setPrefilledFolder("");
            setForceWholeLabOnCreate(false);
          }}
          onCreated={handleMethodCreated}
          onTemplateUsed={handleTemplateUsed}
        />
      )}

      {/* Protocol template library (Extension Store Phase U1). Browsing the
          static catalog and using a template both happen here; "Use template"
          creates an owned method, then we refresh the methods query and open
          the new method in the viewer. */}
      {browsingTemplates && (
        <MethodTemplateLibraryModal
          existingFolders={existingFolders}
          onClose={() => setBrowsingTemplates(false)}
          onUsed={handleTemplateUsed}
        />
      )}

      {/* Compound-aware delete modal — only opens when the target method
          is referenced by one or more compounds (Q-A4 lock). Falls back to
          the simple confirm() in handleDelete for the common case. */}
      {pendingDelete && (
        <DeleteMethodConfirm
          methodName={pendingDelete.method.name}
          affectedCompounds={pendingDelete.affected}
          onCancel={() => setPendingDelete(null)}
          onJustDelete={handleJustDelete}
          onCascadeDelete={handleCascadeDelete}
        />
      )}

      {/* Edit-compound builder. Opened from the CompoundViewer's "Edit"
          button below. */}
      {editingCompound && (
        <CompoundMethodBuilder
          editing={editingCompound}
          existingFolders={existingFolders}
          onClose={() => setEditingCompound(null)}
          onSaved={async () => {
            setEditingCompound(null);
            await queryClient.refetchQueries({ queryKey: ["methods"] });
          }}
        />
      )}

      {/* View Method Modal */}
      {viewingMethod && (
        <ViewMethodModal
          method={viewingMethod}
          currentUser={currentUser}
          onClose={() => setViewingMethod(null)}
          onDelete={handleDelete}
          onEditCompound={(method) => {
            setViewingMethod(null);
            setEditingCompound(method);
          }}
          onConvertedToChild={(childMethodId) => {
            if (childMethodId === null) {
              setViewingMethod(null);
              return;
            }
            // Find the surviving child in the live methods cache. The
            // `methods` query gets refetched inside the action handler
            // before this fires, so the lookup is current.
            const child =
              methods.find((m) => m.id === childMethodId) ?? null;
            setViewingMethod(child);
          }}
        />
      )}
    </AppShell>
  );
}

// ── Create Category Modal ────────────────────────────────────────────────────

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
      <div className="bg-surface-raised rounded-xl shadow-2xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-title font-semibold text-foreground">
            New Category
          </h3>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-foreground-muted hover:text-foreground text-heading"
            >
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="p-6">
          <label className="block text-meta font-medium text-foreground-muted mb-1">
            Category Name
          </label>
          <input
            type="text"
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="e.g. Molecular Biology"
            data-tour-target="methods-category-name-input"
            className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate(false);
            }}
          />
          {existingFolders.length > 0 && (
            <div className="mt-3">
              <p className="text-meta text-foreground-muted mb-1">Existing categories:</p>
              <div className="flex flex-wrap gap-1">
                {existingFolders.map((folder) => (
                  <span
                    key={folder}
                    className="text-meta px-2 py-0.5 bg-surface-sunken text-foreground-muted rounded-full"
                  >
                    {folder}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={() => handleCreate(false)}
            disabled={!categoryName.trim()}
            data-tour-target="methods-category-create-empty"
            className="px-4 py-2 text-body border border-border text-foreground hover:bg-surface-sunken rounded-lg disabled:opacity-50"
          >
            Create Empty
          </button>
          <button
            onClick={() => handleCreate(true)}
            disabled={!categoryName.trim()}
            className="px-4 py-2 text-body text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            Create & Add Method
          </button>
        </div>
      </div>
    </div>
  );
}


// ── View Method Modal ────────────────────────────────────────────────────────

function ViewMethodModal({
  method,
  currentUser,
  onClose,
  onDelete,
  onEditCompound,
  onConvertedToChild,
}: {
  method: Method;
  currentUser: string;
  onClose: () => void;
  onDelete: (id: number) => void;
  onEditCompound: (method: Method) => void;
  /** Forwarded from CompoundViewer's convert-back action. The parent looks
   *  up the child id in the methods cache and reopens this modal on the
   *  child's record (or just closes the modal when the compound was empty). */
  onConvertedToChild: (childMethodId: number | null) => void;
}) {
  // Unified Share entry point (2026-06-04): one Share button in the action
  // strip opens the two-tab UnifiedShareDialog (lab ACL + cross-boundary send),
  // replacing the standalone "Share outside this folder" send button.
  const [showShare, setShowShare] = useState(false);
  const queryClient = useQueryClient();

  // After wrapping the current method into a compound: close this viewer
  // and reopen on the new compound's edit modal so the user can immediately
  // add the second component.
  const handleWrapped = (compound: Method) => {
    onClose();
    onEditCompound(compound);
  };

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
    if (method.method_type === "plate") {
      return <PlateViewer method={method} currentUser={currentUser} onClose={onClose} onDelete={onDelete} />;
    }
    if (method.method_type === "cell_culture") {
      return <CellCultureViewer method={method} currentUser={currentUser} onClose={onClose} onDelete={onDelete} />;
    }
    if (method.method_type === "mass_spec") {
      return <MassSpecViewer method={method} currentUser={currentUser} onClose={onClose} onDelete={onDelete} />;
    }
    if (method.method_type === "coding_workflow") {
      return <CodingWorkflowViewer method={method} currentUser={currentUser} onClose={onClose} onDelete={onDelete} />;
    }
    if (method.method_type === "qpcr_analysis") {
      return <QpcrAnalysisViewer method={method} currentUser={currentUser} onClose={onClose} onDelete={onDelete} />;
    }
    if (method.method_type === "compound") {
      return (
        <CompoundViewer
          method={method}
          currentUser={currentUser}
          onClose={onClose}
          onDelete={onDelete}
          onEdit={() => onEditCompound(method)}
          onConvertedToChild={onConvertedToChild}
        />
      );
    }
    return <MarkdownMethodViewer method={method} currentUser={currentUser} onClose={onClose} onDelete={onDelete} />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="flex bg-surface-raised rounded-xl shadow-2xl max-w-[calc(4rem+4rem+72rem)] w-full mx-4 max-h-[85vh]">
        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden rounded-l-xl">
          {/* Cross-boundary provenance. Self-hides on a native method
              (received_from absent), so only a method imported from a received
              bundle shows "Received from {email}, verified" on the entity. */}
          {method.received_from && (
            <div className="px-4 pt-3">
              <ReceivedFromBadge
                receivedFrom={method.received_from}
                fingerprint={method.received_from_fingerprint}
                receivedAt={method.received_at}
              />
            </div>
          )}
          {/* Action strip for the user's OWN method. "Extend into kit" wraps a
              non-compound method into a new compound; the unified Share button
              opens the two-tab dialog (lab ACL + cross-boundary encrypted-copy
              send). Both gate on !is_shared_with_me, a received method is not the
              user's to wrap or re-share from here. */}
          {!method.is_shared_with_me && (
            <div className="flex items-center justify-end gap-1 px-4 pt-3 pb-1">
              {method.method_type !== "compound" && (
                <WrapAsCompoundAction method={method} onWrapped={handleWrapped} />
              )}
              <Tooltip
                label="Share"
                placement="bottom"
              >
                <button
                  type="button"
                  aria-label="Share"
                  onClick={() => setShowShare(true)}
                  className="text-foreground-muted hover:text-foreground-muted p-1"
                >
                  {/* Share-node glyph (inline SVG; no icon library, no emoji). */}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          )}
          {renderViewer()}
        </div>
        {/* Experiments sidebar */}
        <MethodExperimentsSidebar methodId={method.id} methodName={method.name} />
      </div>
      {showShare && (
        <UnifiedShareDialog
          isOpen
          target={{
            kind: "method",
            method,
            owner: method.owner || method.created_by || currentUser,
          }}
          onClose={() => setShowShare(false)}
          onShared={() => {
            queryClient.refetchQueries({ queryKey: ["methods"] });
          }}
        />
      )}
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
          className="px-2 py-1 text-body font-semibold border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
          disabled={saving}
        />
        <button
          onClick={handleSaveName}
          disabled={saving || !name.trim()}
          className="px-2 py-1 text-meta text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "..." : "Save"}
        </button>
        <button
          onClick={() => {
            setName(method.name);
            setEditingName(false);
          }}
          className="px-2 py-1 text-meta text-foreground-muted hover:bg-surface-sunken rounded"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group">
      <h3 className="text-body font-semibold text-foreground">{method.name}</h3>
      <Tooltip label="Rename method" placement="bottom">
        <button
          onClick={() => setEditingName(true)}
          className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 text-meta text-foreground-muted hover:text-foreground-muted hover:bg-surface-sunken rounded transition-opacity"
        >
          <PencilIcon />
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
  const { canModifyMethod } = useMethodPermissions();

  const hasUnsavedChanges = content !== originalContent && !loading;

  // Imperative flush handle published by the embedded editor. Calling it
  // commits the editor's in-flight block buffer, fires onChange, and returns
  // the freshest full-document string, so the parent "Save" button can persist
  // the very latest edit even if the user never left the active block.
  const editorSaveRef = useRef<(() => string) | null>(null);
  // Mirrors the editor's in-flight buffer-dirty flag. Because the editor
  // buffers keystrokes and only flushes to `content` on commit, `content`
  // (and thus hasUnsavedChanges) lags while the user is mid-block. We OR this
  // into the Save button's enabled state so the button lights up the instant
  // typing starts, not only after a block switch.
  const [editorDirty, setEditorDirty] = useState(false);

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
          // Drop = attach to Images/ only; placing the markdown ref
          // inline is the user's explicit drag from the bottom strip.
          imageEvents.emitAttached({ basePath: methodDir, relativePath: `Images/${finalName}` });
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
        // R1c: migration is a write to the source markdown, so gate it
        // through the unified `canWrite` (owner / lab_head-unlocked /
        // shared edit). Wider than the old `is_public || created_by`
        // guard, but each path still requires write permission.
        const canMigrate = canModifyMethod(method);
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
  }, [method, method.source_path, method.name, canModifyMethod]);

  // When `explicitValue` is supplied (the parent Save button flushes the
  // editor buffer first and passes the freshest doc, or Cmd+S routes the
  // buffer value), persist that instead of the async-lagging `content` state.
  // Falls back to `content` otherwise.
  const handleSave = useCallback(async (explicitValue?: string) => {
    if (!method.source_path) return;
    const latest = typeof explicitValue === "string" ? explicitValue : content;
    setSaving(true);
    try {
      await filesApi.writeFile(
        method.source_path,
        latest,
        `Update method: ${method.name}`
      );
      // Method Picker FLAG B: re-stamp the picker-card excerpt from the
      // freshly-saved body so the card hero stays current without a per-card
      // file read. Only markdown methods carry a body here; structured types
      // edit their protocol record through their own viewers. Best-effort:
      // a failed excerpt update never blocks the body save.
      if (method.method_type === "markdown" || method.method_type == null) {
        const excerpt = deriveExcerptFromMarkdown(latest);
        try {
          await scopedMethodsApi.update(method.id, { excerpt });
        } catch {
          // Body already persisted; excerpt is a best-effort denormalization.
        }
      }
      // Update the baseline so subsequent unsaved-change checks compare
      // against the just-saved content.
      setContent(latest);
      setOriginalContent(latest);
      setEditing(false);
    } catch {
      alert("Failed to save");
    } finally {
      setSaving(false);
    }
  }, [content, method.id, method.source_path, method.name, method.method_type, scopedMethodsApi]);

  // Cancel discards in-memory edits by reverting `content` to the snapshot
  // captured on read (or last successful save). Without this, clicking Cancel
  // would leave `content` mutated; re-clicking Edit (without remounting the
  // popup) would resurrect the dirty edits.
  const handleCancel = useCallback(() => {
    setContent(originalContent);
    setEditing(false);
  }, [originalContent]);

  // R1c: unified write gate (owner / lab_head-unlocked / shared edit).
  // Replaces the legacy `!is_public || created_by === currentUser` check.
  const canModify = canModifyMethod(currentMethod);
  const isWholeLab =
    currentMethod.is_public || isWholeLabShared(currentMethod.shared_with);

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <MethodNameEditor method={currentMethod} onNameUpdated={(newName) => setCurrentMethod({ ...currentMethod, name: newName })} />
            <p className="text-meta text-foreground-muted mt-0.5">{currentMethod.source_path}</p>
          </div>
          <div className="flex items-center gap-2">
            {!editing ? (
              <>
                {canModify && (
                  <button
                    onClick={() => setShowSharePopup(true)}
                    className={`px-3 py-1.5 text-meta rounded-lg ${
                      isWholeLab
                        ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-500/20"
                        : "bg-surface-sunken text-foreground-muted hover:bg-foreground-muted/15"
                    }`}
                    title={isWholeLab ? "Unshare method" : "Share method"}
                    aria-label={isWholeLab ? "Unshare method" : "Share method"}
                  >
                    <span className="flex items-center gap-1">
                      {isWholeLab ? <GlobeIcon /> : <LockIcon />}
                      {isWholeLab ? "Public" : "Private"}
                    </span>
                  </button>
                )}
                {canModify && (
                  <button
                    onClick={() => setEditing(true)}
                    className="px-3 py-1.5 text-meta bg-surface-sunken text-foreground-muted rounded-lg hover:bg-foreground-muted/15"
                  >
                    Edit
                  </button>
                )}
              </>
            ) : (
              <>
                {(hasUnsavedChanges || editorDirty) && (
                  <span className="text-meta text-amber-600 dark:text-amber-300 font-medium">Unsaved changes</span>
                )}
                <button
                  onClick={handleCancel}
                  className="px-3 py-1.5 text-meta text-foreground-muted rounded-lg hover:bg-surface-sunken"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // Flush the editor's in-flight block buffer first so the
                    // last in-progress edit lands on disk, then persist.
                    const latest = editorSaveRef.current?.() ?? content;
                    void handleSave(latest);
                  }}
                  disabled={saving || (!hasUnsavedChanges && !editorDirty)}
                  className={`px-3 py-1.5 text-meta rounded-lg transition-colors ${
                    (hasUnsavedChanges || editorDirty) && !saving
                      ? "text-white bg-blue-600 hover:bg-blue-700"
                      : "text-foreground-muted bg-foreground-muted/15 cursor-not-allowed"
                  } disabled:opacity-50`}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </>
            )}
            {canModify && (
              <button
                onClick={() => onDelete(currentMethod.id)}
                className="px-3 py-1.5 text-meta text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                Delete
              </button>
            )}
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-foreground-muted hover:text-foreground text-heading ml-2"
              >
                ✕
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-6 text-body text-foreground-muted animate-pulse">
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
                recordType="method"
                // The parent owns its own version-controlled "Save" button, so
                // hide the editor's internal one. saveRef flushes the live
                // buffer; onExplicitSave routes Cmd+S to disk; onDirtyChange
                // keeps the parent button enabled while mid-edit.
                hideSaveButton
                saveRef={editorSaveRef}
                onExplicitSave={(v) => { void handleSave(v); }}
                onDirtyChange={setEditorDirty}
              />
              {uploadWarning && (
                <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg flex items-start gap-2">
                  <span className="text-amber-500">⚠️</span>
                  <div className="flex-1">
                    <p className="text-body text-amber-800 dark:text-amber-200">{uploadWarning}</p>
                  </div>
                  <button
                    onClick={() => setUploadWarning(null)}
                    className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-300"
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
      
      {/* Unified Share dialog. The viewer's Public / Private pill opens this
          two-tab surface (lab ACL + cross-boundary send) instead of the bare
          lab-ACL dialog, matching the action-strip Share button. */}
      {showSharePopup && (
        <UnifiedShareDialog
          isOpen
          target={{
            kind: "method",
            method: currentMethod,
            owner:
              currentMethod.owner || currentMethod.created_by || currentUser,
          }}
          onClose={() => setShowSharePopup(false)}
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
  const { canModifyMethod } = useMethodPermissions();

  // Owner-aware view: shared-with-edit methods route reads to the owner's dir.
  const scopedMethodsApi = useMemo(() => ownerScopedMethodsApi(currentMethod), [currentMethod]);

  // R1c: unified write gate (owner / lab_head-unlocked / shared edit).
  const canModify = canModifyMethod(currentMethod);
  const isWholeLab =
    currentMethod.is_public || isWholeLabShared(currentMethod.shared_with);

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
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <MethodNameEditor method={currentMethod} onNameUpdated={(newName) => setCurrentMethod({ ...currentMethod, name: newName })} />
            <p className="text-meta text-foreground-muted mt-0.5">
              PDF — {currentMethod.source_path}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canModify && !currentMethod.is_shared_with_me && (
              <Tooltip label="Share method" placement="bottom">
                <button
                  onClick={() => setShowSharePopup(true)}
                  className={`px-3 py-1.5 text-meta rounded-lg ${
                    isWholeLab
                      ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-500/20"
                      : "bg-surface-sunken text-foreground-muted hover:bg-foreground-muted/15"
                  }`}
                >
                  <span className="flex items-center gap-1">
                    {isWholeLab ? <GlobeIcon /> : <LockIcon />}
                    {isWholeLab ? "Public" : "Private"}
                  </span>
                </button>
              </Tooltip>
            )}
            {canModify && (
              <button
                onClick={() => onDelete(currentMethod.id)}
                className="px-3 py-1.5 text-meta text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                Delete
              </button>
            )}
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-foreground-muted hover:text-foreground text-heading ml-2"
              >
                ✕
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <p className="p-6 text-body text-foreground-muted animate-pulse">
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
              <p className="text-body text-foreground-muted">
                Unable to display PDF. The file may not exist yet.
              </p>
            </div>
          )}
        </div>
      </div>
      
      {/* Unified Share dialog. The viewer's Public / Private pill opens this
          two-tab surface (lab ACL + cross-boundary send) instead of the bare
          lab-ACL dialog, matching the action-strip Share button. */}
      {showSharePopup && (
        <UnifiedShareDialog
          isOpen
          target={{
            kind: "method",
            method: currentMethod,
            owner:
              currentMethod.owner || currentMethod.created_by || currentUser,
          }}
          onClose={() => setShowSharePopup(false)}
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

  // R1c: unified write gate. The methods page's `useMethodPermissions`
  // hook handles owner / lab_head-unlocked / shared edit.
  const { canModifyMethod } = useMethodPermissions();
  const canModify = canModifyMethod(currentMethod);
  const isWholeLab =
    currentMethod.is_public || isWholeLabShared(currentMethod.shared_with);

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <MethodNameEditor method={currentMethod} onNameUpdated={(newName) => setCurrentMethod({ ...currentMethod, name: newName })} />
            <p className="text-meta text-foreground-muted mt-0.5">
              PCR Protocol
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canModify && !currentMethod.is_shared_with_me && (
              <Tooltip label="Share method" placement="bottom">
                <button
                  onClick={() => setShowSharePopup(true)}
                  className={`px-3 py-1.5 text-meta rounded-lg ${
                    isWholeLab
                      ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-500/20"
                      : "bg-surface-sunken text-foreground-muted hover:bg-foreground-muted/15"
                  }`}
                >
                  <span className="flex items-center gap-1">
                    {isWholeLab ? <GlobeIcon /> : <LockIcon />}
                    {isWholeLab ? "Public" : "Private"}
                  </span>
                </button>
              </Tooltip>
            )}
            {canModify && (
              <button
                onClick={() => onDelete(currentMethod.id)}
                className="px-3 py-1.5 text-meta text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                Delete
              </button>
            )}
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-foreground-muted hover:text-foreground text-heading ml-2"
              >
                ✕
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-body text-foreground-muted animate-pulse">
              Loading PCR protocol...
            </p>
          ) : !protocol ? (
            <div className="text-center py-8">
              <p className="text-body text-foreground-muted">
                PCR protocol not found. It may have been deleted.
              </p>
            </div>
          ) : gradient ? (
            <div className="space-y-6">
              {/* Interactive Gradient Editor - Always visible with Edit Cycle button */}
              <div>
                <h4 className="text-body font-semibold text-foreground mb-3">
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
                  <h4 className="text-body font-semibold text-foreground">
                    Reaction Recipe
                  </h4>
                  {editingRecipe ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingRecipe(false)}
                        className="px-3 py-1.5 text-meta text-foreground-muted rounded-lg hover:bg-surface-sunken"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveRecipe}
                        disabled={saving}
                        className="px-3 py-1.5 text-meta text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Save Recipe"}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingRecipe(true)}
                      className="px-3 py-1.5 text-meta bg-surface-sunken text-foreground-muted rounded-lg hover:bg-foreground-muted/15"
                    >
                      Edit Recipe
                    </button>
                  )}
                </div>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-meta">
                    <thead className="bg-surface-sunken">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-foreground-muted">Ingredient</th>
                        <th className="px-4 py-2 text-left font-medium text-foreground-muted">Concentration</th>
                        <th className="px-4 py-2 text-left font-medium text-foreground-muted">Amount/Rx</th>
                        {editingRecipe && <th className="px-2 py-2 w-8"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {ingredients.map((ing, i) => (
                        <tr key={ing.id} className={i % 2 === 0 ? "bg-surface-raised" : "bg-surface-sunken"}>
                          <td className="px-4 py-2">
                            {ing.name === "Total" ? (
                              <span className="font-medium text-foreground">{ing.name}</span>
                            ) : editingRecipe ? (
                              <input
                                type="text"
                                value={ing.name}
                                onChange={(e) => {
                                  const newIngredients = [...ingredients];
                                  newIngredients[i] = { ...ing, name: e.target.value };
                                  setIngredients(newIngredients);
                                }}
                                className="w-full px-2 py-1 border border-border rounded text-foreground"
                              />
                            ) : (
                              <span className="text-foreground font-medium">{ing.name}</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {ing.name === "Total" ? (
                              <span className="text-foreground-muted">-</span>
                            ) : editingRecipe ? (
                              <input
                                type="text"
                                value={ing.concentration}
                                onChange={(e) => {
                                  const newIngredients = [...ingredients];
                                  newIngredients[i] = { ...ing, concentration: e.target.value };
                                  setIngredients(newIngredients);
                                }}
                                className="w-full px-2 py-1 border border-border rounded text-foreground-muted"
                                placeholder="e.g. 10x"
                              />
                            ) : (
                              <span className="text-foreground-muted">{ing.concentration || "-"}</span>
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
                                className="w-full px-2 py-1 border border-border rounded text-foreground-muted"
                                placeholder="e.g. 2.5"
                              />
                            ) : (
                              <span className="text-foreground-muted">{ing.amount_per_reaction || "-"}</span>
                            )}
                          </td>
                          {editingRecipe && ing.name !== "Total" && (
                            <td className="px-2 py-2">
                              <Tooltip label="Remove ingredient" placement="left">
                                <button
                                  onClick={() => {
                                    setIngredients(ingredients.filter((item) => item.id !== ing.id));
                                  }}
                                  className="text-foreground-muted hover:text-red-500 text-body"
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
                      className="w-full py-2 text-meta text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10 border-t border-border"
                    >
                      + Add Ingredient
                    </button>
                  )}
                </div>
              </div>
              
              {/* Notes */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-body font-semibold text-foreground">
                    Notes
                  </h4>
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Any additional notes..."
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      
      {/* Unified Share dialog. The viewer's Public / Private pill opens this
          two-tab surface (lab ACL + cross-boundary send) instead of the bare
          lab-ACL dialog, matching the action-strip Share button. */}
      {showSharePopup && (
        <UnifiedShareDialog
          isOpen
          target={{
            kind: "method",
            method: currentMethod,
            owner:
              currentMethod.owner || currentMethod.created_by || currentUser,
          }}
          onClose={() => setShowSharePopup(false)}
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

// ── Compound Viewer ──────────────────────────────────────────────────────────
//
// Standalone-view wrapper for /methods compound rows. Re-uses the
// CompoundMethodTabContent renderer in readOnly mode against a synthetic
// "preview" task that owns no real per-task snapshot data — the standalone
// view is for browsing the kit's components, not editing them per-task.

function CompoundViewer({
  method,
  currentUser,
  onClose,
  onDelete,
  onEdit,
  onConvertedToChild,
}: {
  method: Method;
  currentUser: string;
  onClose: () => void;
  onDelete: (id: number) => void;
  onEdit: () => void;
  /** Fired after the user picks "Convert back to single method". The
   *  argument is the surviving child method's id, or null when the compound
   *  was empty. The parent uses this to navigate to the child's viewer. */
  onConvertedToChild: (childMethodId: number | null) => void;
}) {
  // Synthetic task that carries one attachment pointing at this compound,
  // with a null compound_snapshots payload. The CompoundMethodTabContent
  // renderer fans out and reads source-template data for each child;
  // readOnly suppresses every save/reset affordance.
  const previewTask = useMemo<Task>(
    () => ({
      id: -1,
      project_id: 0,
      name: "",
      start_date: "",
      duration_days: 0,
      end_date: "",
      is_high_level: false,
      is_complete: false,
      task_type: "experiment",
      weekend_override: null,
      method_ids: [method.id],
      deviation_log: null,
      tags: null,
      sort_order: 0,
      experiment_color: null,
      sub_tasks: null,
      method_attachments: [
        {
          method_id: method.id,
          owner: method.owner,
          pcr_gradient: null,
          pcr_ingredients: null,
          lc_gradient: null,
          body_override: null,
          plate_annotation: null,
          cell_culture_schedule: null,
          variation_notes: null,
          compound_snapshots: null,
          qpcr_analysis: null,
        },
      ],
      owner: method.owner || currentUser,
      shared_with: [],
    }),
    [method.id, method.owner, currentUser],
  );
  // R1c: unified write gate (owner / lab_head-unlocked / shared edit).
  const { canModifyMethod } = useMethodPermissions();
  const canModify = canModifyMethod(method);
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h3 className="text-body font-semibold text-foreground">{method.name}</h3>
          <p className="text-meta text-foreground-muted mt-0.5">
            Kit, {method.components?.length ?? 0} component
            {(method.components?.length ?? 0) === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Convert-back to single method — only when the compound has at
              most one component left. Deletes the compound wrapper; the
              parent navigates to the surviving child (or just closes when
              the compound was empty). */}
          {canModify && (method.components?.length ?? 0) <= 1 && (
            <ConvertCompoundToSingleAction
              compound={method}
              onConverted={onConvertedToChild}
            />
          )}
          {canModify && (
            <button
              onClick={onEdit}
              className="px-3 py-1.5 text-meta bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Edit components
            </button>
          )}
          {canModify && (
            <button
              onClick={() => onDelete(method.id)}
              className="px-3 py-1.5 text-meta text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              Delete
            </button>
          )}
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-foreground-muted hover:text-foreground text-heading ml-2"
            >
              ✕
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <CompoundMethodTabContent
          task={previewTask}
          method={method}
          methodId={method.id}
          attachment={previewTask.method_attachments[0]}
          readOnly
          hideVariationNotes
        />
      </div>
    </div>
  );
}
