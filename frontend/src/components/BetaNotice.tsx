/**
 * Temporary beta notice (pre-1.0). Single source for the "we're in beta,
 * please report bugs" copy so it can't drift between the surfaces that show
 * it (the loading splash + the folder-setup welcome screen). Remove or soften
 * once we ship 1.0.
 *
 * `tone` switches the card styling between the dark splash surfaces (the
 * login + folder-setup screens still sit on the slate gradient) and the light
 * surfaces (the loading screen, now unified to the welcome page's light +
 * subtle-rainbow look). `className` lets the caller position it (e.g. a fixed
 * bottom-left corner, or an inline block in a centered column).
 */
export default function BetaNotice({
  className = "",
  tone = "dark",
}: {
  className?: string;
  tone?: "dark" | "light";
}) {
  const isLight = tone === "light";
  return (
    <div
      data-testid="beta-notice"
      className={`rounded-lg border px-4 py-3 text-left ${
        isLight
          ? "border-[#e3ecf6] bg-white/70"
          : "border-white/10 bg-white/5"
      } ${className}`}
    >
      <p
        className={`text-meta font-semibold mb-1 ${
          isLight ? "text-amber-700" : "text-amber-300"
        }`}
      >
        ResearchOS is in beta
      </p>
      <p
        className={`text-meta leading-relaxed ${
          isLight ? "text-gray-600" : "text-slate-300"
        }`}
      >
        You will run into the occasional bug while we keep polishing, and we are
        working hard to fix them. Thank you for being an early user! Please
        report anything that breaks, and we would love to hear what is and
        isn&apos;t working for you.
      </p>
    </div>
  );
}
