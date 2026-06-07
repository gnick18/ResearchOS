"use client";

/**
 * "Thanks" page body (rendered at /thanks).
 *
 * Two community-gratitude jobs on one branded page: thank the people who fund
 * ResearchOS through GitHub Sponsors, and credit the open-source projects it is
 * built on. GitHub stays the checkout; this page tells the story and links out.
 * Design doc: docs/proposals/THANKS_PAGE.md, approved mockup:
 * docs/mockups/thanks-page.html.
 *
 * BeakerBot escalation across tiers (decided after mockup review): the beaker
 * fill stays constant and the mascot's excitement rises instead. Bench is a
 * content idle, Lab is excited (giggle), Institute is celebrating (cheering)
 * with a light custom-SVG confetti layer. We use the OFFICIAL BeakerBot
 * component, never a hand-traced SVG. The component already gates animation on
 * prefers-reduced-motion.
 *
 * Sponsor wall renders from src/data/sponsors.json. While it is empty it shows
 * a warm "be the first" state. The open-source section is a short teaser that
 * links to the full /open-source inventory, it does not duplicate the credits.
 *
 * Styling uses the app's semantic theme tokens (bg-surface*, text-foreground*,
 * border-border) so it works in light and dark mode. Primary buttons use the
 * brand-action blue, matching the rest of the app.
 *
 * Voice rules: warm and concept-first. No em-dashes, no emojis, no mid-sentence
 * colons. Interface glyphs come from the verified <Icon> registry; the only raw
 * SVG is the decorative ConfettiLayer (in components/animations/).
 */

import Link from "next/link";

import BeakerBot from "@/components/BeakerBot";
import AppFooter from "@/components/AppFooter";
import ConfettiLayer from "@/components/animations/ConfettiLayer";
import { Icon } from "@/components/icons";
import { sponsors } from "@/data/sponsors";

const GITHUB_SPONSORS_URL = "https://github.com/sponsors/ResearchOS-LLC";

/* ───────────── tier cards ──────────────────────────────────────────────── */

interface Tier {
  id: string;
  name: string;
  price: string;
  perks: string[];
  featured?: boolean;
}

const TIERS: Tier[] = [
  {
    id: "bench",
    name: "Bench",
    price: "5",
    perks: [
      "The GitHub Sponsor badge on your profile",
      "Your name on the sponsor wall below",
    ],
  },
  {
    id: "lab",
    name: "Lab",
    price: "25",
    featured: true,
    perks: [
      "Everything in Bench",
      "Your name or handle in the repo's SPONSORS.md, where contributors see it",
      "Your lab's logo and link on the welcome page and wiki, if you want it shown",
    ],
  },
  {
    id: "institute",
    name: "Institute",
    price: "100",
    perks: [
      "Everything in Lab",
      "Your lab's logo featured first and larger across the welcome page and wiki, if you want it shown",
    ],
  },
];

function TierBeaker({ id }: { id: string }) {
  // Each tier is continuously lively (no jumpy one-shot replays). Excitement
  // escalates through the motion itself: Bench is the calm alive idle (sway,
  // blink, gaze drift), Lab waves both arms in the air, Institute twirls. The
  // double-wave and twirl poses are infinite loops added to the official
  // BeakerBot, and all three honor prefers-reduced-motion via the component's
  // own animation gate.
  if (id === "lab") {
    return <BeakerBot pose="double-wave" animated className="h-24 w-auto" ariaLabel="" />;
  }
  if (id === "institute") {
    return <BeakerBot pose="twirl" animated className="h-24 w-auto" ariaLabel="" />;
  }
  return <BeakerBot pose="idle" alive animated className="h-24 w-auto" ariaLabel="" />;
}

