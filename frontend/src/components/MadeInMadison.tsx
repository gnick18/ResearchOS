/**
 * MadeInMadison — reusable brand identity element for the ResearchOS Wisconsin
 * LLC identity. Surfaces on the footer, wiki/trust pages, and the marketing
 * deck (where a plain-HTML copy is used instead).
 *
 * Voice rules: no em-dashes, no emojis, no mid-sentence colons.
 *
 * Props
 * -----
 * variant  "badge" (default) — bordered rounded chip with the WI shape + bold
 *          headline + subline. Good for trust sections and credibility callouts.
 *          "line" — compact single-line version for tight spots like the footer.
 * tone     "punchy" (default) — includes the California contrast line. Use on
 *          marketing surfaces.
 *          "soft" — drops the California jab. Use on formal / compliance pages.
 * className  optional Tailwind passthrough.
 */

import { Icon } from "@/components/icons";

const PUNCHY_SUBLINE =
  "A registered Wisconsin LLC, independent and Midwest based, not a California cloud.";

const SOFT_SUBLINE =
  "A registered Wisconsin LLC, independent and Midwest based.";

export default function MadeInMadison({
  variant = "badge",
  tone = "punchy",
  className = "",
}: {
  variant?: "badge" | "line";
  tone?: "punchy" | "soft";
  className?: string;
}) {
  const subline = tone === "soft" ? SOFT_SUBLINE : PUNCHY_SUBLINE;

  // "Madison" in Green Bay Packers green-and-gold. Inline style (not Tailwind
  // gradient utilities, which changed names in Tailwind v4) with the full
  // WebKit clip-text recipe, so the gradient is the text itself and reads on
  // both light and dark.
  const madison = (
    <span
      style={{
        backgroundImage: "linear-gradient(100deg, #2E8B45, #FFB81C)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        color: "transparent",
      }}
    >
      Madison
    </span>
  );

  if (variant === "line") {
    return (
      <span
        className={`inline-flex items-center gap-2 text-meta text-foreground-muted ${className}`}
      >
        {/* WI silhouette: green-gold gradient with a gold Madison star (self-colored) */}
        <Icon name="wisconsin" className="h-5 w-5 flex-none" title="Wisconsin" />
        <span>Built in {madison}.</span>
      </span>
    );
  }

  // badge variant
  return (
    <div
      className={`inline-flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-left ${className}`}
    >
      {/* WI silhouette: ~34px, green-gold gradient with a gold Madison star (self-colored) */}
      <Icon name="wisconsin" className="h-[34px] w-[34px] flex-none" title="Wisconsin" />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-extrabold leading-tight text-foreground">
          Built in {madison}
        </span>
        <span className="text-[11.5px] leading-snug text-foreground-muted">
          {subline}
        </span>
      </div>
    </div>
  );
}
