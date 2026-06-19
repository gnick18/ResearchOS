import type { Metadata } from "next";
import Link from "next/link";

import BeakerBot from "@/components/BeakerBot";
import MadeInMadison from "@/components/MadeInMadison";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Reveal from "@/components/marketing/Reveal";
import Kicker from "@/components/marketing/Kicker";

/**
 * Public `/about` company page. The honest origin story of ResearchOS, built by
 * two researchers on the same team. It started when one of them was setting his
 * lab up on a clunky, expensive electronic lab notebook and we decided to build
 * a better, cheaper one tailored to academics. Brand hero (kept from the prior
 * version), a rainbow-connected origin timeline, the two people behind it, why
 * it exists, the company, and the Built-in-Madison credibility. Same premium
 * chrome as the welcome and pricing pages (rainbow ribbon, brand backdrop,
 * Reveal scroll-ins, pastel rainbow kickers).
 *
 * Marketing page, rendered without the AppShell or a connected folder so anyone
 * can read it. Mission and positioning copy inherited from the welcome page and
 * docs/branding/POSITIONING.md, kept real and not salesy.
 *
 * The two people: Dr. Grant Nickles (writes most of the code) and Dr. Emile
 * Gluck-Thaler (PI of the Fungal Interactions Lab at UW-Madison, where they both
 * work, piloting ResearchOS and leading adoption). Lab: https://fungi.cals.wisc.edu/.
 *
 * Voice rules: no em-dashes, no emojis, no mid-sentence colons. State the why.
 */
const GITHUB_URL = "https://github.com/gnick18/ResearchOS";
const RAINBOW_TEXT = "var(--brand-rainbow-vivid)";

export const metadata: Metadata = {
  title: "About",
  description:
    "ResearchOS is an open-source, local-first set of tools for academic labs, built by two researchers on the same team. It started when one of us was setting a lab up on a clunky, expensive electronic lab notebook, so we built a better, cheaper one. A registered Wisconsin LLC stands behind it, and anything it earns goes back into our science.",
};

// The product journey, the big features in the order they actually landed
// (dates from git history). Rendered as a boustrophedon "flight path" map on
// desktop: each card is centered on (x, y) percentages of the map box, the
// dotted rocket trail (public/about/rocket-trail.svg) snakes through the same
// coordinates and shows in the gaps + U-turns, and BeakerBot rides a spaceship
// at the end. Mobile falls back to a stacked list. The order here MUST follow
// the serpentine path order (row 0 left to right, row 1 right to left, ...) so
// the numbered cards read in sequence along the trail.
type Checkpoint = { when: string; title: string; sub: string; x: number; y: number };
const TRAIL: Checkpoint[] = [
  // Row 0, left to right.
  {
    when: "Feb 2026",
    title: "The lab notebook",
    sub: "A free electronic lab notebook. Where ResearchOS began.",
    x: 18,
    y: 13,
  },
  {
    when: "May 2026",
    title: "Scheduling and methods",
    sub: "A lab Gantt, a reusable methods library, and calendar overlays.",
    x: 50,
    y: 13,
  },
  {
    when: "May 2026",
    title: "Version control",
    sub: "Edit history, attribution, and a recycle bin for your notes.",
    x: 82,
    y: 13,
  },
  // Row 1, right to left.
  {
    when: "Jun 2026",
    title: "Sequences",
    sub: "A built-in plasmid and sequence editor, no separate license.",
    x: 82,
    y: 37,
  },
  {
    when: "Jun 2026",
    title: "Sealed sharing",
    sub: "Optional encrypted sharing between labs. Your data stays on your disk.",
    x: 50,
    y: 37,
  },
  {
    when: "Jun 2026",
    title: "Mobile companion",
    sub: "A phone app for bench photos, timers, and your day at a glance.",
    x: 18,
    y: 37,
  },
  // Row 2, left to right.
  {
    when: "Jun 2026",
    title: "Chemistry workbench",
    sub: "Draw structures and search the literature, no SciFinder needed.",
    x: 18,
    y: 61,
  },
  {
    when: "Jun 2026",
    title: "Data Hub",
    sub: "Statistics and publication graphs, a free Prism alternative.",
    x: 50,
    y: 61,
  },
  {
    when: "Jun 2026",
    title: "Phylogenetics",
    sub: "Build and style trees right in the browser.",
    x: 82,
    y: 61,
  },
];
// The trail ends at BeakerBot on a spaceship, since we are still building.
const TRAIL_END = { x: 50, y: 82 };

