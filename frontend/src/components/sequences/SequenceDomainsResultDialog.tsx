"use client";

// sequence editor master (redesign phase 5). The READ view for a saved DOMAINS
// result artifact. Re-opening a domains artifact from the History tab's Results
// section lists the stored hits exactly as the scan returned them. A snapshot,
// so nothing is recomputed here; the editable protein drawer is where a live
// re-run happens. Icons via <Icon> only (no inline svg); no em-dashes, no mid-
// sentence colons, dark-mode tokens.

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";
import type { DomainsArtifactResult } from "@/lib/sequences/artifacts";

const SOURCE_LABEL: Record<DomainsArtifactResult["source"], string> = {
  ebi: "EBI InterProScan",
  local: "On-device database",
  curated: "Common domains",
};

export default function SequenceDomainsResultDialog({
  result,
  stale,
  onClose,
  onRerun,
}: {
  /** The stored domains payload, or null when closed. */
  result: DomainsArtifactResult | null;
  /** True when the sequence has changed since this result was computed. */
  stale?: boolean;
  /** Close the read view. */
  onClose: () => void;
  /** Re-run the live scan (shown only when stale and a live re-run is wired). */
  onRerun?: () => void;
}) {
  if (!result) return null;

  const hits = result.hits;

  return (
    <LivingPopup open onClose={onClose} label="Domains" selfSize showClose={false}>
      <div
        className="pointer-events-auto relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface-raised ros-popup-card-shadow"
        data-testid="domains-result-dialog"
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-500/15">
            <Icon name="protein" className="h-5 w-5 text-sky-600 dark:text-sky-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-foreground">
              Domains in {result.featureName || "feature"}
            </h2>
            <p className="text-meta text-foreground-muted">
              {hits.length} {hits.length === 1 ? "hit" : "hits"} from{" "}
              {SOURCE_LABEL[result.source]}. Saved result, viewing only.
            </p>
          </div>
          <Tooltip label="Close">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-surface-sunken"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>

        {/* Stale banner */}
        {stale ? (
          <div className="flex items-center gap-2 border-b border-border bg-amber-50 px-5 py-2.5 text-meta text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            <Icon name="hourglass" className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1">
              The sequence changed since this scan ran, so these hits may no longer
              line up.
            </span>
            {onRerun ? (
              <button
                type="button"
                onClick={onRerun}
                className="flex flex-shrink-0 items-center gap-1 rounded-md border border-amber-300 px-2 py-0.5 font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-500/30 dark:text-amber-200 dark:hover:bg-amber-500/20"
              >
                <Icon name="refresh" className="h-3 w-3" />
                Re-run
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Hit list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {hits.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-body text-foreground-muted">
              This scan found no domain hits.
            </div>
          ) : (
            <ul className="space-y-2">
              {hits.map((hit, i) => (
                <li
                  key={`${hit.accession}:${hit.start}:${hit.end}:${i}`}
                  className="rounded-lg border border-border px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-body font-medium text-foreground">
                      {hit.name || hit.accession}
                    </span>
                    <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-meta font-medium text-foreground-muted">
                      {hit.db}
                    </span>
                    <span className="text-meta text-foreground-muted">{hit.accession}</span>
                    <span className="ml-auto text-meta text-foreground-muted tabular-nums">
                      {hit.start.toLocaleString()} to {hit.end.toLocaleString()} aa
                    </span>
                  </div>
                  {hit.description ? (
                    <p className="mt-0.5 text-meta text-foreground-muted">{hit.description}</p>
                  ) : null}
                  {hit.evalue != null || hit.score != null ? (
                    <p className="mt-0.5 text-meta text-foreground-muted tabular-nums">
                      {hit.evalue != null ? `E-value ${hit.evalue.toExponential(1)}` : ""}
                      {hit.evalue != null && hit.score != null ? " · " : ""}
                      {hit.score != null ? `score ${hit.score}` : ""}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </LivingPopup>
  );
}
