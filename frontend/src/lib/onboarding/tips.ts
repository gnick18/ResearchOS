/**
 * Onboarding tip catalog. The orchestrator iterates this list on every
 * roll tick, filtering by pathname + sidecar state to find an eligible
 * tip. Numbered priority = display order when multiple tips match the
 * same route.
 *
 * Each tip points at a real, shipped feature whose entry point is
 * non-obvious to a brand-new user. Tips can optionally carry:
 *   - `setupAction`  — extra footer button that navigates somewhere
 *                      (auto-opens a modal via deep-link query param).
 *   - `onShow`       — string hook fired when the card mounts (e.g. the
 *                      "animation-burst" 5-burst sequence for the
 *                      gantt-animations tip).
 *   - `gate`         — extra eligibility predicate beyond `route` (e.g.
 *                      `workbench-experiments-tab` checks the workbench
 *                      page's active sub-tab).
 *
 * The 10th tip in the proposal — `lab-mode-picker` — is NOT in this
 * catalog. It's a standalone tip rendered inside `UserLoginScreen` with
 * its own sessionStorage-backed gate; see
 * `components/OnboardingLabModePickerTip.tsx`.
 */

export type OnboardingTipOnShow = "animation-burst";
export type OnboardingTipGate = "workbench-experiments-tab";

export interface OnboardingTipSetupAction {
  /** Button label rendered in the tip-card footer. */
  label: string;
  /** Today only `"navigate"`. `"modal"` reserved for future use. */
  kind: "navigate" | "modal";
  /** Required when `kind === "navigate"`. The orchestrator calls
   *  `router.push(href)` and then dismisses the tip with the `got-it`
   *  outcome so it counts as served. */
  href?: string;
}

export interface OnboardingTip {
  /** Stable identifier used as the sidecar `tips` key. */
  id: string;
  /** Display title on the tip card. */
  title: string;
  /** Pathname matcher — a tip becomes eligible when
   *  `pathname.startsWith(route)`. "/" matches every route, so use a
   *  specific prefix when targeting one surface only. */
  route: string;
  /** `data-onboarding-target` value to look up via `querySelector` when
   *  scheduling. The orchestrator drops the schedule if the element
   *  isn't present at fire time. */
  target: string;
  /** Body copy. */
  body: string;
  /** Wiki path to open when the user clicks "Read more →". */
  wikiPath: string;
  /** Display priority. Lower wins when multiple tips share a route. */
  priority: number;
  /** Optional CTA — adds a button to the card footer that navigates
   *  somewhere helpful (settings deep-link, modal opener, etc.). */
  setupAction?: OnboardingTipSetupAction;
  /** Optional hook fired when the card mounts. Today only
   *  `"animation-burst"` (used by `gantt-animations`). */
  onShow?: OnboardingTipOnShow;
  /** Optional extra eligibility predicate. Today only
   *  `"workbench-experiments-tab"` — the orchestrator skips the tip
   *  unless the workbench page's active sub-tab is "experiments". */
  gate?: OnboardingTipGate;
}