// The two people behind ResearchOS, honest about where we are right now. Plain
// initial chips (letter marks, not logos), the same safe approach the prior
// journey rail used.
// `credential` is an optional verified affiliation chip. Grant's uses the exact
// OVCR-cleared wording from the welcome page (the funder, UW-Madison Office of
// the Vice Chancellor for Research, was specific about this), so keep it verbatim.
type Person = {
  initial: string;
  name: string;
  role: string;
  blurb: string;
  credential?: string;
};
const PEOPLE: Person[] = [
  {
    initial: "G",
    name: "Dr. Grant Nickles",
    role: "Builds ResearchOS",
    credential: "UW-Madison Distinguished Research Fellow",
    blurb:
      "I came up through genetics at Iowa State and did my PhD at UW-Madison mining fungal genomes, so I lived in a dozen lab tools at once. I write most of the code, and the fellowship is what lets the app stay free.",
  },
  {
    initial: "E",
    name: "Dr. Emile Gluck-Thaler",
    role: "Runs the lab it is built for",
    blurb:
      "Emile leads the Fungal Interactions Lab at UW-Madison, where we both work. He is putting ResearchOS to use in the lab as we build it, and he will lead getting it in front of other academic labs.",
  },
];

const ONWARD: { href: string; title: string; sub: string; external?: boolean }[] = [
  { href: "/pricing", title: "Pricing", sub: "Every number, the real cost math" },
  { href: "/transparency", title: "Transparency", sub: "We reproduce peer-reviewed results" },
  { href: "/thanks", title: "Thanks", sub: "Sponsors and the open source we build on" },
  { href: GITHUB_URL, title: "GitHub", sub: "Read and fork the source", external: true },
];

