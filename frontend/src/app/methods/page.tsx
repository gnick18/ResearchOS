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
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { usePiViewMode } from "@/hooks/usePiViewMode";
import { fileService } from "@/lib/file-system/file-service";
import { fileEvents } from "@/lib/attachments/file-events";
import { imageEvents } from "@/lib/attachments/image-events";
import { migrateNoteImages } from "@/lib/notes/migrate-images";
import { setBeakerContext } from "@/components/ai/context-bridge";
import { hasLegacyStampFormat, normalizeStampFormat } from "@/lib/stamp-utils";
import AppShell from "@/components/AppShell";
import LiveMarkdownEditor from "@/components/LiveMarkdownEditor";
import RenderedMarkdown from "@/components/RenderedMarkdown";
import { InteractiveGradientEditor } from "@/components/InteractiveGradientEditor";
import MethodExperimentsSidebar from "@/components/MethodExperimentsSidebar";
import { useFileRenamePopup } from "@/components/FileRenamePopup";
import UnifiedShareDialog from "@/components/sharing/UnifiedShareDialog";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import ReceivedFromBadge from "@/components/ReceivedFromBadge";
import Tooltip from "@/components/Tooltip";
import ObjectBacklinks from "@/components/ObjectBacklinks";
import { Icon, type IconName } from "@/components/icons";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
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
import { forkMethod } from "@/lib/methods/fork-method";
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
import { useMethodsBeakerSource } from "./useMethodsBeakerSource";

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

// ── Lineage forest ───────────────────────────────────────────────────────────
// A method with `parent_method_id` is a fork (variant) of the method it points
// at. The explorer nests variants under their base method, lineage wins over
// folders, so a variant filed in a different folder still renders under its
// base. Ids are unique only within an ownership bucket (own methods, or one
// owner's shared methods), so a forest is always built from a single bucket.

type MethodNode = { method: Method; children: MethodNode[]; depth: number };

/** Effective parent id for `m` within `byId`, or null when it is a root.
 *  Returns null for a missing / self / out-of-bucket parent, and breaks any
 *  parent cycle (a malformed parent_method_id loop) by treating the method as
 *  a root rather than looping forever. */
function resolveParentId(m: Method, byId: Map<number, Method>): number | null {
  const pid = m.parent_method_id;
  if (pid == null || pid === m.id || !byId.has(pid)) return null;
  const seen = new Set<number>([m.id]);
  let cur: number | null = pid;
  while (cur != null) {
    if (seen.has(cur)) return null; // cycle — break here, treat m as a root
    seen.add(cur);
    const parent = byId.get(cur);
    if (!parent) break;
    const next = parent.parent_method_id;
    cur = next != null && byId.has(next) ? next : null;
  }
  return pid;
}

/** Build the lineage forest for one ownership bucket. Roots are base methods
 *  (no in-bucket parent); each node's children are its forks, sorted by name,
 *  with a `depth` stamped for indentation. */
