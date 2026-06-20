// A small labeled badge pill, the seed of a larger badge system (founding
// member, early adopter, and so on, like GitHub's achievement badges). It is
// brand-tokened and the optional glyph comes from the icon registry. A dedicated
// badge glyph is a verified asset that needs Grant's sign-off, so the founding
// badge ships text-only for now.
//
// House style: no em-dashes, no emojis, no mid-sentence colons, sentence case.

import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons/registry";

export type BadgeTone = "founding" | "neutral";

export function Badge({
  children,
  icon,
  tone = "founding",
}: {
  children: ReactNode;
  /** Optional registry glyph. Omit until the badge system gets its own glyph. */
  icon?: IconName;
  tone?: BadgeTone;
}) {
  const cls =
    tone === "founding"
      ? "bg-brand-action/10 text-brand-action ring-brand-action/25"
      : "bg-surface-sunken text-foreground-muted ring-border";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta font-semibold ring-1 ring-inset ${cls}`}
    >
      {icon ? <Icon name={icon} className="h-3.5 w-3.5" /> : null}
      {children}
    </span>
  );
}

export default Badge;
