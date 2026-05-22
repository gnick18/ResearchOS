"use client";

/**
 * §6.16 Phase 2c Lab Mode tour — Search tab walkthrough.
 *
 * Lab Mode manager 2026-05-22, enriched in Lab Mode fix manager R1
 * (2026-05-22). Beats:
 *
 *   1. Click the Search tab so LabSearchPanel mounts.
 *   2. (Deferred) type a sample query ("GFP") into the keywords
 *      input so the user sees the search-result render path.
 *
 * Typing is deferred to playback because the keyword input doesn't
 * exist at script-build time (Search isn't the default tab). We use
 * a `callbackAction` that focuses the input + sets its value via the
 * native input descriptor so React's controlled-input handler picks
 * up the change. A plain `el.value = "..."` would update the DOM
 * but skip React's onChange wiring, leaving the controlled state
 * stale.
 */
import { TOUR_TARGETS } from "../walkthrough/lib/targets";
import { buildLabModeTabStep } from "./lib/lab-mode-tab-step";
import { waitForElement } from "../walkthrough/lib/cursor-script";

const KEYWORDS_INPUT = `[data-tour-target="${TOUR_TARGETS.labModeSearchKeywordInput}"]`;
const SAMPLE_QUERY = "GFP";

export const labModeSearchStep = buildLabModeTabStep({
  id: "lab-mode-search",
  tabTarget: TOUR_TARGETS.labModeSearchTab,
  speech: (
    <>
      <p>
        Last thing: lab-wide search. Filter by date, owner, method,
        experiment, anything.
      </p>
      <p>
        Quick example, type a keyword like &ldquo;GFP&rdquo; or pick a
        filter chip and the results render below.
      </p>
    </>
  ),
  additionalActions: async ({ callbackAction }) => {
    // Deferred typing: wait for the input to mount, focus it, then
    // dispatch a single input event with the query. Faster than
    // simulating keystroke-by-keystroke + survives the controlled-
    // input round-trip via the native descriptor setter.
    const typeQuery = callbackAction(async () => {
      const el = await waitForElement(KEYWORDS_INPUT, 4000);
      if (!(el instanceof HTMLInputElement)) return;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (setter) {
        setter.call(el, SAMPLE_QUERY);
      } else {
        el.value = SAMPLE_QUERY;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return [typeQuery];
  },
});
