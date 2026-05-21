/**
 * Step-body registry for the Onboarding v4 tour controller.
 *
 * P1 ships PLACEHOLDER bodies — every entry declares the right id +
 * pose default + a manual completion type + the conditional gate (so
 * step-machine.ts can drive the order). Real `speech`, `cursorScript`,
 * `targetSelector`, and `completion` contracts land in:
 *
 *   P4 → setup-q1 / setup-q1a / setup-q1b / setup-q2..q6 (port v3
 *        setup step bodies onto the v4 tour controller modal surface)
 *   P5 → home-create-project through wiki-pointer (universal §6.1-6.12)
 *   P6 → telegram + purchases + calendar (conditional §6.13-6.15)
 *   P7 → lab-prompt + lab-spawn-beakerbot + lab-permission-practice
 *        (§6.16, minimal lab tour per L19)
 *
 * The registry is intentionally a flat map so future arc phases can do
 * a single-line `TOUR_STEPS["home-create-project"] = { ... real body }`
 * patch without touching the machine. Steps absent from the registry
 * at runtime fall back to a generic "placeholder" rendering inside the
 * controller — used to confirm the machine wires up correctly before
 * P4-P7 fill in bodies.
 *
 * Phase-2 cleanup grid step (`phase4-cleanup`) lives here too even
 * though it doesn't render BeakerBot — the controller special-cases
 * its rendering, but the registry entry keeps the step-machine happy.
 */
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import type { TourStep, TourStepId } from "./step-types";
import { TOUR_STEP_ORDER, isStepGatedOut } from "./step-machine";
import { SETUP_STEP_DESCRIPTORS } from "./steps/setup";

/**
 * Build a placeholder step body matching the brief's "Step bodies in
 * P4+" rule. Returns a TourStep that:
 *   - shows a temporary speech string referencing the step id (so a
 *     developer running the tour in P1 sees which step is active),
 *   - poses BeakerBot in `pointing` (the default per the brief),
 *   - uses `manual` completion (a "Got it, next" button advances),
 *   - re-uses the step-machine gating predicate so a manager wiring
 *     a real body in P4-P7 doesn't accidentally drop the gate.
 */
function placeholderStep(id: TourStepId): TourStep {
  return {
    id,
    speech: `(Placeholder body for "${id}". Real content lands in P4-P7.)`,
    pose: "pointing",
    completion: {
      type: "manual",
      buttonLabel: "Got it, next",
    },
    // The placeholder retains the machine's gating predicate so a
    // manager wiring a real body in P4-P7 doesn't have to re-derive it.
    // Resolved against the actual picks at step-entry time by the
    // controller; absent picks → undefined (i.e., step always shows).
    conditionalOn: (picks: FeaturePicks | null) => !isStepGatedOut(id, picks),
  };
}

/**
 * Build a real Phase 1 modal-setup step body from the setup descriptor
 * map. P4 populates every Phase 1 step id (welcome + setup-q1 +
 * setup-q1a + setup-q1b + setup-q2..q6) here so the modal-setup surface
 * sees full speech + pose + a manual completion contract.
 *
 * The body component itself is mounted by the modal-setup shell via the
 * `SETUP_STEP_DESCRIPTORS` lookup, not by this TourStep record. The
 * TourStep here owns the BeakerBot-side metadata (speech bubble, pose,
 * completion contract); the modal body lives in `./steps/setup/`.
 */
function setupStep(id: TourStepId): TourStep {
  const d = SETUP_STEP_DESCRIPTORS[id];
  if (!d) {
    // Defensive fallback. Should never fire because every entry in
    // SETUP_STEP_IDS has a descriptor; if a future contributor adds a
    // setup step id to the machine but forgets the descriptor, this
    // keeps the controller from blowing up.
    return placeholderStep(id);
  }
  return {
    id,
    speech: d.speech,
    pose: d.pose,
    completion: {
      type: "manual",
      // Welcome's modal Next-button label is "Let's go" per v3 parity;
      // the rest use the default "Next" label which the modal shell
      // resolves itself.
      buttonLabel: id === "welcome" ? "Let's go" : "Next",
    },
    conditionalOn: (picks: FeaturePicks | null) => !isStepGatedOut(id, picks),
  };
}

/**
 * The v4 tour step registry. P4 populates every Phase 1 modal-setup
 * step with a real body (see `setupStep` above); the remaining steps
 * stay on the placeholder until P5-P7 replaces them one-at-a-time.
 *
 * The type is `Record<TourStepId, TourStep>` so a real body just
 * overwrites the placeholder at the matching key. Iteration order
 * is NOT load-bearing — the machine drives ordering via
 * `TOUR_STEP_ORDER`, not via this registry.
 */
export const TOUR_STEPS: Record<TourStepId, TourStep> = Object.fromEntries(
  TOUR_STEP_ORDER.map((id) => {
    if (SETUP_STEP_DESCRIPTORS[id]) return [id, setupStep(id)];
    return [id, placeholderStep(id)];
  }),
);

/**
 * Look up the registered step body for an id. Returns `undefined` when
 * the id isn't in the registry — useful for the controller's
 * "render a generic placeholder card" fallback during P1-P3.
 */
export function getStep(id: TourStepId): TourStep | undefined {
  return TOUR_STEPS[id];
}
