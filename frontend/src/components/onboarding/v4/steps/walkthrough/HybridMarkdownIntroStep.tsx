/**
 * §6.7 HE-1 — markdown intro (narration only).
 *
 * Hybrid editor manager 2026-05-22. Heads-up beat: every text editor on
 * this site uses markdown. Sets up the HE-2 familiarity gate.
 *
 * Wave 2C speech rewrite (v4 tour speech manager — C, 2026-05-27):
 * applies Grant's BEAKERBOT_TOUR_SCRIPT_REWRITE_2026-05-27.md copy.
 * Now frames markdown as a lightweight format ("type simple symbols
 * around your words instead of clicking buttons") and references the
 * upcoming HE-2 branch ("Already comfortable with markdown? The next
 * step will let you skip ahead.").
 *
 * Pure narration — no cursor demo, no spotlight target.
 */
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

export const hybridMarkdownIntroStep = buildWalkthroughStep({
  id: "hybrid-markdown-intro",
  speech: (
    <>
      <p className="mb-2">
        Every editor in ResearchOS uses <strong>markdown</strong>: a
        lightweight way to format text by typing simple symbols around
        your words instead of clicking buttons.
      </p>
      <p>
        If you have written anything in Slack, Notion, or GitHub, you
        have already used it. The next few steps cover the basics, bold,
        italic, underline, and headers. Already comfortable with
        markdown? The next step will let you skip ahead.
      </p>
    </>
  ),
  pose: "pointing",
  completion: manualAdvance("Got it, next"),
});
