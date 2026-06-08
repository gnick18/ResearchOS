// sequence editor master (Methods source sub-bot). BeakerSearch step 3, the thin
// HOOK that wires the live Method Library page state + handlers into the pure
// buildMethodsSource builder and registers the result with the shared palette.
//
// All the testable logic lives in methods-beaker-source.ts (no React, no store).
// This hook only reads the queries / state the page already holds (passed in as
// args to avoid a second fetch), reads useMethodPermissions for the canModify
// gate, prefetches the static catalog manifest ONCE (reusing the page's
// fetchMethodCatalogManifest, the same loader the template browser uses), closes
// the handler bag over the page's real setters + ownerScopedMethodsApi /
// methodsApi + the template instantiate path + the ["methods"] invalidation,
// keeps a small session-local recently-opened MRU, and calls buildMethodsSource
// inside a useMemo so the registration object is stable.
//
// A few honest notes, called out so a reader is not misled:
//
//  - HOVERED-as-context is wired (BeakerSearch step 4). The provider tracks the
//    last [data-beaker-target] under the pointer; the method cards on page.tsx
//    are tagged "method:<owner>:<id>". This hook reads useBeakerHoveredKey,
//    parses the "method" kind, resolves it against the live methods list (with a
//    public fallback), and passes it into the builder's hovered slot. SELECTED
//    (an open viewer / compound builder) still outranks a hover, so a real open
//    method wins. The template hover (spec 3.3) stays out of scope, templates in
//    the browser are not the user's cards; the per-template "Use" commands + the
//    Template library nav group cover that path without hover.
//
//  - convertToSingle + extendIntoKit reuse the REAL operations rather than
//    re-implementing them. extendIntoKit calls methodsApi.wrapAsCompound (the
//    exact call WrapAsCompoundAction makes) then opens the builder. The convert
//    action lives only as a button inside the CompoundViewer
//    (ConvertCompoundToSingleAction), so convertToSingle opens that viewer where
//    the real, confirm-gated button renders, the same way "Edit" opens the
//    viewer rather than re-implementing the per-type editor.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  methodsApi as rawMethodsApi,
  type MethodUpdate,
} from "@/lib/local-api";
import { useBeakerSearchSource } from "@/components/beaker-search/useBeakerSearchSource";
import { useBeakerHoveredKey } from "@/components/beaker-search/BeakerSearchProvider";
import { parseBeakerTargetKey } from "@/components/beaker-search/beaker-hover";
import { useMethodPermissions } from "@/hooks/useMethodPermissions";
import {
  fetchMethodCatalogManifest,
  fetchMethodCatalogTemplate,
  instantiateMethodFromTemplate,
  type MethodCatalogManifestEntry,
} from "@/lib/methods/method-catalog";
import type { Method } from "@/lib/types";
import {
  buildMethodsSource,
  METHODS_RECENT_CAP,
  type MethodRecentRef,
  type MethodsSourceData,
  type MethodsSourceHandlers,
} from "./methods-beaker-source";

/** Mirror of the page's module-local ownerScopedMethodsApi (page.tsx:78-97), so
 *  a shared-with-edit method's writes route to the OWNER's directory while own
 *  methods write unscoped. Delete is intentionally NOT owner-routed (only the
 *  original owner destroys the file), matching the page. */
function effectiveOwnerOf(method: Method): string | undefined {
  return method.is_shared_with_me && method.shared_permission === "edit"
    ? method.owner
    : undefined;
}

function ownerScopedMethodsApi(method: Method) {
  const owner = effectiveOwnerOf(method);
  return {
    update: (id: number, data: MethodUpdate) =>
      rawMethodsApi.update(id, data, owner),
    fork: (
      id: number,
      data: { new_name: string; new_source_path: string; deviations: string },
    ) => rawMethodsApi.fork(id, data, owner),
  };
}

/** Derive a fresh markdown fork source path (mirrors DeviationModal's fork). For
 *  a structured method whose source_path is a `pcr://protocol/{id}`-style ref,
 *  the fork copies the row (a fresh markdown path is harmless, the structured
 *  payload is not duplicated, spec open question 2). */
