"use client";

/**
 * §6.4a-prompt Methods page — interactive category-type picker (v4 sec
 * 6.4 redesign per Grant 2026-05-21 feedback).
 *
 * This beat (`methods-category-prompt`): BeakerBot asks the user
 * "what's a common type of technique you do in the lab?" and shows
 * four to six labeled buttons (chemistry / molecular biology /
 * bioinformatics / microbiology / cell biology) plus an Other option
 * that opens a small text input below the buttons. No cursor, no
 * spotlight — pure modal-style picker overlay inside the speech bubble.
 *
 * Tour simplification pass 3 2026-06-03 (needs-care, CASE 1): the prior
 * `methods-category-open` (open the New Category modal) + `methods-
 * category` (type the label + Create Empty) beats are cut. Categories in
 * the data model are free-text `folder_path` strings on methods, so no
 * pre-existing category RECORD is needed: the later `methods-create`
 * beat reads this picked label and types it into the method's Folder
 * field, and the category materializes when the method is saved. This
 * beat's only job is to RECORD the pick.
 *
 * State-sharing mechanism: localStorage key
 * `V4_METHODS_CATEGORY_PICK_KEY`. The picker writes on advance; the
 * `methods-create` beat reads it at playback to fill the Folder field,
 * then clears it on exit so a re-run of the tour starts fresh.
 *
 * Why localStorage (vs a module singleton or React context):
 *
 *   - The two beats are independent registered step bodies; sharing
 *     module state across files would require introducing yet another
 *     `pick-store.ts` indirection.
 *   - Persisting through page navigation is free: the demo step lives
 *     on `/methods` while the prompt overlay sits over whatever route
 *     the user is currently on, so the hand-off may cross a route
 *     change in the resume / refresh case.
 *   - The picker payload is a single short string (the category
 *     label); the value is throwaway, no schema migration risk.
 *
 * Classification: USER ACTION (per Grant 2026-05-21 cursor
 * responsibility rule). BeakerBot asks a question with a thinking
 * pose; the user picks an answer themselves. No cursor demo, no
 * cursor script, no spotlight target.
 */
import { useState } from "react";
import { useTourController } from "../../TourController";
import { buildWalkthroughStep, manualAdvance } from "./lib/step-helpers";

/** localStorage key the two-beat picker hand-off writes / reads. The
 *  v4_ prefix matches the existing onboarding-v4 storage convention
 *  used in `frontend/src/lib/onboarding/`. */
export const V4_METHODS_CATEGORY_PICK_KEY = "v4_methods_category_pick";

/** Canonical picker options. Ordered from most common (Grant's
 *  examples: chemistry, molecular biology, bioinformatics) to less
 *  common (microbiology, cell biology), with Other as the escape
 *  hatch. Each entry's `label` doubles as the value written to
 *  localStorage; the demo step types this label verbatim into the
 *  category-name input. */
export const METHODS_CATEGORY_PICKER_OPTIONS: ReadonlyArray<string> = [
  "Chemistry",
  "Molecular Biology",
  "Bioinformatics",
  "Microbiology",
  "Cell Biology",
];

/** Save the user's pick to localStorage. Exported for the demo step
 *  to read; tests use this and the matching `readMethodsCategoryPick`
 *  helper to drive the hand-off in isolation. */
export function writeMethodsCategoryPick(label: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(V4_METHODS_CATEGORY_PICK_KEY, label);
  } catch {
    // localStorage can throw in private-mode Safari etc. The picker
    // hand-off is best-effort; the demo step has a fallback label so
    // a dropped write degrades to "My First Methods" rather than a
    // wedge.
  }
}

/** Read the user's pick from localStorage, falling back to null when
 *  unset / unreadable. */
export function readMethodsCategoryPick(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(V4_METHODS_CATEGORY_PICK_KEY);
  } catch {
    return null;
  }
}

/** Clear the pick after the methods-create beat consumes it. Called on
 *  that beat's exit hook + on tour exit so a fresh run of the tour starts
 *  with no stale value. */
export function clearMethodsCategoryPick(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(V4_METHODS_CATEGORY_PICK_KEY);
  } catch {
    // ignore
  }
}

/** Inner component — rendered as the speech-bubble body. Holds the
 *  Other-text-input toggle state locally; commits the pick to
 *  localStorage and advances the tour on button click. */
