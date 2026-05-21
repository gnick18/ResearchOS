/**
 * Step shape for the Onboarding v4 tour controller — see
 * ONBOARDING_V4_PROPOSAL.md §4.4. P1 declares the type surface only;
 * the actual step bodies land in P4 (setup phase port) and P5-P7
 * (walkthrough + conditional + lab phases).
 *
 * The split into a dedicated file (vs co-locating with TourController)
 * lets step-machine.ts + step-registry.ts both import the type without
 * pulling in the React provider — keeps the pure-function step machine
 * vitest-able with zero React surface.
 */
import type { ReactNode } from "react";
import type { BeakerBotPose } from "@/components/BeakerBot";
import type { CursorAction } from "@/components/BeakerBotCursor";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";

// Re-export CursorAction so consumers (P5+ step bodies) can import
// everything tour-related from this file without juggling two import
// paths. Also re-export BeakerBotPose for the same reason.
export type { BeakerBotPose, CursorAction };

/**
 * Identifier for one step in the v4 tour. Free-form string per §4.4 so
 * P4-P7 can introduce new ids without a centralized union update; the
 * step-machine enforces validity via `TOUR_STEP_ORDER` membership.
 */
export type TourStepId = string;

/**
 * Step-completion strategy per L6 (hybrid: event-driven where feasible,
 * manual fallback where ambiguous, auto-advance for narrative-only
 * moments like the wiki pointer).
 *
 *  - `"event"`  — the step subscribes to a domain event bus (project
 *                 create, method save, search query rendered, etc.) via
 *                 `eventListener`. The listener returns an unsubscribe
 *                 function. When the event fires, the controller calls
 *                 `advance()` automatically.
 *  - `"manual"` — the step shows a "Got it, next" affordance in the
 *                 BeakerBot speech bubble. User clicks to advance.
 *  - `"auto"`   — the step auto-advances after `autoAdvanceAfterMs`.
 *                 Used for cursor-driven demos that complete after a
 *                 fixed animation budget (e.g. typewriter ends → +1.5s
 *                 → advance).
 */
export type TourStepCompletion =
  | {
      type: "event";
      /** Subscribe to whatever signal marks step completion; return an
       *  unsubscribe function. The controller calls the unsubscribe on
       *  step exit so we never leak listeners across steps. */
      eventListener: (advance: () => void) => () => void;
    }
  | {
      type: "manual";
      /** Optional override for the "Got it, next" button label. */
      buttonLabel?: string;
    }
  | {
      type: "auto";
      /** Required for auto: how many ms after step entry to advance. */
      autoAdvanceAfterMs: number;
    };

/**
 * One step in the v4 in-product tour. See §4.4 of the proposal. P5+
 * fills in `cursorScript` + real `speech` + concrete `completion`
 * handlers; P1 ships placeholder bodies via `step-registry.ts`.
 */
