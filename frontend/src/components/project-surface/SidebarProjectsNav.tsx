"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAllProjectsIncludingShared } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Project } from "@/lib/types";

const PROJECTS_HREF = "/";
const PROJECT_ROUTE_PREFIX = "/workbench/projects/";

function projectHref(project: Project): string {
  const base = `/workbench/projects/${project.id}`;
  // Mirror ProjectDetailPopup's URL shape: own projects route bare, shared
  // projects append `?owner=<their_owner>`. ProjectRoute reads `?owner=` to
  // pick the right per-user file path under users/<owner>/projects/.
  return project.is_shared_with_me
    ? `${base}?owner=${encodeURIComponent(project.owner)}`
    : base;
}

interface ActiveProjectRef {
  id: number;
  owner: string | null;
}

function parseActiveProject(
  pathname: string,
  ownerParam: string | null,
): ActiveProjectRef | null {
  if (!pathname.startsWith(PROJECT_ROUTE_PREFIX)) return null;
  const rest = pathname.slice(PROJECT_ROUTE_PREFIX.length);
  const idStr = rest.split("/")[0];
  const id = Number(idStr);
  if (!Number.isFinite(id)) return null;
  return { id, owner: ownerParam };
}

export default function SidebarProjectsNav() {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  // Shares the cache key with DailyTasksSidebar / home page (`["projects",
  // currentUser]`), so this rail never triggers an extra fetch — react-query
  // hands back the already-loaded list.
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });

  const ownerParam = searchParams?.get("owner") ?? null;
  const activeProject = useMemo(
    () => parseActiveProject(pathname, ownerParam),
    [pathname, ownerParam],
  );

  const onHomeRoute = pathname === PROJECTS_HREF;

  // Active, non-Miscellaneous, sorted by sort_order ASC. Misc is excluded
  // because it's a permanent catch-all bucket with no meaningful route page
  // (P7 applied the same exclusion to the popup's "Open full view"
  // affordances).
  const items = useMemo(() => {
    if (!projects) return [];
    return projects
      .filter((p) => !p.is_archived && p.name !== "Miscellaneous")
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [projects]);

  // Match both id AND owner. Alex's project 3 and Morgan's project 3 are
  // different projects under per-user id namespaces, so the sidebar lights
  // up only when the URL's `?owner=` (or its absence, for own projects)
  // agrees with the sidebar entry's owner.
  const isActiveProject = (p: Project): boolean => {
    if (!activeProject || activeProject.id !== p.id) return false;
    if (p.is_shared_with_me) return activeProject.owner === p.owner;
    return activeProject.owner === null;
  };

  return (
    <aside className="w-48 border-r border-gray-200 bg-white overflow-y-auto flex-shrink-0">
      <div className="p-3">
        <Link
          href={PROJECTS_HREF}
          className={`block px-3 py-1.5 rounded-lg text-sm transition-colors ${
            onHomeRoute
              ? "bg-blue-50 text-blue-700 font-medium"
              : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
          }`}
        >
          Projects
        </Link>
      </div>

      {!isLoading && items.length > 0 && (
        <ul className="px-2 pb-3 space-y-0.5">
          {items.map((project) => {
            const active = isActiveProject(project);
            return (
              <li key={`${project.owner}:${project.id}`}>
                <Link
                  href={projectHref(project)}
                  className={`flex items-center gap-2 pl-2 pr-2 py-1 rounded-md text-sm transition-colors ${
                    active
                      ? "bg-blue-50 text-blue-700 font-medium"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  <span
                    aria-hidden
                    className="w-1 self-stretch rounded-full flex-shrink-0"
                    style={{ backgroundColor: project.color ?? "#3b82f6" }}
                  />
                  <span className="truncate">{project.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
