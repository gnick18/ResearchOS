import type { Metadata } from "next";
import Link from "next/link";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Kicker from "@/components/marketing/Kicker";
import { Icon } from "@/components/icons";
import ContributeWizard from "@/components/library/ContributeWizard";

/** When on, the live wizard renders; otherwise the "coming soon" placeholder. */
const CONTRIBUTE_ENABLED =
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "true";

/**
 * Public `/library/contribute` route. Placeholder for the contribution wizard
 * (Part 3 of docs/proposals/2026-06-15-asset-library-portal-landing-contribution.md):
 * single + bulk SVG upload, a license affirmation limited to open licenses, and
 * spreadsheet-style bulk tagging + citation tagging. Submissions auto-publish
 * flagged "unverified for accuracy" and are checked by independent reviewers
 * (the submitter cannot clear their own flag).
 *
 * The page exists now so the landing's "Contribute" call to action resolves and
 * the IA is visible; the wizard itself lands with Part 3.
 */
export const metadata: Metadata = {
  title: "Contribute an icon",
  description:
    "Add your own scientific icons to the open library under an open license, with tags and a citation. Bulk upload and bulk tagging make a whole set quick.",
};

const STEPS: { title: string; body: string }[] = [
  {
    title: "Upload one or many",
    body: "Drag in a single SVG or a whole folder. Each is previewed and sanitized before anything is stored.",
  },
  {
    title: "License and rights",
    body: "Affirm you hold the rights and pick an open license. Only CC0, CC-BY, and CC-BY-SA are offered, never non-commercial or no-derivatives.",
  },
  {
    title: "Tag and cite in bulk",
    body: "A spreadsheet-style grid lets you set the title, category, tags, creator, and citation across a whole selection at once, then tweak any single icon.",
  },
  {
    title: "Community review",
    body: "Your icons go live flagged unverified for accuracy until an independent researcher checks them. You cannot clear your own flag.",
  },
];

export default function ContributePage() {
  return CONTRIBUTE_ENABLED ? <ContributeWizard /> : <ContributePlaceholder />;
}

function ContributePlaceholder() {
  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />
      <section className="relative overflow-hidden">
        <MarketingBackdrop tone="vivid" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 pb-14 pt-16 text-center sm:pt-24">
          <div className="flex justify-center">
            <Kicker>Contribute</Kicker>
          </div>
          <h1 className="mx-auto mt-4 max-w-2xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            Add your icons to the open library.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-lg text-foreground-muted">
            The contribution wizard is on the way. It will make it easy to upload
            a whole set, license it openly, and tag and cite it in bulk, so the
            library grows with work the whole community can use.
          </p>
          <div className="mt-8 flex justify-center">
            <Link
              href="/library"
              className="inline-flex items-center gap-2 rounded-full border border-border-strong px-5 py-2.5 text-sm font-semibold transition hover:border-brand-action"
            >
              <Icon name="chevronLeft" className="h-4 w-4" /> Back to the library
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-4xl px-6 py-14">
          <h2 className="text-2xl font-bold tracking-tight">How it will work</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="rounded-2xl border border-border bg-surface-raised/70 p-5"
              >
                <div className="flex items-center gap-2 text-brand-action">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-action/10 text-meta font-bold">
                    {i + 1}
                  </span>
                  <span className="font-semibold text-foreground">{s.title}</span>
                </div>
                <p className="mt-2 text-meta text-foreground-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
