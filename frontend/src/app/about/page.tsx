import type { Metadata } from "next";
import Link from "next/link";

import MadeInMadison from "@/components/MadeInMadison";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import Reveal from "@/components/marketing/Reveal";

/**
 * Public `/about` company page. The origin story and the "real, accountable
 * business" signal, where Dr. Grant Nickles is named as the founder. Rebuilt to
 * the approved mockup (docs/mockups/2026-06-12-about-redesign.html): a brand
 * hero with a founder portrait, the founder story paired with a candid field
 * photo, branded section blocks, and the Built-in-Madison credibility. Same
 * premium chrome as the welcome and pricing pages (rainbow ribbon, brand
 * backdrop, Reveal scroll-ins, pastel-rainbow kickers).
 *
 * Marketing page, rendered without the AppShell or a connected folder so anyone
 * can read it. Mission and positioning copy inherited from the welcome page and
 * docs/branding/POSITIONING.md, kept real and not salesy.
 *
 * Voice rules: no em-dashes, no emojis, no mid-sentence colons. State the why.
 */
const GITHUB_URL = "https://github.com/gnick18/ResearchOS";
const RAINBOW_TEXT = "var(--brand-rainbow-vivid)";

export const metadata: Metadata = {
  title: "About | ResearchOS",
  description:
    "ResearchOS is an open-source company that grew out of a research fellowship at UW-Madison. It builds free, local-first alternatives to the expensive tools labs depend on, so researchers own their data and can verify the science in public. A registered Wisconsin LLC stands behind it.",
};

/** A section eyebrow with the pastel-rainbow rule, matching the welcome page. */
function Kicker({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span aria-hidden className="brand-rainbow-bg h-[3px] w-6 flex-none rounded-full" />
      <span className="font-mono text-meta font-semibold uppercase tracking-[0.08em] text-brand-action">
        {children}
      </span>
    </span>
  );
}

const ONWARD: { href: string; title: string; sub: string; external?: boolean }[] = [
  { href: "/pricing", title: "Pricing", sub: "Every number, the real cost math" },
  { href: "/transparency", title: "Transparency", sub: "We reproduce peer-reviewed results" },
  { href: "/thanks", title: "Thanks", sub: "Sponsors and the open source we build on" },
  { href: GITHUB_URL, title: "GitHub", sub: "Read and fork the source", external: true },
];

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken text-foreground">
      <div aria-hidden className="brand-rainbow-bg h-2 w-full" />
      <MarketingNav />

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <header className="relative isolate overflow-hidden border-b border-border">
        <MarketingBackdrop tone="soft" />
        <Reveal className="relative z-10 mx-auto grid w-full max-w-[1120px] items-center gap-10 px-6 py-16 md:grid-cols-[1.25fr_0.75fr]">
          <div>
            <Kicker>about ResearchOS</Kicker>
            <h1 className="mt-4 max-w-[18ch] text-display font-extrabold leading-[1.08] tracking-tight text-brand-ink dark:text-foreground sm:text-5xl">
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
            <p className="mt-5 max-w-[52ch] text-title leading-relaxed text-foreground-muted">
              ResearchOS grew out of a research fellowship at UW-Madison. The
              tools labs depend on are overpriced and hold your data hostage in
              someone else&apos;s cloud. We build free, open, local-first
              alternatives, and the goal is not just cheaper, it is better.
            </p>
          </div>
          {/* Founder photo, rainbow-framed. */}
          <div className="mx-auto w-full max-w-[300px]">
            <div className="brand-rainbow-bg rounded-[20px] p-[3px] shadow-[0_26px_60px_-34px_rgba(15,40,80,0.5)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/about/grant-field.jpg"
                alt="Dr. Grant Nickles"
                width={800}
                height={1100}
                className="block aspect-[4/5] w-full rounded-[17px] object-cover object-[center_28%]"
              />
            </div>
          </div>
        </Reveal>
      </header>

      <main className="flex-1">
        {/* ── The story (human anchor) ────────────────────────────────── */}
        <section className="border-b border-border">
          <Reveal className="mx-auto w-full max-w-[1120px] px-6 py-14">
            <Kicker>the story</Kicker>
            <h2 className="mt-3 max-w-[24ch] text-heading font-extrabold tracking-tight text-foreground">
              Why one researcher built this
            </h2>
            <div className="mt-6 max-w-[68ch]">
              <div>
                <p className="text-title leading-relaxed text-foreground-muted">
                  I came up through genetics at Iowa State, then did my PhD at
                  UW-Madison mining fungal genomes for natural products and
                  running the chemistry to back it up. So I lived in a dozen tools
                  at once. A lot of my PhD wasn&apos;t spent on science. It went to
                  fighting software that cost too much and locked my own data away
                  from me. Every tool wanted another license and another login,
                  and on a grad student stipend, the stack a lab is told it needs
                  just wasn&apos;t affordable.
                </p>
                <p className="mt-4 text-title leading-relaxed text-foreground-muted">
                  I&apos;ve always been a builder. I co-ran a swim-lesson business
                  with my mom through college and spent a summer doing R&amp;D at a
                  food-security startup, so when the tooling kept getting in the
                  way of the science, I built the thing I wished I had instead.
                  That&apos;s ResearchOS. It&apos;s free, it&apos;s open, and
                  it&apos;s local-first, which is a fancy way of saying your work
                  lives on your own machine and stays yours.
                </p>
                <blockquote
                  className="mt-6 pl-4 text-xl font-bold leading-snug tracking-tight text-foreground"
                  style={{ borderLeft: "3px solid transparent", borderImage: "var(--brand-rainbow) 1" }}
                >
                  &ldquo;I wanted my data to be mine, and the tools to be something
                  any lab could afford. So I built them.&rdquo;
                </blockquote>
                <p className="mt-4 text-body font-semibold text-foreground">
                  Dr. Grant Nickles, founder
                </p>
              </div>
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
              It is supported by a UW Distinguished Research Fellowship at
              UW-Madison, with funding from the Wisconsin Alumni Research
              Foundation. That, plus voluntary{" "}
              <Link
                href="/thanks"
                className="font-medium text-brand-action underline-offset-2 hover:underline"
              >
                GitHub Sponsors
              </Link>
              , keeps the core free and open for the whole research community.
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
