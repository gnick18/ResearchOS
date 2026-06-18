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
        Why it stays cheap and private.
      </h2>
      <p className="mb-3 text-title leading-relaxed text-slate-700">
        Both come from the same choice. Your data lives with you, not with us,
        so we are not paying to store everyone&apos;s research and we have
        nothing of yours to lose, sell, or get breached.
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
            Every feature works locally at no cost. Receiving shared work is
            free too. Sending a copy and hosting live collaboration are the
            paid parts, because those are the only things that use our relay.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-500"
          />
          <span>
            <strong className="font-semibold text-slate-900">
              Only the PI ever pays for a lab.
            </strong>{" "}
            A lab plan is one pooled cost the PI carries, and members join for
            free. Storage is billed at roughly what it costs us, not as a
            markup to profit from.
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
            When you ask it something, only the note or table it needs is sent
            through our server to an AI provider, with the key held on our side
            and the provider set to keep nothing by default. Nothing else from
            your folder goes along for the ride.
          </span>
        </li>
      </ul>
      <p className="mb-6 text-body leading-relaxed text-slate-600">
        That is the whole model. Local by default, a free account for
        identity, and small paid streams only when you choose to share or
        collaborate. Now let us set up your folder.
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
