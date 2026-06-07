import type { Metadata } from "next";
import BeakerBot from "@/components/BeakerBot";
import Wordmark from "@/components/Wordmark";
import AppFooter from "@/components/AppFooter";
import styles from "./maintenance.module.css";

export const metadata: Metadata = {
  title: "ResearchOS is upgrading",
  description: "ResearchOS is undergoing scheduled maintenance and will be back online shortly.",
};

/**
 * Full-screen "under construction" holding page.
 *
 * Shown to everyone (except a bypass-cookie holder) while MAINTENANCE_MODE is
 * on, via src/proxy.ts. Reusable across maintenance windows: the expected
 * return time is read from the MAINTENANCE_RETURN_AT env var (a display string),
 * so a new window just updates that var, no code change.
 *
 * Server component so it can read the non-public env var. BeakerBot, Wordmark,
 * and AppFooter are client islands. No em-dashes, no emojis, no mid-sentence
 * colons.
 */
export default function MaintenancePage() {
  const returnAt =
    process.env.MAINTENANCE_RETURN_AT?.trim() ||
    "Monday, June 8, 2026 at 9:00 AM Central Time";

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-sky-50 to-white">
      <header className="flex justify-center px-6 pt-10 pb-2">
        <Wordmark size="lg" animated={false} markEasterEgg="none" textClassName="text-brand-ink" />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-10 text-center">
        <div className="flex max-w-lg flex-col items-center gap-7">
          {/* BeakerBot + hard hat + hammer, floating as one glued group. */}
          <div className={`relative h-60 w-60 ${styles.float}`}>
            <BeakerBot
              pose="idle"
              animated={false}
              className="h-full w-full text-sky-500"
              ariaLabel="BeakerBot wearing a hard hat"
            />

            {/* Hard hat sitting on BeakerBot's head. */}
            <svg
              className="absolute left-1/2 top-[14%] w-[56%] -translate-x-1/2"
              viewBox="0 0 100 58"
              fill="none"
              aria-hidden="true"
            >
              <path d="M6 47 Q50 37 94 47 L94 51 Q50 43 6 51 Z" fill="#f59e0b" />
              <path d="M21 47 Q21 13 50 11 Q79 13 79 47 Z" fill="#fbbf24" />
              <rect x="45.5" y="13" width="9" height="34" rx="3.5" fill="#f59e0b" />
            </svg>

            {/* Hammer leaning in at the lower right. */}
            <svg
              className="absolute -right-2 bottom-[8%] w-[28%] rotate-[18deg]"
              viewBox="0 0 60 84"
              fill="none"
              aria-hidden="true"
            >
              <rect x="26" y="22" width="8" height="56" rx="4" fill="#b45309" />
              <path d="M11 13 H49 V25 H41 L36 20 H24 L19 25 H11 Z" fill="#64748b" />
              <rect x="11" y="13" width="38" height="4" rx="2" fill="#94a3b8" />
            </svg>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-slate-800">
            We will be right back
          </h1>

          <p className="text-base leading-relaxed text-slate-600">
            ResearchOS is undergoing scheduled maintenance to ship some major
            improvements. We expect to be back online by{" "}
            <span className="font-semibold text-slate-800">{returnAt}</span>.
          </p>

          <p className="rounded-xl bg-white/70 px-5 py-4 text-sm leading-relaxed text-slate-500 ring-1 ring-sky-100">
            Your work is safe. ResearchOS is local-first, so your notes and files
            live on your own machine and are never touched by site updates.
          </p>

          <p className="text-sm text-slate-400">
            Thank you for your patience. BeakerBot is on it.
          </p>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
