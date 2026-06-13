"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAllTasksIncludingShared,
  fetchAllProjectsIncludingShared,
} from "@/lib/local-api";
import AppShell from "@/components/AppShell";
import BeakerBot from "@/components/BeakerBot";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import UserLoginScreen from "@/components/UserLoginScreen";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useAppStore } from "@/lib/store";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { getPiViewMode } from "@/hooks/usePiViewMode";
import { decideLandingRedirect } from "./page-landing-redirect";
import type { Task } from "@/lib/types";
import { taskKey } from "@/lib/types";

// Widget-framework teardown v2 (2026-06-02): the customizable widget
// dashboard that "/" used to render is GONE. "/" is now a pure router: it
// resolves the user, runs the ?openTask= / ?openProject= deep-link
// handlers, then bounces to the surface that owns the account type
// (lab_head -> /lab-overview, everyone else -> /workbench) via
// decideLandingRedirect. It renders no canvas of its own, only the login
// gate, the deep-link TaskDetailPopup, and a light spinner while the
// bounce resolves.

export default function HomePage() {
  const router = useRouter();
  // Single useSearchParams call shared by both the landing-tab redirect and
  // the openProject/openTask deep-link handler below.
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const { currentUser: providerCurrentUser, isLoading: fsLoading } =
    useFileSystem();
  const currentUser = providerCurrentUser ?? "";
  const checkingUser = fsLoading;

  // One-shot redirect to the user's chosen default landing tab on first
  // load. Subsequent manual visits to "/" are respected.
  //
  // Sentinel `?from=lab-overview`: when /lab-overview redirects here it
  // tags the URL so we honor the bounce as the user's final destination
  // instead of compounding into a second redirect via defaultLandingTab.
  const defaultLandingTab = useAppStore((s) => s.defaultLandingTab);
  const isLabHead = useIsLabHead(currentUser || null);
  useEffect(() => {
    // "/" renders nothing now, so it ALWAYS bounces to the role landing,
    // EXCEPT while a deep-link is being handled (a popup is opening on "/")
    // or a task popup is open. Without that guard the bounce would yank the
    // user off "/" before the ?openTask=/?openProject= flow can run.
    const hasDeepLink = !!(
      searchParams?.get("openTask") || searchParams?.get("openProject")
    );
    const decision = decideLandingRedirect({
      suppress: hasDeepLink || selectedTask !== null,
      currentUser,
      isLabHead,
      defaultLandingTab,
      fromRedirect: searchParams?.get("from") ?? null,
      tourActive: false,
      piViewMode: getPiViewMode(),
    });
    if (decision.kind === "replace") {
      router.replace(decision.to);
      return;
    }
    // A `?from=` sentinel that resolved to "stay on /" still needs the
    // sentinel stripped from the URL (so reload + share work).
    if (decision.markOneShot && searchParams?.get("from")) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("from");
      const query = next.toString();
      router.replace(query ? `/?${query}` : "/");
    }
  }, [
    currentUser,
    defaultLandingTab,
    isLabHead,
    router,
    searchParams,
    selectedTask,
  ]);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
  });

  // Deep-link: `/?openTask=<id>` opens the task detail popup once the task
  // data has loaded, then strips that param so a reload doesn't re-trigger.
  // `?openProject=<id>` navigates to the canonical project route. Other
  // params pass through untouched.
  useEffect(() => {
    if (!searchParams) return;
    const wantsProject = searchParams.get("openProject");
    const wantsTask = searchParams.get("openTask");
    if (!wantsProject && !wantsTask) return;
    if (wantsProject) {
      const pid = Number(wantsProject);
      if (Number.isFinite(pid)) {
        const match = projects.find(
          (p) => p.id === pid && (p.owner ?? currentUser) === currentUser,
        );
        if (match) {
          const next = new URLSearchParams(searchParams.toString());
          next.delete("openProject");
          const ownerSuffix = match.is_shared_with_me
            ? `?owner=${encodeURIComponent(match.owner)}${next.toString() ? `&${next.toString()}` : ""}`
            : next.toString()
              ? `?${next.toString()}`
              : "";
          router.replace(`/workbench/projects/${match.id}${ownerSuffix}`);
          return;
        }
      }
    }
    let didOpen = false;
    if (wantsTask) {
      // Resolve the task two ways, newest first. BeakerSearch global search emits
      // the composite taskKey ("self:<id>" for an own task, "<owner>:<id>" for one
      // shared into me), which is computed over the same merged allTasks here, so
      // a shared task resolves to the right owner namespace and opens read-only the
      // way the list already surfaces it. Older links carry a bare numeric id, which
      // still opens the current user's own task. The popup itself is owner-agnostic.
      const match =
        allTasks.find((t) => taskKey(t) === wantsTask) ??
        (Number.isFinite(Number(wantsTask))
          ? allTasks.find(
              (t) => t.id === Number(wantsTask) && (t.owner ?? currentUser) === currentUser,
            )
          : undefined);
      if (match) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- deep-link handler: opens popup imperatively once the async-loaded allTasks include the URL-referenced id. Cannot be useMemo (setSelectedTask is a side-effect, not derived state); cannot be useState lazy init (data arrives async after mount).
        setSelectedTask(match);
        didOpen = true;
      }
    }
    if (didOpen) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("openTask");
      const query = next.toString();
      router.replace(query ? `/?${query}` : "/");
    }
  }, [searchParams, projects, allTasks, currentUser, router]);

  // Show login screen if no current user. UserLoginScreen already calls
  // useFileSystem().setCurrentUser internally, so by the time onLogin fires
  // the provider has the new user.
  if (!checkingUser && !currentUser) {
    return (
      <UserLoginScreen
        onLogin={() => {
          queryClient.invalidateQueries();
        }}
      />
    );
  }

  return (
    <AppShell>
      {/* "/" renders no surface of its own (widget-framework teardown v2): it
          is a router that bounces to the role landing. Instead of a bare
          spinner, a short branded welcome fills the window before the redirect
          lands (brand refresh, 2026-06-11). */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex flex-col items-center text-center">
          <BeakerBot
            pose="waving"
            ariaLabel="ResearchOS BeakerBot"
            className="h-16 w-16 text-brand-sky"
          />
          <p className="mt-3 text-heading font-extrabold text-brand-ink dark:text-foreground">
            Welcome back{currentUser ? `, ${currentUser}` : ""}
          </p>
          <p className="mt-1 text-body text-foreground-muted">
            Taking you to your {isLabHead ? "lab overview" : "workbench"}.
          </p>
        </div>
      </div>

      {/* Task Detail Popup (deep-link `?openTask=`). */}
      {selectedTask && (
        <TaskDetailPopup
          task={selectedTask}
          project={projects.find(
            (p) =>
              p.id === selectedTask.project_id && p.owner === selectedTask.owner,
          )}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {/* Loading overlay while checking user */}
      {checkingUser && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-surface-overlay/95 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
            <p className="text-body text-gray-500">Checking user...</p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
