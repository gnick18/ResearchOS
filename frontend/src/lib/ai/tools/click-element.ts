// BeakerBot click_element action tool (ai click bot, 2026-06-11).
//
// The first ACTION tool. Given a ref the model picked from a read_page result, it
// resolves the ref back to the live element and dispatches a real click, so
// BeakerBot can perform a step for the user instead of only pointing at it.
//
// This is an action, so it goes through the agent loop's approval gate (set
// action: true). In "ask" autonomy the loop pauses, shows the user what will be
// clicked (the spotlight on the target plus an Allow / Skip confirm), and only
// runs execute after the user allows. In "auto" autonomy it runs directly, EXCEPT
// the destructive hard-stop, a target whose accessible name looks destructive or
// outward-facing (Delete, Send, Share, Pay, ...) always confirms. describeAction
// and isDestructive let the loop build that confirm and make that decision WITHOUT
// running the click.
//
// Graceful when the ref no longer resolves (the page changed since read_page),
// the same recovery path guide_to_element uses, tell the model to re-read.
//
// The pure planning (resolve, narrate, decide destructiveness) is split from the
// effectful click, so it unit-tests with a fake DOM and the effect stays thin.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { resolveRef, accessibleName, resolveRole } from "../page-perception";
import { checkDestructive } from "../destructive-heuristic";
import type { AiTool } from "./types";

export type ClickDeps = {
  resolve: (ref: string) => HTMLElement | null;
  // Dispatch the actual click. Injected so the effect is testable. Defaults to a
  // real element.click() in production.
  click: (el: HTMLElement) => void;
};

export type ClickResult = {
  clicked: boolean;
  ref?: string;
  message: string;
};

/** Read the accessible name of a resolved element, so describeAction and the
 *  destructive check both reason about the same human label the user sees. Falls
 *  back to the model-supplied name (from read_page) when the element is gone, so
 *  the confirm copy still reads naturally. */
export function targetLabel(
  ref: string,
  fallbackName: string | undefined,
  resolve: (ref: string) => HTMLElement | null,
): string {
  const el = resolve(ref);
  if (el && typeof document !== "undefined") {
    const name = accessibleName(el, document);
    if (name) return name;
  }
  return (fallbackName ?? "").trim();
}

/** Run the resolve-then-click sequence for a ref. Effectful, but resolve and
 *  click are injected so this unit-tests with a fake DOM. Returns a graceful
 *  result when the ref no longer resolves, so the model can re-read and try
 *  again rather than crash. */
export function runClick(
  args: { ref: string; name?: string },
  deps: ClickDeps,
): ClickResult {
  const el = deps.resolve(args.ref);
  if (!el) {
    return {
      clicked: false,
      ref: args.ref,
      message:
        "Could not find that element. The page may have changed since you read it. Call read_page again for fresh refs, then click the right one.",
    };
  }
  deps.click(el);
  const label = (args.name ?? "").trim();
  return {
    clicked: true,
    ref: args.ref,
    message: label
      ? `Clicked "${label}" for the user.`
      : "Clicked the element for the user.",
  };
}

export const clickElementTool: AiTool = {
  name: "click_element",
  description:
    "Click an element on the current page FOR the user, to carry out a step from a plan they already approved (for example open the new method form, or switch to a tab). Pass the ref of an element from a recent read_page result. This actually clicks the control, it does not just highlight it. Use guide_to_element instead when the user only wants to be SHOWN where something is. Only use this after you proposed a plan with propose_plan and the user approved it, then run the steps in order without asking again. The one exception is a destructive or outward-facing control (delete, send, share, pay), which the app still confirms at the moment it runs even inside an approved plan, just let the user confirm in that prompt. Always read_page first so the ref is fresh, and after the task is done say in one short sentence what you did.",
  parameters: {
    type: "object",
    properties: {
      ref: {
        type: "string",
        description:
          'The ref of the element to click, taken from a read_page result, for example "bb-12".',
      },
      name: {
        type: "string",
        description:
          "The element's name from read_page, used to narrate what was clicked and to show the user what they are approving. Optional but strongly recommended.",
      },
    },
    required: ["ref"],
    additionalProperties: false,
  },
  action: true,
  // Immutable: a click moves around or operates the UI (open a form, switch a tab,
  // click a nav link), it does not change the user's data, so it runs WITHOUT a
  // per-step confirm in both review modes. The real data writes go through their
  // own gated tools (create_task, write_note, ...). The destructive safety net
  // below still confirms a Delete / Send / Pay / Share target at the moment it runs.
  immutable: true,
  describeAction: (args) => {
    const ref = typeof args.ref === "string" ? args.ref : "";
    const name = typeof args.name === "string" ? args.name : undefined;
    const label = targetLabel(ref, name, resolveRef);
    const summary = label ? `click "${label}"` : "click an element on the page";
    return { summary, ...(ref ? { ref } : {}) };
  },
  isDestructive: (args) => {
    const ref = typeof args.ref === "string" ? args.ref : "";
    const name = typeof args.name === "string" ? args.name : undefined;
    const label = targetLabel(ref, name, resolveRef);
    const el = ref ? resolveRef(ref) : null;
    const role = el ? resolveRole(el) ?? undefined : undefined;
    return checkDestructive(label, role).destructive;
  },
  execute: async (args) => {
    const ref = typeof args.ref === "string" ? args.ref : "";
    if (!ref) {
      return {
        clicked: false,
        message: "No ref was given. Call read_page first and pass one of its refs.",
      };
    }
    const name = typeof args.name === "string" ? args.name : undefined;
    return runClick(
      { ref, name },
      { resolve: resolveRef, click: (el) => el.click() },
    );
  },
};
