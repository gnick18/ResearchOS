import type { Metadata } from "next";
import BeakerBot from "@/components/BeakerBot";

export const metadata: Metadata = {
  title: "ResearchOS is upgrading",
  description: "ResearchOS is getting big upgrades and will be back live shortly.",
};

/**
 * Full-screen "under construction" holding page.
 *
 * Shown to everyone (except a bypass-cookie holder) while MAINTENANCE_MODE is
 * on, via src/middleware.ts. The real app is hidden during heavy backend
 * migration work so half-finished states never reach users. The copy reassures
 * that local data is untouched, since ResearchOS is local-first and a user's
 * notes live on their own machine, not on anything we are changing.
 *
 * Uses the real BeakerBot mascot with an overlaid hard hat + a hammer. No
 * em-dashes, no emojis, no mid-sentence colons.
 */
export default function MaintenancePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-b from-sky-50 to-white px-6 py-16 text-center">
      <div className="flex max-w-md flex-col items-center gap-7">
        <div className="relative h-56 w-56">
          <BeakerBot
            pose="idle"
            alive
            className="h-full w-full text-sky-500"
            ariaLabel="BeakerBot wearing a hard hat"
          />

          {/* Hard hat sitting on BeakerBot's head. */}
          <svg
            className="absolute left-1/2 top-[2%] w-[58%] -translate-x-1/2"
            viewBox="0 0 100 58"
            fill="none"
            aria-hidden="true"
          >
            <path d="M6 47 Q50 37 94 47 L94 51 Q50 43 6 51 Z" fill="#f59e0b" />
            <path d="M21 47 Q21 13 50 11 Q79 13 79 47 Z" fill="#fbbf24" />
            <rect x="45.5" y="13" width="9" height="34" rx="3.5" fill="#f59e0b" />
          </svg>

          {/* Hammer leaning in at the lower right, like a tool set down. */}
          <svg
            className="absolute -right-1 bottom-[6%] w-[30%] rotate-[18deg]"
            viewBox="0 0 60 84"
            fill="none"
            aria-hidden="true"
          >
            <rect x="26" y="22" width="8" height="56" rx="4" fill="#b45309" />
            <path
              d="M11 13 H49 V25 H41 L36 20 H24 L19 25 H11 Z"
              fill="#64748b"
            />
            <rect x="11" y="13" width="38" height="4" rx="2" fill="#94a3b8" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-slate-800">We are building hard</h1>

        <p className="text-base leading-relaxed text-slate-600">
          ResearchOS is getting some big upgrades. The site will be back live by
          Monday. Your local data is untouched and stays on your own machine,
          nothing here changes that.
        </p>

        <p className="text-sm text-slate-400">
          Thanks for your patience. BeakerBot is on it.
        </p>
      </div>
    </main>
  );
}