export default function AboutPage() {
  // TEMP: hide the public /about page on deployed builds. It tells a solo-founder
  // story that is now out of date (Emile is a co-founder), and the page will be
  // remade. Shows a Beaker maintenance state on prod/preview; the real page still
  // renders in local `next dev`. Set ABOUT_LIVE=true to expose it, or remove this
  // block once the page is rewritten.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ABOUT_LIVE !== "true"
  ) {
    return (
      <div className="min-h-screen bg-surface-sunken">
        <MarketingNav />
        <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 py-20 text-center">
          <BeakerBot
            pose="idle"
            animated={false}
            className="h-40 w-40 text-sky-500"
            ariaLabel="BeakerBot updating the about page"
          />
          <h1 className="mt-6 text-2xl font-semibold text-foreground sm:text-3xl">
            Our story is getting an update
          </h1>
          <p className="mt-3 max-w-md text-body leading-relaxed text-foreground-muted">
            We are refreshing this page now that the team has grown. Back soon,
            with the full picture of who is building ResearchOS.
          </p>
          <Link
            href="/"
            className="mt-7 rounded-full border border-border px-5 py-2 text-meta font-medium text-foreground hover:bg-surface"
          >
            Back to home
          </Link>
        </main>
        <MarketingFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken text-foreground">
      <div aria-hidden className="brand-rainbow-bg h-2 w-full" />
      <MarketingNav />

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <header className="relative isolate overflow-hidden border-b border-border">
        <MarketingBackdrop tone="soft" />
        <Reveal className="relative z-10 mx-auto w-full max-w-[860px] px-6 py-16 text-center">
          <div className="flex justify-center">
            <Kicker>about ResearchOS</Kicker>
          </div>
          <h1 className="mx-auto mt-4 max-w-[22ch] text-display font-extrabold leading-[1.08] tracking-tight text-brand-ink dark:text-foreground sm:text-5xl">
            Research software should be accessible and{" "}
            <span
              style={{
                background: RAINBOW_TEXT,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              better
            </span>
            , not expensive and locked
          </h1>
          <p className="mx-auto mt-5 max-w-[58ch] text-title leading-relaxed text-foreground-muted">
            ResearchOS grew out of a research fellowship at UW-Madison. The
            tools labs depend on are overpriced and hold your data hostage in
            someone else&apos;s cloud. We build free, open, local-first
            alternatives, and the goal is not just cheaper, it is better.
          </p>
        </Reveal>
      </header>

      <main className="flex-1">
        {/* ── The story (how it actually started) ─────────────────────── */}
        <section className="border-b border-border">
          <Reveal className="mx-auto w-full max-w-[760px] px-6 py-14">
            <Kicker>how it started</Kicker>
            <h2 className="mt-3 max-w-[26ch] text-heading font-extrabold tracking-tight text-foreground">
              It started with a lab notebook we did not like
            </h2>
            <div className="mt-6">
              <p className="text-title leading-relaxed text-foreground-muted">
                ResearchOS began with a real problem. Emile was setting his lab
                up on an electronic lab notebook, LabArchives, and asked what I
                thought. I tried it and came away really dissatisfied. It was
                expensive, it got in the way more than it helped, and it kept the
                lab&apos;s own data locked inside someone else&apos;s cloud.
              </p>
              <p className="mt-4 text-title leading-relaxed text-foreground-muted">
                So for fun I started building a better, cheaper notebook, one
                actually tailored to how academics work. That side project turned
                into months of the two of us going back and forth, spitballing
                ideas, throwing out what did not work and keeping what did.
                ResearchOS is where that landed.
              </p>
              <p className="mt-4 text-title leading-relaxed text-foreground-muted">
                We are honest about where we are. We are still building. I write
                most of the code, Emile is piloting ResearchOS day to day in his
                lab, and he will help bring it to other labs as we go. We are on
                the same research team, and the plan is simple, anything
                ResearchOS earns goes back into our own science.
              </p>
              <p className="mt-6 text-body font-semibold text-foreground">
                Grant and Emile
              </p>
            </div>
          </Reveal>
        </section>

        {/* ── The journey (winding feature map) ───────────────────────── */}
        <section className="border-b border-border">
          <Reveal className="mx-auto w-full max-w-[1120px] px-6 py-14">
            <Kicker>the journey</Kicker>
            <h2 className="mt-3 max-w-[26ch] text-heading font-extrabold tracking-tight text-foreground">
              What we have built so far
            </h2>
            <p className="mt-4 max-w-[60ch] text-body leading-relaxed text-foreground-muted">
              The big features, in the order they actually landed. We are not done,
              the trail keeps going.
            </p>

            {/* Desktop: a boustrophedon flight-path map. The dotted rocket trail
                is a static SVG (so it never trips the inline-svg icon guard) and
                snakes left to right then back, showing in the gaps between the
                opaque cards and on the U-turns. BeakerBot rides a spaceship at
                the end of the trail. */}
            <div className="relative mx-auto mt-10 hidden h-[760px] w-full max-w-[1040px] md:block">
              <img
                src="/about/rocket-trail.svg"
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
              {TRAIL.map((c, i) => (
                <div
                  key={c.title}
                  className="absolute z-10 w-[27%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface-raised px-4 py-3 shadow-[0_18px_40px_-26px_rgba(15,40,80,0.55)]"
                  style={{ left: `${c.x}%`, top: `${c.y}%` }}
                >
                  {/* The numbered stop badge, on the trail. */}
                  <span className="absolute -left-3 -top-3 grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-action to-brand-purple text-[12px] font-extrabold text-white ring-4 ring-surface-sunken shadow-[0_8px_18px_-8px_rgba(15,40,80,0.8)]">
                    {i + 1}
                  </span>
                  <span className="block text-body font-extrabold text-foreground">
                    {c.title}
                  </span>
                  <span className="mt-1 block text-[12px] leading-snug text-foreground-muted">
                    {c.sub}
                  </span>
                </div>
              ))}
              {/* The end of the trail: BeakerBot blasting off, because we are
                  still building. */}
              <div
                className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ left: `${TRAIL_END.x}%`, top: `${TRAIL_END.y}%` }}
              >
                <div className="relative h-36 w-36">
                  <img
                    src="/about/spaceship.svg"
                    alt=""
                    aria-hidden
                    className="pointer-events-none absolute inset-0 h-full w-full drop-shadow-[0_18px_30px_rgba(15,40,80,0.35)]"
                  />
                  <BeakerBot
                    pose="cheering"
                    animated={false}
                    className="absolute left-1/2 top-[36%] h-[52px] w-[52px] -translate-x-1/2 -translate-y-1/2"
                    ariaLabel="BeakerBot blasting off"
                  />
                </div>
                <div className="mt-1 w-[230px] rounded-2xl border border-border bg-surface-raised px-4 py-3 text-center shadow-[0_18px_40px_-26px_rgba(15,40,80,0.55)]">
                  <span className="block text-body font-extrabold text-foreground">
                    BeakerBot
                  </span>
                  <span className="mt-1 block text-[12px] leading-snug text-foreground-muted">
                    An AI lab assistant that runs on your own data. And we are
                    still building, so the trail keeps going.
                  </span>
                </div>
              </div>
            </div>

            {/* Mobile: a plain stacked list with a straight dashed spine. */}
            <ol className="relative mt-8 space-y-4 md:hidden">
              <span
                aria-hidden
                className="absolute left-[21px] top-6 bottom-6 w-[2px] rounded-full bg-gradient-to-b from-brand-action via-brand-purple to-brand-action opacity-60"
              />
              {TRAIL.map((c, i) => (
                <li key={c.title} className="relative flex items-start gap-4">
                  <span className="relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-action to-brand-purple text-[13px] font-extrabold text-white shadow-[0_10px_24px_-14px_rgba(15,40,80,0.7)]">
                    {i + 1}
                  </span>
                  <span className="flex-1 rounded-xl border border-border bg-surface-raised px-4 py-2.5">
                    <span className="block text-body font-extrabold text-foreground">
                      {c.title}
                    </span>
                    <span className="block text-[11.5px] leading-snug text-foreground-muted">
                      {c.sub}
                    </span>
                  </span>
                </li>
              ))}
              <li className="relative flex items-start gap-4">
                <span className="relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-action to-brand-purple shadow-[0_10px_24px_-14px_rgba(15,40,80,0.7)]">
                  <BeakerBot
                    pose="cheering"
                    animated={false}
                    className="h-7 w-7 text-white"
                    ariaLabel="BeakerBot blasting off"
                  />
                </span>
                <span className="flex-1 rounded-xl border border-border bg-surface-raised px-4 py-2.5">
                  <span className="block text-body font-extrabold text-foreground">
                    BeakerBot
                  </span>
                  <span className="block text-[11.5px] leading-snug text-foreground-muted">
                    An AI lab assistant on your own data. Still building, more on
                    the way.
                  </span>
                </span>
              </li>
            </ol>
          </Reveal>
        </section>

        {/* ── The two people behind it ────────────────────────────────── */}
        <section className="border-b border-border">
          <Reveal className="mx-auto w-full max-w-[1120px] px-6 py-14">
            <Kicker>who is building it</Kicker>
            <h2 className="mt-3 max-w-[24ch] text-heading font-extrabold tracking-tight text-foreground">
              Two researchers, one team
            </h2>
            <p className="mt-4 max-w-[64ch] text-body leading-relaxed text-foreground-muted">
              ResearchOS is built by two people on the same research team, the{" "}
              <a
                href="https://fungi.cals.wisc.edu/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-action underline-offset-2 hover:underline"
              >
                Fungal Interactions Lab
              </a>{" "}
              at UW-Madison, not a faceless company. We are still small and still
              building, and we would rather tell you that plainly than pretend
              otherwise.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {PEOPLE.map((p) => (
                <div
                  key={p.name}
                  className="flex gap-4 rounded-2xl border border-border bg-surface-raised p-5"
                >
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-action to-brand-purple text-base font-extrabold text-white shadow-[0_10px_24px_-14px_rgba(15,40,80,0.7)]">
                    {p.initial}
                  </span>
                  <div>
                    <h3 className="text-body font-extrabold text-foreground">
                      {p.name}
                    </h3>
                    <p className="text-meta font-semibold text-brand-action">
                      {p.role}
                    </p>
                    {p.credential ? (
                      <span className="mt-2 inline-block rounded-full border border-brand-action/25 bg-brand-action/[0.06] px-2.5 py-1 text-[11px] font-semibold text-brand-action">
                        {p.credential}
                      </span>
                    ) : null}
                    <p className="mt-1.5 text-meta leading-relaxed text-foreground-muted">
                      {p.blurb}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ── Why it exists ───────────────────────────────────────────── */}
        <section className="border-b border-border">
          <Reveal className="mx-auto w-full max-w-[1120px] px-6 py-14">
            <Kicker>why it exists</Kicker>
            <h2 className="mt-3 max-w-[28ch] text-heading font-extrabold tracking-tight text-foreground">
              Good research tooling should be a public good
            </h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-border bg-surface-raised p-5">
                <h3 className="text-body font-extrabold text-foreground">
                  One app, not ten licenses
                </h3>
                <p className="mt-1.5 text-meta leading-relaxed text-foreground-muted">
                  Lab software is sold one expensive license at a time, the
                  notebook, the chemistry tool, the cloning tool, the stats
                  package, renewed every year for every student who rotates
                  through. ResearchOS replaces that stack with one free app.
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-surface-raised p-5">
                <h3 className="text-body font-extrabold text-foreground">
                  Inspectable, ownable, free
                </h3>
                <p className="mt-1.5 text-meta leading-relaxed text-foreground-muted">
                  The code is open source on GitHub, export is the default state
                  rather than a panic button, and a real, accountable business
                  stands behind it rather than a donation link that can vanish.
                </p>
              </div>
            </div>
            <p className="mt-5 max-w-[64ch] text-body leading-relaxed text-foreground-muted">
              Local-first means your notes, methods, experiments, structures, and
              files live in a plain folder on your own disk, readable with or
              without ResearchOS. The science is validated in public on the{" "}
              <Link
                href="/transparency"
                className="font-medium text-brand-action underline-offset-2 hover:underline"
              >
                transparency page
              </Link>
              , where the calculations recompute against peer-reviewed tools.
            </p>
          </Reveal>
        </section>

        {/* ── The company behind it ───────────────────────────────────── */}
        <section className="border-b border-border">
          <Reveal className="mx-auto w-full max-w-[1120px] px-6 py-14">
            <Kicker>the company behind it</Kicker>
            <h2 className="mt-3 max-w-[24ch] text-heading font-extrabold tracking-tight text-foreground">
              A real, accountable business
            </h2>
            <p className="mt-4 max-w-[64ch] text-body leading-relaxed text-foreground-muted">
              ResearchOS is a registered Wisconsin LLC with real banking and
              payment processing in place. The local app and every feature stay
              free. The only paid parts are optional cloud storage and the
              optional AI assistant, both metered at cost. Full breakdown on the{" "}
              <Link
                href="/pricing"
                className="font-medium text-brand-action underline-offset-2 hover:underline"
              >
                pricing page
              </Link>
              .
            </p>
            <p className="mt-3 max-w-[64ch] text-body leading-relaxed text-foreground-muted">
              ResearchOS grew out of work Grant began during a UW-Madison
              Distinguished Research Fellowship, which is what funds the free and
              open core. Because it is open source and local-first, voluntary{" "}
              <Link
                href="/thanks"
                className="font-medium text-brand-action underline-offset-2 hover:underline"
              >
                GitHub Sponsors
              </Link>
              {" "}are enough to keep it free and open for the whole research community.
            </p>
            <p className="mt-3 max-w-[64ch] text-body leading-relaxed text-foreground-muted">
              We are two researchers on the same team, and the goal is not to get
              rich off other labs. Anything ResearchOS earns, we put back into our
              own research. That is the whole point.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-gradient-to-br from-brand-action/[0.05] to-brand-purple/[0.05] px-5 py-4">
              <MadeInMadison variant="badge" tone="punchy" />
              <span className="text-meta font-semibold text-foreground-muted">
                A registered Wisconsin LLC, not a California cloud.
              </span>
            </div>
          </Reveal>
        </section>

        {/* ── Onward ──────────────────────────────────────────────────── */}
        <section>
          <Reveal className="mx-auto w-full max-w-[1120px] px-6 py-14">
            <Kicker>keep reading</Kicker>
            <h2 className="mt-3 mb-5 text-heading font-extrabold tracking-tight text-foreground">
              Go deeper
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {ONWARD.map((o) =>
                o.external ? (
                  <a
                    key={o.href}
                    href={o.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-xl border border-border bg-surface-raised p-4 transition-transform hover:-translate-y-0.5 hover:border-brand-action/40"
                  >
                    <div className="text-body font-extrabold text-foreground">{o.title}</div>
                    <div className="mt-1 text-[11.5px] text-foreground-muted">{o.sub}</div>
                  </a>
                ) : (
                  <Link
                    key={o.href}
                    href={o.href}
                    className="rounded-xl border border-border bg-surface-raised p-4 transition-transform hover:-translate-y-0.5 hover:border-brand-action/40"
                  >
                    <div className="text-body font-extrabold text-foreground">{o.title}</div>
                    <div className="mt-1 text-[11.5px] text-foreground-muted">{o.sub}</div>
                  </Link>
                ),
              )}
            </div>
          </Reveal>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
