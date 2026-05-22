/**
 * §6.7 HE-1 — markdown intro (narration only).
 *
 * Hybrid editor manager 2026-05-22. Heads-up beat: every text editor on
 * this site uses markdown. Sets up the HE-2 familiarity gate.
 *
 * Pure narration — no cursor demo, no spotlight target.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

export const hybridMarkdownIntroStep = buildWalkthroughStep({
  id: "hybrid-markdown-intro",
  speech: (
    <>
      <p className="mb-2">
        Heads up: every text editor on this site uses{" "}
        <strong>markdown</strong> format.
      </p>
      <p>
        Markdown is a way to format text using simple symbols, like
        <code className="font-mono mx-1 px-1 bg-gray-100 rounded">**bold**</code>
        and
        <code className="font-mono mx-1 px-1 bg-gray-100 rounded"># header</code>.
        It&apos;s an open standard, the same one Slack, Discord, Notion,
        and GitHub use.
      </p>
    </>
  ),
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
});
