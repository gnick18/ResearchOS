"use client";

/**
 * The `/departments` page: the public marketing "sell" page for a DEPARTMENT
 * account, the org tier that sits ABOVE a lab (built 2026-06-16). A department
 * gathers multiple labs under one organization with central admin.
 *
 * It is a public sell page like `/labs`, `/ai`, and `/pricing` (whitelisted in
 * providers.tsx so a logged-out visitor lands here instead of the folder-connect
 * gate). It carries its own MarketingNav + footer and needs no folder.
 *
 * NOTE on routes: `/department` (singular) is the in-app, sign-in-gated dept
 * ADMIN portal (plan, roster, billing). This is the public MARKETING page, so it
 * lives at `/departments` (plural), parallel to `/labs`.
 *
 * IA:
 *   Hero (badge, headline with a rainbow phrase, the dept-admin pitch, CTA)
 *   What a department adds (the org-level features above a single lab)
 *   The local-first promise still holds (data on each member's disk, E2E, cloud
 *      is only the sync intermediary)
 *   Final CTA (sign in to set up a department) + sponsors + footer
 *
 * HARD RULE: no pricing or plan numbers here. The Billing lane owns pricing and
 * is mid-rebuild (Model A). Link to /pricing for the numbers, never state them.
 * An account is REQUIRED to run a department, so it is framed as the way in, not
 * as optional.
 *
 * Voice rules: no em-dashes, no emojis (every glyph is <Icon name=...> from the
 * registry), no mid-sentence colons. Contractions OK, state the WHY. BeakerBot
 * is the only mascot. Brand tokens only, never raw hex for new accents.
 */

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import BeakerBot from "@/components/BeakerBot";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons/registry";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";
import Reveal from "@/components/marketing/Reveal";
import Kicker from "@/components/marketing/Kicker";
import SponsorStrip from "@/components/SponsorStrip";
import { markLandingSeen } from "@/lib/landing/landing-gate";

const RAINBOW = "var(--brand-rainbow)";
const RAINBOW_TEXT = "var(--brand-rainbow-vivid)";

/** A single "what a department adds" feature. */
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

