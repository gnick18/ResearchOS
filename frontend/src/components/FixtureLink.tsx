"use client";

import Link, { type LinkProps } from "next/link";
import { useSearchParams } from "next/navigation";
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";

/**
 * Drop-in replacement for `next/link` that preserves the `?wikiCapture=…`
 * fixture flag across internal navigation. Persona 02 and persona 13 of the
 * QA tour both hit the same bug: a `<Link>` to an internal route dropped
 * the param mid-tour, so the next page rendered against the user's real
 * folder data — exactly the screenshot-privacy violation the URL gate is
 * supposed to prevent (AGENTS.md §6).
 *
 * Behavior:
 *  - If the current URL carries `?wikiCapture=<value>`, that param is
 *    appended (or merged) onto any internal `/`-rooted href.
 *  - External hrefs (`https://…`, `mailto:`, `#anchor`, etc.) pass through
 *    untouched.
 *  - When no `wikiCapture` is present on the current URL, the href is
 *    untouched — same behavior as `next/link`.
 *
 * URL remains the source of truth for fixture mode; this wrapper only
 * propagates it. `isWikiCaptureMode()` / `getDemoMode()` semantics are
 * unchanged.
 */

type Href = LinkProps["href"];

export function withFixtureParam(href: Href, captureValue: string | null): Href {
  if (!captureValue) return href;
  if (typeof href !== "string") return href;
  // Internal routes start with a single "/". Reject protocol-relative ("//"),
  // anchors ("#…"), relative paths, and absolute URLs (mailto:, https:, etc.).
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}wikiCapture=${encodeURIComponent(captureValue)}`;
}

type FixtureLinkProps = Omit<LinkProps, "href"> &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    href: Href;
    children?: ReactNode;
  };

const FixtureLink = forwardRef<HTMLAnchorElement, FixtureLinkProps>(
  function FixtureLink({ href, children, ...rest }, ref) {
    const params = useSearchParams();
    const capture = params?.get("wikiCapture") ?? null;
    const finalHref = withFixtureParam(href, capture);
    return (
      <Link href={finalHref} ref={ref} {...rest}>
        {children}
      </Link>
    );
  },
);

export default FixtureLink;
