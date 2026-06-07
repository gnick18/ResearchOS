// sequence editor master. The <Icon> component, the single way to render an
// icon on ResearchOS. It draws from the verified ICONS registry so glyphs can
// never drift again. The icon-guard test (see __tests__/icon-guard.test.ts)
// blocks any new inline <svg> elsewhere in the tree.

import { ICONS, type IconName } from "./registry";

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
  const entry = ICONS[name];
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
