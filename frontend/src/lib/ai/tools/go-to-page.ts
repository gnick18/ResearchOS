// BeakerBot go_to_page tool (ai perception bot, 2026-06-11).
//
// The cross-page half of the guide flow. read_page only sees the page the user is
// ON, so when the control the user wants lives elsewhere, BeakerBot first
// navigates to the likely page, then reads it, then guides. This tool does the
// navigate step. It takes either a free-text description of what the user wants
// (resolved to a page via the routing hint, the demoted manifest's one surviving
// job) or an explicit path, performs a soft SPA navigation, and tells the model it
// landed so the model knows to call read_page next.
//
// Read-only with respect to USER DATA. It changes the route (the view), never the
// user's files, so no approval gate.
//
// The pure planning (resolve a request or path to a destination) is split from the
// effectful navigate, so planning is unit-testable and the effect is thin.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { resolvePageHints } from "../page-routing";
import { requestNavigation } from "@/components/ai/navigation-bridge";
import type { AiTool } from "./types";

// The routes the routing hint is allowed to send the user to. A guard so a model
// supplied path cannot navigate off-app or to an unknown deep link, the navigation
// stays within the known top-level pages.
const KNOWN_PAGES = new Set([
  "/workbench",
  "/gantt",
  "/calendar",
  "/methods",
  "/purchases",
  "/search",
  "/settings",
]);

export type GoToPagePlan =
  | { ok: true; page: string; reason: "path" | "hint" }
  | { ok: false; error: string };

/** Resolve a navigation request to a destination page. Prefer an explicit, known
 *  path, otherwise resolve the free-text query through the routing hint. Pure, so
 *  tests assert the destination with no router. Returns an error result when
 *  neither a usable path nor a confident hint is available, so the model can fall
 *  back to a worded explanation. */
export function planGoToPage(args: {
  path?: string;
  query?: string;
}): GoToPagePlan {
  const path = (args.path ?? "").trim();
  if (path) {
    // Normalize to the top-level route, so /methods/123 still maps to /methods.
    const top = "/" + (path.replace(/^\//, "").split("/")[0] ?? "");
    if (KNOWN_PAGES.has(top)) {
      return { ok: true, page: top, reason: "path" };
    }
    return {
      ok: false,
      error: `"${path}" is not a known page. Describe what the user wants instead and I will route to it.`,
    };
  }

  const query = (args.query ?? "").trim();
  if (!query) {
    return {
      ok: false,
      error: "Give either a page path or a description of what the user wants.",
    };
  }

  const hints = resolvePageHints(query);
  if (hints.length === 0) {
    return {
      ok: false,
      error: `I could not tell which page hosts "${query}". Ask the user to be more specific, or read the current page in case it is already here.`,
    };
  }
  return { ok: true, page: hints[0].page, reason: "hint" };
}

export type GoToPageDeps = {
  navigate: (path: string) => void;
  currentPath?: () => string;
  // Optional waiter that resolves once the live path matches the target page (or
  // times out). Injected so the await-the-route-change behavior is testable. When
  // omitted, runGoToPage navigates without waiting (pure-plan callers and tests
  // that only care about the navigate call).
  waitForPath?: (page: string) => Promise<boolean>;
};

export type GoToPageResult = {
  navigated: boolean;
  page?: string;
  alreadyThere?: boolean;
  // True when the route was confirmed to have landed (waitForPath resolved true).
  // False when the wait timed out, so the model knows the page may still be
  // transitioning.
  landed?: boolean;
  message: string;
};

/** Run the navigation for a planned destination. Skips navigation when already on
 *  the page (avoids a redundant transition and a flash). When a waitForPath waiter
 *  is supplied it AWAITS the route actually landing before resolving, so the model
 *  does not call read_page against the old or transitioning DOM (which used to make
 *  it re-navigate and trip a hard reload). Effectful, but navigate and the waiter
 *  are injected so this is unit-testable. */
export async function runGoToPage(
  plan: Extract<GoToPagePlan, { ok: true }>,
  deps: GoToPageDeps,
): Promise<GoToPageResult> {
  const onPage =
    deps.currentPath !== undefined && deps.currentPath() === plan.page;
  if (onPage) {
    return {
      navigated: false,
      page: plan.page,
      alreadyThere: true,
      landed: true,
      message: `Already on ${plan.page}. Call read_page to see what is here.`,
    };
  }
  deps.navigate(plan.page);

  // Wait for the soft navigation to actually land before telling the model to read
  // the page. Without this the next read_page can run against the old DOM, find
  // nothing, and the model re-navigates, which previously led to a hard reload that
  // wiped the conversation.
  const landed = deps.waitForPath ? await deps.waitForPath(plan.page) : true;

  if (!landed) {
    return {
      navigated: true,
      page: plan.page,
      landed: false,
      message: `Started navigating to ${plan.page} but the route did not confirm in time. Call read_page to see where we are before guiding.`,
    };
  }

  return {
    navigated: true,
    page: plan.page,
    landed: true,
    message: `Navigated to ${plan.page}. Call read_page now to perceive it, then guide to the right element.`,
  };
}

function currentPathname(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname;
}

const PATH_WAIT_TIMEOUT_MS = 4000;
const PATH_WAIT_INTERVAL_MS = 80;

/** Poll the live pathname until its top-level segment matches the target page, or
 *  the timeout elapses. Resolves true on a match, false on timeout. Mirrors the
 *  waitForElement pattern. now and setTimeoutFn are injectable so the wait is
 *  testable with a fake clock. */
export function waitForPathMatch(
  page: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    readPath?: () => string;
    now?: () => number;
    setTimeoutFn?: typeof setTimeout;
  } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? PATH_WAIT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? PATH_WAIT_INTERVAL_MS;
  const readPath = options.readPath ?? currentPathname;
  const now = options.now ?? (() => Date.now());
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;

  const topOf = (p: string): string =>
    "/" + (p.replace(/^\//, "").split("/")[0] ?? "");
  const target = topOf(page);

  return new Promise((resolve) => {
    const start = now();
    const tick = () => {
      if (topOf(readPath()) === target) {
        resolve(true);
        return;
      }
      if (now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeoutFn(tick, intervalMs);
    };
    tick();
  });
}

export const goToPageTool: AiTool = {
  name: "go_to_page",
  description:
    "Navigate the user to a different page in ResearchOS, used when the control they want is not on the page they are looking at. Pass a plain-text description of what they want (for example \"add a method\" or \"buy a reagent\") and BeakerBot routes to the most likely page, or pass an explicit path like \"/methods\". After it navigates, call read_page to perceive the new page, then guide_to_element to highlight the control. This only changes the page shown, never the user's data.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "What the user wants to do, in plain words, used to pick the right page when no path is given.",
      },
      path: {
        type: "string",
        description:
          "An explicit page path to navigate to, for example \"/methods\". Optional, prefer query unless you already know the exact route.",
      },
    },
    additionalProperties: false,
  },
  execute: async (args) => {
    const path = typeof args.path === "string" ? args.path : undefined;
    const query = typeof args.query === "string" ? args.query : undefined;
    const plan = planGoToPage({ path, query });
    if (!plan.ok) {
      return { navigated: false, message: plan.error };
    }
    return runGoToPage(plan, {
      navigate: requestNavigation,
      currentPath: currentPathname,
      waitForPath: (page) => waitForPathMatch(page),
    });
  },
};
