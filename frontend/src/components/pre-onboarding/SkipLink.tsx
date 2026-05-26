"use client";

/**
 * Skip link — small, quiet, top-right corner. Present on every beat
 * per L4 in PRE_ONBOARDING_PROPOSAL.md. The user takes their own
 * risk; per the proposal we do not gate the skip behind a timer or
 * any "must read the security beat" enforcement.
 *
 * The link writes the seen flag + fires onComplete via the parent
 * screen's `handleSkip`. The actual side effects live there so the
 * orchestrator owns the lifecycle; this component is pure presentation.
 */
export interface SkipLinkProps {
  onSkip: () => void;
  disabled?: boolean;
}

export default function SkipLink({ onSkip, disabled }: SkipLinkProps) {
  return (
    <button
      type="button"
      onClick={onSkip}
      disabled={disabled}
      className="absolute right-4 top-4 rounded-md px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
      data-testid="pre-onboarding-skip"
    >
      Skip, I know what I&apos;m doing
    </button>
  );
}
