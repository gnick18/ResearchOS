// BeakerBot guide_to_element tool (ai perception bot, 2026-06-11).
//
// The premium guide action. Given a ref the model picked from a read_page result,
// it resolves the ref back to the live element, scrolls it into view, and draws
// the spotlight (a breathing sky-blue ring, an animated pointer cue, and a one
// line BeakerBot note). This is the replacement for the old anchor-based spotlight,
// it targets the element the model actually saw on the page rather than a static
// selector from a catalog.
//
// The narration is computed from the perceived name the model already knows, so
// BeakerBot's bubble reads naturally ("Here is the New method button"). The model
// may also pass its own short note for a more specific cue.
//
// Read-only with respect to USER DATA. It changes the VIEW (scroll plus a
// decorative highlight), never the user's files, so it needs no approval gate.
//
// The pure planning (resolve the ref, build the narration) is split from the
// effectful show, so planning is unit-testable and the effect is thin and
// injectable.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { resolveRef } from "../page-perception";
import { showSpotlight } from "@/components/ai/spotlight-controller";
import type { AiTool } from "./types";

// Build the one-line bubble note. Prefer a model-supplied note (it can be more
// specific, like "click here to start a new method"), otherwise a calm default
// built from the element's name. No emoji, no mid-sentence colon.
export function buildNarration(name: string | undefined, note: string | undefined): string {
  const trimmedNote = (note ?? "").trim();
  if (trimmedNote) return trimmedNote;
  const trimmedName = (name ?? "").trim();
  if (trimmedName) return `Here is ${trimmedName}.`;
  return "Here is what you are looking for.";
}

export type GuideDeps = {
  resolve: (ref: string) => HTMLElement | null;
  show: (el: HTMLElement, narration: string) => void;
};

export type GuideResult = {
  highlighted: boolean;
  ref?: string;
  message: string;
};

/** Run the resolve-then-spotlight sequence for a ref. Effectful, but resolve and
 *  show are injected so this is unit-testable with a fake DOM. Returns a graceful
 *  result when the ref no longer resolves (the page changed since read_page), so
 *  the model can re-read and try again rather than crash. */
export function runGuide(
  args: { ref: string; name?: string; note?: string },
  deps: GuideDeps,
): GuideResult {
  const el = deps.resolve(args.ref);
  if (!el) {
    return {
      highlighted: false,
      ref: args.ref,
      message:
        "That element is no longer on the page. The page may have changed since you read it. Call read_page again to get fresh refs, then guide to the right one.",
    };
  }
  const narration = buildNarration(args.name, args.note);
  deps.show(el, narration);
  return {
    highlighted: true,
    ref: args.ref,
    message: `Highlighted "${(args.name ?? args.ref).trim()}" for the user.`,
  };
}

export const guideToElementTool: AiTool = {
  name: "guide_to_element",
  description:
    "Take the user to a specific element on the current page and visually highlight it. Pass the ref of an element from a recent read_page result. BeakerBot scrolls it into view and draws a glowing ring with a pointer and a short note, so the user can see exactly where to click. Call this right after read_page, while the refs are fresh, with the ref whose name best matches what the user asked for. This only changes what is shown, it never changes the user's data.",
  parameters: {
    type: "object",
    properties: {
      ref: {
        type: "string",
        description:
          "The ref of the element to highlight, taken from a read_page result, for example \"bb-12\".",
      },
      name: {
        type: "string",
        description:
          "The element's name from read_page, used to narrate what was highlighted. Optional but recommended.",
      },
      note: {
        type: "string",
        description:
          "A short one-line note to show the user, for example \"Click here to add a new method\". Optional, keep it under about ten words, no emoji.",
      },
    },
    required: ["ref"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const ref = typeof args.ref === "string" ? args.ref : "";
    if (!ref) {
      return {
        highlighted: false,
        message: "No ref was given. Call read_page first and pass one of its refs.",
      };
    }
    const name = typeof args.name === "string" ? args.name : undefined;
    const note = typeof args.note === "string" ? args.note : undefined;
    return runGuide(
      { ref, name, note },
      { resolve: resolveRef, show: showSpotlight },
    );
  },
};
