export const HELP_HREF = "/wiki";

/** Canonical map of in-app feature route → wiki page that documents it.
 *  Consumed by:
 *    - the in-app `?` help icon (via `appRouteToWikiRoute`, falls back
 *      to the wiki landing on unmapped routes)
 *    - the demo-mode "Read the docs" button (via `getWikiForRoute`,
 *      returns null on unmapped routes so the affordance hides) */
export const APP_ROUTE_TO_WIKI: Record<string, string> = {
  "/": "/wiki/features/home",
  "/gantt": "/wiki/features/gantt",
  "/experiments": "/wiki/features/experiments",
  "/workbench": "/wiki/features/experiments",
  "/methods": "/wiki/features/methods",
  "/pcr": "/wiki/features/pcr",
  "/purchases": "/wiki/features/purchases",
  "/calendar": "/wiki/features/calendar",
  "/lab": "/wiki/features/lab-mode",
  "/search": "/wiki/features/search",
  "/links": "/wiki/features/links",
  "/settings": "/wiki/features/settings",
  // FOLLOW-UP: Project Surface lives at the dynamic route
  // `/workbench/projects/<id>`. The lookup below is exact-match only, so a
  // single literal entry can't cover every id. The `?` help icon will fall
  // back to the wiki landing via `appRouteToWikiRoute`'s null-coalescing.
  // Switching this map to prefix-matching is the right next step; until
  // then, see /wiki/features/projects for the documentation.
};

/** Lookup with wiki-landing fallback. Use for affordances that should
 *  always land somewhere reasonable (e.g. the `?` help icon). */
export function appRouteToWikiRoute(pathname: string): string {
  return APP_ROUTE_TO_WIKI[pathname] ?? HELP_HREF;
}

/** Strict lookup. Returns null for unmapped routes; use for affordances
 *  that should hide rather than dump the user on the landing page (e.g.
 *  the demo-mode "Read the docs" button). */
export function getWikiForRoute(pathname: string): string | null {
  return APP_ROUTE_TO_WIKI[pathname] ?? null;
}

export interface WikiNode {
  href: string;
  label: string;
  /** Short blurb shown on the section index page and (for the landing page)
   *  the quickstart cards. Keep under ~80 chars. */
  blurb?: string;
  /** When set, this node is a section header with nested children. The
   *  section header itself may also be a real route (e.g. an overview page). */
  children?: WikiNode[];
}

