/**
 * Onboarding tip catalog. The orchestrator iterates this list on every
 * roll tick, filtering by pathname + sidecar state to find an eligible
 * tip. Numbered priority = display order when multiple tips match the
 * same route.
 *
 * Each tip points at a real, shipped feature whose entry point is
 * non-obvious to a brand-new user. Content matches the LOCKED 10-tip
 * set from `ONBOARDING_TIPS_PROPOSAL.md` §"Initial tip set".
 */

export interface OnboardingTip {
  /** Stable identifier used as the sidecar `tips` key. Must match the
   *  `data-onboarding-target` attribute of the DOM element this tip
   *  points at. */
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
  /** Body copy. ≤140 chars in display (so the card stays compact). */
  body: string;
  /** Wiki path to open when the user clicks "Read more →". Plain
   *  `<a href>` — full page nav, like the rest of the wiki entry
   *  points in the app. */
  wikiPath: string;
  /** Display priority. Lower wins when multiple tips share a route. */
  priority: number;
}

export const ONBOARDING_TIPS: OnboardingTip[] = [
  {
    id: "drop-to-replace",
    title: "Drop to replace images",
    route: "/",
    target: "drop-to-replace",
    body:
      "Drop a new image onto any existing image to replace it in place — no need to open the editor first.",
    wikiPath: "/wiki/features/markdown-editor#drop-to-replace",
    priority: 1,
  },
  {
    id: "telegram-send-to-task",
    title: "Inbox photos → tasks",
    route: "/",
    target: "telegram-send-to-task",
    body:
      "Photos from your Telegram bot land in your Inbox. Click any image and pick a task to attach it to — no manual filing.",
    wikiPath: "/wiki/integrations/telegram",
    priority: 2,
  },
  {
    id: "duplicate-upload",
    title: "Same-name uploads ask first",
    route: "/",
    target: "duplicate-upload",
    body:
      "Upload a file with a name that already exists and ResearchOS will ask: dedupe, replace, or rename. No silent overwrites.",
    wikiPath: "/wiki/features/markdown-editor#duplicate-upload",
    priority: 3,
  },
  {
    id: "cross-owner-share",
    title: "Host a colleague's task",
    route: "/",
    target: "cross-owner-share",
    body:
      "Drop a colleague's task into your project to host it. Both their Gantt and yours stay in sync — they own the data, you see it in your timeline.",
    wikiPath: "/wiki/features/links#cross-owner",
    priority: 4,
  },
  {
    id: "appshell-cluster",
    title: "Bottom-right quick actions",
    route: "/",
    target: "appshell-cluster",
    body:
      "Bottom-right corner has five quick actions: data folder, user switch, bug report, support, and a notification test button. Hover to see labels.",
    wikiPath: "/wiki/features/settings",
    priority: 5,
  },
  {
    id: "labarchives-import",
    title: "Import a LabArchives notebook",
    route: "/settings",
    target: "labarchives-import",
    body:
      "Import an entire LabArchives notebook as projects and tasks. The wizard walks you through page-to-project mapping; inline images are rehydrated automatically.",
    wikiPath: "/wiki/integrations/labarchives",
    priority: 6,
  },
  {
    id: "lab-mode",
    title: "Lab Mode rolls everything up",
    route: "/lab",
    target: "lab-mode",
    body:
      "Lab Mode is the multi-user roll-up. Eight tabs — Activity, Gantt, Experiments, Roadmaps, Methods, Notes, Search — each answers one question across the whole lab.",
    wikiPath: "/wiki/features/lab-mode",
    priority: 7,
  },
  {
    id: "wiki-entry",
    title: "Every feature has a wiki page",
    route: "/",
    target: "wiki-entry",
    body:
      "Click the docs icon any time you want the long version. No login, no separate tab management — it opens beside your work.",
    wikiPath: "/wiki/",
    priority: 8,
  },
  {
    id: "high-level-goals",
    title: "Roadmap goals per project",
    route: "/gantt",
    target: "high-level-goals",
    body:
      "Every project carries roadmap goals. Open the goals sidebar to track them — useful in lab meetings or 1:1s.",
    wikiPath: "/wiki/features/home",
    priority: 9,
  },
  {
    id: "methods-folder-tree",
    title: "Methods folder tree",
    route: "/methods",
    target: "methods-folder-tree",
    body:
      "Protocols live in a folder tree. Drag and drop to reorganize; click a folder to bulk-edit its methods together.",
    wikiPath: "/wiki/features/methods",
    priority: 10,
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
