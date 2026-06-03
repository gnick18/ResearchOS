"use client";

/**
 * Walkthrough Beat 2: Data security.
 *
 * The trust beat. Without it, fresh users assume "pick a folder" is
 * uploading their files and bounce. The copy has to land as "we
 * genuinely cannot see your data," not as legal-flavored privacy
 * boilerplate.
 *
 * Voice rules: second-person, plain English, no jargon, no policy
 * vocabulary. Use concrete claims ("nothing uploads", "we cannot see
 * your data") instead of abstract reassurance ("we respect your
 * privacy"). The headline carries the load, the body lists the three
 * concrete reasons, the footer admits the one caveat (backups are
 * your call).
 *
 * Salvaged from the retired pre-onboarding flow (75c6107b) and rehomed
 * under picker-walkthrough/.
 */
export interface SecurityBeatProps {
  onNext: () => void;
}

export default function SecurityBeat({ onNext }: SecurityBeatProps) {
  return (
    <div data-testid="picker-walkthrough-beat-security">
      <h2 className="mb-3 text-2xl font-bold text-slate-900">
        Your data stays on your computer.
      </h2>
      <p className="mb-3 text-title leading-relaxed text-slate-700">
        ResearchOS is local-first. The folder you pick is yours. Every
        experiment, note, and measurement lives inside it on your machine,
        and the browser reads and writes that folder directly through your
        operating system.
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
            Notes, measurements, and files stay on your machine. There is
            no ResearchOS server reading your folder.
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
            Even if we wanted to, we have no way to read what is in your
            folder. The website only sees what your browser shows on screen.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-500"
          />
          <span>
            <strong className="font-semibold text-slate-900">
              One anonymous pageview ping.
            </strong>{" "}
            ResearchOS sends Vercel a single anonymous beacon per route so
            we can see which pages get used. No IDs, no folder contents,
            no typed text. Flip <strong>Offline mode</strong> on in
            Settings to turn it off; the analytics script is never
            injected while that toggle is on.
          </span>
        </li>
      </ul>
      <p className="mb-6 text-body leading-relaxed text-slate-600">
        Backups and sharing are your call. If you ever want to sync across
        devices or share with the lab, you can put the folder in your
        cloud-sync app (we will show you how on the next screen).
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center rounded-lg bg-sky-500 px-5 py-2.5 text-body font-semibold text-white shadow-sm transition-colors hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          data-testid="picker-walkthrough-security-next"
        >
          Got it, next
        </button>
      </div>
    </div>
  );
}
