"use client";

// useClassDashboard (CT-5): the student-side resolved class-dashboard template.
//
// FORCE-application (Grant 2026-06-19, v1): when the active folder is a class
// (lab_kind === "class"), the workbench renders EXACTLY the instructor's template
// (which tabs, in what order, the landing tab, the intro banner). No per-student
// customization, no apply-banner. When there is no template (not a class, or the
// cache is absent), the hook resolves to the default (all tabs, default landing,
// no intro), which is today's hardcoded workbench, byte-identical.
//
// FLAG: gated by CLASS_MODE_ENABLED. With the flag off, no folder ever carries
// lab_kind === "class" (the writers are flag-gated) and this hook reads nothing,
// returning the default resolution so the workbench is unchanged. The early flag
// guard also means the cache file is never read on a flag-off build.
//
// The template arrives folder-locally via materializeLabView caching the pulled
// lab-wide-public class_dashboard record to _class_dashboard.json; this hook reads
// that cache (no lab key needed) and resolves it. It re-reads on folder /
// settings writes so a fresh pull or an instructor edit propagates.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { CLASS_MODE_ENABLED } from "@/lib/lab/class-mode-config";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";
import {
  resolveClassDashboard,
  defaultResolvedClassDashboard,
  resolveClassStudentNav,
  type ResolvedClassDashboard,
} from "@/lib/lab/class-dashboard";
import { readCachedClassDashboard } from "@/lib/lab/class-dashboard-store";

export interface UseClassDashboardResult {
  /** True once the underlying reads have settled (so the page can avoid a
   *  flash of the default strip before a force-template applies). */
  ready: boolean;
  /** The resolved template to FORCE-apply. Always concrete (default when none). */
  resolved: ResolvedClassDashboard;
  /** True iff this folder is a class with a published template forcing the view. */
  isForced: boolean;
  /**
   * CT-6: the set of top-nav hrefs a class STUDENT may see (resolveClassStudentNav).
   * The coursework default when no template names a nav allowlist. The AppShell
   * applies this ONLY for a class student; every other consumer ignores it.
   */
  studentNav: ReadonlySet<string>;
}

const DEFAULT_RESULT: UseClassDashboardResult = {
  ready: true,
  resolved: defaultResolvedClassDashboard(),
  isForced: false,
  studentNav: resolveClassStudentNav(null),
};

export function useClassDashboard(
  username: string | null,
): UseClassDashboardResult {
  const [result, setResult] = useState<UseClassDashboardResult>(
    // Flag off: settle immediately on the default so there is never a loading
    // flash on a non-class build.
    CLASS_MODE_ENABLED && username
      ? { ...DEFAULT_RESULT, ready: false }
      : DEFAULT_RESULT,
  );

  useEffect(() => {
    // Flag off, or signed out: the default, settled, forever inert.
    if (!CLASS_MODE_ENABLED || !username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- flag-off / sign-out: collapse to the default synchronously, no I/O.
      setResult(DEFAULT_RESULT);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const settings = await readUserSettings(username);
        // Only a class folder forces a dashboard. A research lab / solo folder
        // never reads the cache, so its workbench is unchanged.
        if (settings.lab_kind !== "class") {
          if (!cancelled) setResult(DEFAULT_RESULT);
          return;
        }
        const template = await readCachedClassDashboard();
        if (cancelled) return;
        const resolved = resolveClassDashboard(template);
        setResult({
          ready: true,
          resolved,
          isForced: template != null,
          studentNav: resolveClassStudentNav(template),
        });
      } catch (err) {
        // Never gate the workbench on a failed read; fall back to the default.
        console.warn("[useClassDashboard] read failed", err);
        if (!cancelled) setResult(DEFAULT_RESULT);
      }
    };

    void load();

    // Re-read when this user's settings change (a fresh pull writes the cache and
    // a class provisioner / instructor edit bumps settings on the same bus).
    const unsubscribe = onUserSettingsWritten((event) => {
      if (cancelled) return;
      if (event.username !== username) return;
      void load();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [username]);

  return result;
}