function buildMethodForest(methods: Method[]): MethodNode[] {
  const keyOf = (m: Method) => `${m.owner}:${m.id}`;
  // Parent resolution is by numeric id (that's what parent_method_id stores);
  // first method wins if two share an id across owners. Node identity is keyed
  // by owner:id so a private id-N and a public id-N stay distinct nodes.
  const byId = new Map<number, Method>();
  methods.forEach((m) => {
    if (!byId.has(m.id)) byId.set(m.id, m);
  });
  const nodeByKey = new Map<string, MethodNode>();
  methods.forEach((m) => nodeByKey.set(keyOf(m), { method: m, children: [], depth: 0 }));
  const roots: MethodNode[] = [];
  methods.forEach((m) => {
    const node = nodeByKey.get(keyOf(m))!;
    const pid = resolveParentId(m, byId);
    const parentMethod = pid != null ? byId.get(pid) : undefined;
    const parentNode = parentMethod ? nodeByKey.get(keyOf(parentMethod)) : undefined;
    if (parentNode && parentNode !== node) {
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const stamp = (node: MethodNode, depth: number) => {
    node.depth = depth;
    node.children.sort((a, b) => a.method.name.localeCompare(b.method.name));
    node.children.forEach((c) => stamp(c, depth + 1));
  };
  roots.sort((a, b) => a.method.name.localeCompare(b.method.name));
  roots.forEach((r) => stamp(r, 0));
  return roots;
}

/** Flatten a forest into visible rows. A family (a root and its descendants)
 *  renders when ANY member matches `matches`, so a variant matching the active
 *  folder pulls its out-of-folder base into view (lineage wins). Collapsed
 *  bases hide their descendants. */
function flattenForest(
  roots: MethodNode[],
  matches: (m: Method) => boolean,
  isExpanded: (m: Method) => boolean,
): MethodNode[] {
  const out: MethodNode[] = [];
  const familyMatches = (node: MethodNode): boolean =>
    matches(node.method) || node.children.some(familyMatches);
  const walk = (node: MethodNode) => {
    out.push(node);
    if (isExpanded(node.method)) node.children.forEach(walk);
  };
  roots.forEach((r) => {
    if (familyMatches(r)) walk(r);
  });
  return out;
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

  // Publish the open method to the BeakerBot context bridge so the model can
  // resolve "this", "this method", or "this protocol" to what the user has open.
  // Mirrors the Data Hub publisher: rebuilt when the selection changes, cleared on
  // close and on unmount so the model never inherits a stale selection.
  useEffect(() => {
    if (!viewingMethod) {
      setBeakerContext(null);
      return;
    }
    setBeakerContext({
      route: "/methods",
      pageLabel: "Methods",
      selection: {
        type: "method",
        id: String(viewingMethod.id),
        name: viewingMethod.name || "Untitled method",
      },
    });
    return () => {
      setBeakerContext(null);
    };
  }, [viewingMethod]);
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

  // Explorer navigation. `activeFolder` scopes the right pane: "all" (every
  // own method), "shared" (the Shared with Lab view, grouped by owner), or a
  // specific folder name. `activeType` is an optional method-type chip filter.
  // `collapsedBases` tracks which base methods are collapsed in the lineage
  // tree (default expanded, so a freshly created fork is visible right away).
  const [activeFolder, setActiveFolder] = useState<string>("all");
  const [activeType, setActiveType] = useState<string | null>(null);
  const [collapsedBases, setCollapsedBases] = useState<Set<string>>(new Set());
  // The method currently being forked. Set by the popup's "Fork" button or a
  // list row's fork action; opens the name-the-variant modal.
  const [forkingSource, setForkingSource] = useState<Method | null>(null);
  const [forkBusy, setForkBusy] = useState(false);
  // Right-click row menu (Open / Fork / Delete). Positioned at the cursor.
  const [rowMenu, setRowMenu] = useState<{ method: Method; x: number; y: number } | null>(null);

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

  // Get current user for permission checks. Read BEFORE the methods query so the
  // methods cache can key on the user (see the methods queryKey below).
  const { data: userData } = useQuery({
    queryKey: ["users"],
    queryFn: usersApi.list,
  });
  const currentUser = userData?.current_user || "";

  // RS-1: a PI in the lab lens defaults to the "Shared with lab" protocol library
  // (public + members' methods) rather than their own private methods. Applied
  // once when the lab lens first resolves, ref-guarded so it never fights a
  // folder the PI then picks themselves.
  const isLabHead = useIsLabHead(currentUser || null);
  const { mode: piViewMode } = usePiViewMode();
  const labLens = isLabHead === true && piViewMode === "lab";
  const appliedLabFolderDefault = useRef(false);
  // RS-1: once, when the PI lab lens resolves, open the Shared-with-lab library.
  useEffect(() => {
    if (labLens && !appliedLabFolderDefault.current) {
      appliedLabFolderDefault.current = true;
      setActiveFolder("shared");
    }
  }, [labLens]);

  // BeakerSearch global object search, decision 5, the methods query-key
  // alignment. The page previously read bare `["methods"]` while `/search` (the
  // relationship anchor) and the global object index read `["methods",
  // currentUser]`. Those are DIFFERENT cache entries, which double-fetched and
  // split staleness after an edit. Standardize on `["methods", currentUser]` so
  // there is ONE method cache. The page's many `refetchQueries({ queryKey:
  // ["methods"] })` calls below still hit it (React Query matches by key prefix),
  // so no invalidation site changes. This is a cache-key alignment only, the page
  // internals and the deep-link are untouched.
  const { data: rawMethods = [] } = useQuery({
    queryKey: ["methods", currentUser],
    queryFn: fetchAllMethodsIncludingShared,
  });

  // Dedupe by owner:id. fetchAllMethodsIncludingShared can surface the same
  // record twice (e.g. a public method present in both the own and public
  // passes), which both renders a duplicate row and, because two methods then
  // share an owner:id key, breaks the lineage tree and React keys. First
  // occurrence wins. This is a defensive guard regardless of the upstream cause.
  const methods = useMemo(() => {
    const seen = new Set<string>();
    const out: Method[] = [];
    for (const m of rawMethods) {
      const key = `${m.owner}:${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    return out;
  }, [rawMethods]);

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
  // Guard so this effect handles each openMethod value exactly once. `methods` is
  // a useMemo off a react-query result, so a write (e.g. BeakerBot's create/edit
  // tools, which then navigate to ?openMethod=<id>) refetches the list and gives
  // `methods` a NEW identity. Without the guard the effect re-fires on that new
  // identity while the router.replace that strips the param is still async, calling
  // setViewingMethod + router.replace in a tight storm = "Maximum update depth
  // exceeded". The ref makes it idempotent per openMethod value; clearing the param
  // resets it so the same id can be reopened later.
  const handledOpenMethodRef = useRef<string | null>(null);
  useEffect(() => {
    if (!searchParams) return;
    const wantsMethod = searchParams.get("openMethod");
    if (!wantsMethod) {
      handledOpenMethodRef.current = null;
      return;
    }
    if (handledOpenMethodRef.current === wantsMethod) return;
    const mid = Number(wantsMethod);
    if (!Number.isFinite(mid)) return;
    const match =
      methods.find((m) => m.id === mid && m.owner === currentUser) ??
      methods.find((m) => m.id === mid && m.owner === "public") ??
      methods.find((m) => m.id === mid);
    // Not loaded yet: leave the guard unset so a later methods update retries.
    if (!match) return;
    handledOpenMethodRef.current = wantsMethod;
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
  // Lineage forests for the explorer. Built from the UNFILTERED buckets so a
  // base method is always present to host its forks; search / type / folder
  // filtering happens at flatten time (a family shows when any member matches).
  const ownForest = useMemo(() => buildMethodForest(ownMethods), [ownMethods]);
  const ownById = useMemo(() => {
    const map = new Map<number, Method>();
    ownMethods.forEach((m) => map.set(m.id, m));
    return map;
  }, [ownMethods]);
  const sharedForestByOwner = useMemo(() => {
    const out: Record<string, { roots: MethodNode[]; byId: Map<number, Method> }> = {};
    for (const [label, list] of Object.entries(groupSharedMethodsByOwner(sharedMethods))) {
      const byId = new Map<number, Method>();
      list.forEach((m) => byId.set(m.id, m));
      out[label] = { roots: buildMethodForest(list), byId };
    }
    return out;
  }, [sharedMethods]);

  // Distinct method types present across the whole library, for the rail's
  // type-filter chips. Stable display order from the type registry's labels.
  const presentTypes = useMemo(() => {
    const seen = new Set<string>();
    methods.forEach((m) => {
      if (m.method_type) seen.add(m.method_type);
    });
    return Array.from(seen).sort((a, b) =>
      getMethodTypeMeta(a as Method["method_type"]).label.localeCompare(
        getMethodTypeMeta(b as Method["method_type"]).label,
      ),
    );
  }, [methods]);

  // Row-level filter predicate (search + type). Folder scoping is layered on
  // separately for the own bucket so it can be skipped for the shared view.
  const rowMatches = useCallback(
    (m: Method) => {
      if (!matchesMethodSearch(m, searchQuery)) return false;
      if (activeType && m.method_type !== activeType) return false;
      return true;
    },
    [searchQuery, activeType],
  );
  const ownFolderMatches = useCallback(
    (m: Method) => {
      if (activeFolder === "all" || activeFolder === "shared") return true;
      return (m.folder_path || "Uncategorized") === activeFolder;
    },
    [activeFolder],
  );
  const isExpanded = useCallback(
    (m: Method) => !collapsedBases.has(`${m.owner}:${m.id}`),
    [collapsedBases],
  );
  const toggleCollapse = useCallback((key: string) => {
    setCollapsedBases((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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

  // Create a fork (variant) of `forkingSource` under `newName`. Clones the
  // per-type content (forkMethod), refetches, makes sure the base is expanded
  // so the new variant is visible nested under it, then opens the fork.
  const handleForkConfirm = useCallback(
    async (newName: string) => {
      if (!forkingSource) return;
      setForkBusy(true);
      try {
        const created = await forkMethod(forkingSource, newName);
        await queryClient.refetchQueries({ queryKey: ["methods"] });
        setCollapsedBases((prev) => {
          const next = new Set(prev);
          next.delete(`${forkingSource.owner}:${forkingSource.id}`);
          return next;
        });
        setForkingSource(null);
        setViewingMethod(created);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Failed to fork method");
      } finally {
        setForkBusy(false);
      }
    },
    [forkingSource, queryClient],
  );

  // Renders a single dense method row in the explorer tree. `bucketById`
  // resolves the parent within the same ownership bucket so a variant can
  // show an "in <folder>" pin when its base lives in a different folder
  // (lineage wins over folders). `isOwnBucket` keeps drag-to-folder enabled
  // for the user's own methods only; shared methods are not draggable.
  const renderMethodRow = (
    node: MethodNode,
    bucketById: Map<number, Method>,
    isOwnBucket: boolean,
  ) => {
    const m = node.method;
    const meta = getMethodTypeMeta(m.method_type);
    const TypeIcon = meta.icon;
    const rowKey = `${m.owner}:${m.id}`;
    const hasChildren = node.children.length > 0;
    const expanded = isExpanded(m);
    const isVariant = node.depth > 0;
    const parent =
      m.parent_method_id != null ? bucketById.get(m.parent_method_id) : undefined;
    const showFolderPin =
      isVariant && parent && (m.folder_path || "") !== (parent.folder_path || "");
    const isPublic = m.is_public || isWholeLabShared(m.shared_with);
    return (
      <div
        key={rowKey}
        // Hover-as-context (BeakerSearch step 4). The composite owner:id key the
        // Methods source resolves to the hovered method when the palette opens
        // while nothing is selected. SELECTED (an open viewer) still outranks it.
        data-beaker-target={`method:${m.owner}:${m.id}`}
        draggable={isOwnBucket}
        onDragStart={isOwnBucket ? () => handleDragStart(m) : undefined}
        onClick={() => setViewingMethod(m)}
        onContextMenu={(e) => {
          e.preventDefault();
          setRowMenu({ method: m, x: e.clientX, y: e.clientY });
        }}
        style={{ paddingLeft: 12 + node.depth * 22 }}
        className={`group flex items-center gap-2 pr-3 py-2 border-b border-border cursor-pointer hover:bg-surface-sunken transition-colors ${
          draggedMethod?.id === m.id && draggedMethod?.owner === m.owner
            ? "opacity-50"
            : ""
        } ${isVariant ? "bg-surface/40" : ""}`}
      >
        {/* Disclosure triangle (base with forks) or an alignment spacer. */}
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? "Collapse variants" : "Expand variants"}
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapse(rowKey);
            }}
            className="flex-none p-0.5 text-foreground-muted hover:text-foreground rounded"
          >
            <Icon
              name="chevronRight"
              className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="flex-none w-[18px]" aria-hidden />
        )}
        {/* Type glyph chip. */}
        <span
          className={`flex-none grid place-items-center h-7 w-7 rounded-md ${meta.color.bg} ${meta.color.text}`}
        >
          <TypeIcon className="h-4 w-4" />
        </span>
        <span className="text-body font-medium text-foreground truncate">
          {m.name}
        </span>
        {m.tags && m.tags.length > 0 && (
          <span className="hidden md:flex items-center gap-1.5 flex-none">
            {m.tags.slice(0, 2).map((tag) => (
              <span key={tag} className="text-meta text-foreground-muted">
                #{tag}
              </span>
            ))}
          </span>
        )}
        {showFolderPin && (
          <span className="flex-none text-meta text-foreground-muted border border-dashed border-border rounded px-1.5 py-0.5">
            in {m.folder_path}
          </span>
        )}
        <span className="flex-1 min-w-[8px]" />
        {hasChildren && (
          <span className="flex-none text-meta font-bold text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/15 rounded-full px-2 py-0.5">
            {node.children.length} variant{node.children.length > 1 ? "s" : ""}
          </span>
        )}
        {isPublic && (
          <span className="flex-none hidden lg:inline text-meta px-2 py-0.5 bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-300 rounded-full">
            Public
          </span>
        )}
        {m.last_edited_at && (
          <span className="flex-none hidden xl:inline text-meta text-foreground-muted tabular-nums">
            {new Date(m.last_edited_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
        {/* Fork (create a variant) — popup + row action per Grant. Clones the
            method's content into a new private variant linked back via
            parent_method_id. Shown on row hover; stopPropagation keeps the
            row's open-on-click from also firing. */}
        <Tooltip label="Fork (create a variant)" placement="left">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setForkingSource(m);
            }}
            className="flex-none p-1 text-foreground-muted hover:text-brand-action hover:bg-surface-raised rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            aria-label={`Fork ${m.name}`}
          >
            <Icon name="copy" className="h-4 w-4" />
          </button>
        </Tooltip>
        {/* Retire-from-lab control for PUBLIC methods (delete-affordances bot,
            2026-05-29). Public methods are ownerless, so the unified write gate
            hides every per-viewer Delete button — leaving a stale public method
            with no way to remove it. Shown on row hover; stopPropagation keeps
            the row's open-on-click from also firing. */}
        {m.is_public && (
          <Tooltip label="Retire from lab" placement="left">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleRetirePublicMethod(m);
              }}
              className="flex-none p-1 text-foreground-muted hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label={`Retire ${m.name} from the lab`}
            >
              <Icon name="trash" className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>
    );
  };

  // True when the page should show the "no methods yet" empty state,
  // i.e. the user has nothing of their own AND nothing shared with
  // them. The explorer's per-view empty states (renderExplorerList) now
  // cover the messaging that the old two-section layout did.

  // BeakerSearch step 3, register the Method Library palette source while the
  // page is mounted. Reads the already-fetched state above (no second fetch) and
  // closes over the page's real create / open / delete / retire / template
  // handlers; all the testable logic lives in methods-beaker-source.ts.
  useMethodsBeakerSource({
    methods,
    filteredOwnMethods,
    filteredSharedMethods,
    allFolders,
    existingFolders,
    searchQuery,
    setSearchQuery,
    browsingTemplates,
    viewingMethod,
    editingCompound,
    setViewingMethod,
    setEditingCompound,
    setCreating,
    setCreatingCategory,
    setBrowsingTemplates,
    setForceWholeLabOnCreate,
    setPrefilledFolder,
    handleDelete,
    handleRetirePublicMethod,
    handleTemplateUsed,
    currentUser,
  });

  // ── Explorer render helpers ────────────────────────────────────────────────
  const crumbLabel =
    activeFolder === "all"
      ? "All methods"
      : activeFolder === "shared"
        ? "Shared with lab"
        : activeFolder;

  // Count of methods visible in the active view (whole families, ignoring
  // collapse), for the list-bar summary.
  const shownCount =
    activeFolder === "shared"
      ? Object.values(sharedForestByOwner).reduce(
          (n, { roots }) => n + flattenForest(roots, rowMatches, () => true).length,
          0,
        )
      : flattenForest(
          ownForest,
          (m) => rowMatches(m) && ownFolderMatches(m),
          () => true,
        ).length;

  const renderRailItem = (
    folder: string,
    iconName: IconName,
    label: string,
    count: number,
    opts?: { dropTarget?: boolean },
  ) => {
    const active = activeFolder === folder;
    return (
      <button
        key={folder}
        type="button"
        onClick={() => setActiveFolder(folder)}
        onDragOver={opts?.dropTarget ? (e) => handleDragOver(e, folder) : undefined}
        onDragLeave={opts?.dropTarget ? handleDragLeave : undefined}
        onDrop={opts?.dropTarget ? () => handleDrop(folder) : undefined}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-body text-left transition-colors ${
          active
            ? "bg-brand-action text-white font-medium"
            : "text-foreground hover:bg-surface-raised"
        } ${
          opts?.dropTarget && dropTargetFolder === folder && !active
            ? "ring-2 ring-brand-action"
            : ""
        }`}
      >
        <Icon name={iconName} className="h-4 w-4 flex-none opacity-85" />
        <span className="flex-1 truncate">{label}</span>
        <span
          className={`text-meta tabular-nums ${active ? "text-white/80" : "text-foreground-muted"}`}
        >
          {count}
        </span>
      </button>
    );
  };

  const renderEmptyState = (msg: string, showCreate = false) => (
    <div className="p-12 text-center">
      <p className="text-body text-foreground-muted mb-3">{msg}</p>
      {showCreate && (
        <button
          onClick={() => setCreating(true)}
          className="ros-btn-raise px-4 py-2 text-body bg-brand-action text-white rounded-lg hover:bg-brand-action/90"
        >
          + New Method
        </button>
      )}
    </div>
  );

  const renderExplorerList = () => {
    if (activeFolder === "shared") {
      const blocks = Object.keys(sharedForestByOwner)
        .sort((a, b) => a.localeCompare(b))
        .map((label) => {
          const { roots, byId } = sharedForestByOwner[label];
          const flat = flattenForest(roots, rowMatches, isExpanded);
          if (!flat.length) return null;
          return (
            <div key={`shared-${label}`}>
              <div className="px-4 py-1.5 bg-surface-sunken border-b border-border text-meta font-bold uppercase tracking-wider text-foreground-muted">
                {label}
              </div>
              {flat.map((node) => renderMethodRow(node, byId, false))}
            </div>
          );
        })
        .filter(Boolean);
      if (!blocks.length) {
        return renderEmptyState(
          searchQuery
            ? "No shared methods match this search."
            : "No methods shared with you yet.",
        );
      }
      return <>{blocks}</>;
    }
    const flat = flattenForest(
      ownForest,
      (m) => rowMatches(m) && ownFolderMatches(m),
      isExpanded,
    );
    if (!flat.length) {
      return renderEmptyState(
        searchQuery
          ? "No methods of yours match this search."
          : activeFolder === "all"
            ? "You haven't created any methods yet."
            : "No methods in this category yet.",
        !searchQuery,
      );
    }
    return <>{flat.map((node) => renderMethodRow(node, ownById, true))}</>;
  };

  return (
    <AppShell>
      <div className="flex-1 overflow-auto px-6 pt-3 pb-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-title font-semibold text-foreground">
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
            {/* UX clawback (minimalism): "+ New Category" and the duplicate
                "Template library" button were demoted out of this header so
                "New Method" reads as the single clear primary. Creating a
                category — really just a free-text folder — now lives in the
                rail's "My folders" section; Template library keeps its rail
                item. Search stays here. */}
            <button
              onClick={() => setCreating(true)}
              data-tour-target="methods-new-method-button"
              className="ros-btn-raise px-3 py-1.5 text-body bg-brand-action text-white rounded-lg hover:bg-brand-action/90"
            >
              + New Method
            </button>
          </div>
        </div>

        {/* ── Explorer: folder rail + dense lineage tree ───────────────── */}
        {/* The card grid was retired (it duplicated the click-through popup
            and did not scale past a handful of methods). The rail scopes the
            right pane to All methods, Shared with lab, or a single folder;
            the right pane is a dense tree where forked variants nest under the
            base method they came from. Lineage wins over folders, so a variant
            filed elsewhere still renders under its base with an "in <folder>"
            pin. */}
        <div className="flex border border-border rounded-xl overflow-hidden bg-surface-raised min-h-[480px]">
          {/* Rail */}
          <aside className="w-56 flex-none border-r border-border bg-surface-sunken p-3 overflow-y-auto">
            <p className="px-1.5 mb-1.5 text-meta font-bold uppercase tracking-wider text-foreground-muted">
              Library
            </p>
            <div className="space-y-0.5">
              {renderRailItem("all", "list", "All methods", ownMethods.length)}
              {renderRailItem("shared", "users", "Shared with lab", sharedMethods.length)}
              <button
                type="button"
                onClick={() => setBrowsingTemplates(true)}
                data-tour-target="methods-template-library-button"
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-body text-left text-foreground hover:bg-surface-raised transition-colors"
              >
                <TemplateLibraryIcon className="h-4 w-4 flex-none opacity-85" />
                <span className="flex-1 truncate">Template library</span>
              </button>
            </div>

            {/* My folders / categories. The "+ New folder/category" affordance
                lives HERE now (UX clawback): categories are just free-text
                folders, so creating one no longer earns primary-button weight
                in the page header. Renders even with zero folders so the
                create affordance is always reachable. Reuses the existing
                setCreatingCategory flow + CreateCategoryModal. */}
            <p className="px-1.5 mt-4 mb-1.5 text-meta font-bold uppercase tracking-wider text-foreground-muted">
              My folders
            </p>
            <div className="space-y-0.5">
              {allFolders
                .slice()
                .sort((a, b) => a.localeCompare(b))
                .map((folder) =>
                  renderRailItem(
                    folder,
                    "folder",
                    folder,
                    (ownGrouped[folder] ?? ownMethods.filter(
                      (m) => (m.folder_path || "Uncategorized") === folder,
                    )).length,
                    { dropTarget: true },
                  ),
                )}
              <button
                type="button"
                onClick={() => {
                  setCreatingCategory(true);
                  // Onboarding v4 §6.4: the `methods-category-open` sub-step
                  // used to wait for this DOM event to advance. That step was
                  // retired in tour simplification pass 3 2026-06-03 (CASE 1),
                  // so there is no tour listener now. Cheap no-op dispatch when
                  // nothing is listening.
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(
                      new CustomEvent("tour:methods-category-modal-opened"),
                    );
                  }
                }}
                data-tour-target="methods-add-category"
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-body text-left text-foreground-muted hover:bg-surface-raised hover:text-foreground transition-colors"
              >
                <Icon name="plus" className="h-4 w-4 flex-none opacity-85" />
                <span className="flex-1 truncate">New folder/category</span>
              </button>
            </div>

            {presentTypes.length > 0 && (
              <>
                <p className="px-1.5 mt-4 mb-1.5 text-meta font-bold uppercase tracking-wider text-foreground-muted">
                  Filter by type
                </p>
                <div className="flex flex-wrap gap-1.5 px-1">
                  {presentTypes.map((t) => {
                    const meta = getMethodTypeMeta(t as Method["method_type"]);
                    const active = activeType === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setActiveType(active ? null : t)}
                        className={`text-meta font-medium px-2.5 py-1 rounded-full border transition-colors ${
                          active
                            ? "bg-brand-action border-brand-action text-white"
                            : "border-border text-foreground-muted hover:bg-surface-raised"
                        }`}
                      >
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </aside>

          {/* List pane */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <span className="text-title font-semibold text-foreground truncate">
                {crumbLabel}
              </span>
              {/* Removable active-folder filter chip. Shown only when a real
                  folder/category is in focus (not the "all" or "shared"
                  pseudo-folders); the x clears back to All methods so the
                  filter is always visible and escapable. Matches the type
                  chip's styling right below it. */}
              {activeFolder !== "all" && activeFolder !== "shared" && (
                <button
                  type="button"
                  onClick={() => setActiveFolder("all")}
                  className="inline-flex items-center gap-1 text-meta text-brand-action hover:underline"
                  aria-label={`Clear ${activeFolder} folder filter`}
                >
                  <Icon name="folder" className="h-3 w-3" />
                  {activeFolder}
                  <Icon name="close" className="h-3 w-3" />
                </button>
              )}
              {activeType && (
                <button
                  type="button"
                  onClick={() => setActiveType(null)}
                  className="inline-flex items-center gap-1 text-meta text-brand-action hover:underline"
                >
                  {getMethodTypeMeta(activeType as Method["method_type"]).label}
                  <Icon name="close" className="h-3 w-3" />
                </button>
              )}
              <span className="flex-1" />
              <span className="text-meta text-foreground-muted">
                {shownCount} {shownCount === 1 ? "method" : "methods"}
                {" · variants nested under their base"}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">{renderExplorerList()}</div>
          </div>
        </div>
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
      <DeleteMethodConfirm
        open={pendingDelete !== null}
        methodName={pendingDelete?.method.name ?? ""}
        affectedCompounds={pendingDelete?.affected ?? []}
        onCancel={() => setPendingDelete(null)}
        onJustDelete={handleJustDelete}
        onCascadeDelete={handleCascadeDelete}
      />

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
          allMethods={methods}
          onOpenMethod={(m) => setViewingMethod(m)}
          onFork={(m) => setForkingSource(m)}
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

      {/* Fork (name-the-variant) modal. Opened from the viewer's Fork button or
          a list row's fork action. */}
      {forkingSource && (
        <ForkMethodModal
          source={forkingSource}
          busy={forkBusy}
          onCancel={() => setForkingSource(null)}
          onConfirm={handleForkConfirm}
        />
      )}

      {/* Right-click row menu. */}
      {rowMenu &&
        (() => {
          const m = rowMenu.method;
          const isOwn = Boolean(currentUser) && !isSharedMethod(m, currentUser);
          const items: ContextMenuItem[] = [
            {
              label: "Open",
              icon: <Icon name="eye" className="h-4 w-4" />,
              onClick: () => setViewingMethod(m),
            },
            {
              label: "Fork (create a variant)",
              icon: <Icon name="copy" className="h-4 w-4" />,
              onClick: () => setForkingSource(m),
            },
          ];
          if (m.is_public) {
            items.push({
              label: "Retire from lab",
              icon: <Icon name="trash" className="h-4 w-4" />,
              onClick: () => void handleRetirePublicMethod(m),
            });
          } else if (isOwn) {
            items.push({
              label: "Delete",
              icon: <Icon name="trash" className="h-4 w-4" />,
              onClick: () => void handleDelete(m.id),
            });
          }
          return (
            <ContextMenu
              x={rowMenu.x}
              y={rowMenu.y}
              items={items}
              onClose={() => setRowMenu(null)}
            />
          );
        })()}
    </AppShell>
  );
}

// ── Fork Method Modal ─────────────────────────────────────────────────────────

function ForkMethodModal({
  source,
  busy,
  onCancel,
  onConfirm,
}: {
  source: Method;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (newName: string) => void;
}) {
  const [name, setName] = useState(`${source.name} (variant)`);
  const trimmed = name.trim();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface-overlay border border-border rounded-xl ros-popup-card-shadow max-w-md w-full mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-title font-semibold text-foreground">Fork method</h3>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onCancel}
              className="text-foreground-muted hover:text-foreground"
              aria-label="Close"
            >
              <Icon name="close" className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>
        <div className="p-6">
          <p className="text-meta text-foreground-muted mb-3">
            Creates an independent copy of{" "}
            <span className="font-medium text-foreground">{source.name}</span>{" "}
            that you can edit freely. It stays linked to the original as a
            variant, so you can always see where it came from.
          </p>
          <label className="block text-meta font-medium text-foreground-muted mb-1">
            Variant name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && trimmed && !busy) onConfirm(trimmed);
            }}
          />
        </div>
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-border">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={() => trimmed && onConfirm(trimmed)}
            disabled={!trimmed || busy}
            className="ros-btn-raise px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
          >
            {busy ? "Forking..." : "Create variant"}
          </button>
        </div>
      </div>
    </div>
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
      <div className="bg-surface-raised rounded-xl ros-popup-card-shadow max-w-md w-full mx-4">
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
            className="ros-btn-neutral px-4 py-2 text-body disabled:opacity-50"
          >
            Create Empty
          </button>
          <button
            onClick={() => handleCreate(true)}
            disabled={!categoryName.trim()}
            className="ros-btn-raise px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
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
  allMethods,
  onOpenMethod,
  onFork,
  onClose,
  onDelete,
  onEditCompound,
  onConvertedToChild,
}: {
  method: Method;
  currentUser: string;
  /** Full method list, used to resolve this method's lineage (its base and
   *  its forks) for the Lineage box. */
  allMethods: Method[];
  /** Navigate the viewer to another method (jump up to a base or down to a
   *  variant from the Lineage box). */
  onOpenMethod: (method: Method) => void;
  /** Start a fork of this method (opens the name-the-variant modal). */
  onFork: (method: Method) => void;
  onClose: () => void;
  onDelete: (id: number) => void;
  onEditCompound: (method: Method) => void;
  /** Forwarded from CompoundViewer's convert-back action. The parent looks
   *  up the child id in the methods cache and reopens this modal on the
   *  child's record (or just closes the modal when the compound was empty). */
  onConvertedToChild: (childMethodId: number | null) => void;
}) {
  // Lineage: the base this method was forked from (if any) and the forks made
  // from it. Resolve the parent by id, preferring the same owner so a shared
  // and an own method with a colliding id don't cross-link. Variants are every
  // method pointing back at this one.
  const lineageParent =
    method.parent_method_id != null
      ? allMethods.find(
          (m) => m.id === method.parent_method_id && m.owner === method.owner,
        ) ?? allMethods.find((m) => m.id === method.parent_method_id)
      : undefined;
  const lineageVariants = allMethods.filter(
    (m) => m.parent_method_id === method.id && m.owner === method.owner,
  );
  const hasLineage = Boolean(lineageParent) || lineageVariants.length > 0;
  // Unified Share entry point (2026-06-04): one Share button in the action
  // strip opens the two-tab UnifiedShareDialog (lab ACL + cross-boundary send),
  // replacing the standalone "Share outside this folder" send button.
  const [showShare, setShowShare] = useState(false);
  const { canShare } = useAccountCapabilities();
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
      <div className="flex bg-surface-raised rounded-xl ros-popup-card-shadow max-w-[calc(4rem+4rem+72rem)] w-full mx-4 max-h-[85vh]">
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
          {/* Action strip. Fork is always available (forking a shared or
              public method = make my own private variant). "Extend into kit"
              and the unified Share button gate on !is_shared_with_me, a
              received method is not the user's to wrap or re-share from here. */}
          <div className="flex items-center justify-end gap-2 px-4 pt-3 pb-1">
            <Tooltip label="Fork (create a variant)" placement="bottom">
              <button
                type="button"
                aria-label="Fork this method"
                onClick={() => onFork(method)}
                className="inline-flex items-center gap-1 text-meta font-medium text-brand-action hover:underline px-1.5 py-1"
              >
                <Icon name="copy" className="h-4 w-4" />
                Fork
              </button>
            </Tooltip>
            {!method.is_shared_with_me && method.method_type !== "compound" && (
              <WrapAsCompoundAction method={method} onWrapped={handleWrapped} />
            )}
            {!method.is_shared_with_me && canShare && (
              <Tooltip label="Share" placement="bottom">
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
            )}
          </div>
          {/* Lineage box. Surfaces the fork relationship that lives in
              `parent_method_id`: jump up to the base this was forked from, or
              down to any of its variants. Self-hides when the method has no
              lineage. */}
          {hasLineage && (
            <div className="mx-4 mt-2 mb-1 border border-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-sunken border-b border-border text-meta font-bold uppercase tracking-wider text-foreground-muted">
                <Icon name="lineage" className="h-3.5 w-3.5" />
                Lineage
              </div>
              <div className="px-3 py-2 space-y-1.5">
                {lineageParent && (
                  <div className="flex items-center gap-2 text-body">
                    <span className="flex-none w-20 text-meta font-bold uppercase tracking-wide text-foreground-muted">
                      Forked from
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenMethod(lineageParent)}
                      className="font-medium text-brand-action hover:underline text-left truncate"
                    >
                      {lineageParent.name}
                    </button>
                  </div>
                )}
                {lineageVariants.length > 0 && (
                  <div className="flex items-start gap-2 text-body">
                    <span className="flex-none w-20 text-meta font-bold uppercase tracking-wide text-foreground-muted pt-0.5">
                      Variants
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {lineageVariants.map((v) => (
                        <button
                          key={`${v.owner}:${v.id}`}
                          type="button"
                          onClick={() => onOpenMethod(v)}
                          className="text-meta font-medium px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/25"
                        >
                          {v.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {renderViewer()}
          {/* Backlinks — where this method is referenced across notes and
              experiments. Self-hides when there are none. */}
          <ObjectBacklinks type="method" id={String(method.id)} className="mt-4" />
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
          className="ros-btn-raise px-2 py-1 text-meta text-white bg-brand-action rounded hover:bg-brand-action/90 disabled:opacity-50"
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
  const { canShare } = useAccountCapabilities();

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
                {canModify && canShare && (
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
                      ? "text-white bg-brand-action hover:bg-brand-action/90"
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
                // Chemistry Phase 3: reference picker.
                enableReferencePicker
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
  const { canShare } = useAccountCapabilities();

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
            {canModify && !currentMethod.is_shared_with_me && canShare && (
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
  const { canShare } = useAccountCapabilities();

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
            {canModify && !currentMethod.is_shared_with_me && canShare && (
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
                        className="ros-btn-raise px-3 py-1.5 text-meta text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
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
                      className="w-full py-2 text-meta text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-brand-action/10 border-t border-border"
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
                <div className="rounded-lg border border-border">
                  <LiveMarkdownEditor
                    value={notes}
                    onChange={setNotes}
                    placeholder="Any additional notes..."
                    showToolbar={false}
                    showShortcutsHelper={false}
                    compact={true}
                    hideAttachments={true}
                  />
                </div>
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
              className="ros-btn-raise px-3 py-1.5 text-meta bg-brand-action text-white rounded-lg hover:bg-brand-action/90"
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
