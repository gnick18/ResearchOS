"use client";

/**
 * Settings page Streaks section (Phase S3 of the Streak-and-Milestones arc).
 *
 * See docs/proposals/done/STREAK_AND_MILESTONES_PROPOSAL.md §3 L6 (disable path), §6.2 (the
 * spec this implements), §7.2 (celebrations_seen contract: account
 * anniversaries are date-anchored, so they can NEVER be cleared from this
 * UI; only streak_milestones may be reset).
 *
 * Scope (UI-only):
 *  - Enable / disable toggle. Disabling preserves existing streak state.
 *  - Read-only stat trio (current count, personal best, started_on)
 *    visible only when enabled.
 *  - Reset streak with a confirmation modal. Optional second checkbox in
 *    the modal clears celebrations_seen.streak_milestones so streak
 *    milestone scenes can re-fire.
 *  - PTO subsection placeholder (S4 owns the actual editor).
 *
 * What this section does NOT do:
 *  - No write-path / activity tracking hook (S1).
 *  - No top-nav StreakBadge (S2).
 *  - No PTO editor implementation (S4).
 *  - No milestone scheduler / celebration manager (S6).
 */

import { useCallback, useEffect, useState } from "react";

import { useFileSystem } from "@/lib/file-system/file-system-context";
import {
  patchStreak,
  readStreak,
  type StreakSidecar,
} from "@/lib/streak/streak-sidecar";
import PtoEditor from "./PtoEditor";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  HighlightedText,
  SectionMatchProvider,
  useSectionSearchState,
} from "./search-context";

export default function StreaksSection() {
  const { currentUser, isConnected } = useFileSystem();

  const [sidecar, setSidecar] = useState<StreakSidecar | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResetModal, setShowResetModal] = useState(false);

  // Initial load + reload on user switch. The file system context is the
  // canonical signal: we can't read a per-user sidecar without a connected
  // user, so we short-circuit to a null sidecar (which renders nothing).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (!currentUser || !isConnected) {
        setSidecar(null);
        setLoading(false);
        return;
      }
      try {
        const s = await readStreak(currentUser);
        if (!cancelled) setSidecar(s);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser, isConnected]);

  const applyPatch = useCallback(
    async (mutator: (cur: StreakSidecar) => StreakSidecar) => {
      if (!currentUser) return;
      const next = await patchStreak(currentUser, mutator);
      setSidecar(next);
    },
    [currentUser],
  );

  const handleToggle = useCallback(
    (nextEnabled: boolean) => {
      void applyPatch((cur) => ({ ...cur, enabled: nextEnabled }));
    },
    [applyPatch],
  );

  const handleReset = useCallback(
    (alsoClearCelebrationsSeen: boolean) => {
      void applyPatch((cur) => ({
        ...cur,
        current_count: 0,
        started_on: null,
        last_activity_date: null,
        // personal best is intentionally preserved per spec.
        celebrations_seen: alsoClearCelebrationsSeen
          ? {
              ...cur.celebrations_seen,
              streak_milestones: [],
            }
          : cur.celebrations_seen,
      }));
      setShowResetModal(false);
    },
    [applyPatch],
  );

  // Match the existing SectionShell silhouette so this slots in cleanly
  // between the other Settings sections. (Inlined instead of importing
  // SectionShell, since page.tsx keeps SectionShell private, and duplicating
  // ~12 lines is cheaper than refactoring the shared file from S3 scope.)
  //
  // Settings search UX manager 2026-05-23: also wires this hand-rolled
  // shell into the page-wide search filter (search-context.tsx) so a
  // query like "streak" or "personal best" hides every other section
  // and keeps this one visible. Uses the same `useSectionSearchState`
  // hook as `SectionShell` in page.tsx so behavior is identical.
  const sectionTitle = "Streaks (private to you)";
  const sectionDesc =
    sidecar && sidecar.enabled === false
      ? "Streaks are off. Re-enable to start tracking from today onward. Your existing state is kept but won't update."
      : "Tracks how many workdays in a row you've saved something. Visible only to you.";
  // Extra search keywords for row primitives inside this section that
  // don't (yet) go through SearchableRow — the personal-best stat tile,
  // the PTO subsection labels, the reset button. Keeps "PTO" and
  // "personal best" hitting this section.
  const searchKeywords =
    "personal best current streak started on reset streak PTO paid time off";
  const state = useSectionSearchState(
    sectionTitle,
    `${sectionDesc} ${searchKeywords}`,
  );
  return (
    <section
      id="streaks"
      className="bg-surface-raised rounded-xl border border-border p-6 scroll-mt-4"
      data-testid="streaks-section"
      data-tour-target="settings-streak-section"
      data-settings-section-marker="1"
      hidden={state.shouldHide}
    >
      <div className="mb-4">
        <h2 className="text-title font-semibold text-foreground flex items-center gap-1.5">
          <LockIcon className="h-3.5 w-3.5 text-sky-500" />
          <HighlightedText text={sectionTitle} />
        </h2>
        <p className="text-meta text-foreground-muted mt-1">
          <HighlightedText text={sectionDesc} />
        </p>
      </div>

      <SectionMatchProvider register={state.register}>
      <div className="space-y-4">
        {loading || !sidecar ? (
          <div className="text-meta text-foreground-muted">Loading.</div>
        ) : (
          <>
            <StreakToggleRow
              checked={sidecar.enabled}
              onChange={handleToggle}
            />

            {sidecar.enabled && (
              <div
                className="grid grid-cols-3 gap-3"
                data-testid="streaks-stats"
              >
                <StatTile
                  label="Current streak"
                  value={`${sidecar.current_count} ${sidecar.current_count === 1 ? "day" : "days"}`}
                />
                <StatTile
                  label="Personal best"
                  value={`${sidecar.longest_count} ${sidecar.longest_count === 1 ? "day" : "days"}`}
                />
                <StatTile
                  label="Started on"
                  value={sidecar.started_on ?? "Not started yet"}
                />
              </div>
            )}

            {sidecar.enabled && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowResetModal(true)}
                  className="px-3 py-1.5 text-body font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors"
                  data-testid="streaks-reset-button"
                >
                  Reset streak
                </button>
              </div>
            )}

            <PtoSubsection />
          </>
        )}
      </div>
      </SectionMatchProvider>

      {showResetModal && sidecar && (
        <ResetStreakModal
          currentCount={sidecar.current_count}
          onCancel={() => setShowResetModal(false)}
          onConfirm={handleReset}
        />
      )}
    </section>
  );
}

