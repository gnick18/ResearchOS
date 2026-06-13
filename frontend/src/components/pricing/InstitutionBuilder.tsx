"use client";

/**
 * The "For institutions" interactive plan builder on /pricing. An institution is
 * a container of departments, the department model one level up. Sliders for
 * departments, average labs per department, and adoption, plus the share-type
 * chips, derive the same cost-recovery plus per-active-lab sustaining figure.
 * It assumes a fixed average members per lab. Below the builder, a self-serve
 * trust packet (HECVAT, security one-pager, open-source, standard agreement)
 * plus the local-first / end-to-end-encrypted callout. Numbers and formula
 * mirror the approved mockup exactly.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useMemo, useState } from "react";

import { Icon } from "@/components/icons";
import {
  AVG_MEMBERS_PER_LAB,
  avgPerMemberGB,
  FREE_GB_PER_LAB,
} from "@/lib/pricing/assumptions";
import { computeCostRecovery, usd } from "@/lib/pricing/cost-math";

import ShareTypeChips from "./ShareTypeChips";
import SliderRow from "./SliderRow";

const MAILTO =
  "mailto:?subject=" +
  encodeURIComponent("ResearchOS institution plan for procurement") +
  "&body=" +
  encodeURIComponent(
    "We are evaluating ResearchOS at the institution level. Here is the plan estimate and the self-serve security packet from research-os.app/pricing.",
  );

const TRUST_ITEMS = [
  "Security architecture, one page",
  "Pre-filled HECVAT",
  "Open-source code to audit",
  "Standard agreement",
];

export default function InstitutionBuilder() {
  const [depts, setDepts] = useState(6);
  const [labsPer, setLabsPer] = useState(8);
  const [adopt, setAdopt] = useState(50);
  const [shareTypes, setShareTypes] = useState<number[]>([1]);

  const i = useMemo(() => {
    const perMemberGB = avgPerMemberGB(shareTypes);
    const A = adopt / 100;
    const totalLabs = depts * labsPer;
    const activeLabs = totalLabs * A;
    const activeMembers = activeLabs * AVG_MEMBERS_PER_LAB;
    const storage = activeMembers * perMemberGB;
    const free = totalLabs * FREE_GB_PER_LAB;
    const { billableGB, recovery, sustain, rate } = computeCostRecovery({
      storageGB: storage,
      freeGB: free,
      activeLabs,
    });
    return {
      totalLabs,
      active: Math.round(activeMembers),
      storage: Math.round(storage),
      free,
      bill: Math.round(billableGB),
      recovery,
      sustain,
      rate,
      coversDepts: Math.max(1, Math.round(depts * A)),
      coversLabs: Math.max(1, Math.round(activeLabs)),
    };
  }, [depts, labsPer, adopt, shareTypes]);

  return (
    <div>
      <p className="mx-auto mb-4 max-w-2xl text-center text-[13px] leading-relaxed text-foreground-muted">
        An institution is a container of departments, the same model one more
        level up. The estimate and the invoice stay automated. The only
        normally-manual part, the security review and the agreement, is a
        self-serve packet you hand to procurement. Standard terms, no sales call.
      </p>
      <div className="mx-auto max-w-3xl">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Inputs */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5">
            <h4 className="mb-4 text-sm font-extrabold text-foreground">
              Tell us about your institution
            </h4>
            <SliderRow
              label="Departments"
              value={depts}
              min={2}
              max={40}
              ariaLabel="Number of departments"
              onChange={setDepts}
            />
            <SliderRow
              label="Average labs per department"
              value={labsPer}
              min={2}
              max={30}
              ariaLabel="Average labs per department"
              onChange={setLabsPer}
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
              Your institution plan
            </h4>
            <CalcRow label="Total labs across the institution" value={String(i.totalLabs)} />
            <CalcRow label="Active members covered" value={String(i.active)} />
            <CalcRow label="Estimated storage" value={`~${i.storage} GB`} />
            <CalcRow label="Free across all lab pools" value={`${i.free} GB`} />
            <CalcRow label="Billable storage at ~$0.05/GB" value={`${i.bill} GB`} />
            <CalcRow label="Our bare cost to run it" value={usd(i.recovery)} />
            <CalcRow
              label="Sustaining contribution, keeps it free for individual researchers"
              value={usd(i.sustain)}
            />
            <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-border pt-3 text-foreground">
              <span className="text-[12.5px]">Your institution rate</span>
              <span>
                <span className="text-[23px] font-extrabold tabular-nums text-brand-ink dark:text-foreground">
                  {usd(i.rate)}
                </span>
                <span className="text-[13px] font-semibold text-foreground-muted">
                  {" "}
                  /mo
                </span>
              </span>
            </div>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-purple/[0.13] px-3.5 py-1.5 text-[12px] font-extrabold text-brand-purple">
              <span className="h-2 w-2 flex-none rounded-full bg-brand-purple" />
              <span>
                Covers about {i.coversDepts} departments, {i.coversLabs} active labs
              </span>
            </div>
            <div className="mt-4">
              <a href={MAILTO} className="btn-brand inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-[13.5px] font-bold">
                <Icon name="mail" className="h-4 w-4" />
                Send the institution plan to procurement
              </a>
            </div>
            <p className="mt-2.5 text-[11.5px] leading-snug text-foreground-muted">
              Larger institutions pay a sustaining rate above our bare cost. That
              surplus keeps ResearchOS free for individual researchers and funds
              the open-source development, and it is still a small fraction of the
              per-seat licenses you pay elsewhere. One automatic recurring invoice
              on net terms, or a card or bank account on file, no one quotes it by
              hand. Paying by bank transfer costs a little less because it costs us
              less to process. An estimate, not a final price, and free during the
              beta. Assumes about {AVG_MEMBERS_PER_LAB} members per lab.
            </p>
          </div>
        </div>
      </div>

      {/* Self-serve trust packet */}
      <div className="mx-auto mt-4 max-w-3xl border-t border-dashed border-border pt-4">
        <div className="mb-2.5 text-center text-[11px] font-bold uppercase tracking-wide text-foreground-muted">
          Your security review, self-serve
        </div>
        <div className="mb-3 flex flex-wrap justify-center gap-2">
          {TRUST_ITEMS.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-2 rounded-[9px] border border-border bg-surface-raised px-3 py-2 text-[12px] font-semibold text-foreground"
            >
              <span className="h-[7px] w-[7px] flex-none rounded-full bg-green-600 dark:bg-green-400" />
              {item}
            </span>
          ))}
        </div>
        <p className="mx-auto max-w-2xl text-center text-[12.5px] leading-relaxed text-foreground-muted">
          Why the review is easy. We are{" "}
          <b className="text-foreground">local-first and end-to-end encrypted</b>,
          so we hold almost none of your institution&apos;s data, and what we relay
          we cannot read. The code is <b className="text-foreground">open source</b>,
          so your IT office can audit it, and sign-in already works through{" "}
          <b className="text-foreground">Microsoft Entra</b>. A tool that stores
          everyone&apos;s research in one place has a far longer review than one
          that stores almost nothing.
        </p>
      </div>
    </div>
  );
}

function CalcRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px] text-foreground-muted">
      <span>{label}</span>
      <b className="font-semibold tabular-nums text-foreground">{value}</b>
    </div>
  );
}
