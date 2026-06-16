/**
 * "How we would price it" cost-math transparency on /pricing. The cold / hot
 * optimization diagram (CSS-div bars, not SVG) shows that almost all synced data
 * rests in cheap cold storage with only a thin hot layer, blending to ~$0.05 per
 * GB per month. A plain-English "what this means for you" panel sits beside it.
 *
 * NOTE: the per-individual usage wizard was deliberately removed, do not add it.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import {
  BLENDED_COLD_SHARE,
  COLD_PER_GB_MO,
  HOT_PER_GB_MO,
} from "@/lib/pricing/assumptions";

interface CostMathProps {
  billingEnabled: boolean;
}

export default function CostMath({ billingEnabled }: CostMathProps) {
  const coldPct = Math.round(BLENDED_COLD_SHARE * 100);
  const hotPct = 100 - coldPct;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Optimization diagram */}
        <div className="rounded-2xl border border-border bg-surface-raised p-5">
          <h4 className="mb-3.5 text-sm font-extrabold text-foreground">
            How we keep the cost tiny
          </h4>

          <div className="mb-3.5">
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px]">
              <b className="font-bold text-foreground">Cold storage, Cloudflare R2</b>
              <span className="tabular-nums text-foreground-muted">
                ${COLD_PER_GB_MO} / GB / mo
              </span>
            </div>
            <div className="h-3.5 overflow-hidden rounded-md bg-surface-sunken">
              <div
                className="pricing-bar-grow h-full rounded-md bg-green-600 dark:bg-green-500"
                style={{ width: `${coldPct}%` }}
              />
            </div>
          </div>

          <div className="mb-3.5">
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px]">
              <b className="font-bold text-foreground">Active sync layer, hot</b>
              <span className="tabular-nums text-foreground-muted">
                ${HOT_PER_GB_MO} / GB / mo
              </span>
            </div>
            <div className="h-3.5 overflow-hidden rounded-md bg-surface-sunken">
              <div
                className="pricing-bar-grow pricing-bar-grow-delay h-full rounded-md bg-brand-action"
                style={{ width: `${hotPct}%` }}
              />
            </div>
          </div>

          <p className="mt-3.5 border-t border-dashed border-border pt-3.5 text-[12.5px] leading-relaxed text-foreground-muted">
            Almost all of your synced data rests in cheap cold storage, with only
            a thin active layer on the faster, pricier tier. That blend puts our
            all-in cost near <b className="text-foreground">$0.05 per GB per month</b>,
            far below either tier on its own. Local-first is why, your everyday
            work never leaves your disk, so little ever needs the hot layer.
          </p>
        </div>

        {/* What this means for you */}
        <div className="rounded-2xl border border-border bg-surface-raised p-5">
          <h4 className="mb-3.5 text-sm font-extrabold text-foreground">
            What this means for you
          </h4>
          <p className="mb-2.5 text-[12.5px] leading-relaxed text-foreground-muted">
            Most individual researchers never pay. The free 5 GB pool covers
            typical note and image sharing, so you stay on Free. Share a lot of
            large datasets and it is a few dollars a month, never charged per
            keystroke.
          </p>
          <p className="mb-2.5 text-[12.5px] leading-relaxed text-foreground-muted">
            Labs pool that free tier across the whole team. Departments and
            institutions use the builders above, where the same blended cost
            scales up, plus a small sustaining contribution that keeps all of this
            free for the individual researchers.
          </p>
          <p className="text-[11.5px] leading-snug text-foreground-muted">
            {billingEnabled
              ? "An estimate, not a final price. Tax is added on top only where the LLC is registered to collect it, which for most universities is nowhere."
              : "An estimate, not a final price, and free today during the beta. Tax is added on top only where the LLC is registered to collect it, which for most universities is nowhere."}
          </p>
        </div>
      </div>
    </div>
  );
}