function TierCard({ tier }: { tier: Tier }) {
  const featured = Boolean(tier.featured);
  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl border bg-surface-raised p-6 shadow-sm ${
        featured ? "border-brand-sky ring-1 ring-brand-sky" : "border-border"
      }`}
    >
      {tier.id === "institute" ? <ConfettiLayer /> : null}
      {featured ? (
        <span className="relative mx-auto mb-2.5 inline-block rounded-full bg-brand-sky/10 px-2.5 py-1 text-meta font-bold uppercase tracking-wider text-brand-sky">
          Most chosen
        </span>
      ) : null}
      <div className="relative mx-auto mb-1 flex h-28 items-end justify-center">
        <TierBeaker id={tier.id} />
      </div>
      <div className="relative text-center text-title font-bold text-foreground">
        {tier.name}
      </div>
      <div className="relative mt-0.5 text-center text-body text-foreground-muted">
        <b className="text-2xl text-foreground">${tier.price}</b> / month
      </div>
      <ul className="relative my-5 flex-1 space-y-2.5 text-body">
        {tier.perks.map((perk) => (
          <li key={perk} className="flex items-start gap-2 text-foreground">
            <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-sky" />
            <span>{perk}</span>
          </li>
        ))}
      </ul>
      <a
        href={GITHUB_SPONSORS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`relative inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-body font-semibold transition-colors ${
          featured
            ? "bg-brand-action text-white hover:bg-brand-action/90"
            : "border border-border bg-surface-raised text-foreground hover:bg-surface-sunken"
        }`}
      >
        Sponsor on GitHub
      </a>
    </div>
  );
}

/* ───────────── sponsor wall ────────────────────────────────────────────── */

function SponsorWall() {
  if (sponsors.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface-raised p-10 text-center text-foreground-muted">
        <div className="mb-1.5 text-title font-semibold text-foreground">
          Be the first to back ResearchOS.
        </div>
        <div className="text-body">
          Your name will sit right here, in good company.
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      {sponsors.map((s) => {
        const inner = s.logo ? (
          <img src={s.logo} alt={s.name} className="h-10 w-auto" />
        ) : (
          <span className="text-body font-semibold text-foreground">{s.name}</span>
        );
        return (
          <div
            key={s.name}
            className="flex items-center justify-center rounded-xl border border-border bg-surface-raised p-5 text-center"
          >
            {s.url ? (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:opacity-80"
              >
                {inner}
              </a>
            ) : (
              inner
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ───────────── open-source teaser groups (link out, do not duplicate) ──── */

const OSS_GROUPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "The writing surface",
    body: (
      <>
        <b className="font-semibold text-foreground">CodeMirror</b>,{" "}
        <b className="font-semibold text-foreground">marked</b>, the{" "}
        <b className="font-semibold text-foreground">unified</b> remark/rehype
        pipeline, <b className="font-semibold text-foreground">turndown</b>
      </>
    ),
  },
  {
    title: "Sequence and cloning",
    body: (
      <>
        <b className="font-semibold text-foreground">Konva</b> and{" "}
        <b className="font-semibold text-foreground">react-konva</b>, plus
        vendored <b className="font-semibold text-foreground">SeqViz</b> and{" "}
        <b className="font-semibold text-foreground">TeselaGen</b> bio-parsers
      </>
    ),
  },
  {
    title: "Calculators and math",
    body: (
      <>
        <b className="font-semibold text-foreground">expr-eval-fork</b>, and a
        primer Tm ported from{" "}
        <b className="font-semibold text-foreground">Biopython</b>
      </>
    ),
  },
  {
    title: "Charts, files, and state",
    body: (
      <>
        <b className="font-semibold text-foreground">Recharts</b>,{" "}
        <b className="font-semibold text-foreground">frappe-gantt</b>,{" "}
        <b className="font-semibold text-foreground">JSZip</b>,{" "}
        <b className="font-semibold text-foreground">Zustand</b>,{" "}
        <b className="font-semibold text-foreground">TanStack Query</b>,{" "}
        <b className="font-semibold text-foreground">date-fns</b>
      </>
    ),
  },
  {
    title: "The framework",
    body: (
      <>
        <b className="font-semibold text-foreground">React</b> and{" "}
        <b className="font-semibold text-foreground">Next.js</b>
      </>
    ),
  },
  {
    title: "Code we recycle",
    body: (
      <>
        SeqViz (MIT), TeselaGen bio-parsers (MIT), the Biopython Tm port (BSD),
        carried with their licenses
      </>
    ),
  },
];

/* ───────────── page ────────────────────────────────────────────────────── */

export default function ThanksPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken text-foreground">
      {/* Header / back to app */}
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="text-body font-medium text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
          >
            ResearchOS
          </Link>
          <Link
            href="/"
            className="text-body font-medium text-brand-action underline-offset-2 hover:underline"
          >
            Back to the app
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">
        {/* ── Hero ── */}
        <div className="pb-10 pt-16 text-center">
          <div className="mx-auto mb-4 flex justify-center">
            <BeakerBot pose="idle" alive animated className="h-28 w-auto" ariaLabel="BeakerBot, the ResearchOS mascot" />
          </div>
          <h1 className="mx-auto mb-3 max-w-2xl text-4xl font-bold leading-tight tracking-tight text-foreground">
            ResearchOS is free and open because of people like you.
          </h1>
          <p className="mx-auto mb-7 max-w-xl text-title text-foreground-muted">
            The people who fund it and the open-source projects it stands on.
            Both keep the whole thing free for the research community. Thank you.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href="#sponsors"
              className="inline-flex items-center justify-center rounded-xl bg-brand-action px-5 py-3 text-body font-semibold text-white transition-colors hover:bg-brand-action/90"
            >
              Become a sponsor
            </a>
            <a
              href="#oss"
              className="inline-flex items-center justify-center rounded-xl border border-border bg-surface-raised px-5 py-3 text-body font-semibold text-foreground transition-colors hover:bg-surface-sunken"
            >
              See what we are built on
            </a>
          </div>
        </div>

        {/* ── Sponsors ── */}
        <section id="sponsors" className="scroll-mt-6 py-12">
          <p className="mb-1.5 text-meta font-bold uppercase tracking-wider text-brand-sky">
            Sponsors
          </p>
          <h2 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
            Fund the science you want to exist
          </h2>
          <p className="mb-7 max-w-2xl text-title text-foreground-muted">
            ResearchOS has no paid tier and no investors deciding its direction.
            Sponsorship covers hosting and development so it stays free and open.
            GitHub handles the rest.
          </p>
          <div className="grid gap-5 md:grid-cols-3">
            {TIERS.map((tier) => (
              <TierCard key={tier.id} tier={tier} />
            ))}
          </div>
        </section>

        {/* ── Sponsor wall ── */}
        <section className="py-12">
          <p className="mb-1.5 text-meta font-bold uppercase tracking-wider text-brand-sky">
            Sponsor wall
          </p>
          <h2 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
            The people behind ResearchOS
          </h2>
          <p className="mb-7 max-w-2xl text-title text-foreground-muted">
            Everyone who sponsors shows up here. Empty for now, this is where you
            would be.
          </p>
          <SponsorWall />
        </section>

        {/* ── Built on open source (teaser, links out) ── */}
        <section id="oss" className="scroll-mt-6 py-12">
          <p className="mb-1.5 text-meta font-bold uppercase tracking-wider text-brand-sky">
            Built on open source
          </p>
          <h2 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
            We stand on a lot of other people&apos;s work
          </h2>
          <p className="mb-7 max-w-2xl text-title text-foreground-muted">
            Every screen rests on open-source software written by volunteers,
            students, and engineers who chose to share. Several licenses also
            require attribution, so this is both a thank-you and an obligation we
            take seriously.
          </p>
          <div className="rounded-2xl border border-border bg-surface-raised p-7 shadow-sm">
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {OSS_GROUPS.map((group) => (
                <div key={group.title}>
                  <h4 className="mb-1 text-body font-semibold text-foreground">
                    {group.title}
                  </h4>
                  <div className="text-body text-foreground-muted">{group.body}</div>
                </div>
              ))}
            </div>
            <p className="mt-5 border-t border-border pt-4 text-meta text-foreground-muted">
              The full per-package license inventory lives on the{" "}
              <Link
                href="/open-source"
                className="font-medium text-brand-action underline-offset-2 hover:underline"
              >
                open source page
              </Link>{" "}
              and in THIRD_PARTY_NOTICES, generated straight from the installed
              dependency tree so it never drifts.
            </p>
          </div>
        </section>
      </main>

      <AppFooter />
    </div>
  );
}
