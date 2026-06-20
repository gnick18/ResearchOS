// A single achievement badge rendered as a circular medallion (badges v1).
//
// A 3px ring in the badge's color, a brand-tokened surface fill, and either the
// badge glyph (<Icon>, never inline svg) or a short `text` number centered in
// the ring color. Earned badges render in full color; locked badges render
// faded and desaturated so the bin reads as "what you could still earn". Works
// in light and dark mode through brand surface tokens; only the ring/glyph
// color comes from the badge (the sanctioned BADGE_COLORS hex).
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import { Icon } from "@/components/icons";
import type { Badge } from "@/lib/badges/catalog";

type MedallionSize = "sm" | "lg";

/** Pixel diameters and glyph sizing per medallion size. */
const SIZE: Record<
  MedallionSize,
  { box: string; glyph: string; text: string; ring: number }
> = {
  sm: { box: "h-12 w-12", glyph: "h-5 w-5", text: "text-meta", ring: 3 },
  lg: { box: "h-20 w-20", glyph: "h-9 w-9", text: "text-title", ring: 3 },
};

export default function BadgeMedallion({
  badge,
  size,
  earned,
}: {
  badge: Badge;
  size: MedallionSize;
  earned: boolean;
}) {
  const s = SIZE[size];
  // Locked badges drop to a neutral grey and fade; earned badges carry the
  // badge color on both the ring and the glyph/text (via currentColor).
  const color = earned ? badge.ring : "var(--color-border)";

  return (
    <span
      className={[
        "inline-flex items-center justify-center rounded-full",
        "bg-surface-raised",
        s.box,
        earned ? "" : "opacity-60 grayscale",
      ].join(" ")}
      style={{
        boxShadow: `inset 0 0 0 ${s.ring}px ${color}`,
        color,
      }}
      role="img"
      aria-label={`${badge.label}${earned ? "" : " (locked)"}`}
    >
      {badge.glyph ? (
        <Icon name={badge.glyph} className={s.glyph} />
      ) : (
        <span
          className={`${s.text} font-bold leading-none tracking-tight`}
          aria-hidden
        >
          {badge.text}
        </span>
      )}
    </span>
  );
}
