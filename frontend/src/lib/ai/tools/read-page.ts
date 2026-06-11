// BeakerBot read_page tool (ai perception bot, 2026-06-11).
//
// The live page-perception tool, READ-ONLY. At call time it walks the real DOM
// for the interactive, visible controls on the page the user is looking at and
// returns a compact list of { ref, role, name, hint } the model can reason over.
// This is what replaces the hand-built UI-anchor catalog. The catalog went stale
// the moment a button moved, the live read never does, because it perceives the
// page as it actually is right now.
//
// The flow the model uses, read_page to see what is here, pick the element whose
// name best matches what the user asked, then guide_to_element with that ref to
// scroll to it and draw a premium spotlight, all in the same turn while the refs
// are fresh.
//
// Read-only with respect to user data AND the view. It only inspects the DOM and
// stamps a transient marker attribute, it navigates nothing and changes nothing
// the user can see. No approval gate.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { perceiveLivePage } from "../page-perception";
import type { AiTool } from "./types";

export const readPageTool: AiTool = {
  name: "read_page",
  description:
    "Look at the page the user is currently viewing and list its interactive elements (buttons, links, inputs, selects, tabs, menu items). Returns the current page path and an array of elements, each with a ref, a role, a human name, and sometimes a hint about which section it is in. Call this when the user asks how or where to do something, then pick the element whose name best matches what they want and call guide_to_element with its ref to take them there and highlight it. If what they want is not in the list, the control may live on another page, navigate there first (guide_to_element can do this) and read again. Read-only, it only looks at the page.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async () => {
    const result = perceiveLivePage();
    if (result.count === 0) {
      return {
        page: result.page,
        count: 0,
        elements: [],
        note: "No interactive elements were perceived on this page. It may still be loading, or the control you want lives on another page.",
      };
    }
    return result;
  },
};
