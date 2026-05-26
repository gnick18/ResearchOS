"use client";

import Link, { type LinkProps } from "next/link";
import { useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";

/**
 * Drop-in replacement for `next/link` that preserves the `?wikiCapture=…`
 * fixture flag across internal navigation. Persona 02 and persona 13 of the
 * QA tour both hit the same bug: a `<Link>` to an internal route dropped
 * the param mid-tour, so the next page rendered against the user's real
 * folder data, exactly the screenshot-privacy violation the URL gate is
 * supposed to prevent (AGENTS.md §6).
 *
 * Behavior:
 *  - For each param in the allowlist below, if the current URL carries it,
 *    that param is appended (or merged) onto any internal `/`-rooted href.
 *  - External hrefs (`https://…`, `mailto:`, `#anchor`, etc.) pass through
 *    untouched.
 *  - When no allowlisted params are present on the current URL, the href is
 *    untouched, same behavior as `next/link`.
 *
 * URL remains the source of truth for fixture mode; this wrapper only
 * propagates it. `isWikiCaptureMode()` / `getDemoMode()` semantics are
 * unchanged.
 *
 * Panel investigator follow-up (finding #2): previously this only
 * re-injected `wikiCapture`. `wizard-preview=1` and `wizardSeedStep=<id>`
 * are stripped by `TourController.stripPreviewQueryParams` on auto-nav and
 * were never re-attached on user-click, so reload mid-tour preserved
 * `wikiCapture=picker` but lost `wizard-preview=1`. SessionStorage sticky
 * flags keep the tour mounted, so this was URL-vs-state asymmetry rather
 * than a functional regression. All three params are dev-only / localhost-
 * gated (`wiki-capture-mock.ts:194-198`), so re-attachment has no
 * production impact.
 */

type Href = LinkProps["href"];

// Allowlist of fixture / preview params we propagate across internal
// navigation. Order is preserved when building the merged query string.
const FIXTURE_PARAM_ALLOWLIST = [
  "wikiCapture",
  "wizard-preview",
  "wizardSeedStep",
] as const;

type FixtureParamValues = Partial<Record<(typeof FIXTURE_PARAM_ALLOWLIST)[number], string>>;

export function withFixtureParam(
  href: Href,
  captureValue: string | null | FixtureParamValues,
): Href {
  if (typeof href !== "string") return href;
  // Internal routes start with a single "/". Reject protocol-relative ("//"),
  // anchors ("#…"), relative paths, and absolute URLs (mailto:, https:, etc.).
  if (!href.startsWith("/") || href.startsWith("//")) return href;

  // Normalize the legacy `(href, captureValue: string)` form into the
  // current-URL params record. Old call sites and the test suite still
  // pass a raw `wikiCapture` value; both code paths produce the same
  // merged href.
  const values: FixtureParamValues =
    typeof captureValue === "string"
      ? { wikiCapture: captureValue }
      : captureValue ?? {};

  let out = href;
  for (const key of FIXTURE_PARAM_ALLOWLIST) {
    const raw = values[key];
    if (!raw) continue;
    const sep = out.includes("?") ? "&" : "?";
    out = `${out}${sep}${key}=${encodeURIComponent(raw)}`;
  }
  return out;
}

function collectFixtureParams(
  params: ReadonlyURLSearchParams | null,
): FixtureParamValues {
  const out: FixtureParamValues = {};
  if (!params) return out;
  for (const key of FIXTURE_PARAM_ALLOWLIST) {
    const v = params.get(key);
    if (v) out[key] = v;
  }
  return out;
}

type FixtureLinkProps = Omit<LinkProps, "href"> &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    href: Href;
    children?: ReactNode;
  };

const FixtureLink = forwardRef<HTMLAnchorElement, FixtureLinkProps>(
  function FixtureLink({ href, children, ...rest }, ref) {
    const params = useSearchParams();
    const finalHref = withFixtureParam(href, collectFixtureParams(params));
    return (
      <Link href={finalHref} ref={ref} {...rest}>
        {children}
      </Link>
    );
  },
);

export default FixtureLink;
