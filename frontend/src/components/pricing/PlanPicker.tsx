"use client";

/**
 * The plan picker on /pricing. A four-segment toggle (For individuals / For labs
 * / For departments / For institutions). Individuals and Labs show fixed
 * Free/Plus/Pro cards (Free highlighted "Recommended" in green, Plus and Pro
 * show "Low monthly price" with no figure since those are still provisional).
 * Departments and Institutions show the interactive plan builders.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useState } from "react";

import { Icon } from "@/components/icons";

import DepartmentBuilder from "./DepartmentBuilder";
import InstitutionBuilder from "./InstitutionBuilder";

type Segment = "ind" | "lab" | "dept" | "inst";

interface PlanCard {
  name: string;
  ribbon: { label: string; tone: "rec" | "soft" };
  price: { figure: string; per?: string };
  priceNote: string;
  feats: string[];
  cta: { label: string; primary: boolean; href?: string };
}

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "ind", label: "For individuals" },
  { id: "lab", label: "For labs" },
  { id: "dept", label: "For departments" },
  { id: "inst", label: "For institutions" },
];

const INDIVIDUAL_PLANS: PlanCard[] = [
  {
    name: "Free",
    ribbon: { label: "Recommended", tone: "rec" },
    price: { figure: "$0", per: " /mo" },
    priceNote: "A real working tier, not a trial.",
    feats: [
      "~1.6 million free AI tokens to start, a one-time sign-up gift (about 15 tasks or 30-plus quick questions)",
      "5 GB of shared-document storage",
      "A generous editing allowance",
      "Everything in the app, no features held back",
      "Your local notebook stays free either way",
    ],
    cta: { label: "Start free", primary: true, href: "/" },
  },
  {
    name: "Plus",
    ribbon: { label: "Coming at launch", tone: "soft" },
    price: { figure: "Low monthly price" },
    priceNote: "Price set after the beta, see the note below.",
    feats: [
      "More storage for people who share a lot",
      "A higher editing allowance",
      "Everything in Free, with more room",
    ],
    cta: { label: "Notify me at launch", primary: false },
  },
  {
    name: "Pro",
    ribbon: { label: "Coming at launch", tone: "soft" },
    price: { figure: "Low monthly price" },
    priceNote: "Price set after the beta, see the note below.",
    feats: [
      "The most storage for heavy collaborators",
      "The highest editing allowance",
      "Same cost-recovery pricing",
    ],
    cta: { label: "Notify me at launch", primary: false },
  },
];

const LAB_PLANS: PlanCard[] = [
  {
    name: "Lab Free",
    ribbon: { label: "Recommended", tone: "rec" },
    price: { figure: "$0", per: " /mo" },
    priceNote: "A shared pool for the whole lab.",
    feats: [
      "~1.6 million free AI tokens for every member to start, a one-time sign-up gift (about 15 tasks each)",
      "5 GB pooled across the whole lab",
      "Real-time co-editing for the team",
      "Only the PI sets it up, members never enter a card",
    ],
    cta: { label: "Start your lab free", primary: true, href: "/" },
  },
  {
    name: "Lab Plus",
    ribbon: { label: "Coming at launch", tone: "soft" },
    price: { figure: "Low monthly price" },
    priceNote: "Price set after the beta, see the note below.",
    feats: [
      "A larger shared pool, pooled across everyone",
      "A higher pooled editing allowance",
      "One invoice, only the PI pays",
    ],
    cta: { label: "Notify me at launch", primary: false },
  },
  {
    name: "Lab Pro",
    ribbon: { label: "Coming at launch", tone: "soft" },
    price: { figure: "Low monthly price" },
    priceNote: "Price set after the beta, see the note below.",
    feats: [
      "The largest shared pool for big or busy labs",
      "The highest pooled editing allowance",
      "Still one invoice, still cost-recovery",
    ],
    cta: { label: "Notify me at launch", primary: false },
  },
];

interface PlanPickerProps {
  billingEnabled: boolean;
}

export default function PlanPicker({ billingEnabled }: PlanPickerProps) {
  const [seg, setSeg] = useState<Segment>("ind");

  return (
    <div>
      <div className="mb-6 text-center">
        <div
          role="tablist"
          aria-label="Choose a plan audience"
          className="inline-flex flex-wrap justify-center gap-1 rounded-xl border border-border bg-surface-sunken p-1 ros-seg-track"
        >
          {SEGMENTS.map((s) => {
            const active = seg === s.id;
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={active}
                onClick={() => setSeg(s.id)}
                className={`rounded-lg px-4 py-1.5 text-[13px] font-bold transition-colors ${
                  active
                    ? "bg-surface-raised text-foreground ros-seg-active"
                    : "text-foreground-muted hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {seg === "ind" ? <PlanCards plans={INDIVIDUAL_PLANS} /> : null}
      {seg === "lab" ? <PlanCards plans={LAB_PLANS} /> : null}
      {seg === "dept" ? <DepartmentBuilder billingEnabled={billingEnabled} /> : null}
      {seg === "inst" ? <InstitutionBuilder billingEnabled={billingEnabled} /> : null}
    </div>
  );
}

function PlanCards({ plans }: { plans: PlanCard[] }) {
  return (
    <div className="mx-auto grid max-w-4xl grid-cols-1 gap-3.5 sm:grid-cols-3">
      {plans.map((p) => {
        const featured = p.ribbon.tone === "rec";
        return (
          <div
            key={p.name}
            className={`flex flex-col rounded-2xl border bg-surface-raised p-5 ${
              featured
                ? "border-green-600 ring-1 ring-green-600 dark:border-green-500 dark:ring-green-500"
                : "border-border"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-extrabold text-foreground">
              {p.name}
              <span
                className={`rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide ${
                  p.ribbon.tone === "rec"
                    ? "bg-green-600 text-white dark:bg-green-500"
                    : "bg-brand-action/[0.13] text-brand-action"
                }`}
              >
                {p.ribbon.label}
              </span>
            </div>
            <div className="mb-0.5 mt-3 text-3xl font-extrabold tracking-tight text-brand-ink dark:text-foreground">
              {p.price.figure}
              {p.price.per ? (
                <span className="text-[13px] font-semibold text-foreground-muted">
                  {p.price.per}
                </span>
              ) : null}
            </div>
            <div className="min-h-[30px] text-[11.5px] leading-snug text-foreground-muted">
              {p.priceNote}
            </div>
            <ul className="mt-3.5 flex flex-col gap-2.5">
              {p.feats.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-[12.5px] leading-snug text-foreground"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-green-600/[0.16] text-green-600 dark:text-green-400"
                  >
                    <Icon name="check" className="h-2.5 w-2.5" />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-4">
              {p.cta.primary ? (
                <a
                  href={p.cta.href ?? "/"}
                  className="btn-brand block w-full rounded-xl px-5 py-2.5 text-center text-[13.5px] font-bold"
                >
                  {p.cta.label}
                </a>
              ) : (
                <a
                  href={NOTIFY_MAILTO}
                  className="block w-full rounded-xl border border-border bg-surface-raised px-5 py-2.5 text-center text-[13.5px] font-bold text-foreground transition-colors hover:border-foreground-muted"
                >
                  {p.cta.label}
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const NOTIFY_MAILTO =
  "mailto:gnickles@wisc.edu?subject=" +
  encodeURIComponent("Notify me when ResearchOS paid plans launch") +
  "&body=" +
  encodeURIComponent(
    "Please let me know when the ResearchOS paid storage plans go live.",
  );
