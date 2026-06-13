/**
 * Phylogenetics visual for the /transparency page.
 *
 * Shows the side-by-side proof that our native /phylo tree layout matches
 * ggtree, the metric numbers (tip-order and depth agreement) plus the committed
 * ggtree reference figure. The claim is honest: the two figures are close in
 * shape and ordering, not pixel-identical, so the copy says exactly that.
 *
 * Until the offline ggtree run lands, ggtreeFigure is null and we render a calm
 * pending state instead of a broken image. No new inline SVG (the page rule):
 * the reference figure is a committed PNG and everything else is text + bars.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

interface Props {
  ggtreeFigure: string | null;
  matchedTips: number;
  ourTips: number;
  tipOrderAgreement: number;
  depthAgreement: number;
  pending: boolean;
}

/** A 0..1 agreement value as a labeled proportion bar. */
function AgreementBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between text-meta">
        <span className="text-foreground-muted">{label}</span>
        <span className="font-mono text-foreground">{value.toFixed(4)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function PhyloFigures({
  ggtreeFigure,
  matchedTips,
  ourTips,
  tipOrderAgreement,
  depthAgreement,
  pending,
}: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-border bg-surface-sunken p-3">
        <div className="mb-2 text-meta font-semibold text-foreground-muted">
          ggtree reference figure
        </div>
        {pending || !ggtreeFigure ? (
          <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-meta text-foreground-muted">
            Pending. The ggtree figure is rendered offline by
            gen-phylo-ggtree-golden.R and committed here once the R run lands.
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ggtreeFigure}
            alt="ggtree rendering of the same tree"
            className="w-full rounded-md border border-border bg-white"
          />
        )}
      </div>

      <div className="rounded-lg border border-border bg-surface-sunken p-3">
        <div className="mb-3 text-meta font-semibold text-foreground-muted">
          Layout agreement
        </div>
        {pending ? (
          <p className="text-meta text-foreground-muted">
            These numbers activate once the committed ggtree golden is real (not
            the shipped placeholder). Our layout still computes; it is the
            reference that is pending.
          </p>
        ) : (
          <div className="space-y-4">
            <AgreementBar
              label="Tip-order agreement (abs Spearman)"
              value={tipOrderAgreement}
            />
            <AgreementBar
              label="Depth agreement (normalized Pearson)"
              value={depthAgreement}
            />
            <p className="text-meta text-foreground-muted">
              {matchedTips} of {ourTips} tips matched by label. A value near 1.0
              means our tree and ggtree's draw the tips in the same order and put
              every node at the same relative branch-length depth. This is shape
              and ordering agreement, not pixel parity.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
