"use client";

/**
 * The "For departments" interactive plan builder on /pricing. A department is a
 * container of labs, one plan above several lab pools. Sliders for labs, average
 * members per lab, and adoption, plus the multi-select share-type chips, derive
 * a cost-recovery figure plus a per-active-lab sustaining contribution and show
 * the monthly rate. Numbers and formula mirror the approved mockup exactly.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import { avgPerMemberGB, FREE_GB_PER_LAB } from "@/lib/pricing/assumptions";
import { computeCostRecovery, usd } from "@/lib/pricing/cost-math";

import ShareTypeChips from "./ShareTypeChips";
import SliderRow from "./SliderRow";

const MAILTO =
  "mailto:?subject=" +
  encodeURIComponent("ResearchOS department plan") +
  "&body=" +
  encodeURIComponent(
    "We are looking at ResearchOS for our department. Here is the plan estimate from research-os.app/pricing.",
  );

interface DepartmentBuilderProps {
  billingEnabled: boolean;
}

export default function DepartmentBuilder({ billingEnabled }: DepartmentBuilderProps) {
  const [labs, setLabs] = useState(8);
  const [members, setMembers] = useState(6);
  const [adopt, setAdopt] = useState(60);
  // Default selection: "Images, gels, microscopy" (index 1), matching the mockup.
  const [shareTypes, setShareTypes] = useState<number[]>([1]);

  const d = useMemo(() => {
    const perMemberGB = avgPerMemberGB(shareTypes);
    const A = adopt / 100;
    const active = labs * members * A;
    const activeLabs = labs * A;
    const storage = active * perMemberGB;
    const free = labs * FREE_GB_PER_LAB;
    const { billableGB, recovery, sustain, rate } = computeCostRecovery({
      storageGB: storage,
      freeGB: free,
      activeLabs,
    });
    return {
      active: Math.round(active),
      storage: Math.round(storage),
      free,
      bill: Math.round(billableGB),
      recovery,
      sustain,
      rate,
      coversLabs: Math.max(1, Math.round(activeLabs)),
    };
  }, [labs, members, adopt, shareTypes]);

  return (
    <div>
      <p className="mx-auto mb-4 max-w-2xl text-center text-[13px] leading-relaxed text-foreground-muted">
        A department is a container of labs, one plan above several lab pools.
        Build yours from your own numbers below. It bills as a single automatic
        invoice to your procurement office, and you can change the amount any
        month, no lock-in and no annual contract.
      </p>
      <div className="mx-auto max-w-3xl">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Inputs */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5">
            <h4 className="mb-4 text-sm font-extrabold text-foreground">
              Tell us about your department
            </h4>
            <SliderRow
              label="Labs, the PIs in the department"
              value={labs}
              min={2}
              max={60}
              ariaLabel="Number of labs"
              onChange={setLabs}
            />
            <SliderRow
              label="Average members per lab"
              value={members}
              min={2}
              max={30}
              ariaLabel="Average members per lab"
              onChange={setMembers}
            />
            <SliderRow
              label="Estimated adoption"
              value={adopt}
              display={`${adopt}%`}
              min={10}
              max={100}
              step={5}
              ariaLabel="Estimated adoption"
              onChange={setAdopt}
            />
            <ShareTypeChips selected={shareTypes} onChange={setShareTypes} />
          </div>

          {/* Output */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5">
            <h4 className="mb-4 text-sm font-extrabold text-foreground">
              Your department plan
            </h4>
            <CalcRow label="Active members covered" value={String(d.active)} />
            <CalcRow label="Estimated department storage" value={`~${d.storage} GB`} />
            <CalcRow
              label={`Free across ${labs} lab pools`}
              value={`${d.free} GB`}
            />
            <CalcRow label="Billable storage at ~$0.05/GB" value={`${d.bill} GB`} />
            <CalcRow label="Our bare cost to run it" value={usd(d.recovery)} />
            <CalcRow
              label="Sustaining contribution, keeps it free for individual researchers"
              value={usd(d.sustain)}
            />
            <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-border pt-3 text-foreground">
              <span className="text-[12.5px]">Your department rate</span>
              <span>
                <span className="text-[23px] font-extrabold tabular-nums text-brand-ink dark:text-foreground">
                  {usd(d.rate)}
                </span>
                <span className="text-[13px] font-semibold text-foreground-muted">
                  {" "}
                  /mo
                </span>
              </span>
            </div>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-purple/[0.13] px-3.5 py-1.5 text-[12px] font-extrabold text-brand-purple">
              <span className="h-2 w-2 flex-none rounded-full bg-brand-purple" />
              <span>Covers about {d.coversLabs} active labs</span>
            </div>
            <div className="mt-4">
              <a href={MAILTO} className="btn-brand inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-[13.5px] font-bold">
                <Icon name="mail" className="h-4 w-4" />
                Email this plan to your department
              </a>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-snug text-foreground-muted">
              Departments and institutions pay a small sustaining rate above our
              bare cost. That surplus keeps ResearchOS free for individual
              researchers and funds the open-source development, and it is still a
              fraction of what you pay per seat elsewhere. One automatic recurring
              invoice to your procurement office on net terms, or a card or bank
              account on file, change it any month, no lock-in. Paying by bank
              transfer costs a little less because it costs us less to process. An
              estimate, not a final price{billingEnabled ? "." : ", and free during the beta."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CalcRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-[12.5px] text-foreground-muted">
      <span className="min-w-0 shrink">{label}</span>
      <b className="shrink-0 font-semibold tabular-nums text-foreground">{value}</b>
    </div>
  );
}
