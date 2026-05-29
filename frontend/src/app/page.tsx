"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAllTasksIncludingShared,
  fetchAllProjectsIncludingShared,
} from "@/lib/local-api";
import AppShell from "@/components/AppShell";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import UserLoginScreen from "@/components/UserLoginScreen";
import DashboardCanvas from "@/components/home/HomeCanvas";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useAppStore } from "@/lib/store";
import { useAccountType } from "@/hooks/useAccountType";
import { useOptionalTourController } from "@/components/onboarding/v4/TourController";
import { V4_PREVIEW_STICKY_KEY } from "@/lib/file-system/wiki-capture-mock";
import { decideLandingRedirect } from "./page-landing-redirect";
import type { Task } from "@/lib/types";

// Dashboard unification (dashboard-unification build, 2026-05-29): Home
// (route "/") and Lab Overview ("/lab-overview", now a redirect to "/")
// collapsed into ONE per-user widget dashboard. This page renders ONLY the
// widget canvas (`<DashboardCanvas>`). The hardcoded "Research Project
// Overview" grid + its "+ New Project" button + the active/archived
// project cards are GONE. Their job moves to the seeded Projects Overview
// widget (which has its own inline New Project flow), so no creation
// affordance is lost and the page is now structurally identical to what
// Lab Overview used to be: a single widget canvas, nothing hardcoded on
// top. The account-aware nav label + the unified `dashboard_layout`
// persistence make this one concept for every account type.

// Only redirect to the user's default landing tab once per tab/session. If
// they manually navigate back to "/" later, we respect that.
let didLandingRedirect = false;

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
  const accountType = useAccountType(currentUser || null);
  // The v4 onboarding walkthrough mounts page.tsx inside
  // <TourControllerProvider>, so the live tour mode is readable here. The
  // walkthrough's dashboard phase navigates to "/" via the controller's
  // router.push; the tour-active guard below keeps the one-shot landing
  // bounce from firing mid-tour. `tourMode !== null` is true across every
  // tour phase; the sticky preview flag is a belt-and-suspenders for the
  // brief reload window before TourBootstrap re-starts the controller.
  const tourController = useOptionalTourController();
  const tourActive =
    (tourController?.tourMode ?? null) !== null ||
    (typeof window !== "undefined" &&
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(V4_PREVIEW_STICKY_KEY) === "1");
  useEffect(() => {
    const decision = decideLandingRedirect({
      didLandingRedirect,
      currentUser,
      accountType,
      defaultLandingTab,
      fromRedirect: searchParams?.get("from") ?? null,
      tourActive,
    });
    if (decision.markOneShot) didLandingRedirect = true;
    if (decision.kind === "replace") {
      router.replace(decision.to);
      return;
    }
    // A `?from=` sentinel that resolved to "stay on the dashboard" still
    // needs the sentinel stripped from the URL (so reload + share work).
    if (decision.markOneShot && searchParams?.get("from")) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("from");
      const query = next.toString();
      router.replace(query ? `/?${query}` : "/");
    }
  }, [
    currentUser,
    defaultLandingTab,
    accountType,
    tourActive,
    router,
    searchParams,
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
      const tid = Number(wantsTask);
      if (Number.isFinite(tid)) {
        const match = allTasks.find(
          (t) => t.id === tid && (t.owner ?? currentUser) === currentUser,
        );
        if (match) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- deep-link handler: opens popup imperatively once the async-loaded allTasks include the URL-referenced id. Cannot be useMemo (setSelectedTask is a side-effect, not derived state); cannot be useState lazy init (data arrives async after mount).
          setSelectedTask(match);
          didOpen = true;
        }
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
      <div className="flex-1 overflow-auto p-6">
        {currentUser && <DashboardCanvas username={currentUser} />}
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
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
            <p className="text-sm text-gray-500">Checking user...</p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
