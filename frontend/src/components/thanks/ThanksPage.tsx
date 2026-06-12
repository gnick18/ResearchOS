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
import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";
import ConfettiLayer from "@/components/animations/ConfettiLayer";
import { Icon } from "@/components/icons";
import { sponsors } from "@/data/sponsors";

const GITHUB_SPONSORS_URL = "https://github.com/sponsors/ResearchOS-LLC";

// Brand rainbow ramps, the same ones the welcome page, footer, and avatars use.
// RAINBOW is the pastel fill (the top ribbon); RAINBOW_TEXT is the saturated ramp
// clipped into the gradient headline word.
const RAINBOW = "var(--brand-rainbow)";
const RAINBOW_TEXT = "var(--brand-rainbow-vivid)";

/* ───────────── tier cards ──────────────────────────────────────────────── */

interface Tier {
  id: string;
  name: string;
  price: string;
  perks: string[];
  featured?: boolean;
}

// Recognition tiers for supporting the open-source PROJECT through GitHub
// Sponsors. Deliberately named in a patron space (Backer / Patron / Benefactor),
// NOT after lab or org sizes, so they are never confused with the in-app storage
// tiers (Lab / Research / Department), which are a separate Stripe purchase and
// the only thing that grants cloud storage. These perks are recognition only.
const TIERS: Tier[] = [
  {
    id: "backer",
    name: "Backer",
    price: "5",
    perks: [
      "The GitHub Sponsor badge on your profile",
      "Your name on the sponsor wall below",
    ],
  },
  {
    id: "patron",
    name: "Patron",
    price: "15",
    featured: true,
    perks: [
      "Everything in Backer",
      "Your name or handle in the repo's SPONSORS.md, where contributors see it",
      "Your logo and link on the welcome page and wiki, if you want it shown",
    ],
  },
  {
    id: "benefactor",
    name: "Benefactor",
    price: "25",
    perks: [
      "Everything in Patron",
      "Your logo featured first and larger across the welcome page and wiki, if you want it shown",
    ],
  },
];

function TierBeaker({ id }: { id: string }) {
  // Each tier is continuously lively (no jumpy one-shot replays). Excitement
  // escalates through the motion itself, Backer is the calm alive idle (sway,
  // blink, gaze drift), Patron waves both arms in the air, Benefactor twirls. The
  // double-wave and twirl poses are infinite loops added to the official
  // BeakerBot, and all three honor prefers-reduced-motion via the component's
  // own animation gate.
  if (id === "patron") {
    return <BeakerBot pose="double-wave" animated className="h-24 w-auto" ariaLabel="" />;
  }
  if (id === "benefactor") {
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
      {tier.id === "benefactor" ? <ConfettiLayer /> : null}
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

// Canonical project homepages for every credited project, so each name in the
// teaser links straight to its source. The full per-package license inventory
// (with versions) lives on /open-source; these are the friendly front doors.
const OSS_URLS: Record<string, string> = {
  CodeMirror: "https://codemirror.net/",
  marked: "https://marked.js.org/",
  unified: "https://unifiedjs.com/",
  turndown: "https://github.com/mixmark-io/turndown",
  Konva: "https://konvajs.org/",
  "react-konva": "https://github.com/konvajs/react-konva",
  SeqViz: "https://github.com/Lattice-Automation/seqviz",
  TeselaGen: "https://github.com/TeselaGen/tg-oss",
  "expr-eval-fork": "https://github.com/jorenbroekema/expr-eval",
  Biopython: "https://biopython.org/",
  Recharts: "https://recharts.org/",
  "frappe-gantt": "https://github.com/frappe/gantt",
  JSZip: "https://stuk.github.io/jszip/",
  Zustand: "https://github.com/pmndrs/zustand",
  "TanStack Query": "https://tanstack.com/query",
  "date-fns": "https://date-fns.org/",
  React: "https://react.dev/",
  "Next.js": "https://nextjs.org/",
};

// A credited project name rendered as a link to its homepage. Opens in a new
// tab (it leaves ResearchOS) and keeps the bold treatment so the layout reads
// the same, just clickable. `label` overrides the visible text when the key
// differs from what we want on screen (e.g. "TeselaGen" -> "TeselaGen").
function Oss({ name, label }: { name: keyof typeof OSS_URLS; label?: string }) {
  return (
    <a
      href={OSS_URLS[name]}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-foreground underline decoration-border underline-offset-2 transition-colors hover:text-brand-action hover:decoration-brand-action"
    >
      {label ?? name}
    </a>
  );
}

const OSS_GROUPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "The writing surface",
    body: (
      <>
        <Oss name="CodeMirror" />, <Oss name="marked" />, the{" "}
        <Oss name="unified" /> remark/rehype pipeline, <Oss name="turndown" />
      </>
    ),
  },
  {
    title: "Sequence and cloning",
    body: (
      <>
        <Oss name="Konva" /> and <Oss name="react-konva" />, plus vendored{" "}
        <Oss name="SeqViz" /> and <Oss name="TeselaGen" /> bio-parsers
      </>
    ),
  },
  {
    title: "Calculators and math",
    body: (
      <>
        <Oss name="expr-eval-fork" />, and a primer Tm ported from{" "}
        <Oss name="Biopython" />
      </>
    ),
  },
  {
    title: "Charts, files, and state",
    body: (
      <>
        <Oss name="Recharts" />, <Oss name="frappe-gantt" />, <Oss name="JSZip" />,{" "}
        <Oss name="Zustand" />, <Oss name="TanStack Query" />, <Oss name="date-fns" />
      </>
    ),
  },
  {
    title: "The framework",
    body: (
      <>
        <Oss name="React" /> and <Oss name="Next.js" />
      </>
    ),
  },
  {
    title: "Code we recycle",
    body: (
      <>
        <Oss name="SeqViz" /> (MIT), <Oss name="TeselaGen" label="TeselaGen bio-parsers" />{" "}
        (MIT), the <Oss name="Biopython" label="Biopython Tm port" /> (BSD),
        carried with their licenses
      </>
    ),
  },
];

/* ───────────── page ────────────────────────────────────────────────────── */

export default function ThanksPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken text-foreground">
      {/* Thin rainbow ribbon pinned to the very top edge, the brand signature. */}
      <div aria-hidden className="h-[5px] w-full" style={{ background: RAINBOW }} />

      <MarketingNav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6">
        {/* ── Hero ── */}
        <div className="pb-10 pt-16 text-center">
          <div className="mx-auto mb-4 flex justify-center">
            <BeakerBot pose="idle" alive animated className="h-28 w-auto" ariaLabel="BeakerBot, the ResearchOS mascot" />
          </div>
          <h1 className="mx-auto mb-3 max-w-2xl text-4xl font-bold leading-tight tracking-tight text-foreground">
            ResearchOS is{" "}
            <span
              style={{
                background: RAINBOW_TEXT,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              free and open
            </span>{" "}
            because of people like you.
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
            ResearchOS is free and open source, with no investors steering it.
            Sponsoring here is a thank-you to the project that helps cover hosting
            and keeps the tool free for labs that cannot pay. It is separate from
            the optional cloud storage a lab can add in-app, and it grants
            recognition, not storage. GitHub handles the checkout.
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

      <MarketingFooter />
    </div>
  );
}
