"use client";

/**
 * Walkthrough Beat 2: Where your work lives.
 *
 * The trust beat. Before a fresh user picks a folder, they need to land
 * the core mental model: the folder is theirs, on their machine, and the
 * browser reads and writes it directly. Without this, "pick a folder"
 * reads as "upload my files" and people bounce.
 *
 * Voice rules: second-person, plain English, concrete claims ("nothing
 * uploads", "we cannot read it") over abstract reassurance. The three
 * bullets carry the load; the footer admits the one honest caveat
 * (backups and sharing are your call, covered later in the walkthrough).
 *
 * No em-dashes, no mid-sentence colons, no emojis.
 */
export interface WhereWorkLivesBeatProps {
  onNext: () => void;
}

export default function WhereWorkLivesBeat({
  onNext,
}: WhereWorkLivesBeatProps) {
  return (
    <div data-testid="picker-walkthrough-beat-where-work-lives">
      <h2 className="mb-3 text-2xl font-bold text-slate-900">
        Your research stays on your computer.
      </h2>
      <p className="mb-3 text-title leading-relaxed text-slate-700">
        ResearchOS is local-first. The folder you pick is yours, and every
        experiment, note, and measurement lives inside it on your machine. The
        browser reads and writes that folder directly.
      </p>
      <ul className="mb-4 space-y-2 text-body text-slate-700">
        <li className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-500"
          />
          <span>
            <strong className="font-semibold text-slate-900">
              Your folder never uploads.
            </strong>{" "}
            There is no ResearchOS server reading it.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-500"
          />
          <span>
            <strong className="font-semibold text-slate-900">
              We cannot see your data.
            </strong>{" "}
            The website only sees what your browser shows on screen.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-500"
          />
          <span>
            <strong className="font-semibold text-slate-900">
              One anonymous pageview ping,
            </strong>{" "}
            and you can turn it off in Settings.
          </span>
        </li>
      </ul>
      <p className="mb-6 text-body leading-relaxed text-slate-600">
        So what does touch the cloud, and when? That is the next screen, and
        it is the part worth understanding.
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center rounded-lg bg-sky-500 px-5 py-2.5 text-body font-semibold text-white shadow-sm transition-colors hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          data-testid="picker-walkthrough-where-work-lives-next"
        >
          Got it, next
        </button>
      </div>
    </div>
  );
}
