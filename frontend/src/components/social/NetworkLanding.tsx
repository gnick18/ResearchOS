"use client";

// Public /network landing for the researcher network (social layer, Phase A2).
//
// The discovery surface for the people side of ResearchOS, built on the SAME
// marketing chrome as /library (MarketingNav + MarketingBackdrop + Reveal +
// Kicker + MarketingFooter): a hero, a live login-free researcher search, and a
// short value-prop band, then the footer. Rendered without the AppShell or a
// connected folder so anyone can browse before signing in (the route is in the
// providers public-marketing bypass, flag-gated on SOCIAL_LAYER_ENABLED).
//
// Voice rules: no em-dashes, no emojis, no mid-sentence colons.

import Link from "next/link";

import MarketingNav from "@/components/MarketingNav";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Reveal from "@/components/marketing/Reveal";
import Kicker from "@/components/marketing/Kicker";
import { Icon, type IconName } from "@/components/icons";
import PublicResearcherSearch from "@/components/social/PublicResearcherSearch";
import LabDirectoryCard from "@/components/social/LabDirectoryCard";
import NetworkShareHandler from "@/components/social/NetworkShareHandler";
import { DEMO_LAB_CARD } from "@/lib/social/demo-lab";

const VALUE_PROPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "share",
    title: "Send work, not files",
    body: "Share a method, sequence, dataset, or figure straight to another researcher on ResearchOS. No zipping, no email chains, no shared-drive permissions to manage.",
  },
  {
    icon: "labTree",
    title: "Find your department and institution",
    body: "See who from your lab, department, or institution is already on ResearchOS, and share with a colleague down the hall as easily as one across the world.",
  },
  {
    icon: "shield",
    title: "Know it reached the right person",
    body: "A verified-domain badge and a key fingerprint let you confirm a collaborator before you send, so your work goes to the person you meant, not a look-alike.",
  },
  {
    icon: "users",
    title: "Reachable by choice",
    body: "Being listed is what lets a collaborator find and share with you. It is opt-in, you can hide any time, and your email is never shown.",
  },
];

export default function NetworkLanding() {
  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <MarketingBackdrop tone="vivid" />
        <div className="relative z-10 mx-auto max-w-5xl px-6 pb-12 pt-16 text-center sm:pt-24">
          <Reveal className="flex justify-center">
            <Kicker>Seamless sharing</Kicker>
          </Reveal>
          <Reveal as="div" delay={60}>
            <h1 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">
              Send your work to any researcher, in one step.
            </h1>
          </Reveal>
          <Reveal as="div" delay={120}>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-foreground-muted">
              The researcher network is how your work leaves your lab. Find anyone
              else on ResearchOS and share a method, sequence, dataset, or figure
              straight to them, with no zipped files, no email chains, and no drive
              permissions. It is not a feed or a follower count. It is the shortest
              path from your data to a collaborator, whether they are in your
              department or across the world.
            </p>
          </Reveal>
          <Reveal as="div" delay={180}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="#find"
                className="inline-flex items-center gap-2 rounded-full bg-brand-action px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              >
                <Icon name="search" className="h-4 w-4" /> Find a collaborator
              </a>
              <Link
                href="/settings?section=profile"
                className="inline-flex items-center gap-2 rounded-full border border-border-strong px-5 py-2.5 text-sm font-semibold text-foreground transition hover:border-brand-action"
              >
                Set up your profile
                <Icon name="chevronRight" className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Search */}
      <section id="find" className="relative scroll-mt-20">
        <div className="mx-auto max-w-2xl px-6 pb-4">
          <Reveal as="div">
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-semibold text-foreground">
                Find who you want to share with
              </h2>
              <p className="mt-1 mb-4 text-meta text-foreground-muted">
                Listed researchers only. No login required.
              </p>
              <PublicResearcherSearch />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Labs on the network. For the demo this is the single seeded demo lab,
          sourced from the DEMO_LAB_CARD fixture (which mirrors the Option A row).
          The card carries its own sample-lab badge so it is never mistaken for a
          real listing. */}
      <section className="relative">
        <div className="mx-auto max-w-2xl px-6 pb-2 pt-6">
          <Reveal as="div">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-lg font-semibold text-foreground">Labs</h2>
              <span className="h-px flex-1 bg-border" />
              <span className="text-meta text-foreground-muted">1 listed</span>
            </div>
          </Reveal>
          <Reveal as="div" delay={60}>
            <LabDirectoryCard card={DEMO_LAB_CARD} />
          </Reveal>
        </div>
      </section>

      {/* Value props */}
      <section className="relative">
        <div className="mx-auto max-w-5xl px-6 py-14">
          <div className="grid gap-5 sm:grid-cols-2">
            {VALUE_PROPS.map((p, i) => (
              <Reveal as="div" key={p.title} delay={i * 80}>
                <div className="h-full rounded-2xl border border-border bg-surface p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-action/10 text-brand-action">
                    <Icon name={p.icon} className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-body font-semibold text-foreground">
                    {p.title}
                  </h3>
                  <p className="mt-2 text-meta leading-relaxed text-foreground-muted">
                    {p.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <MarketingFooter />

      {/* App-origin deep-link handler: reads ?share=<slug> from the URL and
          opens RecipientShareDialog pre-addressed to the lab's PI when the
          gate conditions are met (flag + session + folder + resolved slug).
          Inert when any condition is missing; renders no visible DOM otherwise. */}
      <NetworkShareHandler />
    </div>
  );
}
