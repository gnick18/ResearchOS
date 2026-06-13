import type { ReactNode } from "react";

/**
 * Section eyebrow kicker: a monospace brand-action label with a short pastel
 * rainbow rule before it (the brand ramp as a quiet ornament). The shared
 * marketing eyebrow, used across welcome, pricing, /ai, /about, and the legal /
 * trust pages so every section heading reads from one family.
 *
 * No hooks, so it works in both server and client pages.
 */
export default function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="brand-rainbow-bg h-[3px] w-6 flex-none rounded-full"
      />
      <span className="font-mono text-meta font-semibold uppercase tracking-[0.12em] text-brand-action">
        {children}
      </span>
    </div>
  );
}