export const WIKI_NAV: WikiNode[] = [
  {
    href: "/wiki",
    label: "Quickstart",
    blurb: "60-second tour of ResearchOS.",
  },
  {
    href: "/wiki/getting-started",
    label: "Getting Started",
    children: [
      {
        href: "/wiki/getting-started/browser-requirements",
        label: "Browser Requirements",
        blurb: "Why ResearchOS needs Chrome, Edge, or Brave.",
      },
      {
        href: "/wiki/getting-started/connecting-your-folder",
        label: "Connecting Your Folder",
        blurb: "How the folder picker works and what it stores.",
      },
      {
        href: "/wiki/getting-started/creating-a-user",
        label: "Creating a User",
        blurb: "Pick a username, set an optional password.",
      },
      {
        href: "/wiki/getting-started/welcome-wizard",
        label: "The Welcome Wizard",
        blurb: "Seven-step setup that picks your tabs and offers three integrations.",
      },
      {
        href: "/wiki/getting-started/demo-mode",
        label: "Demo Mode",
        blurb: "Try ResearchOS in the browser with a seeded yeast lab.",
      },
      {
        href: "/wiki/getting-started/labarchives-export",
        label: "Exporting from LabArchives",
        blurb: "Generate the Offline Notebook ZIP that ResearchOS imports.",
      },
    ],
  },
  {
    href: "/wiki/shared-lab-accounts",
    label: "Shared Lab Accounts",
    blurb: "Run one ResearchOS folder across a whole lab.",
    children: [
      {
        href: "/wiki/shared-lab-accounts/onedrive",
        label: "OneDrive",
        blurb: "Files On-Demand → Always keep on this device.",
      },
      {
        href: "/wiki/shared-lab-accounts/google-drive",
        label: "Google Drive",
        blurb: "Drive for desktop in Mirror mode.",
      },
      {
        href: "/wiki/shared-lab-accounts/dropbox",
        label: "Dropbox",
        blurb: "Smart Sync set to Local.",
      },
      {
        href: "/wiki/shared-lab-accounts/icloud",
        label: "iCloud Drive",
        blurb: "Keep Downloaded on macOS.",
      },
    ],
  },
  {
    href: "/wiki/features",
    label: "Features",
    children: [
      {
        href: "/wiki/features/home",
        label: "Home & Projects",
        blurb: "Create, color, archive, and reorder projects.",
      },
      {
        href: "/wiki/features/projects",
        label: "Project Surface",
        blurb: "Slim Inspector popup plus a full Workspace route for each project.",
      },
      {
        href: "/wiki/features/gantt",
        label: "Gantt Chart",
        blurb: "Drag to reschedule, dependencies cascade automatically.",
      },
      {
        href: "/wiki/features/experiments",
        label: "Experiments & Notes",
        blurb: "Tile grid, popup with Notes / Method / Results, PDF / HTML / Raw export.",
      },
      {
        href: "/wiki/features/markdown-editor",
        label: "The Markdown Editor",
        blurb: "Three modes, keyboard shortcuts, image strip, code blocks.",
      },
      {
        href: "/wiki/features/methods",
        label: "Methods Library",
        blurb: "Reusable protocols, with PCR programs as a specialized form.",
        children: [
          {
            href: "/wiki/features/pcr",
            label: "PCR Protocols",
            blurb: "Visual thermal gradient editor and reagent table.",
          },
        ],
      },
      {
        href: "/wiki/features/purchases",
        label: "Purchases & Funding",
        blurb: "Track buys against lab-wide funding accounts.",
      },
      {
        href: "/wiki/features/calendar",
        label: "Calendar",
        blurb: "Native events plus external read-only feeds.",
      },
      {
        href: "/wiki/features/lab-mode",
        label: "Lab Mode",
        blurb: "Aggregated view across every user in the folder.",
        children: [
          {
            href: "/wiki/features/lab-mode/activity",
            label: "Activity",
            blurb: "Running now, recently completed, recent shared notes.",
          },
          {
            href: "/wiki/features/lab-mode/gantt",
            label: "Combined GANTT",
            blurb: "Every user's tasks on one timeline, colored by owner.",
          },
          {
            href: "/wiki/features/lab-mode/purchases",
            label: "Lab-wide purchases",
            blurb: "Cross-user spend rolled up by funding account.",
          },
          {
            href: "/wiki/features/lab-mode/cross-user-lists",
            label: "Cross-user lists",
            blurb: "Experiments, Methods, Roadmaps, and Notes across the lab.",
          },
          {
            href: "/wiki/features/lab-mode/user-filter",
            label: "The user filter",
            blurb: "Pick who shows up on every tab, plus the per-user side panel.",
          },
        ],
      },
      {
        href: "/wiki/features/search",
        label: "Search",
        blurb: "Filter-driven task search across your projects.",
      },
      {
        href: "/wiki/features/links",
        label: "Lab Links",
        blurb: "Your personal bookmark wall, grouped by category.",
      },
      {
        href: "/wiki/features/results",
        label: "Results (moved)",
        blurb: "Where the standalone Results page's surfaces moved to.",
      },
      {
        href: "/wiki/features/import-from-eln",
        label: "Import from LabArchives",
        blurb: "The 6-step wizard, page-as-task semantics, and idempotent re-runs.",
      },
      {
        href: "/wiki/features/settings",
        label: "Settings",
        blurb: "Profile, password, preferences, tab visibility.",
      },
      {
        href: "/wiki/features/notifications",
        label: "Notifications & Inbox",
        blurb: "Bell, Telegram inbox, event reminders.",
      },
    ],
  },
  {
    href: "/wiki/integrations",
    label: "Integrations",
    children: [
      {
        href: "/wiki/integrations/telegram",
        label: "Telegram Bot",
        blurb: "Send phone photos straight into your inbox.",
      },
      {
        href: "/wiki/integrations/calendar-feeds",
        label: "Calendar Feeds",
        blurb: "Subscribe to Google, Outlook, or iCloud calendars via iCal URL.",
      },
      {
        href: "/wiki/integrations/labarchives",
        label: "LabArchives",
        blurb: "Import Offline Notebook ZIPs and (optionally) connect your account so the importer can fetch online-only inline images.",
      },
    ],
  },
  {
    href: "/wiki/security",
    label: "Security",
    blurb: "What stays on your computer, what briefly touches our server, and what we never collect.",
  },
];

/** Flatten the nav tree to a single list of leaf pages, in display order.
 *  Used to build prev/next links and the screenshot capture list. */
export function flattenWikiNav(nodes: WikiNode[] = WIKI_NAV): WikiNode[] {
  const out: WikiNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.children) out.push(...flattenWikiNav(node.children));
  }
  return out;
}

/** Find a node by exact href match. */
export function findWikiNode(href: string, nodes: WikiNode[] = WIKI_NAV): WikiNode | null {
  for (const node of nodes) {
    if (node.href === href) return node;
    if (node.children) {
      const found = findWikiNode(href, node.children);
      if (found) return found;
    }
  }
  return null;
}

/** Return the prev/next leaf nodes around the given href (linear order
 *  matching the sidebar). Section parents that have their own page are
 *  treated as ordinary stops in the sequence. */
export function getPrevNext(href: string): { prev: WikiNode | null; next: WikiNode | null } {
  const flat = flattenWikiNav();
  const idx = flat.findIndex((n) => n.href === href);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? flat[idx - 1] : null,
    next: idx < flat.length - 1 ? flat[idx + 1] : null,
  };
}