export default function DepartmentsPage() {
  const router = useRouter();

  // The CTA routes into the app. An account is required to run a department, so
  // this lands the visitor on the onboarding/sign-in path. markLandingSeen()
  // keeps the first-visit landing from snapping back over them.
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
                <Icon name="layer" className="h-3.5 w-3.5" />
              </span>
              A department account in ResearchOS
            </span>

            <h1 className="mt-6 max-w-[20ch] text-[28px] font-extrabold leading-[1.06] tracking-tight text-brand-ink sm:text-4xl md:text-6xl">
              Bring your labs together as{" "}
              <span
                style={{
                  background: RAINBOW_TEXT,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                one department
              </span>
            </h1>

            <p className="mt-5 max-w-[60ch] text-body leading-relaxed text-[#475569] sm:text-title">
              A department account makes you the department admin. Gather your
              labs under one organization and manage the roster, the plan, and the
              billing from one place, while every lab keeps running its own work.
            </p>

            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={goStart}
                data-testid="departments-hero-start"
                className="btn-brand inline-flex min-h-[44px] items-center gap-2 px-6 py-3 text-body"
              >
                <Icon name="layer" className="h-4 w-4" />
                Set up your department
              </button>
              <a
                href="/labs"
                data-testid="departments-hero-labs"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#cfdcec] bg-white px-6 py-3 text-body font-semibold text-brand-action shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
              >
                A single lab instead
                <span aria-hidden>&rarr;</span>
              </a>
            </div>
          </Reveal>
        </header>

        {/* WHAT A DEPARTMENT ADDS */}
        <section className="px-6 py-20 sm:px-12">
          <Reveal className="mx-auto max-w-[1040px]">
            <div className="mb-10 text-center">
              <Kicker>// what a department adds</Kicker>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-4xl">
                Many labs, one organization
              </h2>
              <p className="mx-auto mt-3 max-w-[58ch] text-body leading-relaxed text-[#475569]">
                A lab is one team under one lab head. A department sits above the
                labs and gives the people who run the org one place to manage them
                all, without touching the science in any single lab.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard icon="layer" title="Gather your labs">
                Bring every lab in the department under one organization. Each lab
                keeps its own lab head and its own workspace.
              </FeatureCard>
              <FeatureCard icon="users" title="One roster, every lab">
                See and manage who is in each lab from a single org roster, instead
                of chasing membership lab by lab.
              </FeatureCard>
              <FeatureCard icon="receipt" title="One plan, one bill">
                Put the whole department on a single plan and a single invoice
                rather than billing each lab on its own.
              </FeatureCard>
              <FeatureCard icon="shield" title="Set the rules once">
                Govern access and policy at the org level so every lab in the
                department follows the same rules without per-lab setup.
              </FeatureCard>
              <FeatureCard icon="eye" title="See across the department">
                A read across all of your labs in one view, so the people running
                the org can keep the whole department in order.
              </FeatureCard>
              <FeatureCard icon="gauge" title="Admin without the data">
                The department surface is org admin only. It manages the plan,
                roster, and billing, and never reaches into any lab's research
                files.
              </FeatureCard>
            </div>
          </Reveal>
        </section>

        {/* LOCAL-FIRST PROMISE */}
        <section className="border-t border-[#d8e3f1] bg-gradient-to-b from-white to-[#eef4fb] px-6 py-20 sm:px-12">
          <Reveal className="mx-auto grid max-w-[1040px] gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <Kicker>// the local-first promise still holds</Kicker>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-4xl">
                Org-wide, without pooling the data
              </h2>
              <p className="mt-4 max-w-[52ch] text-body leading-relaxed text-[#475569] sm:text-title">
                A department adds org admin over your labs. It does not move the
                research onto a central server. Every member keeps the local-first
                promise, and the cloud is only the intermediary that keeps people
                in sync.
              </p>
            </div>

            <div className="flex flex-col gap-6 rounded-2xl border border-[#cfe0f3] bg-white p-7 shadow-[0_4px_24px_rgba(15,40,80,0.06)]">
              <PromiseRow icon="folder" title="Data on each member's own disk">
                Every member's records live on their own machine. The department
                manages the org, not a pile of everyone's files on a server.
              </PromiseRow>
              <PromiseRow icon="lock" title="End to end encrypted in transit">
                When work moves between members, it is encrypted end to end. The
                relay carries sealed data it cannot read.
              </PromiseRow>
              <PromiseRow icon="cloud" title="The cloud only keeps you in sync">
                The cloud lets members reach the same live record. It is the sync
                layer, not the home for the department's science.
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
              Run your department on one foundation
            </h2>
            <p className="mt-4 max-w-[52ch] text-body leading-relaxed text-[#475569] sm:text-title">
              Sign in to set up your department, bring your labs together, and
              manage the org from one place. Your labs keep their own work and
              your members keep their data on their own disks.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={goStart}
                data-testid="departments-cta-start"
                className="btn-brand inline-flex min-h-[44px] items-center gap-2 px-6 py-3 text-body"
              >
                <Icon name="layer" className="h-4 w-4" />
                Set up your department
              </button>
              <a
                href="/pricing"
                data-testid="departments-cta-pricing"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#cfdcec] bg-white px-6 py-3 text-body font-semibold text-brand-action shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
              >
                See what a department costs
                <span aria-hidden>&rarr;</span>
              </a>
            </div>
            <p className="mt-6 text-meta text-[#94a3b8]">
              Free and open source at the core. A department is the org tier above
              a lab.{" "}
              <a
                href="/pricing"
                className="font-semibold text-brand-action hover:text-brand-ink"
              >
                See the pricing <span aria-hidden>&rarr;</span>
              </a>
            </p>
          </Reveal>
        </section>

        <SponsorStrip variant="welcome" />
        <MarketingFooter />
      </div>
    </div>
  );
}
