"use client";

/**
 * The `/app` page: the public marketing "sell" page for the COMPANION APP, the
 * mobile half of ResearchOS and one of the strongest reasons to pay (built
 * 2026-06-16, Billing lane). Mirrors the /labs and /departments pattern: public,
 * MarketingNav + footer, no folder, whitelisted in providers.tsx so a logged-out
 * visitor lands here instead of the folder-connect gate.
 *
 * IA:
 *   Hero (badge, headline with a rainbow phrase, the in-your-pocket pitch, CTA)
 *   What the app unlocks (the real capabilities from mobile/app/)
 *   Free to download, pairing is paid (the packaging, with a phone frame)
 *   The local-first promise still holds (capture is sealed, data on your disk)
 *   Final CTA + sponsors + footer
 *
 * HARD RULE: no pricing or plan numbers here. The Billing lane owns pricing and is
 * mid-rebuild (Model A). Link to /pricing for the numbers, never state them.
 *
 * Voice rules: no em-dashes, no emojis (every glyph is <Icon name=...> from the
 * registry), no mid-sentence colons. Contractions OK, state the WHY. BeakerBot is
 * the only mascot. Brand tokens only, never raw hex for new accents.
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

export default function AppPage() {
  const router = useRouter();

  const goStart = () => {
    markLandingSeen();
    router.push("/");
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#fbfcfe] text-brand-ink">
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
                <Icon name="phone" className="h-3.5 w-3.5" />
              </span>
              The ResearchOS companion app
            </span>

            <h1 className="mt-6 max-w-[20ch] text-[28px] font-extrabold leading-[1.06] tracking-tight text-brand-ink sm:text-4xl md:text-6xl">
              Your whole lab,{" "}
              <span
                style={{
                  background: RAINBOW_TEXT,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                in your pocket
              </span>
            </h1>

            <p className="mt-5 max-w-[60ch] text-body leading-relaxed text-[#475569] sm:text-title">
              Capture results at the bench, read your protocols, scan your
              inventory, and stay in the loop, all from your phone and all synced
              to your real ResearchOS workspace. The app is free to download, and
              pairing it to your lab is part of every paid plan.
            </p>

            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={goStart}
                data-testid="app-hero-start"
                className="btn-brand inline-flex min-h-[44px] items-center gap-2 px-6 py-3 text-body"
              >
                <Icon name="phone" className="h-4 w-4" />
                Get started
              </button>
              <a
                href="/demo"
                data-testid="app-hero-demo"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#cfdcec] bg-white px-6 py-3 text-body font-semibold text-brand-action shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
              >
                Explore the live demo
                <span aria-hidden>&rarr;</span>
              </a>
            </div>
          </Reveal>
        </header>

        {/* WHAT THE APP UNLOCKS */}
        <section className="px-6 py-20 sm:px-12">
          <Reveal className="mx-auto max-w-[1040px]">
            <div className="mb-10 text-center">
              <Kicker>// what the app unlocks</Kicker>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-4xl">
                The bench is where the data is made
              </h2>
              <p className="mx-auto mt-3 max-w-[58ch] text-body leading-relaxed text-[#475569]">
                Most lab work happens away from the laptop. The companion app puts
                the parts you need at the bench in your hand, and everything you
                capture lands in the right place back in your workspace.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard icon="camera" title="Capture at the bench">
                Snap a gel or a plate and mark it up, jot a note, or log a
                measurement. It lands in the right experiment back on your laptop,
                with no retyping later.
              </FeatureCard>
              <FeatureCard icon="book" title="Your notebook on your phone">
                Pull up your notebook, your protocols, and your methods wherever
                you are working, so you are not walking back to the desk to check a
                step.
              </FeatureCard>
              <FeatureCard icon="alarmClock" title="Run protocols with timers">
                Step timers wired to the protocol you are actually running, so a
                long incubation or a wash series keeps time without a second app.
              </FeatureCard>
              <FeatureCard icon="box" title="Inventory in hand">
                Scan a barcode, glance at the room map, and drop low stock into a
                one-tap reorder queue while you are standing at the shelf.
              </FeatureCard>
              <FeatureCard icon="bell" title="Stay in the loop">
                Push notifications for your lab, so a finished run or a teammate's
                request reaches you when you are away from the bench.
              </FeatureCard>
              <FeatureCard icon="cloud" title="Synced to your real workspace">
                Everything you do on the phone is the same workspace as your
                laptop, kept in sync over the relay, not a separate island of
                notes.
              </FeatureCard>
            </div>
          </Reveal>
        </section>

        {/* FREE TO DOWNLOAD, PAIRING IS PAID */}
        <section className="border-t border-[#d8e3f1] bg-white px-6 py-20 sm:px-12">
          <Reveal className="mx-auto grid max-w-[1040px] gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <Kicker>// how the app is packaged</Kicker>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-4xl">
                Free to download, paired when you pay
              </h2>
              <p className="mt-4 max-w-[52ch] text-body leading-relaxed text-[#475569] sm:text-title">
                Anyone can install the app and use the offline timers,
                calculators, and the wiki, plus a demo so you can see bench
                capture working before you commit. Pairing it to your real lab,
                the live capture and sync that actually reaches your workspace, is
                included on every paid plan.
              </p>
              <ul className="mt-6 flex flex-col gap-3">
                <li className="flex items-start gap-3 text-body text-[#475569]">
                  <span aria-hidden className="mt-0.5 text-brand-action">
                    <Icon name="check" className="h-4 w-4" />
                  </span>
                  <span>
                    Free, offline timers, calculators, and the wiki, plus a demo
                  </span>
                </li>
                <li className="flex items-start gap-3 text-body text-[#475569]">
                  <span aria-hidden className="mt-0.5 text-brand-action">
                    <Icon name="phone" className="h-4 w-4" />
                  </span>
                  <span>
                    Paired, live capture and sync to your real workspace on a paid
                    plan
                  </span>
                </li>
                <li className="flex items-start gap-3 text-body text-[#475569]">
                  <span aria-hidden className="mt-0.5 text-brand-action">
                    <Icon name="users" className="h-4 w-4" />
                  </span>
                  <span>
                    Works for Solo, Lab, and Department, the whole team can pair
                    their phones
                  </span>
                </li>
              </ul>
              <a
                href="/pricing"
                data-testid="app-pricing-link"
                className="mt-7 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#cfdcec] bg-white px-6 py-3 text-body font-semibold text-brand-action shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
              >
                See what pairing costs
                <span aria-hidden>&rarr;</span>
              </a>
            </div>

            {/* phone frame */}
            <div className="mx-auto w-full max-w-[280px]">
              <div className="rounded-[2.2rem] border border-[#cfdcec] bg-white p-3 shadow-[0_10px_40px_rgba(15,40,80,0.12)]">
                <div className="overflow-hidden rounded-[1.7rem] border border-[#e6eef7] bg-[#f4f8fc]">
                  <div className="flex items-center justify-between px-4 py-2.5 text-meta text-[#64748b]">
                    <span>Ramirez Lab</span>
                    <span aria-hidden className="text-brand-action">
                      <Icon name="bell" className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <div className="space-y-2.5 px-3 pb-4">
                    <div className="flex items-center gap-3 rounded-xl border border-[#e6eef7] bg-white px-3 py-2.5">
                      <span
                        aria-hidden
                        className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-sky/10 text-brand-action"
                      >
                        <Icon name="camera" className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-body font-semibold text-brand-ink">
                          Gel image captured
                        </div>
                        <div className="truncate text-meta text-[#94a3b8]">
                          Added to Cohort 2, lane 3
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border border-[#e6eef7] bg-white px-3 py-2.5">
                      <span
                        aria-hidden
                        className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-sky/10 text-brand-action"
                      >
                        <Icon name="alarmClock" className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-body font-semibold text-brand-ink">
                          Wash step, 8:00
                        </div>
                        <div className="truncate text-meta text-[#94a3b8]">
                          Western blot protocol
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border border-[#e6eef7] bg-white px-3 py-2.5">
                      <span
                        aria-hidden
                        className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-sky/10 text-brand-action"
                      >
                        <Icon name="box" className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-body font-semibold text-brand-ink">
                          Trypsin low, reorder queued
                        </div>
                        <div className="truncate text-meta text-[#94a3b8]">
                          Scanned at freezer B
                        </div>
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
              <Kicker>// the local-first promise still holds</Kicker>
              <h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-brand-ink md:text-4xl">
                Your phone, not our vault
              </h2>
              <p className="mt-4 max-w-[52ch] text-body leading-relaxed text-[#475569] sm:text-title">
                The app is a window into your own workspace, not a copy parked on
                our servers. What you capture syncs to your machine, and the cloud
                is only the intermediary that carries it.
              </p>
            </div>

            <div className="flex flex-col gap-6 rounded-2xl border border-[#cfe0f3] bg-white p-7 shadow-[0_4px_24px_rgba(15,40,80,0.06)]">
              <PromiseRow icon="folder" title="Capture lands on your own disk">
                A photo or note from the bench syncs into your workspace on your
                machine, the same local-first home as everything else.
              </PromiseRow>
              <PromiseRow icon="lock" title="End to end encrypted in transit">
                What the phone sends is encrypted end to end. The relay carries
                sealed data it cannot read.
              </PromiseRow>
              <PromiseRow icon="cloud" title="The cloud only keeps you in sync">
                Pairing uses the cloud as the intermediary between your phone and
                your laptop. It is the sync layer, not the home for your science.
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
              Take ResearchOS to the bench
            </h2>
            <p className="mt-4 max-w-[52ch] text-body leading-relaxed text-[#475569] sm:text-title">
              Get started on the web, pick a paid plan, and pair your phone to
              capture, glance, and sync from anywhere in the lab.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={goStart}
                data-testid="app-cta-start"
                className="btn-brand inline-flex min-h-[44px] items-center gap-2 px-6 py-3 text-body"
              >
                <Icon name="phone" className="h-4 w-4" />
                Get started
              </button>
              <a
                href="/pricing"
                data-testid="app-cta-pricing"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#cfdcec] bg-white px-6 py-3 text-body font-semibold text-brand-action shadow-[0_2px_12px_rgba(15,40,80,0.06)] transition-transform hover:scale-[1.02]"
              >
                See the pricing
                <span aria-hidden>&rarr;</span>
              </a>
            </div>
            <p className="mt-6 text-meta text-[#94a3b8]">
              The app is free to download. Pairing to your real lab is included on
              every paid plan.{" "}
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
