/**
 * Section shell + heading helpers for /pricing. A Section is one bordered band;
 * SectionHeading renders the centered title + optional subtitle. Keeps the page
 * file declarative and matches the mockup's .sec / .sectitle / .sectsub.
 *
 * Voice: no em-dashes, no emojis, no mid-sentence colons.
 */

import type { ReactNode } from "react";

import Reveal from "@/components/marketing/Reveal";

export function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`border-b border-border px-3 py-6 last:border-b-0 sm:px-8 sm:py-8 ${className}`}
    >
      {/* Shared marketing scroll-reveal: each band lifts in as it scrolls on
          screen, the same entrance the welcome page and login hero use. */}
      <Reveal>{children}</Reveal>
    </section>
  );
}

export function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <>
      <h2 className="mb-1 text-center text-xl font-extrabold text-brand-ink dark:text-foreground">
        {title}
      </h2>
      {subtitle ? (
        <p className="mx-auto mb-5 max-w-[64ch] text-center text-[13px] leading-relaxed text-foreground-muted">
          {subtitle}
        </p>
      ) : null}
    </>
  );
}
