"use client";

// Onboarding tutor — beat 2, the interest picker.
//
// Beaker asks who the user is (role) and what they want to do (goals). The picks
// branch the presentation: the reel-director turns them into the adaptive set of
// deep demos plus the montage, and they seed the user's memory. Goal-framed
// (what you want to DO), not page-framed.
//
// Presentational, driven by the parent's step machine via value + onChange. The
// "Start the tour" button is enabled only once a role is chosen (goals are
// optional, the director falls back to a role-default set). No emojis, no
// em-dashes, no mid-sentence colons.

import BeakerBot from "@/components/BeakerBot";
import { ROLES, GOALS, type Role, type GoalKey } from "@/lib/onboarding/reel-director";
import TutorScreen from "./TutorScreen";

export interface InterestPickerProps {
  role: Role | null;
  goals: GoalKey[];
  onSetRole: (role: Role) => void;
  onToggleGoal: (goal: GoalKey) => void;
  onStart: () => void;
  /** Dismiss onboarding entirely (the always-available escape). */
  onSkip: () => void;
  /** Step back to the welcome (picks preserved). */
  onBack: () => void;
}

export default function InterestPicker({
  role,
  goals,
  onSetRole,
  onToggleGoal,
  onStart,
  onSkip,
  onBack,
}: InterestPickerProps) {
  const canStart = role !== null;
  return (
    <TutorScreen>
      <button
        onClick={onSkip}
        className="absolute right-4 top-4 z-20 text-xs text-[var(--muted,#6b716a)] hover:text-[var(--fg,#1f2421)] hover:underline"
      >
        Skip for now
      </button>
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-start gap-2">
          <div className="h-8 w-8 flex-none">
            <BeakerBot pose="idle" animated alive ariaLabel="Beaker" className="h-full w-full" />
          </div>
          <div className="rounded-xl rounded-tl-sm border border-[var(--line,#e3e5e0)] bg-[var(--sunken,#f1f2ef)] px-3 py-2 text-sm">
            First, who are you and what do you want to get done? I&apos;ll show you
            the parts that matter to you.
          </div>
        </div>

        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--faint,#9aa097)]">
          I&apos;m a
        </div>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <button
              key={r.key}
              onClick={() => onSetRole(r.key)}
              aria-pressed={role === r.key}
              className={
                "rounded-full border px-3 py-1.5 text-xs " +
                (role === r.key
                  ? "border-[var(--violet,#7c4dca)] bg-[var(--violet,#7c4dca)] font-semibold text-white"
                  : "border-[var(--line2,#d2d5cd)] bg-[var(--surface,#fff)] text-[var(--muted,#6b716a)] hover:bg-[var(--sunken,#f1f2ef)]")
              }
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="mb-1.5 mt-4 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--faint,#9aa097)]">
          I want to
        </div>
        <div className="flex flex-wrap gap-2">
          {GOALS.map((g) => {
            const on = goals.includes(g.key);
            return (
              <button
                key={g.key}
                onClick={() => onToggleGoal(g.key)}
                aria-pressed={on}
                className={
                  "rounded-full border px-3 py-1.5 text-xs " +
                  (on
                    ? "border-[var(--brand,#1d9e75)] bg-[var(--brand,#1d9e75)] font-semibold text-white"
                    : "border-[var(--line2,#d2d5cd)] bg-[var(--surface,#fff)] text-[var(--muted,#6b716a)] hover:bg-[var(--sunken,#f1f2ef)]")
                }
              >
                {g.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={onBack}
            className="text-xs font-medium text-[var(--muted,#6b716a)] hover:text-[var(--fg,#1f2421)]"
          >
            Back
          </button>
          <button
            onClick={onStart}
            disabled={!canStart}
            className={
              "rounded-lg px-4 py-2 text-xs font-bold text-white " +
              (canStart
                ? "bg-[var(--brand,#1d9e75)] hover:brightness-105"
                : "cursor-not-allowed bg-[var(--line2,#d2d5cd)]")
            }
          >
            Start the tour
          </button>
        </div>
      </div>
    </TutorScreen>
  );
}
