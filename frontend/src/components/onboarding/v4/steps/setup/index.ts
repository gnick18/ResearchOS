/**
 * Setup-step body registry for the v4 modal-setup surface.
 *
 * The TourController's modal-setup shell looks up the active step's body
 * component here and renders it inside the modal chrome (header + Next /
 * Back / Skip footer). Phase 1 step ids (welcome + setup-q1 + setup-q1a
 * + setup-q1b + setup-q2..q6) all resolve to a body via this map; any
 * step id outside the map falls back to the controller's generic
 * placeholder render (currently no other modal-setup step exists, but
 * the shape is open so a future phase can add one without rewiring the
 * controller).
 *
 * Title lookups for the modal header (e.g. "Solo or lab?") and pose
 * defaults are ALSO declared here so the modal shell + the step-registry
 * see one source of truth.
 *
 * v4 keeps Phase 1 modal-contained per ONBOARDING_V4_PROPOSAL.md L9.
 */
import type { ComponentType } from "react";
import type { BeakerBotPose } from "@/components/BeakerBot";
import type { TourStepId } from "../../step-types";
import type { SetupStepProps } from "./types";
import WelcomeStep from "./WelcomeStep";
import Q1AccountTypeStep from "./Q1AccountTypeStep";
import Q1aLabStorageStep from "./Q1aLabStorageStep";
import Q1bLabConnectInfoStep from "./Q1bLabConnectInfoStep";
import Q2PurchasesStep from "./Q2PurchasesStep";
import Q3CalendarStep from "./Q3CalendarStep";
import Q4GoalsStep from "./Q4GoalsStep";
import Q5TelegramStep from "./Q5TelegramStep";
import Q6AiHelperStep from "./Q6AiHelperStep";

export interface SetupStepDescriptor {
  /** Modal-header title shown above the step body. */
  title: string;
  /** BeakerBot pose displayed in the modal header for this step.
   *  Welcome uses `waving`; the Q1-Q6 picks use `thinking` so the mascot
   *  reads as "considering options with the user" (matches v3's setup
   *  pose). Q1b is informational (no pick), so `reading` matches the
   *  "look at this paragraph" flow. */
  pose: BeakerBotPose;
  /** Short prose the BeakerBot speech bubble can show alongside the modal
   *  body. The shell can choose to render this (or not); the registry
   *  carries it so step-registry.ts has consistent speech for every
   *  Phase 1 step. NO EM-DASHES per Grant's standing rule. */
  speech: string;
  /** The body component. The shell mounts it with SetupStepProps. */
  Component: ComponentType<SetupStepProps>;
}

/**
 * Map from setup-step id (matches `TOUR_STEP_ORDER` entries) to the
 * descriptor the modal shell renders. Steps not in this map are not
 * setup-phase steps and won't be rendered by the modal-setup surface.
 */
export const SETUP_STEP_DESCRIPTORS: Partial<
  Record<TourStepId, SetupStepDescriptor>
> = {
  welcome: {
    title: "Welcome to ResearchOS",
    pose: "waving",
    speech:
      "Welcome! Two-sentence pitch coming right up, then we'll get you set up.",
    Component: WelcomeStep,
  },
  "setup-q1": {
    title: "Solo or lab?",
    pose: "thinking",
    speech:
      "Quick first call: are you flying solo, or is this for a whole lab?",
    Component: Q1AccountTypeStep,
  },
  "setup-q1a": {
    title: "Where will lab data live?",
    pose: "thinking",
    speech:
      "Every lab member needs to point at the same folder. Pick where it lives.",
    Component: Q1aLabStorageStep,
  },
  "setup-q1b": {
    title: "How lab members connect",
    pose: "pointing",
    speech:
      "Heads-up on how the provider you picked plugs into ResearchOS. No input here, just a read.",
    Component: Q1bLabConnectInfoStep,
  },
  "setup-q2": {
    title: "Track lab purchases?",
    pose: "thinking",
    speech:
      "Some folks track every reagent. Some folks would rather forget. Your call.",
    Component: Q2PurchasesStep,
  },
  "setup-q3": {
    title: "Want calendar feeds?",
    pose: "thinking",
    speech:
      "ResearchOS can subscribe to Google, Outlook, iCloud, or ICS feeds. Want that on?",
    Component: Q3CalendarStep,
  },
  "setup-q4": {
    title: "Want a goal-tracking page?",
    pose: "thinking",
    speech:
      "Goal bars next to your Gantt so you can see plan-vs-reality. Want it on?",
    Component: Q4GoalsStep,
  },
  "setup-q5": {
    title: "Telegram for image inbox?",
    pose: "thinking",
    speech:
      "Snap a gel photo on your phone, send it to the bot, the image lands in your inbox. Want it?",
    Component: Q5TelegramStep,
  },
  "setup-q6": {
    title: "AI Helper prompt?",
    pose: "thinking",
    speech:
      "I can copy you a prompt that turns Claude, ChatGPT, or Gemini into a schema-aware assistant. Pick a size.",
    Component: Q6AiHelperStep,
  },
};

/** Look up the setup descriptor for a step id. Returns `undefined` when
 *  the step is not a Phase 1 modal-setup step. */
export function getSetupDescriptor(
  step: TourStepId,
): SetupStepDescriptor | undefined {
  return SETUP_STEP_DESCRIPTORS[step];
}

// Public re-exports so consumers can pull body components individually
// (e.g. test files importing one step).
export {
  WelcomeStep,
  Q1AccountTypeStep,
  Q1aLabStorageStep,
  Q1bLabConnectInfoStep,
  Q2PurchasesStep,
  Q3CalendarStep,
  Q4GoalsStep,
  Q5TelegramStep,
  Q6AiHelperStep,
};
export type { SetupStepProps };
