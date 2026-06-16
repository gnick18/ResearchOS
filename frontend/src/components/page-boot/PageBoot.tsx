"use client";

// The gate: wrap a client-heavy page's content in <PageBoot tasks={...}>. It runs
// the boot tasks behind the BeakerBotLoader and renders the children only once
// every task resolves. On failure it shows a retry (no soft-lock). ETA persists
// per page via localStorage. Callers must keep `tasks` stable across renders
// (build them once, e.g. useMemo) — they are captured per run, not per render.

import { useEffect, useRef, useState } from "react";
import {
  runBoot,
  createLocalTimingStore,
  type BootTask,
  type BootState,
} from "@/lib/page-boot/page-boot";
import { BeakerBotLoader } from "./BeakerBotLoader";

const timingStore = createLocalTimingStore();

export interface PageBootProps {
  /** Stable id for ETA caching (e.g. "datahub", "figures-smart-search"). */
  pageId: string;
  tasks: BootTask[];
  blurb?: string;
  whyHref?: string;
  children: React.ReactNode;
}

export function PageBoot({ pageId, tasks, blurb, whyHref, children }: PageBootProps) {
  const [state, setState] = useState<BootState>({
    pct: 0,
    label: "Starting up",
    etaMs: null,
    phase: "running",
  });
  const [attempt, setAttempt] = useState(0);
  // Capture tasks once per attempt so a parent re-render doesn't restart the boot.
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    let cancelled = false;
    setState({ pct: 0, label: "Starting up", etaMs: null, phase: "running" });
    runBoot(tasksRef.current, {
      pageId,
      timingStore,
      onUpdate: (s) => {
        if (!cancelled) setState(s);
      },
    }).catch(() => {
      // The error state was already emitted via onUpdate; swallow the rejection.
    });
    return () => {
      cancelled = true;
    };
    // Re-run only on an explicit retry or a page change, never on tasks identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, attempt]);

  if (state.phase === "done") return <>{children}</>;

  return (
    <BeakerBotLoader
      state={state}
      blurb={blurb}
      whyHref={whyHref}
      onRetry={() => setAttempt((a) => a + 1)}
    />
  );
}
