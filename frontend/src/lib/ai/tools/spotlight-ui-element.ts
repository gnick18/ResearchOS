// BeakerBot spotlight_ui_element tool (ai spotlight bot, 2026-06-10).
//
// The navigate-and-highlight half of the pair. Given an anchor id from the
// manifest, it navigates to that anchor's page (a soft SPA transition, not a
// reload), waits for the element to mount, scrolls it into view, and renders a
// spotlight glow ring plus a one-line BeakerBot narration over it. It returns
// what it highlighted, or a graceful "could not find that element" when the
// element never mounts within the timeout.
//
// The hard part is cross-navigation timing. The target element does not exist
// until after the route change AND the new page mounts, so we request navigation
// and then POLL the DOM for the selector with a sane timeout (waitForElement),
// rather than assuming the element is present synchronously.
//
// This module separates the pure planning logic (planSpotlight, which resolves an
// id to its anchor and selector, with no DOM and no navigation) from the
// effectful execute, so the planning is unit-testable and the effect is thin.
//
// Read-only with respect to USER DATA. It changes the VIEW (navigation + a
// decorative highlight), never the user's files, so it needs no approval gate.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { UI_ANCHORS, type UiAnchor } from "../ui-anchors.generated";
import {
  showSpotlight,
  waitForElement,
} from "@/components/ai/spotlight-controller";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import type { AiTool } from "./types";

// The selector the controller highlights. Built from the anchor id so the tool
// and the manifest never drift.
export function selectorForAnchor(id: string): string {
  return `[data-tour-target="${id}"]`;
}

// A short, plain narration BeakerBot shows in the spotlight bubble. Concept-first
// and calm, in house voice, no emojis, no mid-sentence colon.
export function narrationFor(anchor: UiAnchor): string {
  return `Here is the ${anchor.label.replace(/\s*\(.*\)\s*$/, "").toLowerCase()}.`;
}

export type SpotlightPlan =
  | { ok: true; anchor: UiAnchor; selector: string; narration: string }
  | { ok: false; error: string };

/** Resolve an anchor id to its navigation + highlight plan. Pure, so tests assert
 *  the right page and selector without touching the DOM. Returns an error result
 *  when the id is not in the manifest, so the model gets a clear message instead
 *  of a thrown error. */
export function planSpotlight(
  id: string,
  anchors: UiAnchor[] = UI_ANCHORS,
): SpotlightPlan {
  const anchor = anchors.find((a) => a.id === id);
  if (!anchor) {
    return {
      ok: false,
      error: `No UI element with id "${id}". Call find_ui_element first to get a valid id.`,
    };
  }
  return {
    ok: true,
    anchor,
    selector: selectorForAnchor(anchor.id),
    narration: narrationFor(anchor),
  };
}

// The effectful runner, factored out so the tool's execute is a thin wrapper and
// the navigation + wait + highlight sequence is injectable for tests (a fake
// navigate, a fake waitForElement, a fake show).
export type RunSpotlightDeps = {
  navigate: (path: string) => void;
  wait: typeof waitForElement;
  show: (el: HTMLElement, narration: string) => void;
  // The current path, so we can skip navigation when already on the target page
  // (avoids a redundant transition and a flash).
  currentPath?: () => string;
};

export type SpotlightResult = {
  highlighted: boolean;
  id?: string;
  label?: string;
  page?: string;
  message: string;
};

/** Run the navigate-wait-highlight sequence for a planned spotlight. Effectful,
 *  but every effect is injected, so this is unit-testable with a fake DOM and a
 *  fake navigator. Navigation is skipped when already on the target page. */
export async function runSpotlight(
  plan: Extract<SpotlightPlan, { ok: true }>,
  deps: RunSpotlightDeps,
): Promise<SpotlightResult> {
  const onPage =
    deps.currentPath !== undefined && deps.currentPath() === plan.anchor.page;
  if (!onPage) {
    deps.navigate(plan.anchor.page);
  }

  const el = await deps.wait(plan.selector);
  if (!el) {
    return {
      highlighted: false,
      id: plan.anchor.id,
      label: plan.anchor.label,
      page: plan.anchor.page,
      message: `Navigated to ${plan.anchor.page} but could not find that element on the page. It may need a step to reveal it first.`,
    };
  }

  deps.show(el, plan.narration);
  return {
    highlighted: true,
    id: plan.anchor.id,
    label: plan.anchor.label,
    page: plan.anchor.page,
    message: `Showing the user the ${plan.anchor.label} on ${plan.anchor.page}.`,
  };
}

// Read the current pathname for the skip-navigation check, SSR-safe.
function currentPathname(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname;
}

// spotlight_ui_element, the navigate-and-highlight tool. Changes the VIEW only,
// never user data, so no approval gate.
export const spotlightUiElementTool: AiTool = {
  name: "spotlight_ui_element",
  description:
    "Take the user to a part of the ResearchOS interface and visually highlight it for them. Pass the id of a UI element from find_ui_element. BeakerBot navigates to that element's page, scrolls it into view, and draws a glow ring around it with a short note, so the user can see exactly where to click. Call this when the user asks how or where to do something, after find_ui_element gives you the best id. This only changes what is shown, it never changes the user's data.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "The id of the UI element to highlight, taken from a find_ui_element result.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const id = typeof args.id === "string" ? args.id : "";
    const plan = planSpotlight(id);
    if (!plan.ok) {
      return { highlighted: false, message: plan.error };
    }
    return runSpotlight(plan, {
      navigate: requestNavigation,
      wait: waitForElement,
      show: showSpotlight,
      currentPath: currentPathname,
    });
  },
};
