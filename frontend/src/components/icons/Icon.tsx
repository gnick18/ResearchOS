// sequence editor master. The <Icon> component, the single way to render an
// icon on ResearchOS. It draws from the verified ICONS registry so glyphs can
// never drift again. The icon-guard test (see __tests__/icon-guard.test.ts)
// blocks any new inline <svg> elsewhere in the tree.

import { ICONS, type IconName } from "./registry";

/** Neutral glyph drawn when a name has no registry entry. Keeps a single bad /
 *  undefined icon (e.g. a palette row whose data omitted iconName) from
 *  white-screening the whole surface. */
const FALLBACK_ICON: IconName = "more";

export function Icon({
  name,
  className,
  title,
}: {
  name: IconName;
  className?: string;
  /** When set, the icon is exposed to assistive tech as an image with this
   *  label. When omitted, it is decorative (aria-hidden). */
  title?: string;
}) {
  // Resilience: <Icon> renders names aggregated from many dynamic sources (the
  // command palette pulls from every page's BeakerSource). The `name` type says
  // IconName, but a runtime row can still carry an undefined / unregistered
  // value. Degrade to a neutral glyph and warn (naming the offender) instead of
  // throwing on `entry.viewBox`, which would take down the entire palette.
  let entry = ICONS[name];
  if (!entry) {
    if (typeof console !== "undefined") {
      console.warn(
        `[Icon] no registry entry for ${JSON.stringify(name)} — rendering the ${FALLBACK_ICON} fallback`,
      );
    }
    entry = ICONS[FALLBACK_ICON];
  }
  return (
    <svg
      viewBox={entry.viewBox ?? "0 0 24 24"}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {entry.body}
    </svg>
  );
}
