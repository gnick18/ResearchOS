/**
 * Temporary beta notice (pre-1.0). Single source for the "we're in beta,
 * please report bugs" copy so it can't drift between the surfaces that show
 * it (the loading splash + the folder-setup welcome screen). Remove or soften
 * once we ship 1.0.
 *
 * The inner card is styled for a dark surface (both current callsites sit on
 * the slate gradient). `className` lets the caller position it (e.g. a fixed
 * bottom-left corner, or an inline block in a centered column).
 */
export default function BetaNotice({ className = "" }: { className?: string }) {
  return (
    <div
      data-testid="beta-notice"
      className={`rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left ${className}`}
    >
      <p className="text-meta font-semibold text-amber-300 mb-1">
        ResearchOS is in beta
      </p>
      <p className="text-meta text-slate-300 leading-relaxed">
        You will run into the occasional bug while we keep polishing, and we are
        working hard to fix them. Thank you for being an early user! Please
        report anything that breaks, and we would love to hear what is and
        isn&apos;t working for you.
      </p>
    </div>
  );
}