export const ONBOARDING_TIPS: OnboardingTip[] = [
  {
    id: "telegram-send-to-task",
    title: "Your phone is a lab notebook",
    body:
      "Text me a photo while an experiment is open and I'll auto-attach it to that task on your laptop. Reply with a caption and I'll save that too.",
    route: "/",
    target: "telegram-send-to-task",
    wikiPath: "/wiki/integrations/telegram",
    priority: 1,
    setupAction: {
      label: "Pair Telegram",
      kind: "navigate",
      href: "/settings#telegram",
    },
  },
  {
    id: "personalize-colors",
    title: "Make it yours",
    body:
      "Feeling bored? Customize your profile color in the Settings.",
    route: "/",
    target: "personalize-colors",
    wikiPath: "/wiki/features/settings",
    priority: 2,
    setupAction: {
      label: "Open Settings",
      kind: "navigate",
      href: "/settings#personalize",
    },
  },
  {
    id: "archive-projects",
    title: "Archive, don't delete",
    body:
      "Done with a project? Archive it instead. I promise nothing gets deleted, and your tasks, results, and images stay right where they are. Unarchive any time.",
    route: "/",
    target: "archive-projects",
    wikiPath: "/wiki/features/home",
    priority: 3,
  },
  {
    id: "link-calendars",
    title: "Link your calendars",
    body:
      "Bring your other calendars in: Google, Apple, Outlook, or any public ICS URL. They show up next to your experiments so you stop juggling tabs.",
    route: "/calendar",
    target: "link-calendars",
    wikiPath: "/wiki/integrations/calendar-feeds",
    priority: 4,
    setupAction: {
      label: "Add a calendar",
      kind: "navigate",
      href: "/calendar?addFeed=1",
    },
  },
  {
    id: "public-methods",
    title: "Make a method public",
    body:
      "Want to share a protocol with the lab? Check 'Make this method public' when you create or edit a method.",
    route: "/methods",
    target: "public-methods",
    wikiPath: "/wiki/features/methods",
    priority: 6,
    setupAction: {
      label: "Start a public method",
      kind: "navigate",
      href: "/methods?createMethod=public",
    },
  },
  {
    id: "gantt-animations",
    title: "Pick your animation",
    body:
      "Sorry for the jump scare. You can pick a different animation for task completions any time.",
    route: "/gantt",
    target: "gantt-animations",
    wikiPath: "/wiki/features/gantt",
    priority: 7,
    setupAction: {
      label: "Pick an animation",
      kind: "navigate",
      href: "/gantt?animations=1",
    },
    onShow: "animation-burst",
  },
  {
    id: "workbench-notes",
    title: "There's a Notes tab too",
    body:
      "Notice the Notes tab? It's where meeting notes and running logs live. Things that don't fit on a single experiment but you still want to find later.",
    route: "/workbench",
    target: "workbench-notes",
    wikiPath: "/wiki/features/home",
    priority: 8,
    gate: "workbench-experiments-tab",
  },
  {
    id: "fullscreen-task",
    title: "Need more room?",
    body:
      "Need more room? Hit the expand button to make the task fullscreen. Esc or the same button exits.",
    route: "/",
    target: "fullscreen-task",
    wikiPath: "/wiki/features/markdown-editor",
    priority: 9,
  },
  {
    id: "goals-vs-tasks",
    title: "Goals vs Tasks",
    body:
      "Confused about Goal vs Task? Tasks are day-to-day stuff (run a PCR, order primers). Goals are the milestones they roll up to (finish a chapter, submit the paper).",
    route: "/gantt",
    target: "create-goal",
    wikiPath: "/wiki/features/gantt",
    priority: 10,
    setupAction: {
      label: "Create a goal",
      kind: "navigate",
      href: "/gantt?createGoal=1",
    },
  },
  {
    id: "ai-helper-prompt",
    title: "Train your AI to know ResearchOS",
    body:
      "Open Settings to copy an AI Helper prompt. Paste it into Claude, ChatGPT, or Gemini and your chatbot becomes a schema-aware helper that can answer feature questions and draft tasks for you.",
    route: "/",
    target: "ai-helper-cog",
    wikiPath: "/wiki/integrations/ai-helper",
    priority: 11,
    setupAction: {
      label: "Open AI Helper",
      kind: "navigate",
      href: "/settings#ai-helper",
    },
  },
];

/** Filter the catalog down to tips eligible to fire on the given route
 *  (sorted by priority). Does NOT consult the sidecar — the orchestrator
 *  applies the dismissal / cooldown / shown_count gates on top. */
export function tipsForRoute(pathname: string): OnboardingTip[] {
  return ONBOARDING_TIPS.filter((tip) => pathname.startsWith(tip.route)).sort(
    (a, b) => a.priority - b.priority,
  );
}

/** Lookup helper. Returns undefined if the id isn't in the catalog. */
export function getTip(id: string): OnboardingTip | undefined {
  return ONBOARDING_TIPS.find((t) => t.id === id);
}

/** Maximum displayed-tip count before the orchestrator taps out. Equal
 *  to the catalog size — once the user has seen the full set, the
 *  brand-new phase is over. */
export const TIP_SHOWN_CAP = ONBOARDING_TIPS.length;

/** Minimum active-seconds between consecutive tip fires (5 minutes of
 *  active engagement, see proposal §"Trigger pattern"). */
export const MIN_GAP_SECONDS = 300;

/** Tutorial mode uses a shorter cooldown so the full set sweeps
 *  through the user's first session faster. */
export const TUTORIAL_MIN_GAP_SECONDS = 60;

/** Tutorial mode skips the random roll and force-fires the highest-
 *  priority eligible tip on each tick. */
export const TUTORIAL_FORCE_FIRE = true;

/** Cumulative active-seconds cap (1 hour). After this much real
 *  engagement, the user is no longer brand-new. */
export const ACTIVE_SECONDS_CAP = 3600;

/** Active-seconds the user must spend on a tip's matching route before
 *  that tip is eligible to fire this session — keeps tips from landing
 *  the instant a user touches a new page. */
export const ROUTE_DWELL_SECONDS = 30;

/** Probability per roll tick that an eligible tip actually fires. With
 *  the 5s roll interval this gives ~33s expected fire time after
 *  eligibility opens. */
export const ROLL_PROBABILITY = 0.15;

/** Roll-tick interval in ms. */
export const ROLL_INTERVAL_MS = 5_000;
