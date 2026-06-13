/**
 * Published-tree reproduction visual for the /transparency page.
 *
 * Shows that the Tree Builder's GENERATED recipe, run offline on a real paper's
 * input, recovers that paper's published tree. When a case is ready it renders
 * the two trees side by side (our result and the published tree), the headline
 * numbers (topology agreement from normalized Robinson-Foulds, and percent of
 * published clades recovered), and a list of the specific branches that differ,
 * so a small RF reads as "agrees except at a few nodes", not a silent miss.
 *
 * While a case is pending (no offline run, or no published tree sourced yet) it
 * renders a calm, honest pending state instead of a broken figure.
 *
 * No new inline SVG (the page rule): the trees are drawn by lib/phylo/render.ts
 * (renderTreeSvg, already in the icon baseline) and injected as a string, exactly
 * like PhyloEmbed. Everything else is text and proportion bars.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { useMemo } from "react";

import { parseTree } from "@/lib/phylo/parse";
import { renderTreeSvg, type RenderSpec } from "@/lib/phylo/render";

interface Props {
  pending: boolean;
  pendingReason: string | null;
  source: string;
  citation: string;
  recipeSummary: string;
  toolVersions: string | null;
  sharedTaxa: number;
  rf: number;
  maxRf: number;
  normalizedRf: number;
  cladesRecovered: number;
  cladesTotal: number;
  percentRecovered: number;
  mode: "support" | "rf";
  pass: boolean;
  rfTolerance: number | null;
  supportCutoff: number;
  wellSupportedMissed: number;
  weaklySupportedMissed: number;
  maxMissingSupport: number | null;
  missingFromOurs: string[][];
  missingSupports: (number | null)[];
  extraInOurs: string[][];
  oursNewick: string | null;
  publishedNewick: string | null;
}

/** A 0..1 proportion as a labeled bar (green = good). */
function ProportionBar({ label, value, display }: { label: string; value: number; display: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between text-meta">
        <span className="text-foreground-muted">{label}</span>
        <span className="font-mono text-foreground">{display}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** A minimal rectangular phylogram spec, support values on, no metadata tracks. */
function reproSpec(width: number, height: number): RenderSpec {
  return {
    layout: "rectangular",
    phylogram: true,
    tracks: {
      labels: true,
      labelsItalic: false,
      points: false,
      strip: false,
      bars: false,
      heat: false,
      clade: false,
      support: true,
    },
    columns: {},
    width,
    height,
  };
}

/** Render a Newick string to an SVG figure, or "" if it does not parse. */
function useTreeSvg(newick: string | null): string {
  return useMemo(() => {
    if (!newick) return "";
    try {
      return renderTreeSvg(parseTree(newick), reproSpec(360, 420));
    } catch {
      return "";
    }
  }, [newick]);
}

/** Render one differing-branch side as a readable "{tip, tip, ...}" clade. */
function cladeText(side: string[]): string {
  const shown = side.slice(0, 6).join(", ");
  return side.length > 6 ? `{${shown}, +${side.length - 6} more}` : `{${shown}}`;
}

export default function PhyloPublished(props: Props) {
  const oursSvg = useTreeSvg(props.oursNewick);
  const publishedSvg = useTreeSvg(props.publishedNewick);

  if (props.pending) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-sunken p-4">
        <div className="mb-1 text-meta font-semibold text-foreground-muted">
          Reproduction pending
        </div>
        <p className="text-meta text-foreground-muted">
          {props.pendingReason
            ?? "This case activates once its offline recipe run is committed."}
        </p>
        <p className="mt-2 text-meta text-foreground-muted">
          Source: {props.source}. Recipe: {props.recipeSummary}.
        </p>
        <p className="mt-1 text-meta text-foreground-muted">{props.citation}</p>
      </div>
    );
  }

  const topologyAgreement = 1 - props.normalizedRf;
  const anyDiff = props.missingFromOurs.length > 0 || props.extraInOurs.length > 0;
  const verdictPass = props.pass;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <figure className="rounded-lg border border-border bg-surface-sunken p-3">
          <figcaption className="mb-2 text-meta font-semibold text-foreground-muted">
            Our recipe result
          </figcaption>
          {oursSvg ? (
            <div
              className="w-full overflow-hidden rounded-md border border-border bg-white [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: oursSvg }}
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-meta text-foreground-muted">
              Tree did not render.
            </div>
          )}
        </figure>
        <figure className="rounded-lg border border-border bg-surface-sunken p-3">
          <figcaption className="mb-2 text-meta font-semibold text-foreground-muted">
            Published tree
          </figcaption>
          {publishedSvg ? (
            <div
              className="w-full overflow-hidden rounded-md border border-border bg-white [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: publishedSvg }}
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-meta text-foreground-muted">
              Tree did not render.
            </div>
          )}
        </figure>
      </div>

      <div className="rounded-lg border border-border bg-surface-sunken p-3">
        <div className="mb-3 text-meta font-semibold text-foreground-muted">
          Reproduction agreement ({props.sharedTaxa} shared taxa)
        </div>
        <div
          className={`mb-4 rounded-md border px-3 py-2 text-meta ${
            verdictPass
              ? "border-emerald-500/40 bg-emerald-500/10 text-foreground"
              : "border-amber-500/40 bg-amber-500/10 text-foreground"
          }`}
        >
          {props.mode === "support" ? (
            verdictPass ? (
              <>
                Recovered <span className="font-semibold">every well-supported clade</span> in
                the published tree (support at or above {props.supportCutoff}).
                {props.weaklySupportedMissed > 0
                  ? ` The ${props.weaklySupportedMissed} branches that differ are all weakly`
                    + ` supported (highest ${props.maxMissingSupport ?? 0}), the expected churn`
                    + ` among near-identical taxa.`
                  : ""}
              </>
            ) : (
              <>
                Missed {props.wellSupportedMissed} published{" "}
                {props.wellSupportedMissed === 1 ? "clade" : "clades"} with support at or above{" "}
                {props.supportCutoff}, listed below.
              </>
            )
          ) : verdictPass ? (
            <>
              Recovered the <span className="font-semibold">published topology</span> within
              tolerance (normalized RF {props.normalizedRf.toFixed(4)} at or below{" "}
              {props.rfTolerance}). This tree carries no branch support, so the case is scored
              by Robinson-Foulds distance rather than the support-aware rule.
            </>
          ) : (
            <>
              Normalized RF {props.normalizedRf.toFixed(4)} exceeds this case&apos;s tolerance of{" "}
              {props.rfTolerance}; the differing branches are listed below.
            </>
          )}
        </div>
        <div className="space-y-4">
          {props.mode === "support" ? (
            <ProportionBar
              label={`Well-supported clades recovered (support >= ${props.supportCutoff})`}
              value={1}
              display={verdictPass ? "all" : `${props.wellSupportedMissed} missed`}
            />
          ) : (
            <ProportionBar
              label={`Topology agreement (1 minus normalized RF, tolerance ${props.rfTolerance})`}
              value={topologyAgreement}
              display={topologyAgreement.toFixed(4)}
            />
          )}
          <ProportionBar
            label="All published clades recovered"
            value={props.cladesTotal > 0 ? props.cladesRecovered / props.cladesTotal : 1}
            display={`${props.percentRecovered.toFixed(1)}% (${props.cladesRecovered}/${props.cladesTotal})`}
          />
          <p className="text-meta text-foreground-muted">
            Topology agreement {topologyAgreement.toFixed(4)} (Robinson-Foulds distance{" "}
            {props.rf} of a possible {props.maxRf}).{" "}
            {props.mode === "support"
              ? "We gate on recovering every well-supported clade rather than on raw RF, because maximum-likelihood search leaves near-identical taxa in low-support branches that differ run to run."
              : "We gate on the normalized RF against a committed tolerance, because this published tree carries no branch support to confine differences to."}{" "}
            The differing branches are listed below so the raw RF reads honestly.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface-sunken p-3">
        <div className="mb-2 text-meta font-semibold text-foreground-muted">
          Branches that differ
        </div>
        {!anyDiff ? (
          <p className="text-meta text-foreground-muted">
            None. Our result recovers every clade in the published tree.
          </p>
        ) : (
          <div className="space-y-2 text-meta text-foreground-muted">
            {props.missingFromOurs.length > 0 ? (
              <div>
                <span className="font-semibold">
                  In the published tree, not ours (with published support):
                </span>
                <ul className="mt-1 space-y-0.5">
                  {props.missingFromOurs.map((side, i) => {
                    const sup = props.missingSupports[i];
                    return (
                      <li key={`m-${side.join("|")}`} className="font-mono text-foreground">
                        <span className="text-foreground-muted">
                          [support {sup === null || sup === undefined ? "n/a" : sup}]
                        </span>{" "}
                        {cladeText(side)}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {props.extraInOurs.length > 0 ? (
              <div>
                <span className="font-semibold">In our result, not the published tree:</span>
                <ul className="mt-1 space-y-0.5">
                  {props.extraInOurs.map((side) => (
                    <li key={`e-${side.join("|")}`} className="font-mono text-foreground">
                      {cladeText(side)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <p className="text-meta text-foreground-muted">
        Recipe: {props.recipeSummary}.
        {props.toolVersions ? ` Run with ${props.toolVersions}.` : ""} {props.citation}
      </p>
    </div>
  );
}
