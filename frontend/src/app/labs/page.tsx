"use client";

/**
 * The `/labs` page: the public marketing "sell" page for a LAB ACCOUNT, the
 * shared-team tier of ResearchOS (built 2026-06-16 for the BeakerAI/Onboarding
 * lane, whose lab-head disclosure popup links here).
 *
 * It explains what a lab account is to a logged-out visitor, the same way
 * `/ai` and `/pricing` are public sell pages (whitelisted in providers.tsx so a
 * visitor lands here instead of the folder-connect gate). It carries its own
 * MarketingNav + footer and needs no folder.
 *
 * IA:
 *   Hero (badge, headline with a rainbow phrase, the lab-head pitch, CTA)
 *   What a lab unlocks (a grid of the relay features a lab turns on)
 *   The local-first promise still holds (data on each member's disk, E2E, cloud
 *      is only the sync intermediary)
 *   Final CTA (sign in to create a lab) + sponsors + footer
 *
 * PRICING (Grant 2026-06-16): unify the price across /labs, /departments, the
 * payment page, and the chooser. Show the Lab price via the shared
 * <PlanPriceCallout> only, which derives every figure from lib/billing/catalog
 * (MODEL_A_PLANS), so a price change propagates from one place and stays in sync
 * with /pricing. Never hardcode a dollar literal here.
 * An account is REQUIRED to run a lab (no-account local-only mode is retired),
 * so the account is framed as the way in, not as optional.
 *
 * Voice rules: no em-dashes, no emojis (every glyph is <Icon name=...> from the
 * registry), no mid-sentence colons. Contractions OK, state the WHY. BeakerBot
 * is the only mascot. Brand tokens only, never raw hex for new accents.
 */

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";

import BeakerBot from "@/components/BeakerBot";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons/registry";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";
import Reveal from "@/components/marketing/Reveal";
import Kicker from "@/components/marketing/Kicker";
import SponsorStrip from "@/components/SponsorStrip";
import Badge from "@/components/marketing/Badge";
import PlanPriceCallout from "@/components/marketing/PlanPriceCallout";
import { markLandingSeen } from "@/lib/landing/landing-gate";

const RAINBOW = "var(--brand-rainbow)";
const RAINBOW_TEXT = "var(--brand-rainbow-vivid)";

