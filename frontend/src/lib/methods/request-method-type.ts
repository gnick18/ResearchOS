/**
 * "Request a new method type" stub (Extension Store Phase U2).
 *
 * A STUB, not the contributor pipeline (that is U4). It opens a prefilled
 * GitHub issue via the existing `generateGitHubIssueUrl` rail
 * (frontend/src/lib/error-reporting.ts) against `gnick18/ResearchOS`, exactly
 * the way FeedbackModal files a feature request. There is no server-side
 * submission: the user lands on GitHub's new-issue form with the title +
 * body prefilled and submits it themselves (local-first, no app server).
 *
 * Method types are CODE shipped via reviewed PRs (EXTENSION doc §1.5), so the
 * realistic ask is "please build + review this type". The prefill frames it
 * that way and reuses the `feature` issue template, the same one the feedback
 * modal's feature-request path uses.
 */

import { generateGitHubIssueUrl } from "@/lib/error-reporting";

export interface RequestMethodTypeInput {
  /** What the user typed describing the method type they want (free text).
   *  May be empty (the prefill still produces a sensible skeleton). */
  description?: string;
}

/** The boilerplate that frames the request as a new-method-type ask. Exported
 *  so the test can assert the body without duplicating the copy. */
export const REQUEST_METHOD_TYPE_PREAMBLE =
  "Requesting a new structured method type for the Method library.";

/**
 * Build the prefilled GitHub-issue URL for a "request a new method type"
 * action. Routes through `generateGitHubIssueUrl({ type: "feature", ... })`
 * so it inherits the feature template, the `[Feature]` title tag, and the
 * `enhancement` label, then frames the body as a method-type ask.
 */
export function buildRequestMethodTypeUrl(
  input: RequestMethodTypeInput = {},
): string {
  const detail = (input.description ?? "").trim();
  const titleDetail = detail.length > 0 ? detail.slice(0, 80) : "New method type";
  const body = detail.length > 0
    ? `${REQUEST_METHOD_TYPE_PREAMBLE}\n\n${detail}`
    : `${REQUEST_METHOD_TYPE_PREAMBLE}\n\nDescribe the method type you'd like: what it captures, the structured fields it needs, and an example use case.`;

  return generateGitHubIssueUrl({
    type: "feature",
    title: `New method type: ${titleDetail}`,
    description: body,
  });
}