function MethodsCategoryPromptInner() {
  const controller = useTourController();
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState("");

  const commitPick = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    writeMethodsCategoryPick(trimmed);
    controller.noteManualAdvance();
  };

  const handleOtherSubmit = () => {
    if (!otherText.trim()) return;
    commitPick(otherText);
  };

  return (
    <div
      data-step-id="methods-category-prompt"
      data-testid="methods-category-prompt"
      className="space-y-3"
    >
      {/*
        FINAL reorder manager 2026-05-27: new pedagogical opener per
        the FINAL tour script's §6.7c. The Methods cluster now runs
        AFTER the workbench notes/lists cluster, so the opener calls
        back to "where lab work gets logged" (the experiment + notes +
        lists arc) before introducing methods as the protocol library.
      */}
      <p className="leading-relaxed mb-2">
        You&apos;ve seen where lab work gets logged. Now for where your
        protocols live.
      </p>
      <p className="leading-relaxed mb-2">
        <strong>Methods</strong> is your library of reusable techniques.
        Write a protocol once here, then attach it to every experiment
        that uses it instead of rewriting the steps each time. Most labs
        run the same handful of techniques over and over, so this ends
        up being one of the most-used pages in ResearchOS.
      </p>
      <p className="leading-relaxed">
        To keep the library navigable, methods get sorted into categories.
        Pick one based on work you actually do and we&apos;ll file your
        first method into it in a moment. What&apos;s a common technique in
        your lab?
      </p>
      <div className="flex flex-col gap-1.5">
        {METHODS_CATEGORY_PICKER_OPTIONS.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => commitPick(label)}
            data-methods-category-pick={label}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-sky-50 hover:border-sky-300 text-gray-800 text-left transition-colors"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOtherOpen((v) => !v)}
          data-methods-category-pick="__other_toggle"
          className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-sky-50 hover:border-sky-300 text-gray-700 text-left transition-colors"
          aria-expanded={otherOpen}
        >
          Other (type your own)
        </button>
        {otherOpen && (
          <div
            className="mt-1 flex items-center gap-2"
            data-testid="methods-category-other-row"
          >
            <input
              type="text"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              placeholder="e.g. Mycology"
              data-methods-category-other-input
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleOtherSubmit();
              }}
              autoFocus
            />
            <button
              type="button"
              onClick={handleOtherSubmit}
              disabled={!otherText.trim()}
              data-methods-category-other-submit
              className="px-2.5 py-1.5 text-xs font-semibold rounded-md bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-50"
            >
              Use this
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The §6.4-prompt TourStep entry. Pose is `thinking` (BeakerBot is
 * asking a question). No spotlight, no cursor script: the speech
 * bubble owns the picker UI. Completion is `manual` so the controller
 * exposes a fallback "Got it, next" — but the inner buttons each
 * trigger `noteManualAdvance` themselves on click. The fallback label
 * stays populated for keyboard-only users who can't click a button,
 * but in practice the picker buttons drive every advance.
 *
 * expectedRoute is `"/methods"` so the controller auto-navigates
 * BEFORE the prompt paints. The prompt itself doesn't anchor to
 * anything on the page, but the next step (demo) does, and pre-routing
 * here means the user sees the methods page underneath the speech
 * bubble while they make their pick.
 */
export const methodsCategoryPromptStep = buildWalkthroughStep({
  id: "methods-category-prompt",
  speech: () => <MethodsCategoryPromptInner />,
  pose: "thinking",
  // No targetSelector: the picker is modal-contained inside the
  // speech bubble, no on-page anchor.
  // No cursorScript: BeakerBot is asking, not demoing.
  completion: manualAdvance("Skip"),
  expectedRoute: "/methods",
  // Methods fix manager 2026-05-22: full page-lock during the picker.
  // The picker buttons live INSIDE the speech bubble (which always
  // passes clicks through, regardless of the allow-list), so an empty
  // allowList here is correct: it blocks every page click outside the
  // bubble. Grant called this picker "perfect" interaction-wise; the
  // lock just prevents the user from accidentally clicking the
  // methods-page underneath and soft-walking themselves out of the
  // picker before making a choice.
  pageLock: {
    allowList: [],
    pillLabel: "Pick a category in the bubble to continue.",
  },
});

export default MethodsCategoryPromptInner;
