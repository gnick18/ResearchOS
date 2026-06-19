"use client";

/**
 * Walkthrough Beat 4: Why it is cheap and private.
 *
 * The payoff beat. Both the low cost and the strong privacy flow from the
 * same choice: your data is not parked on our servers, so we are not paying
 * to store everyone's research, and we have nothing of yours to lose, sell,
 * or get breached. This is the single point Grant most wants users to leave
 * with.
 *
 * Honesty constraints honored here:
 *   - We do not store the folder in the cloud, not even on a paid lab plan.
 *   - The optional AI assistant only sends the note or table it reads to a
 *     provider through our server, with the key held server-side. We do NOT
 *     claim HIPAA or a BAA, and the provider is referred to generically.
 *   - Receiving shared work is free; sending a copy and hosting live
 *     collaboration are the paid parts.
 *
 * No em-dashes, no mid-sentence colons, no emojis.
 */
export interface WhyCheapPrivateBeatProps {
  onNext: () => void;
}

export default function WhyCheapPrivateBeat({
  onNext,
}: WhyCheapPrivateBeatProps) {
  return (
    <div data-testid="picker-walkthrough-beat-why-cheap-private">
      <h2 className="mb-3 text-2xl font-bold text-slate-900">
        Why this is cheap and private.
      </h2>
      <p className="mb-3 text-title leading-relaxed text-slate-700">
        Here&apos;s the part most tools get backwards. Because we never store
        your research, we don&apos;t have to charge you to store it, and we
        can&apos;t lose it, sell it, or leak it.
      </p>
      <ul className="mb-4 space-y-2 text-body text-slate-700">
        <li className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-500"
          />
          <span>
            <strong className="font-semibold text-slate-900">
              The app is free.
            </strong>{" "}
            Every feature works locally at no cost, and receiving shared work
            is free too. Sending a copy or hosting live collaboration are the
            paid parts, since those are the only things that touch our relay.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-500"
          />
          <span>
            <strong className="font-semibold text-slate-900">
              This stays true on a paid lab account.
            </strong>{" "}
            A lab pays for live collaboration and AI, never for storing the
            lab&apos;s data, which still lives on each person&apos;s own disk.
            The PI covers one pooled cost, and members join for free.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-500"
          />
          <span>
            <strong className="font-semibold text-slate-900">
              The AI helper is optional.
            </strong>{" "}
            When you ask it something, only the note or table it needs goes
            through our server to an AI provider. We hold the key on our side,
            and the provider keeps nothing by default. Nothing else from your
            folder goes with it.
          </span>
        </li>
      </ul>
      <p className="mb-6 text-body leading-relaxed text-slate-600">
        That&apos;s the whole model. Local by default, a free account for your
        identity, and small paid streams only when you choose to share or
        collaborate. Now let&apos;s set up your folder.
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center rounded-lg bg-sky-500 px-5 py-2.5 text-body font-semibold text-white shadow-sm transition-colors hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          data-testid="picker-walkthrough-why-cheap-private-next"
        >
          Set up my folder
        </button>
      </div>
    </div>
  );
}
