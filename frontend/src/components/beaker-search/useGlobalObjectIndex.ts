"use client";

// sequence editor master. BeakerSearch global object search, chunk 1, the index
// HOOK.
//
// useGlobalObjectIndex is a thin reader over the four canonical React Query
// caches the app already populates (decision 2, "the index is a thin reader, not
// a new store"). It subscribes to the four loaders by their EXISTING query keys,
// so on any page the user has visited the cache is already warm and the index is
// free, and it fires a one-time, fire-and-forget prefetch of the four loaders on
// shell mount so Cmd-K finds a record by name even on a page the user has not
// visited this session (decision 2, eager-once prefetch). The build itself is the
// pure buildGlobalIndex (global-index.ts).
//
// The four keys MUST match the ones the home / gantt / search / workbench /
// methods / sequences pages register, or the index forks a second cache and goes
// stale after an edit. Methods follows /search on `["methods", currentUser]`
// (decision 5, the Methods page read is aligned to the same key in chunk 1).
// Sequences are local-only and ownerless, so their key carries no user suffix.
//
// This hook is mounted ONCE next to the BeakerSearchProvider at the app shell.
// Chunk 2 feeds its output into the provider as the cross-app NAVIGATE source.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAllTasksIncludingShared,
  fetchAllProjectsIncludingShared,
  fetchAllMethodsIncludingShared,
  sequencesApi,
} from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { buildGlobalIndex, type GlobalIndexEntry } from "./global-index";

/** Subscribe to the four canonical caches and assemble the flat index. The
 *  useMemo rebuilds only when one of the four results changes identity, which is
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

  // Eager-once prefetch (decision 2). Fire-and-forget the four loaders once per
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
  }, [queryClient, user]);

  return useMemo(
    () => buildGlobalIndex({ tasks, projects, methods, sequences, currentUser: user }),
    [tasks, projects, methods, sequences, user],
  );
}
