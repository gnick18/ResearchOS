import type { ReactNode } from "react";

// Force-light subtree (see docs/proposals/dark-mode-toggle.md §7).
//
// Wraps content so it paints with the light palette even under
// data-theme="dark". The `.light-scope` class (globals.css) re-declares every
// themed token at its light value. Used for: permanently-light pages (welcome,
// landing), framed light media on dark pages (screenshots, the sequence editor
// island), and as the incremental-rollout safety valve so an un-converted page
// renders clean light instead of half-dark.

export default function LightOnly({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`light-scope${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
