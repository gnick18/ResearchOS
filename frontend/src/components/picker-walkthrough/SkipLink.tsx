"use client";

/**
 * Skip link (small, quiet, top-right corner). Present on every beat
 * of the opt-in walkthrough modal. The user already opted in by
 * clicking the picker's walkthrough CTA, so the skip link is purely
 * an escape hatch; it does NOT write any seen-flag (the modal is
 * fully opt-in and the picker is the persistent landing).
 *
 * The link fires onSkip via the parent modal's `handleSkip`, which
 * just closes the modal. This component is pure presentation.
 *
 * Salvaged from the retired pre-onboarding flow (75c6107b) and rehomed
 * under picker-walkthrough/.
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
      className="absolute right-4 top-4 z-20 rounded-md px-3 py-1.5 text-meta font-medium text-slate-500 transition-colors hover:bg-slate-900/5 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
      data-testid="picker-walkthrough-skip"
    >
      Skip
    </button>
  );
}
