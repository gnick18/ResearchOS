"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { labApi, LabUser, LabTask, LabProject } from "@/lib/local-api";

const LAB_STALE_MS = 60_000;

/**
 * Shared accessor for lab-mode core data (users, tasks, projects).
 *
 * Every Lab* panel can call this hook directly — React Query dedupes by
 * queryKey, so the underlying fetches run once and all panels share the
 * cache. The lab page no longer has to drill `users/tasks/projects` as
 * props to every panel.
 *
 * Query keys are stable strings (no per-render args) so cache identity
 * is the same regardless of which component is calling.
 */
export function useLabData() {
  const usersQuery = useQuery({
    queryKey: ["lab", "users"],
    queryFn: () => labApi.getUsers().then((r) => r.users),
    staleTime: LAB_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const tasksQuery = useQuery({
    queryKey: ["lab", "tasks"],
    queryFn: () => labApi.getTasks({ exclude_goals: true }),
    staleTime: LAB_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const projectsQuery = useQuery({
    queryKey: ["lab", "projects"],
    queryFn: () => labApi.getProjects(),
    staleTime: LAB_STALE_MS,
    refetchOnWindowFocus: false,
  });

  const users: LabUser[] = usersQuery.data ?? [];
  const tasks: LabTask[] = tasksQuery.data ?? [];
  const projects: LabProject[] = projectsQuery.data ?? [];

  const isLoading =
    usersQuery.isLoading || tasksQuery.isLoading || projectsQuery.isLoading;

  const errorMessage =
    usersQuery.error || tasksQuery.error || projectsQuery.error
      ? "Failed to load data. Please check your connection."
      : null;

  const retry = useCallback(() => {
    usersQuery.refetch();
    tasksQuery.refetch();
    projectsQuery.refetch();
  }, [usersQuery, tasksQuery, projectsQuery]);

  return { users, tasks, projects, isLoading, errorMessage, retry };
}
