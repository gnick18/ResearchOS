"use client";

// sequence editor master. BeakerSearch global object search, chunk 1, the index
// HOOK.
//
// useGlobalObjectIndex is a thin reader over the canonical React Query caches
// the app already populates (decision 2, "the index is a thin reader, not a
// new store"). It subscribes to the loaders by their EXISTING query keys,
// so on any page the user has visited the cache is already warm and the index
// is free, and it fires a one-time, fire-and-forget prefetch of the loaders on
// shell mount so Cmd-K finds a record by name even on a page the user has not
// visited this session (decision 2, eager-once prefetch). The build itself is
// the pure buildGlobalIndex (global-index.ts).
//
// The keys MUST match the ones the home / gantt / search / workbench / methods /
// sequences / datahub / chemistry / purchases pages register, or the index forks
// a second cache and goes stale after an edit. Methods follows /search on
// `["methods", currentUser]` (decision 5, the Methods page read is aligned to
// the same key in chunk 1). Sequences are local-only and ownerless, so their key
// carries no user suffix.
//
// This hook is mounted ONCE next to the BeakerSearchProvider at the app shell.
// Chunk 2 feeds its output into the provider as the cross-app NAVIGATE source.
//
// BeakerSearch v1 coverage gap: Data Hub, molecules, and purchases added to the
// index. Their query keys match the pages that own those caches so the index
// shares one fetch. Purchases use the "purchases-all" key with the current user,
// matching the purchases page loader.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAllTasksIncludingShared,
  fetchAllProjectsIncludingShared,
  fetchAllMethodsIncludingShared,
  fetchAllInventoryItemsIncludingShared,
  sequencesApi,
  notesApi,
  purchasesApi,
} from "@/lib/local-api";
import { readBaseOcrText } from "@/lib/attachments/ocr";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { buildGlobalIndex, type GlobalIndexEntry } from "./global-index";
import { INVENTORY_ENABLED } from "@/lib/inventory/config";
import { dataHubApi } from "@/lib/datahub/api";
import { moleculesApi } from "@/lib/chemistry/api";
import { phyloApi } from "@/lib/phylo/api";

/** Subscribe to all canonical caches and assemble the flat index. The
 *  useMemo rebuilds only when one of the results changes identity, which is
 *  the same `invalidateQueries` the pages already fire after a write, so the
 *  index stays fresh with no bespoke invalidation. */
