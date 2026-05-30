/**
 * "Request a new widget" stub (Extension Store Phase U3).
 *
 * A STUB, not the contributor pipeline (that is U4). It opens a prefilled
 * GitHub issue via the existing `generateGitHubIssueUrl` rail
 * (frontend/src/lib/error-reporting.ts) against `gnick18/ResearchOS`, exactly
 * the way FeedbackModal files a feature request and the way the U2
 * "request a method type" stub does. There is no server-side submission: the
 * user lands on GitHub's new-issue form with the title + body prefilled and
 * submits it themselves (local-first, no app server).
 *
 * Widgets are CODE shipped via reviewed PRs (EXTENSION doc §1.5 / §3.6, no
 * data-only widget template), so the realistic ask is "please build + review
 * this widget". The prefill frames it that way and reuses the `feature` issue
 * template, the same one the feedback modal's feature-request path uses.
 */

import { generateGitHubIssueUrl } from "@/lib/error-reporting";

export interface RequestWidgetInput {
  /** What the user typed describing the widget they want (free text). May be
   *  empty (the prefill still produces a sensible skeleton). */
  description?: string;
}

/** The boilerplate that frames the request as a new-widget ask. Exported so
 *  the test can assert the body without duplicating the copy. */
export const REQUEST_WIDGET_PREAMBLE =
  "Requesting a new dashboard / home widget for the Widget store.";

/**
 * Build the prefilled GitHub-issue URL for a "request a new widget" action.
 * Routes through `generateGitHubIssueUrl({ type: "feature", ... })` so it
 * inherits the feature template, the `[Feature]` title tag, and the
 * `enhancement` label, then frames the body as a widget ask.
 */
export function buildRequestWidgetUrl(input: RequestWidgetInput = {}): string {
  const detail = (input.description ?? "").trim();
  const titleDetail = detail.length > 0 ? detail.slice(0, 80) : "New widget";
  const body =
    detail.length > 0
      ? `${REQUEST_WIDGET_PREAMBLE}\n\n${detail}`
      : `${REQUEST_WIDGET_PREAMBLE}\n\nDescribe the widget you'd like: the lab data it surfaces, the headline stat its tile should show, and the action you'd take from its expanded view.`;

  return generateGitHubIssueUrl({
    type: "feature",
    title: `New widget: ${titleDetail}`,
    description: body,
  });
}
