// frontend/src/lib/calculators/submit-to-library.ts
//
// Custom Calculator Builder, Phase 4 (calculator manager, 2026-06-10):
// "Share to the library". A user who built a calculator can submit it to the
// public template library. There is no backend, so this mirrors the feedback
// button: it builds a pre-filled GitHub new-issue URL the user opens in a new
// tab. A maintainer reviews the submission and, if it fits, folds the spec into
// a future release seed (the static template catalog under
// frontend/public/method-catalog). Reviewed, not instant, so the curated
// library stays trustworthy.
//
// We use the body-param prefill approach (a plain `body=` field), not a YAML
// issue-form template, because issue forms ignore `body=` and only prefill
// their own field ids. The optional .github/ISSUE_TEMPLATE/calculator.yml is
// there for humans who open the issue directly; this URL is what the in-app
// button uses.

import type { CustomCalculator } from "@/lib/types";

const GITHUB_REPO = "gnick18/ResearchOS";

/** The portable, shippable subset of a CustomCalculator. The runtime-only
 *  fields (id, timestamps, owner, share state) describe one user's stored
 *  record, not the calculator itself, so they are stripped before we serialize
 *  the spec into the issue body. This is exactly the shape a future release
 *  seed would embed. */
export interface PortableCalculatorSpec {
  name: string;
  description: string;
  field?: string;
  inputs: CustomCalculator["inputs"];
  steps: CustomCalculator["steps"];
  conditionals: CustomCalculator["conditionals"];
  outputs: CustomCalculator["outputs"];
}

/** The label every submission carries so maintainers can filter the queue. */
export const CALCULATOR_SUBMISSION_LABEL = "calculator-submission";

/** A short plain-language intro that opens the issue body, so a maintainer (and
 *  the submitter) knows what the issue is and that it is reviewed before it can
 *  ship in a release. Exported so the test can assert the body without
 *  re-typing the copy. */
export const CALCULATOR_SUBMISSION_INTRO =
  "This is a calculator submitted from the in-app builder for the shared " +
  "template library. A maintainer reviews each submission, and if it fits it " +
  "ships in a later release seed so everyone gets it. Nothing is added " +
  "automatically.";

/** Strip the runtime-only fields and keep only the portable spec. */
export function toPortableSpec(calc: CustomCalculator): PortableCalculatorSpec {
  const spec: PortableCalculatorSpec = {
    name: calc.name,
    description: calc.description,
    inputs: calc.inputs,
    steps: calc.steps,
    conditionals: calc.conditionals,
    outputs: calc.outputs,
  };
  if (calc.field) spec.field = calc.field;
  return spec;
}

/**
 * Build the GitHub new-issue URL that pre-fills a calculator submission. Mirrors
 * `error-reporting.ts`: same repo, `URLSearchParams` encoding, a `labels`
 * param. The body is a plain intro, then the calculator spec as pretty JSON in
 * a fenced block, then a one-line author note prompt the submitter fills in.
 */
export function buildCalculatorSubmissionUrl(calc: CustomCalculator): string {
  const spec = toPortableSpec(calc);
  const json = JSON.stringify(spec, null, 2);

  const name = (calc.name || "").trim() || "Untitled calculator";
  const title = `Calculator submission: ${name}`;

  const body = [
    CALCULATOR_SUBMISSION_INTRO,
    "",
    "### Calculator spec",
    "",
    "```json",
    json,
    "```",
    "",
    "### What it does and who it helps",
    "",
    "_Replace this line with one or two sentences on what the calculator " +
      "computes and which kind of lab work it is for._",
  ].join("\n");

  const params = new URLSearchParams({
    title,
    labels: CALCULATOR_SUBMISSION_LABEL,
    body,
  });

  return `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
}
