"use client";

// ClassDashboardPanel (CT-5 + CT-3): the INSTRUCTOR authoring surface for the
// class dashboard. The class head picks which workbench tabs the students see and
// in what order, the landing tab, an intro / syllabus banner, and the class
// visibility default. Publishing writes the singleton `class_dashboard`
// lab-wide-public relay record (E2E under the class team key, instructor
// owner-prefix), which every student then reads (FORCE-applied, v1).
//
// FLAG + GATE: rendered only behind CLASS_MODE_ENABLED AND useIsClassMode (the
// instructor-only "this folder is a class I head" predicate), so it is invisible
// on a research lab, a student folder, and a flag-off build. The publish path
// needs a LIVE lab session (the in-memory team key + the instructor's signing
// keys); while the session is not live the publish button is disabled with an
// explanatory line (no soft-lock, the form still renders).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useMemo, useState } from "react";
import { useLabSession } from "@/hooks/useLabSession";
import {
  WORKBENCH_TAB_ORDER,
  CLASS_STUDENT_NAV_CHOICES,
  CLASS_STUDENT_NAV_DEFAULT,
  type WorkbenchTabId,
  type ClassDashboard,
} from "@/lib/lab/class-dashboard";
import {
  publishClassDashboard,
  getClassDashboard,
} from "@/lib/lab/class-dashboard-store";

/** Human labels for the workbench tabs, in default order. */
const TAB_LABELS: Record<WorkbenchTabId, string> = {
  projects: "Projects",
  experiments: "Experiments",
  notes: "Notes",
  lists: "Lists",
  oneonone: "Mentoring",
};

interface LiveSession {
  labId: string;
  instructor: string;
  labKey: Uint8Array;
  ed25519Priv: Uint8Array;
  ed25519Pub: Uint8Array;
}

/** Pull the live lab session keys, or null when the session is not live yet. */
function useLiveSession(): LiveSession | null {
  const session = useLabSession();
  const [live, setLive] = useState<LiveSession | null>(null);

  // The controller's state is imperative; subscribe so we react to it going live.
  useEffect(() => {
    if (!session || session.loading) {
      setLive(null);
      return;
    }
    const { controller } = session;
    const read = () => {
      const state = controller.getState();
      if (state.kind === "live") {
        setLive({
          labId: state.labId,
          instructor: state.member.username,
          labKey: state.labKey,
          ed25519Priv: state.signingKeyPair.ed25519Priv,
          ed25519Pub: state.signingKeyPair.ed25519Pub,
        });
      } else {
        setLive(null);
      }
    };
    read();
    const unsub = controller.subscribe(read);
    return unsub;
  }, [session]);

  return live;
}

