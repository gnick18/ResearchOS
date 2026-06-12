import type { Metadata } from "next";
import Link from "next/link";

import MadeInMadison from "@/components/MadeInMadison";
import MarketingFooter from "@/components/MarketingFooter";
import MarketingNav from "@/components/MarketingNav";

/**
 * Public `/about` company page. Every other research-tool company has an about
 * page, and ResearchOS did not, so the origin story and the "real, accountable
 * business" signal lived only inside the welcome scroll. This is the canonical
 * surface for who builds ResearchOS and why, and it is where Dr. Grant Nickles
 * is named as the founder.
 *
 * Marketing page, rendered without the AppShell or a connected folder so anyone
 * can read it. Mission and positioning copy is inherited from the welcome page
 * and docs/branding/POSITIONING.md, kept real and not salesy.
 *
 * Voice rules: no em-dashes, no emojis, no mid-sentence colons. State the why.
 */
const GITHUB_URL = "https://github.com/gnick18/ResearchOS";

export const metadata: Metadata = {
  title: "About | ResearchOS",
  description:
    "ResearchOS is an open-source company that grew out of a research fellowship at UW-Madison. It builds free, local-first alternatives to the expensive tools labs depend on, so researchers own their data and can verify the science in public. A registered Wisconsin LLC stands behind it.",
};

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken text-foreground">
      <MarketingNav />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <p className="mb-3 text-body font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-300">
          About ResearchOS
        </p>
        <h1 className="mb-6 max-w-[24ch] text-display font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
          Research software should be accessible and better, not expensive and
          locked
        </h1>

        <div className="space-y-5 text-title leading-relaxed text-foreground-muted">
          <p>
            ResearchOS is an{" "}
            <span className="font-semibold text-foreground">
              open-source company
            </span>{" "}
            (AGPLv3) that grew out of a research fellowship at UW-Madison. The
            tools labs depend on are overpriced, and they hold your data hostage
            in someone else&apos;s cloud. We build free, open, local-first
            alternatives, and the goal is not just cheaper, it is{" "}
            <span className="font-semibold text-foreground">better</span>.
          </p>
          <p>
            Local-first means your notes, methods, experiments, structures, and
            files live in a plain folder on your own disk, readable with or
            without ResearchOS. That is the whole reason your data stays yours,
            because it never has to leave your machine, you can answer the
            compliance question honestly, and you keep working when no server is
            up. The science is validated in public on the{" "}
            <Link
              href="/transparency"
              className="font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
            >
              transparency page
            </Link>
            , where the calculations recompute against peer-reviewed tools, so
            you can trust the numbers in your paper instead of a black box.
          </p>
        </div>

        <section className="mt-12">
          <h2 className="mb-4 text-xl font-extrabold tracking-tight text-foreground">
            Why it exists
          </h2>
          <div className="space-y-5 text-body leading-relaxed text-foreground-muted">
            <p>
              Lab software is sold one expensive license at a time, the
              notebook, the chemistry tool, the cloning tool, the stats package,
              and a lab pays again every year for every student who rotates
              through. ResearchOS replaces that stack with one free app, so a
              grad student does not pay for software out of a stipend and a PI
              does not carry a per-seat bill for the whole team.
            </p>
            <p>
              Good research tooling should be a public good, inspectable,
              ownable, and free. That is why the code is open source on{" "}
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
              >
                GitHub
              </a>
              , why export is the default state rather than a panic button, and
              why a real, accountable business stands behind it rather than a
              donation link that can vanish.
            </p>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="mb-4 text-xl font-extrabold tracking-tight text-foreground">
            The company behind it
          </h2>
          <div className="space-y-5 text-body leading-relaxed text-foreground-muted">
            <p>
              ResearchOS is a registered Wisconsin LLC, with real banking and
              payment processing in place. We are the merchant of record, so the
              optional cloud storage, when it turns on, is a real and accountable
              business, not a hobby. The local app and every feature stay free.
              The only paid parts are the optional cloud storage and the optional
              AI assistant, both metered at cost so we recover what they cost us
              and nothing more. You can read the full breakdown on the{" "}
              <Link
                href="/pricing"
                className="font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
              >
                pricing page
              </Link>
              .
            </p>
            <p>
              ResearchOS is supported by a UW Distinguished Research Fellowship
              at UW-Madison, with funding from the Wisconsin Alumni Research
              Foundation. That funding, plus voluntary sponsorships on{" "}
              <Link
                href="/thanks"
                className="font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
              >
                GitHub Sponsors
              </Link>
              , is what keeps the core free and open for the whole research
              community.
            </p>
          </div>
        </section>

        <section className="mt-12 rounded-2xl border border-border bg-surface-raised p-6">
          <p className="text-body leading-relaxed text-foreground">
            Dr. Grant Nickles, founder
          </p>
          <p className="mt-1 text-meta leading-relaxed text-foreground-muted">
            ResearchOS started as one researcher&apos;s answer to overpaying for
            tools that locked the work away. It is built in the open so the
            people who use it can see exactly how it works and own what they put
            into it.
          </p>
          <div className="mt-4">
            <MadeInMadison variant="badge" tone="punchy" />
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