/** A single "what a lab unlocks" feature. */
function FeatureCard({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-[#cfdcec] bg-white p-6 shadow-[0_2px_14px_rgba(15,40,80,0.05)]">
      <span
        aria-hidden
        className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-sky/10 text-brand-action"
      >
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <h3 className="text-title font-extrabold tracking-tight text-brand-ink">
        {title}
      </h3>
      <p className="mt-2 text-body leading-relaxed text-[#475569]">{children}</p>
    </div>
  );
}

/** One line of the local-first promise. */
function PromiseRow({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-4">
      <span
        aria-hidden
        className="mt-0.5 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white text-brand-action shadow-[0_2px_10px_rgba(15,40,80,0.06)]"
      >
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <div>
        <h3 className="text-body font-extrabold tracking-tight text-brand-ink">
          {title}
        </h3>
        <p className="mt-1 text-body leading-relaxed text-[#475569]">
          {children}
        </p>
      </div>
    </div>
  );
}

export default function LabsPage() {
  const router = useRouter();

  // The CTA routes into the app. An account is required to create a lab, so this
  // lands the visitor on the onboarding/sign-in path. markLandingSeen() keeps
  // the first-visit landing from snapping back over them.
  const goStart = () => {
    markLandingSeen();
    router.push("/");
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#fbfcfe] text-brand-ink">
      {/* Thick rainbow ribbon pinned to the very top edge. */}
      <div aria-hidden className="h-2 w-full" style={{ background: RAINBOW }} />

      <MarketingNav />

      <div className="relative">
        {/* HERO */}
        <header className="relative isolate overflow-hidden bg-gradient-to-b from-white to-[#eef4fb] px-6 pb-16 pt-10 text-center sm:px-12">
          <MarketingBackdrop tone="vivid" />
          <Reveal className="relative z-10 mx-auto flex max-w-3xl flex-col items-center">
            <div
              aria-hidden
              className="relative drop-shadow-[0_14px_30px_rgba(26,160,230,0.34)]"
            >
              <BeakerBot
                pose="idle"
                alive
                className="h-24 w-24 text-brand-sky md:h-28 md:w-28"
              />
            </div>

            <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#d3deec] bg-sky-50 px-3.5 py-1.5 text-meta font-semibold text-sky-700">
              <span aria-hidden className="text-brand-sky">
                <Icon name="users" className="h-3.5 w-3.5" />
              </span>
              A lab account in ResearchOS
            </span>

            <h1 className="mt-6 max-w-[20ch] text-[28px] font-extrabold leading-[1.06] tracking-tight text-brand-ink sm:text-4xl md:text-6xl">
              Run your whole lab as{" "}
              <span
                style={{
                  background: RAINBOW_TEXT,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                one shared workspace
              </span>
            </h1>

            <p className="mt-5 max-w-[60ch] text-body leading-relaxed text-[#475569] sm:text-title">
              A lab account makes you the lab head. You create the lab, invite
              your members, and everyone works in one live shared workspace. Sign
              in once to set it up, then your lab stays in sync as you work.
            </p>

            <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3.5 py-1.5 text-meta font-semibold text-green-800">
              <span aria-hidden className="text-green-700">
                <Icon name="check" className="h-3.5 w-3.5" />
              </span>
              90-day free trial, no card required
            </span>

            <p className="mt-3 max-w-[60ch] text-body leading-relaxed text-[#475569] sm:text-title">
              We give the full term, not a token week, because a lab adopts over
              a semester, so you can bring your whole team on and feel the value
              before any money is involved.
            </p>

            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={goStart}
                data-testid="labs-hero-start"
                className="btn-brand inline-flex min-h-[44px] items-center gap-2 px-6 py-3 text-body"
              >
                <Icon name="users" className="h-4 w-4" />
                Create your lab
              </button>
              <Link
                href="/demo"
                data-testid="labs-hero-demo"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#cfdcec] bg-white px-6 py-3 text-body font-semibold text-brand-action shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
              >
                Explore the live demo
                <span aria-hidden>&rarr;</span>
              </Link>
            </div>
          </Reveal>
        </header>

        {/* WHAT A LAB UNLOCKS */}
        <section className="px-6 py-20 sm:px-12">
          <Reveal className="mx-auto max-w-[1040px]">
            <div className="mb-10 text-center">
              <Kicker>{"// what a lab unlocks"}</Kicker>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-4xl">
                One lab, every member, always in sync
              </h2>
              <p className="mx-auto mt-3 max-w-[58ch] text-body leading-relaxed text-[#475569]">
                A lab account turns on the team features. Bring your members into
                one workspace and the relay keeps everyone working off the same
                live records.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard icon="users" title="Invite your members">
                Create the lab, send invites, and your members join one shared
                workspace. You decide who is in.
              </FeatureCard>
              <FeatureCard icon="share" title="Send work across the lab">
                Hand any record to a member in a click. Notes, experiments,
                sequences, and figures move over the relay without email.
              </FeatureCard>
              <FeatureCard icon="pencil" title="Real-time co-editing">
                Two people in the same note or experiment at once, edits showing
                up live, so a hand-off does not mean a stale copy.
              </FeatureCard>
              <FeatureCard icon="phone" title="Capture from any phone">
                The companion app lets a member snap a gel or jot a result at the
                bench and have it land in the lab workspace right away.
              </FeatureCard>
              <FeatureCard icon="eye" title="You lead as the lab head">
                As the PI you get the lab-head controls. See what the lab is
                doing, govern who can reach what, and keep the record in order.
                The lab is yours to run while your members do the work.
              </FeatureCard>
              <FeatureCard icon="folder" title="One shared workspace">
                Every member&apos;s work lives in one place the whole lab can reach, so
                nothing is stranded on one laptop.
              </FeatureCard>
            </div>
          </Reveal>
        </section>

        {/* FEATURED: lab website + paper companion pages */}
        <section className="border-t border-[#d8e3f1] bg-white px-6 py-20 sm:px-12">
          <Reveal className="mx-auto grid max-w-[1040px] gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <Kicker>{"// a home for your science on the web"}</Kicker>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-4xl">
                Your lab gets a site, not just storage
              </h2>
              <p className="mt-4 max-w-[52ch] text-body leading-relaxed text-[#475569] sm:text-title">
                Every paid lab gets a clean web home at your-lab.research-os.com
                and a builder to publish the supplemental data behind your papers.
                Readers and reviewers open citable companion pages with the same
                interactive dataset viewers you use in the app, so your figures
                stay live instead of flattening into a static PDF.
              </p>
              <ul className="mt-6 flex flex-col gap-3">
                <li className="flex items-start gap-3 text-body text-[#475569]">
                  <span aria-hidden className="mt-0.5 text-brand-action">
                    <Icon name="reference" className="h-4 w-4" />
                  </span>
                  <span>
                    A clean lab address you can put on a paper, a poster, or a CV
                  </span>
                </li>
                <li className="flex items-start gap-3 text-body text-[#475569]">
                  <span aria-hidden className="mt-0.5 text-brand-action">
                    <Icon name="figure" className="h-4 w-4" />
                  </span>
                  <span>
                    Citable companion pages, one per paper, that you control
                  </span>
                </li>
                <li className="flex items-start gap-3 text-body text-[#475569]">
                  <span aria-hidden className="mt-0.5 text-brand-action">
                    <Icon name="chart" className="h-4 w-4" />
                  </span>
                  <span>
                    Interactive dataset viewers, the same visualizations from the
                    app, live for your readers
                  </span>
                </li>
              </ul>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[#cfdcec] bg-white shadow-[0_4px_24px_rgba(15,40,80,0.08)]">
              <div className="flex items-center gap-2 border-b border-[#e6eef7] bg-[#f4f8fc] px-4 py-2.5">
                <span aria-hidden className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f0b5b0]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f3d9a4]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#aedcb0]" />
                </span>
                <span className="ml-2 flex-1 truncate rounded-md border border-[#dce6f1] bg-white px-3 py-1 text-meta text-[#64748b]">
                  ramirez-lab.research-os.com
                </span>
              </div>
              <div className="p-5">
                <div className="text-title font-extrabold tracking-tight text-brand-ink">
                  Ramirez Lab
                </div>
                <p className="mt-1 text-meta text-[#64748b]">
                  Supplemental data and paper companion pages
                </p>
                <div className="mt-4 flex flex-col gap-2.5">
                  <div className="flex items-center gap-3 rounded-xl border border-[#e6eef7] bg-[#fafcfe] px-3.5 py-2.5">
                    <span
                      aria-hidden
                      className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-sky/10 text-brand-action"
                    >
                      <Icon name="figure" className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-body font-semibold text-brand-ink">
                        Cohort 2 sequencing
                      </div>
                      <div className="truncate text-meta text-[#94a3b8]">
                        Companion page, Nature Methods 2025
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl border border-[#e6eef7] bg-[#fafcfe] px-3.5 py-2.5">
                    <span
                      aria-hidden
                      className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-sky/10 text-brand-action"
                    >
                      <Icon name="chart" className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-body font-semibold text-brand-ink">
                        Buffer optimization dataset
                      </div>
                      <div className="truncate text-meta text-[#94a3b8]">
                        Interactive viewer, live figures
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* LOCAL-FIRST PROMISE */}
        <section className="border-t border-[#d8e3f1] bg-gradient-to-b from-white to-[#eef4fb] px-6 py-20 sm:px-12">
          <Reveal className="mx-auto grid max-w-[1040px] gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <Kicker>{"// the local-first promise still holds"}</Kicker>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-4xl">
                Shared, without giving up your data
              </h2>
              <p className="mt-4 max-w-[52ch] text-body leading-relaxed text-[#475569] sm:text-title">
                Going from solo to a lab does not move your science onto someone
                else&apos;s server. Each member keeps the local-first promise. The
                cloud is only the intermediary that keeps the team in sync.
              </p>
            </div>

            <div className="flex flex-col gap-6 rounded-2xl border border-[#cfe0f3] bg-white p-7 shadow-[0_4px_24px_rgba(15,40,80,0.06)]">
              <PromiseRow icon="folder" title="Data on each member's own disk">
                Every member&apos;s records live on their own machine, the same as a
                solo workspace. The lab does not pool your files into one server.
              </PromiseRow>
              <PromiseRow icon="lock" title="End to end encrypted in transit">
                When work moves between members, it is encrypted end to end. The
                relay carries sealed data it cannot read.
              </PromiseRow>
              <PromiseRow icon="cloud" title="The cloud only keeps you in sync">
                The cloud is the intermediary that lets two members reach the same
                live record. It is the sync layer, not the home for your science.
              </PromiseRow>
            </div>
          </Reveal>
        </section>

        {/* FINAL CTA */}
        <section className="border-t border-[#d8e3f1] bg-white px-6 py-20 text-center sm:px-12">
          <Reveal className="mx-auto flex max-w-2xl flex-col items-center">
            <div
              aria-hidden
              className="brand-rainbow-bg mb-6 h-1 w-14 rounded-full"
            />
            <BeakerBot
              pose="idle"
              alive
              ariaLabel="BeakerBot"
              className="h-16 w-16 text-brand-sky"
            />
            <h2 className="mt-4 max-w-[20ch] text-3xl font-extrabold leading-[1.08] tracking-tight text-brand-ink md:text-4xl">
              Lead your lab from one workspace
            </h2>
            <p className="mt-4 max-w-[52ch] text-body leading-relaxed text-[#475569] sm:text-title">
              Sign in to create your lab, invite your members, and start working
              off the same live records. You stay the lab head and your members
              keep their data on their own disks.
            </p>
            <div className="mt-7 w-full max-w-md">
              <div className="mb-2">
                <Badge>Founding rate</Badge>
              </div>
              <PlanPriceCallout planId="lab" />
            </div>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={goStart}
                data-testid="labs-cta-start"
                className="btn-brand inline-flex min-h-[44px] items-center gap-2 px-6 py-3 text-body"
              >
                <Icon name="users" className="h-4 w-4" />
                Create your lab
              </button>
              <Link
                href="/pricing"
                data-testid="labs-cta-pricing"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#cfdcec] bg-white px-6 py-3 text-body font-semibold text-brand-action shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
              >
                See what a lab costs
                <span aria-hidden>&rarr;</span>
              </Link>
            </div>
            <p className="mt-6 text-meta text-[#94a3b8]">
              Free and open source at the core. A lab is the shared-team tier.{" "}
              <Link
                href="/pricing"
                className="font-semibold text-brand-action hover:text-brand-ink"
              >
                See the pricing <span aria-hidden>&rarr;</span>
              </Link>
            </p>
          </Reveal>
        </section>

        <SponsorStrip variant="welcome" />
        <MarketingFooter />
      </div>
    </div>
  );
}
