"use client";

// sequence editor master (Phase B). Restriction hero: the cut, the compatible
// ends, and internal sites. The restriction user's question is "do my ends match,
// in what orientation, and will the enzyme also chew up my insert." We draw the
// textbook staggered-strand seam per junction (overhang bases offset on the
// top/bottom strands, then sealed), and surface the #1 restriction footgun, an
// enzyme that ALSO cuts inside the intended product, via the cheap pieces-per-
// fragment proxy. Pure presentation; geometry + the proxy live in
// cloning-hero-helpers.
//
// No emojis (inline SVG only), no em-dashes, no mid-sentence colons.

import type { LigationProduct, DsPiece } from "@/lib/sequences/cut-ligate";
import {
  stickyEndSeam,
  internalSiteFlags,
} from "@/lib/sequences/cloning-hero-helpers";

function WarnIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

const KIND_LABEL: Record<"blunt" | "5'" | "3'", string> = {
  blunt: "blunt",
  "5'": "5' overhang",
  "3'": "3' overhang",
};

interface Props {
  product: LigationProduct;
  /** The kept pieces from the digest, for the internal-site proxy + cut summary. */
  pieces: DsPiece[];
  enzymeNames: string[];
}

export default function StickyEndLadderHero({ product, pieces, enzymeNames }: Props) {
  const junctions = product.junctions ?? [];
  const flags = internalSiteFlags(pieces);

  return (
    <section
      className="rounded-md border border-border bg-surface-sunken/60 p-3"
      aria-label="Sticky ends and cut sites"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
          Sticky-end seams ({junctions.length})
        </h4>
        {enzymeNames.length > 0 ? (
          <span className="text-meta text-foreground-muted">
            {enzymeNames.join(", ")}
          </span>
        ) : null}
      </div>

      {junctions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {junctions.map((jn, i) => {
            const seam = stickyEndSeam(jn.kind, jn.overhang, 2);
            return (
              <div key={i} className="rounded-md border border-border bg-surface-raised p-2">
                <div className="mb-1 text-meta text-foreground-muted">
                  Junction {i + 1} · {KIND_LABEL[jn.kind]}
                </div>
                <div className="rounded bg-surface-sunken px-2 py-1 font-mono text-meta leading-tight text-foreground">
                  <div className="whitespace-pre">
                    <span className="text-foreground-muted">5&apos; </span>
                    {seam.top}
                    <span className="text-foreground-muted"> 3&apos;</span>
                  </div>
                  <div className="whitespace-pre">
                    <span className="text-foreground-muted">3&apos; </span>
                    {seam.bottom}
                    <span className="text-foreground-muted"> 5&apos;</span>
                  </div>
                </div>
                {jn.kind !== "blunt" ? (
                  <div className="mt-1 text-center font-mono text-meta font-medium text-sky-700 dark:text-sky-300">
                    {jn.overhang}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-meta text-foreground-muted">No sealed junctions to show.</p>
      )}

      {/* Internal-site warning (the restriction footgun), via the proxy. */}
      {flags.length > 0 ? (
        <div className="mt-2.5 flex items-start gap-1.5 rounded bg-amber-50 dark:bg-amber-500/15 px-2 py-1.5 text-meta text-amber-700 dark:text-amber-300">
          <WarnIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The enzyme cut{" "}
            {flags
              .map((f) => `"${f.sourceName}" into ${f.pieces} pieces`)
              .join(", ")}
            . An internal site may chew up the intended product. Check the cut map.
          </span>
        </div>
      ) : null}
    </section>
  );
}
