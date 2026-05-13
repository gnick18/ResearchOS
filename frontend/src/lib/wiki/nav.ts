export const HELP_HREF = "/wiki";

/** Maps an in-app route to the wiki page that documents that view. Used
 *  by the `?` help button so clicking it from `/gantt` lands on
 *  `/wiki/features/gantt` instead of always dumping the user on
 *  Quickstart. Routes that don't have a dedicated wiki page fall back
 *  to the wiki landing. */
const APP_ROUTE_TO_WIKI: Record<string, string> = {
  "/": "/wiki/features/home",
  "/gantt": "/wiki/features/gantt",
  "/experiments": "/wiki/features/experiments",
  "/methods": "/wiki/features/methods",
  "/pcr": "/wiki/features/pcr",
  "/purchases": "/wiki/features/purchases",
  "/results": "/wiki/features/results",
  "/calendar": "/wiki/features/calendar",
  "/lab": "/wiki/features/lab-mode",
  "/search": "/wiki/features/search",
  "/links": "/wiki/features/links",
  "/settings": "/wiki/features/settings",
};

export function appRouteToWikiRoute(pathname: string): string {
  return APP_ROUTE_TO_WIKI[pathname] ?? HELP_HREF;
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
        href: "/wiki/features/gantt",
        label: "Gantt Chart",
        blurb: "Drag to reschedule, dependencies cascade automatically.",
      },
      {
        href: "/wiki/features/experiments",
        label: "Experiments & Notes",
        blurb: "Markdown notes, image strip, sub-tasks, PDF export.",
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
      },
      {
        href: "/wiki/features/search",
        label: "Search",
        blurb: "Full-text across projects, tasks, methods, notes.",
      },
      {
        href: "/wiki/features/links",
        label: "Lab Links",
        blurb: "Shared library of external URLs.",
      },
      {
        href: "/wiki/features/results",
        label: "Results",
        blurb: "Per-task results folder with images and notes.",
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
        label: "External Calendar Feeds (ICS)",
        blurb: "Subscribe to Google, Outlook, or iCloud ICS calendars.",
      },
      {
        href: "/wiki/integrations/calendar-oauth",
        label: "Calendar OAuth Setup",
        blurb:
          "One-time deployer setup so users get a one-click Connect button.",
      },
    ],
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
