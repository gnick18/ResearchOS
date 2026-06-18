"use client";

/**
 * Walkthrough Beat 1: Welcome + sign-in line.
 *
 * BeakerBot introduces himself and ResearchOS, and the copy now sets the
 * post-pivot expectation up front: a free ResearchOS account is required,
 * and that account is your identity, not your storage. Your research data
 * still stays on your own computer.
 *
 * The component owns the headline, body, and primary CTA, and emits
 * `onNext` when the user advances. The parent state machine handles the
 * transition to the where-your-work-lives beat. No skip link here (the
 * orchestrator overlays a SkipLink on every beat).
 *
 * Voice rules apply: no em-dashes, no mid-sentence colons, no emojis.
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
      <p className="mb-3 text-title leading-relaxed text-slate-700">
        You sign in with a free ResearchOS account. That account is your
        identity, the way other researchers find you and you find them. It is
        not where your data is stored.
      </p>
      <p className="mb-6 text-title leading-relaxed text-slate-700">
        Your research stays in a folder on your own computer, under your
        control. Let me show you exactly how that works.
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
