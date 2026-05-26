"use client";

/**
 * Pre-onboarding Beat 1: Welcome.
 *
 * BeakerBot introduces himself + ResearchOS in two sentences. Per the
 * proposal §6.1 the pose is `waving` and the copy stays playful but
 * clear: enough warmth to land as "this is friendly software" without
 * tipping into marketing-flavored fluff.
 *
 * The component owns the headline + body + primary CTA, and emits
 * `onNext` when the user advances. The parent state machine handles
 * the actual transition to the security beat. No skip link here — the
 * orchestrator overlays a SkipLink on every beat.
 */
export interface WelcomeBeatProps {
  onNext: () => void;
}

export default function WelcomeBeat({ onNext }: WelcomeBeatProps) {
  return (
    <div data-testid="pre-onboarding-beat-welcome">
      <h2 className="mb-3 text-2xl font-bold text-slate-900">
        Hi, I&apos;m BeakerBot.
      </h2>
      <p className="mb-6 text-base leading-relaxed text-slate-700">
        Welcome to ResearchOS. I&apos;ll help you set up a digital lab notebook
        that keeps every experiment, note, and result on your computer and
        under your control.
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          data-testid="pre-onboarding-welcome-next"
        >
          Next
        </button>
      </div>
    </div>
  );
}
