"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { findWikiNode, getPrevNext, WIKI_NAV } from "@/lib/wiki/nav";
import type { ReactNode } from "react";

interface Props {
  /** Page title — falls back to the matching WIKI_NAV label if omitted. */
  title?: string;
  /** Short subtitle / "what this does" sentence shown under the H1. */
  intro?: ReactNode;
  children: ReactNode;
}

/** Shared wrapper for every wiki page. Provides:
 *   - breadcrumb derived from the URL
 *   - H1 (auto-pulls label from WIKI_NAV)
 *   - intro lede
 *   - main content slot
 *   - prev/next nav across the flattened tree
 *
 *  Pages should compose this with Callout, Screenshot, Steps, Kbd. */
export default function WikiPage({ title, intro, children }: Props) {
  const pathname = usePathname();
  const node = findWikiNode(pathname);
  const heading = title ?? node?.label ?? "ResearchOS Wiki";
  const { prev, next } = getPrevNext(pathname);
  const crumbs = buildCrumbs(pathname);

  return (
    <article className="max-w-3xl mx-auto px-6 lg:px-10 py-8">
      {crumbs.length > 1 ? (
        <nav aria-label="Breadcrumb" className="mb-3 text-xs text-gray-500">
          <ol className="flex flex-wrap gap-1.5">
            {crumbs.map((c, i) => (
              <li key={c.href} className="flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden>›</span> : null}
                {i === crumbs.length - 1 ? (
                  <span className="text-gray-700 font-medium">{c.label}</span>
                ) : (
                  <Link href={c.href} className="hover:text-gray-900 hover:underline">
                    {c.label}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{heading}</h1>
      {intro ? <p className="mt-2 text-base text-gray-600 leading-relaxed">{intro}</p> : null}

      <div
        className="
          mt-6 text-[15px] leading-relaxed text-gray-800
          [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-900
          [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-900
          [&_p]:my-3
          [&_a]:text-blue-600 [&_a:hover]:underline
          [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul>li]:my-1
          [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[13px] [&_code]:font-mono
          [&_strong]:font-semibold [&_strong]:text-gray-900
        "
      >
        {children}
      </div>

      <PrevNext prev={prev} next={next} />
    </article>
  );
}

interface Crumb {
  href: string;
  label: string;
}

function buildCrumbs(pathname: string): Crumb[] {
  const out: Crumb[] = [{ href: "/wiki", label: "Wiki" }];
  if (pathname === "/wiki") return out;

  const segments = pathname.split("/").filter(Boolean);
  let accum = "";
  for (let i = 0; i < segments.length; i++) {
    accum += "/" + segments[i];
    if (accum === "/wiki") continue;
    const node = findWikiNode(accum, WIKI_NAV);
    if (node) {
      out.push({ href: node.href, label: node.label });
    }
  }
  return out;
}

function PrevNext({
  prev,
  next,
}: {
  prev: ReturnType<typeof getPrevNext>["prev"];
  next: ReturnType<typeof getPrevNext>["next"];
}) {
  if (!prev && !next) return null;
  return (
    <nav
      aria-label="Wiki pagination"
      className="mt-12 pt-6 border-t border-gray-200 flex items-stretch gap-3"
    >
      {prev ? (
        <Link
          href={prev.href}
          className="flex-1 min-w-0 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 px-4 py-3 transition-colors group"
        >
          <div className="text-[11px] text-gray-400 uppercase tracking-wide">← Previous</div>
          <div className="mt-0.5 text-sm font-medium text-gray-900 truncate">{prev.label}</div>
        </Link>
      ) : (
        <div className="flex-1" />
      )}
      {next ? (
        <Link
          href={next.href}
          className="flex-1 min-w-0 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 px-4 py-3 transition-colors text-right group"
        >
          <div className="text-[11px] text-gray-400 uppercase tracking-wide">Next →</div>
          <div className="mt-0.5 text-sm font-medium text-gray-900 truncate">{next.label}</div>
        </Link>
      ) : (
        <div className="flex-1" />
      )}
    </nav>
  );
}