export default function ClassDashboardPanel() {
  const live = useLiveSession();

  // Form state. Tabs default to all-on; an empty enabledTabs is a real "hide all"
  // choice, but the resolver always keeps the landing tab so a student is never
  // stranded (see resolveClassDashboard).
  const [enabledTabs, setEnabledTabs] = useState<Set<WorkbenchTabId>>(
    () => new Set(WORKBENCH_TAB_ORDER),
  );
  const [landingTab, setLandingTab] = useState<WorkbenchTabId>("projects");
  // CT-6: the student top-nav allowlist (which screens beyond the always-on
  // Workbench a student sees). Defaults to the coursework-default choices.
  const [enabledNav, setEnabledNav] = useState<Set<string>>(
    () =>
      new Set(
        CLASS_STUDENT_NAV_CHOICES.map((c) => c.href).filter((h) =>
          CLASS_STUDENT_NAV_DEFAULT.includes(h),
        ),
      ),
  );
  const [introTitle, setIntroTitle] = useState("");
  const [introBody, setIntroBody] = useState("");
  const [visibilityDefault, setVisibilityDefault] = useState<
    "collaborative" | "private"
  >("private");
  const [rev, setRev] = useState(0);

  const [status, setStatus] = useState<
    "idle" | "loading" | "saving" | "saved" | "error"
  >("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load the current published template once the session is live, so the form
  // edits the existing value rather than overwriting it blind.
  useEffect(() => {
    if (!live) {
      setStatus((s) => (s === "loading" ? "loading" : s));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const existing = await getClassDashboard({
          labId: live.labId,
          instructor: live.instructor,
          labKey: live.labKey,
        });
        if (cancelled) return;
        if (existing) {
          const tabs =
            existing.tabs == null
              ? new Set(WORKBENCH_TAB_ORDER)
              : new Set(
                  existing.tabs.filter((t): t is WorkbenchTabId =>
                    (WORKBENCH_TAB_ORDER as readonly string[]).includes(t),
                  ),
                );
          setEnabledTabs(tabs);
          if (
            existing.landingTab &&
            (WORKBENCH_TAB_ORDER as readonly string[]).includes(
              existing.landingTab,
            )
          ) {
            setLandingTab(existing.landingTab as WorkbenchTabId);
          }
          // CT-6: load the student nav allowlist. Absent => the coursework
          // default; present => the instructor's saved choice (choices only).
          const navChoiceHrefs = CLASS_STUDENT_NAV_CHOICES.map((c) => c.href);
          setEnabledNav(
            new Set(
              existing.nav == null
                ? navChoiceHrefs.filter((h) =>
                    CLASS_STUDENT_NAV_DEFAULT.includes(h),
                  )
                : existing.nav.filter((h) => navChoiceHrefs.includes(h)),
            ),
          );
          setIntroTitle(existing.intro?.title ?? "");
          setIntroBody(existing.intro?.body ?? "");
          if (existing.visibilityDefault) {
            setVisibilityDefault(existing.visibilityDefault);
          }
          setRev(existing.rev ?? 0);
        }
        setStatus("idle");
      } catch {
        if (!cancelled) setStatus("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live]);

  const toggleTab = (id: WorkbenchTabId) => {
    setEnabledTabs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleNav = (href: string) => {
    setEnabledNav((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  };

  // The ordered, enabled subset to persist. Stored in default order for a stable
  // on-record shape (the resolver re-applies the authored order verbatim).
  const orderedTabs = useMemo(
    () => WORKBENCH_TAB_ORDER.filter((t) => enabledTabs.has(t)),
    [enabledTabs],
  );

  const allOn = orderedTabs.length === WORKBENCH_TAB_ORDER.length;

  const onPublish = async () => {
    if (!live) return;
    setStatus("saving");
    setErrorMsg(null);
    // ABSENT tabs encodes "all on" (the resolver's absent-is-all-on contract); a
    // strict subset persists the explicit list.
    // CT-6: persist the student nav allowlist in CHOICES order. When it equals
    // the coursework default, encode ABSENT (the resolver's absent-is-default
    // contract) so the record stays minimal; otherwise persist the explicit list.
    const orderedNav = CLASS_STUDENT_NAV_CHOICES.map((c) => c.href).filter((h) =>
      enabledNav.has(h),
    );
    const navIsDefault =
      orderedNav.length ===
        CLASS_STUDENT_NAV_DEFAULT.filter((h) => h !== "/workbench").length &&
      orderedNav.every((h) => CLASS_STUDENT_NAV_DEFAULT.includes(h));
    const template: ClassDashboard = {
      tabs: allOn ? undefined : orderedTabs,
      landingTab,
      nav: navIsDefault ? undefined : orderedNav,
      intro:
        introTitle.trim() || introBody.trim()
          ? { title: introTitle.trim(), body: introBody.trim() }
          : undefined,
      visibilityDefault,
      rev: rev + 1,
    };
    try {
      await publishClassDashboard({
        labId: live.labId,
        instructor: live.instructor,
        template,
        labKey: live.labKey,
        signerEd25519Priv: live.ed25519Priv,
        signerEd25519Pub: live.ed25519Pub,
      });
      setRev((r) => r + 1);
      setStatus("saved");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Could not publish the dashboard.",
      );
      setStatus("error");
    }
  };

  // The landing select must offer an enabled tab; if the current landing was
  // disabled, fall back to the first enabled tab.
  useEffect(() => {
    if (!enabledTabs.has(landingTab) && orderedTabs.length > 0) {
      setLandingTab(orderedTabs[0]);
    }
  }, [enabledTabs, landingTab, orderedTabs]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-meta font-semibold text-foreground mb-2">
          Workbench tabs students see
        </p>
        <p className="text-meta text-foreground-muted mb-3">
          Turn off the tabs your class does not use. Everyone in the class gets
          exactly this workbench.
        </p>
        <div className="flex flex-wrap gap-2">
          {WORKBENCH_TAB_ORDER.map((id) => {
            const on = enabledTabs.has(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleTab(id)}
                className={`rounded-lg border px-3 py-1.5 text-body font-medium transition-colors ${
                  on
                    ? "border-brand-action bg-brand-action/10 text-brand-action"
                    : "border-border text-foreground-muted hover:bg-surface-sunken"
                }`}
              >
                {TAB_LABELS[id]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-meta font-semibold text-foreground mb-2">
          Screens students see
        </p>
        <p className="text-meta text-foreground-muted mb-3">
          Students get a focused menu by default. Turn on any extra screens your
          class needs. The Workbench is always on, and anything off here stays
          reachable by link if a student has one.
        </p>
        <div className="flex flex-wrap gap-2">
          {CLASS_STUDENT_NAV_CHOICES.map(({ href, label }) => {
            const on = enabledNav.has(href);
            return (
              <button
                key={href}
                type="button"
                onClick={() => toggleNav(href)}
                className={`rounded-lg border px-3 py-1.5 text-body font-medium transition-colors ${
                  on
                    ? "border-brand-action bg-brand-action/10 text-brand-action"
                    : "border-border text-foreground-muted hover:bg-surface-sunken"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-meta font-semibold text-foreground">
          Landing tab
        </label>
        <select
          value={landingTab}
          onChange={(e) => setLandingTab(e.target.value as WorkbenchTabId)}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-body text-foreground"
        >
          {orderedTabs.map((id) => (
            <option key={id} value={id}>
              {TAB_LABELS[id]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-meta font-semibold text-foreground">
          Intro banner (optional)
        </label>
        <input
          type="text"
          value={introTitle}
          onChange={(e) => setIntroTitle(e.target.value)}
          placeholder="Title (e.g. Welcome to BIO 301)"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-body text-foreground"
        />
        <textarea
          value={introBody}
          onChange={(e) => setIntroBody(e.target.value)}
          placeholder="A short note or syllabus link shown above the tabs."
          rows={3}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-body text-foreground"
        />
      </div>

      <div className="space-y-2">
        <label className="text-meta font-semibold text-foreground">
          New student work defaults to
        </label>
        <div className="flex flex-wrap gap-2">
          {(["private", "collaborative"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVisibilityDefault(v)}
              className={`rounded-lg border px-3 py-1.5 text-body font-medium transition-colors ${
                visibilityDefault === v
                  ? "border-brand-action bg-brand-action/10 text-brand-action"
                  : "border-border text-foreground-muted hover:bg-surface-sunken"
              }`}
            >
              {v === "private" ? "Private to the student" : "Visible to the class"}
            </button>
          ))}
        </div>
        <p className="text-meta text-foreground-muted">
          Private is the default and the exam-safe choice. Visible to the class
          seeds new student work as class-readable (the CURE default). This sets
          the default at create time only and never reshares existing work.
        </p>
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button
          type="button"
          onClick={onPublish}
          disabled={!live || status === "saving"}
          className="rounded-md bg-brand-action px-4 py-2 text-body font-semibold text-white disabled:opacity-50"
        >
          {status === "saving" ? "Publishing..." : "Publish to the class"}
        </button>
        {!live && (
          <span className="text-meta text-foreground-muted">
            Sign in to your class to publish.
          </span>
        )}
        {status === "saved" && (
          <span className="text-meta text-emerald-600 dark:text-emerald-400">
            Published. Every student now sees this workbench.
          </span>
        )}
        {status === "error" && errorMsg && (
          <span className="text-meta text-red-600 dark:text-red-400">
            {errorMsg}
          </span>
        )}
      </div>
    </div>
  );
}