function deriveForkSourcePath(method: Method): string {
  const base = `${method.name} copy`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const slug = base.length > 0 ? base : "method-copy";
  return `methods/${slug}/${slug}.md`;
}

/** The args the page passes (its already-fetched state + the real setters /
 *  handlers). Keeping these explicit means the hook adds no second fetch. */
export interface UseMethodsBeakerSourceArgs {
  methods: Method[];
  filteredOwnMethods: Method[];
  filteredSharedMethods: Method[];
  allFolders: string[];
  existingFolders: string[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  browsingTemplates: boolean;
  viewingMethod: Method | null;
  editingCompound: Method | null;
  setViewingMethod: (m: Method | null) => void;
  setEditingCompound: (m: Method | null) => void;
  setCreating: (b: boolean) => void;
  setCreatingCategory: (b: boolean) => void;
  setBrowsingTemplates: (b: boolean) => void;
  setForceWholeLabOnCreate: (b: boolean) => void;
  setPrefilledFolder: (f: string) => void;
  handleDelete: (id: number) => void | Promise<void>;
  handleRetirePublicMethod: (m: Method) => void | Promise<void>;
  handleTemplateUsed: (created: Method) => void | Promise<void>;
  currentUser: string;
}

/** Register the Methods page's BeakerSearch source while the page is mounted.
 *  Call once from app/methods/page.tsx after the queries + state reads. */
export function useMethodsBeakerSource(args: UseMethodsBeakerSourceArgs): void {
  const queryClient = useQueryClient();
  const { canModifyMethod } = useMethodPermissions();

  // Prefetch the static catalog manifest ONCE (the same loader the template
  // browser uses, fetchMethodCatalogManifest). The manifest is static, so a
  // single read keeps both navigable kinds available without opening the modal.
  const [templates, setTemplates] = useState<MethodCatalogManifestEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchMethodCatalogManifest()
      .then((manifest) => {
        if (!cancelled) setTemplates(manifest.templates);
      })
      .catch(() => {
        // Non-fatal, the Template library nav group + the per-template commands
        // self-hide when the manifest is unreachable; the rest of the source is
        // unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Session-local recently-opened MRU (newest first, capped + de-duped by
  // composite owner:id key). Stored as a ref so a record does not churn the memo;
  // a state bump forces the rebuild when a new method is opened.
  const recentRef = useRef<MethodRecentRef[]>([]);
  const [recentVersion, setRecentVersion] = useState(0);
  const recordRecent = useCallback((method: Method) => {
    const ref: MethodRecentRef = {
      owner: method.owner,
      id: method.id,
      name: method.name,
      method_type: method.method_type,
    };
    const next = [
      ref,
      ...recentRef.current.filter(
        (r) => !(r.owner === ref.owner && r.id === ref.id),
      ),
    ].slice(0, METHODS_RECENT_CAP);
    recentRef.current = next;
    setRecentVersion((v) => v + 1);
  }, []);

  const invalidate = useCallback(
    () => queryClient.refetchQueries({ queryKey: ["methods"] }),
    [queryClient],
  );

  // Wrap setViewingMethod so every palette-driven open records a recent.
  const openMethod = useCallback(
    (method: Method) => {
      recordRecent(method);
      args.setViewingMethod(method);
    },
    [recordRecent, args],
  );

  const handlers = useMemo<MethodsSourceHandlers>(
    () => ({
      openMethod,
      editCompound: (m) => {
        recordRecent(m);
        args.setEditingCompound(m);
      },

      createMethod: () => args.setCreating(true),
      createMethodInFolder: (folder) => {
        args.setPrefilledFolder(folder);
        args.setCreating(true);
      },
      createCategory: () => args.setCreatingCategory(true),
      publishLabWideMethod: () => {
        args.setCreating(true);
        args.setForceWholeLabOnCreate(true);
      },

      browseTemplates: () => args.setBrowsingTemplates(true),
      closeTemplates: () => args.setBrowsingTemplates(false),
      useTemplate: async (slug, folderPath) => {
        try {
          const template = await fetchMethodCatalogTemplate(slug);
          const created = await instantiateMethodFromTemplate(template, {
            folderPath,
          });
          await args.handleTemplateUsed(created);
          recordRecent(created);
        } catch {
          alert("Failed to use this template.");
        }
      },

      rename: async (m) => {
        const name = prompt(`Rename "${m.name}" to`, m.name);
        if (name === null) return;
        const trimmed = name.trim();
        if (trimmed.length === 0 || trimmed === m.name) return;
        await ownerScopedMethodsApi(m).update(m.id, { name: trimmed });
        await invalidate();
      },
      move: async (m) => {
        const dest = prompt(
          `Move "${m.name}" to which category? (blank for Uncategorized)`,
          m.folder_path ?? "",
        );
        if (dest === null) return;
        const trimmed = dest.trim();
        await ownerScopedMethodsApi(m).update(m.id, {
          folder_path: trimmed.length > 0 ? trimmed : null,
        });
        await invalidate();
      },
      extendIntoKit: async (m) => {
        try {
          const compound = await rawMethodsApi.wrapAsCompound(
            m.id,
            undefined,
            effectiveOwnerOf(m),
          );
          await invalidate();
          recordRecent(compound);
          args.setEditingCompound(compound);
        } catch {
          alert("Failed to extend this method into a kit.");
        }
      },
      // The convert action lives only as a button inside the CompoundViewer
      // (ConvertCompoundToSingleAction). Open that viewer where the real,
      // confirm-gated button renders, rather than re-implementing the
      // delete-and-navigate logic here.
      convertToSingle: (m) => openMethod(m),

      fork: async (m) => {
        try {
          await ownerScopedMethodsApi(m).fork(m.id, {
            new_name: `${m.name} (copy)`,
            new_source_path: deriveForkSourcePath(m),
            deviations: "",
          });
          await invalidate();
        } catch {
          alert("Failed to fork this method.");
        }
      },
      // The Share button + UnifiedShareDialog live inside the method viewer, so
      // Share opens that viewer (where the real share affordance renders),
      // rather than re-implementing the share dialog at the page level.
      share: (m) => openMethod(m),
      deleteMethod: (m) => {
        void args.handleDelete(m.id);
      },
      retirePublic: (m) => {
        void args.handleRetirePublicMethod(m);
      },

      setSearchQuery: args.setSearchQuery,
    }),
    [args, openMethod, recordRecent, invalidate],
  );

  // HOVERED. The method card the cursor was over when the palette opened (null
  // while closed). Parse its data-beaker-target key the way page.tsx stamps it
  // ("method:<owner>:<id>"), then resolve to the live method by composite
  // owner:id. SELECTED still outranks this in the builder, so a real open method
  // / compound builder wins. A public method's card stamps owner "public", so
  // the same composite match resolves it.
  const hoveredKey = useBeakerHoveredKey();
  const hovered = useMemo<Method | null>(() => {
    const parsed = parseBeakerTargetKey(hoveredKey);
    if (!parsed || parsed.kind !== "method") return null;
    return (
      args.methods.find((m) => `${m.owner}:${m.id}` === parsed.key) ?? null
    );
  }, [hoveredKey, args.methods]);

  const source = useMemo(() => {
    // recentVersion is a memo dependency so a new open rebuilds the MRU group.
    void recentVersion;
    const data: MethodsSourceData = {
      methods: args.methods,
      filteredOwnMethods: args.filteredOwnMethods,
      filteredSharedMethods: args.filteredSharedMethods,
      allFolders: args.allFolders,
      existingFolders: args.existingFolders,
      searchQuery: args.searchQuery,
      browsingTemplates: args.browsingTemplates,
      viewingMethod: args.viewingMethod,
      editingCompound: args.editingCompound,
      hovered,
      canModify: canModifyMethod,
      currentUser: args.currentUser,
      templates,
      recent: recentRef.current,
    };
    return buildMethodsSource(data, handlers);
  }, [args, canModifyMethod, templates, handlers, recentVersion, hovered]);

  useBeakerSearchSource(source);
}