// ── Internal pieces ─────────────────────────────────────────────────────────

/** Local toggle. Mirrors the visual shape of page.tsx's ToggleRow but
 *  uses sky-blue (matches the streak's privacy-friendly palette per the
 *  proposal's §6.2 lock icon color) and accepts a single label rather
 *  than label + description so it sits cleanly under our subhead. */
function StreakToggleRow({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 cursor-pointer">
      <span className="text-body text-foreground">Enable streak tracking</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Enable streak tracking"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
          checked ? "bg-sky-500" : "bg-gray-300"
        }`}
        data-testid="streaks-enable-toggle"
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-surface-raised shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          } translate-y-0.5`}
        />
      </button>
    </label>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-sunken p-3">
      <p className="text-meta uppercase tracking-wide text-foreground-muted">{label}</p>
      <p className="text-body font-semibold text-foreground mt-1">{value}</p>
    </div>
  );
}

/** Wires the S4 PtoEditor into the Streaks section. Replaces the
 *  earlier stub that S3 shipped; the data-testid is preserved on the
 *  container so the integration test still resolves. */
function PtoSubsection() {
  const { currentUser } = useCurrentUser();
  return (
    <div className="border-t border-border pt-4" data-testid="streaks-pto-stub">
      {currentUser ? <PtoEditor username={currentUser} /> : null}
    </div>
  );
}

/** Small lock glyph (the codebase ships inline SVGs rather than pulling
 *  in lucide-react; mirrors the AppShell icon idiom). Reinforces the
 *  "private to you" framing in the section header. */
function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function ResetStreakModal({
  currentCount,
  onCancel,
  onConfirm,
}: {
  currentCount: number;
  onCancel: () => void;
  onConfirm: (alsoClearCelebrationsSeen: boolean) => void;
}) {
  const [alsoClear, setAlsoClear] = useState(false);
  // Escape cancels this confirm modal (app-wide convention).
  useEscapeToClose(onCancel);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="streaks-reset-title"
      data-testid="streaks-reset-modal"
    >
      <div className="w-full max-w-sm rounded-xl bg-surface-raised p-5 ros-popup-card-shadow">
        <h3
          id="streaks-reset-title"
          className="text-title font-semibold text-foreground"
        >
          Reset your {currentCount}-day streak?
        </h3>
        <p className="mt-2 text-body text-foreground-muted">This can't be undone.</p>

        <label className="mt-4 flex items-start gap-2 cursor-pointer text-body text-foreground">
          <input
            type="checkbox"
            checked={alsoClear}
            onChange={(e) => setAlsoClear(e.target.checked)}
            className="mt-0.5 accent-sky-600"
            data-testid="streaks-reset-also-clear-celebrations"
          />
          <span>
            Also clear celebrations seen (so milestones can re-fire)
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="ros-btn-neutral px-3 py-1.5 text-body font-medium"
            data-testid="streaks-reset-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(alsoClear)}
            className="px-3 py-1.5 text-body font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors"
            data-testid="streaks-reset-confirm"
          >
            Reset streak
          </button>
        </div>
      </div>
    </div>
  );
}
