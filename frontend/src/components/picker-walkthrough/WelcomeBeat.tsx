"use client";

/**
 * Walkthrough Beat 1: Welcome.
 *
 * BeakerBot introduces himself + ResearchOS in two sentences. The pose
 * is `waving` (set by the parent) and the copy stays playful but clear:
 * enough warmth to land as "this is friendly software" without tipping
 * into marketing-flavored fluff.
 *
 * The component owns the headline + body + primary CTA, and emits
 * `onNext` when the user advances. The parent state machine handles
 * the actual transition to the security beat. No skip link here (the
 * orchestrator overlays a SkipLink on every beat).
 *
 * Salvaged from the retired pre-onboarding flow (75c6107b) and rehomed
 * under picker-walkthrough/.
 */
export interface WelcomeBeatProps {
  onNext: () => void;
}

export default function WelcomeBeat({ onNext }: WelcomeBeatProps) {
  return (
    <div data-testid="picker-walkthrough-beat-welcome">
      <h2 className="mb-3 text-2xl font-bold text-slate-900">
        Hi, I&apos;m BeakerBot.
      </h2>
      <p className="mb-3 text-title leading-relaxed text-slate-700">
        Welcome to ResearchOS, a free and open source digital lab notebook
        from ResearchOS LLC, a registered Wisconsin company. It grew out of a
        UW-Madison Distinguished Research Fellowship.
      </p>
      <p className="mb-6 text-title leading-relaxed text-slate-700">
        I&apos;ll help you set things up. Every experiment, note, and result
        stays on your computer and under your control.
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center rounded-lg bg-sky-500 px-5 py-2.5 text-body font-semibold text-white shadow-sm transition-colors hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          data-testid="picker-walkthrough-welcome-next"
        >
          Next
        </button>
      </div>
    </div>
  );
}
