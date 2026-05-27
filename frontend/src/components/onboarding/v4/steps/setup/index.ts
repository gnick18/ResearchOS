/**
 * Setup-step body registry for the v4 modal-setup surface.
 *
 * The TourController's modal-setup shell looks up the active step's body
 * component here and renders it inside the modal chrome (header + Next /
 * Back / Skip footer). Phase 1 step ids (welcome + setup-q1 +
 * setup-q2..q6) all resolve to a body via this map; any step id outside
 * the map falls back to the controller's generic placeholder render
 * (currently no other modal-setup step exists, but the shape is open so
 * a future phase can add one without rewiring the controller).
 *
 * Title lookups for the modal header (e.g. "Solo or lab?") and pose
 * defaults are ALSO declared here so the modal shell + the step-registry
 * see one source of truth.
 *
 * v4 keeps Phase 1 modal-contained per ONBOARDING_V4_PROPOSAL.md L9.
 *
 * 2026-05-22 (HR-dispatched: v4 drop-Q1a-Q1b sub-bot): setup-q1a (lab
 * storage picker) + setup-q1b (lab connect info) were removed. Lab
 * storage decision lives in pre-onboarding §6.4 (cloud-provider screen)
 * now — that's where the user actually picks + links their folder. By
 * the time the user reaches v4 setup, the storage decision is already
 * made via DataSetupScreen, so the modal asking again was redundant.
 */
import type { ComponentType } from "react";
import type { BeakerBotPose } from "@/components/BeakerBot";
import type { TourStepId } from "../../step-types";
import type { SetupStepProps } from "./types";
import WelcomeStep from "./WelcomeStep";
import Q1AccountTypeStep from "./Q1AccountTypeStep";
import Q1cLabHeadStep from "./Q1cLabHeadStep";
import Q2PurchasesStep from "./Q2PurchasesStep";
import Q3CalendarStep from "./Q3CalendarStep";
import Q4GoalsStep from "./Q4GoalsStep";
import Q5TelegramStep from "./Q5TelegramStep";
import Q6AiHelperStep from "./Q6AiHelperStep";
import Q7LinksStep from "./Q7LinksStep";
// v4 setup wrap-up step manager 2026-05-24. Confirmation beat between
// Q7 and the in-product walkthrough; echoes back the user's picks and
// offers Take-the-tour / Go-to-home CTAs. The body owns its CTAs so
// the descriptor sets `hideFooter: true` to hide the modal shell's
// Back / Skip / Next footer.
import SetupWrapupStep from "./SetupWrapupStep";

export interface SetupStepDescriptor {
  /** Modal-header title shown above the step body. */
  title: string;
  /** BeakerBot pose displayed in the modal header for this step.
   *  Welcome uses `waving`; the Q1-Q6 picks use `thinking` so the mascot
   *  reads as "considering options with the user" (matches v3's setup
   *  pose). The setup-wrapup beat uses `cheering` to read as
   *  accomplishment ("you made it"). */
  pose: BeakerBotPose;
  /** Short prose the BeakerBot speech bubble can show alongside the modal
   *  body. The shell can choose to render this (or not); the registry
   *  carries it so step-registry.ts has consistent speech for every
   *  Phase 1 step. NO EM-DASHES per Grant's standing rule. */
  speech: string;
  /** The body component. The shell mounts it with SetupStepProps. */
  Component: ComponentType<SetupStepProps>;
  /** When true, the modal shell hides its Back / Skip this step / Next /
   *  Skip walkthrough footer. The body owns its own CTAs. Used by the
   *  setup-wrapup beat (v4 setup wrap-up step manager 2026-05-24) so
   *  the wrap-up confirmation can render its own "Go to home" /
   *  "Take the feature tour" buttons without the shell's default footer
   *  cluttering the layout. Defaults to false (shell renders footer). */
  hideFooter?: boolean;
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
      "Welcome to ResearchOS! Here is a quick overview before we set up your account.",
    Component: WelcomeStep,
  },
  "setup-q1": {
    title: "Solo or lab?",
    pose: "thinking",
    speech:
      "First up: are you setting this account up just for yourself, or for an entire lab?",
    Component: Q1AccountTypeStep,
  },
  "setup-q1c": {
    title: "Are you the PI?",
    pose: "thinking",
    speech:
      "One follow-up before we move on: are you the PI, or a lab member?",
    Component: Q1cLabHeadStep,
  },
  "setup-q2": {
    title: "Track lab purchases?",
    pose: "thinking",
    speech:
      "Do you want to track lab purchases and reagent orders? You can enable the tracker now or leave it off to keep things simple.",
    Component: Q2PurchasesStep,
  },
  "setup-q3": {
    title: "Want calendar feeds?",
    pose: "thinking",
    speech:
      "ResearchOS can overlay any public calendar such as personal ones from Outlook, Apple, Google, etc. Would you like a walkthrough on how to get that link working?",
    Component: Q3CalendarStep,
  },
  "setup-q4": {
    title: "Want a goal-tracking page?",
    pose: "thinking",
    speech:
      "You can set up high-level goals for projects, or even private goals for things outside the lab. They show up right on your Gantt chart to help you keep track of what you want to achieve and how much time is left. Want to turn this on?",
    Component: Q4GoalsStep,
  },
  "setup-q5": {
    title: "Telegram for image inbox?",
    pose: "thinking",
    speech:
      "You can link a Telegram bot to send photos directly from your phone to your ResearchOS inbox. This makes it easy to quickly upload gel images or bench notes. Do you want to enable this integration?",
    Component: Q5TelegramStep,
  },
  "setup-q6": {
    title: "AI Helper prompt?",
    pose: "thinking",
    speech:
      "We can generate a custom system prompt for external AI tools like Claude, ChatGPT, or Gemini so they understand how your lab notebook is organized. Pick how much detail you want included.",
    Component: Q6AiHelperStep,
  },
  "setup-q7": {
    title: "Save important links?",
    pose: "thinking",
    speech:
      "The Links tab is a dedicated space to save important bookmarks, like your lab calendar, freezer inventory, or manuscript drafts. Do you want this tab enabled?",
    Component: Q7LinksStep,
  },
  // v4 setup wrap-up step manager 2026-05-24. Confirmation beat. The
  // body owns its own CTAs (Go to home / Take the feature tour), so
  // `hideFooter: true` removes the shell's default Back / Skip / Next
  // footer. Pose is `cheering` to read as accomplishment.
  "setup-wrapup": {
    title: "You're all set",
    pose: "cheering",
    speech:
      "Quick recap of what you picked, then we'll get you to the home page (or into the feature tour if you want it).",
    Component: SetupWrapupStep,
    hideFooter: true,
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
  Q1cLabHeadStep,
  Q2PurchasesStep,
  Q3CalendarStep,
  Q4GoalsStep,
  Q5TelegramStep,
  Q6AiHelperStep,
  Q7LinksStep,
  SetupWrapupStep,
};
export type { SetupStepProps };
