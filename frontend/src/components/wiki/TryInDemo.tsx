"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { enterDemo } from "@/lib/demo/enter-demo";

interface Props {
  /** App route to deep-link into (with or without leading slash). The
   *  component prepends `/demo` so the catch-all route at
   *  `/demo/[[...slug]]` installs the fixture and redirects to the
   *  app route with demo mode sticky. */
  href: string;
  children: ReactNode;
}

/**
 * Inline call-out that drops the reader from a wiki page into a live
 * demo of the feature being documented. Picks up the demo banner's
 * amber accent so it's instantly identifiable as a demo affordance.
 */
export function TryInDemo({ href, children }: Props) {
  const normalized = href.startsWith("/") ? href : "/" + href;
  return (
    <Link
      href={"/demo" + normalized}
      onClick={(e) => {
        e.preventDefault();
        enterDemo(normalized, { rememberRoute: true });
      }}
      className="inline-flex items-center gap-2 my-4 px-4 py-2 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-900 hover:bg-amber-500/25 transition no-underline font-medium"
    >
      <span>{children}</span>
      <span aria-hidden>→</span>
    </Link>
  );
}

export default TryInDemo;