export function useGlobalObjectIndex(): GlobalIndexEntry[] {
  const { currentUser } = useCurrentUser();
  const user = currentUser ?? "";
  const queryClient = useQueryClient();

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", user],
    queryFn: fetchAllTasksIncludingShared,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", user],
    queryFn: fetchAllProjectsIncludingShared,
  });
  const { data: methods = [] } = useQuery({
    queryKey: ["methods", user],
    queryFn: fetchAllMethodsIncludingShared,
  });
  const { data: sequences = [] } = useQuery({
    queryKey: ["sequences"],
    queryFn: () => sequencesApi.list(),
  });

  const { data: inventoryItems = [] } = useQuery({
    queryKey: ["inventory-items", user],
    queryFn: fetchAllInventoryItemsIncludingShared,
    enabled: INVENTORY_ENABLED && !!user,
  });

  // Notes, so a handwritten/scanned page is findable from any page (not just
  // the workbench). Same ["notes"] cache the workbench source uses, so the two
  // share one fetch. notesApi.list() returns personal + shared notes.
  const { data: notes = [] } = useQuery({
    queryKey: ["notes"],
    queryFn: () => notesApi.list(),
    enabled: !!user,
  });

  // Aggregated OCR text per note (the same ["note-ocr-text"] query the
  // workbench source runs, so it is shared, not duplicated). poll.ts
  // invalidates this key after writing a sidecar so a freshly scanned page
  // refreshes the index.
  const noteIdSig = useMemo(
    () => notes.map((n) => n.id).sort((a, b) => a - b).join(","),
    [notes],
  );
  const { data: noteOcrText } = useQuery({
    queryKey: ["note-ocr-text", noteIdSig],
    queryFn: async () => {
      const map = new Map<number, string>();
      for (const note of notes) {
        if (!note.username) continue;
        try {
          const text = await readBaseOcrText(`users/${note.username}/notes/${note.id}`);
          if (text) map.set(note.id, text);
        } catch {
          // A note whose folder is unreadable just gets no OCR text.
        }
      }
      return map;
    },
    enabled: notes.length > 0,
    staleTime: 5 * 60_000,
  });

  // Data Hub documents. Same ["datahub", "tables"] cache the /datahub page
  // registers, so edits there invalidate the index automatically.
  const { data: datahubDocs = [] } = useQuery({
    queryKey: ["datahub", "tables"],
    queryFn: () => dataHubApi.list(),
    // Only fetch when a user is connected; the datahub api reads the file system.
    enabled: !!user,
  });

  // Molecules from the chemistry workbench library. Same ["molecules"] cache
  // ChemistryHub registers, so additions + edits invalidate the index.
  const { data: rawMolecules = [] } = useQuery({
    queryKey: ["molecules"],
    queryFn: () => moleculesApi.list(),
    enabled: !!user,
  });

  // Purchase items. Same ["purchases-all", currentUser] cache the purchases
  // page registers. The items are decorated with an owner field so shared
  // purchase items carry the right namespace in their composite key.
  const { data: purchaseItems = [] } = useQuery({
    queryKey: ["purchases-all", user],
    queryFn: () => purchasesApi.listAllIncludingShared(user),
    enabled: !!user,
  });

  // Saved phylogenetic trees. Same ["phylo", "list"] cache the Tree Studio
  // collection rail registers (and PhyloStudio invalidates on save), so a tree
  // added or renamed there refreshes the index automatically.
  const { data: phyloTrees = [] } = useQuery({
    queryKey: ["phylo", "list"],
    queryFn: () => phyloApi.list(),
    enabled: !!user,
  });

  // Eager-once prefetch (decision 2). Fire-and-forget the loaders once per
  // session so the cache is warm before the user visits each page. prefetchQuery
  // is a no-op when the cache is already fresh, so this never double-fetches a
  // page the user has already opened. Re-runs only if the active user changes
  // (a real login switch repopulates a different cache namespace). Sequences
  // carry no user in the key, so the same prefetch covers every user.
  const prefetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (prefetchedFor.current === user) return;
    prefetchedFor.current = user;
    void queryClient.prefetchQuery({ queryKey: ["tasks", user], queryFn: fetchAllTasksIncludingShared });
    void queryClient.prefetchQuery({ queryKey: ["projects", user], queryFn: fetchAllProjectsIncludingShared });
    void queryClient.prefetchQuery({ queryKey: ["methods", user], queryFn: fetchAllMethodsIncludingShared });
    void queryClient.prefetchQuery({ queryKey: ["sequences"], queryFn: () => sequencesApi.list() });
    if (INVENTORY_ENABLED && user) {
      void queryClient.prefetchQuery({
        queryKey: ["inventory-items", user],
        queryFn: fetchAllInventoryItemsIncludingShared,
      });
    }
    if (user) {
      void queryClient.prefetchQuery({
        queryKey: ["datahub", "tables"],
        queryFn: () => dataHubApi.list(),
      });
      void queryClient.prefetchQuery({
        queryKey: ["molecules"],
        queryFn: () => moleculesApi.list(),
      });
      // Purchases are user-scoped and relatively heavy (cross-user reads),
      // so prefetch only after the lighter caches are warm (same effect, deferred
      // by ordering not by a separate timer, good enough for an eager-once pass).
      void queryClient.prefetchQuery({
        queryKey: ["purchases-all", user],
        queryFn: () => purchasesApi.listAllIncludingShared(user),
      });
      void queryClient.prefetchQuery({
        queryKey: ["phylo", "list"],
        queryFn: () => phyloApi.list(),
      });
    }
  }, [queryClient, user]);

  return useMemo(
    () =>
      buildGlobalIndex({
        tasks,
        projects,
        methods,
        sequences,
        inventoryItems,
        currentUser: user,
        notes,
        noteOcrText,
        datahubDocs,
        molecules: rawMolecules,
        purchaseItems,
        phyloTrees,
      }),
    [tasks, projects, methods, sequences, inventoryItems, user, notes, noteOcrText, datahubDocs, rawMolecules, purchaseItems, phyloTrees],
  );
}