export interface TourStep {
  /** Stable string id matching the entry in `TOUR_STEP_ORDER`. */
  id: TourStepId;
  /** BeakerBot's speech bubble content for this step. Can be a literal
   *  ReactNode (for static prose) or a thunk so step bodies can produce
   *  dynamic content (e.g. interpolate the user's name). */
  speech: ReactNode | (() => ReactNode);
  /** BeakerBot's pose for the duration of this step. */
  pose: BeakerBotPose;
  /** CSS selector OR `data-tour-target` value for the spotlight anchor.
   *  `undefined` means no anchor — the step is BeakerBot-speech-only
   *  (e.g., the very first welcome modal step, the wiki pointer
   *  outro). */
  targetSelector?: string;
  /** Pre-baked cursor primitives the controller plays on step entry.
   *  Computed lazily (function returning the script) so the step body
   *  can resolve anchors at runtime — `document.querySelector(...)`
   *  fails if called at module load before the page renders. */
  cursorScript?: () => CursorAction[] | Promise<CursorAction[]>;
  /** Completion-detection contract. See `TourStepCompletion` doc. */
  completion: TourStepCompletion;
  /** Optional side-effect hook called once when this step becomes the
   *  active step. Used by steps that need to spawn demo artifacts or
   *  trigger programmatic events (§6.3 fires a test notification,
   *  §6.8 spawns demo dependency-chain tasks, etc.). Errors are caught
   *  by the controller and logged; an onEnter failure should never wedge
   *  the tour. Receives a context object with the active username (or
   *  `null` outside an end-to-end user identity, e.g. in tests) so the
   *  hook can resolve per-user storage paths via `local-api`. */
  onEnter?: (ctx: { username: string | null }) => void | Promise<void>;
  /** Optional side effect fired the moment the step exits — clean up
   *  demo artifacts, unsubscribe to listeners other than `completion`. */
  onExit?: () => void | Promise<void>;
  /** When this predicate returns `false`, the step is skipped (gating
   *  per L16). When `undefined`, the step always fires. */
  conditionalOn?: (picks: FeaturePicks | null) => boolean;
  /** Optional CSS selector for a LARGER surface that should be fully in
   *  viewport before the cursor demo runs. The per-action `ensureInViewport`
   *  inside cursor-script helpers only scrolls the small click target
   *  (e.g. the "Add Cycle" button) into view; on tall builders like the
   *  PCR gradient editor or LC chart, the user is meant to be looking at
   *  the whole CARD, not just the button. Setting `viewportAnchor` makes
   *  the controller scroll that big container into view at step entry,
   *  BEFORE any cursor script runs.
   *
   *  Behavior:
   *   - When unset (the default): no anchor scroll runs; per-action
   *     `ensureInViewport` calls inside the cursor-script helpers handle
   *     scroll on their own. This matches the pre-anchor behavior so
   *     unrelated steps don't change.
   *   - When set: at step entry, the controller resolves the selector
   *     and compares the element's height to `window.innerHeight`. If
   *     the anchor fits, it scrolls to `block: "center"`. If the anchor
   *     is TALLER than the viewport, it scrolls to `block: "start"` so
   *     the user sees the TOP of the widget ("show me all of this,
   *     starting from the top"). The per-action `ensureInViewport` still
   *     runs afterward for the small click target.
   *
   *  Use this for the §6.4b PCR + LC Gradient deep-demo steps where the
   *  cursor's target is a small toolbar button but the user's actual
   *  attention should be on the whole builder card. */
  viewportAnchor?: string;
  /** Pathname (or pathname prefix) the step expects to render against.
   *  When set, the TourController auto-navigates here on step enter if
   *  `window.location.pathname` doesn't already match.
   *
   *  Match contract:
   *   - `expectedRoute: "/"` matches ONLY the literal "/" pathname.
   *     The home route can't use a prefix match because `/` is a
   *     prefix of every path. Any non-`/` pathname triggers a push.
   *   - Every other value is a `startsWith` prefix check, so
   *     `expectedRoute: "/methods"` treats both `/methods` and
   *     `/methods/structured/pcr-builder` as "already on the right
   *     page" and skips the navigation.
   *
   *  Steps with dynamic routes (the project page at
   *  `/workbench/projects/<id>`, the experiment popup overlay) leave
   *  this unset because their expected route depends on artifact ids;
   *  those steps are entered via cursor demos clicking through, not
   *  via a hard route push. Modal-based steps (setup phase, telegram
   *  conditional, cleanup grid) also leave this unset because the
   *  surface owns the page regardless of route.
   *
   *  Why this exists: Grant's refresh-mid-tour bug. Refreshing on a
   *  non-home page (e.g. while viewing a project) and resuming the
   *  tour put BeakerBot on, say, `home-create-project` while the
   *  browser was still on the project route. BeakerBot said "click
   *  the blue New Project button" but there was no such button on
   *  that page. Auto-navigating to the expected route fixes this. */
  expectedRoute?: string;
}
