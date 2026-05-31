export const HELP_HREF = "/wiki";

/** Canonical map of in-app feature route → wiki page that documents it.
 *  Consumed by:
 *    - the in-app `?` help icon (via `appRouteToWikiRoute`, falls back
 *      to the wiki landing on unmapped routes; uses prefix-match so
 *      dynamic segments like `/workbench/projects/<id>` resolve too)
 *    - the demo-mode "Read the docs" button (via `getWikiForRoute`,
 *      returns null on unmapped routes so the affordance hides;
 *      stays exact-match by design, see its doc comment)
 *
 *  Note: `/experiments` is intentionally NOT in this map. That route
 *  is a `router.replace("/workbench")` stub with no AppShell, so the
 *  `?` icon never renders there; the prior entry was unreachable. */
export const APP_ROUTE_TO_WIKI: Record<string, string> = {
  "/": "/wiki/features/home",
  "/gantt": "/wiki/features/gantt",
  "/workbench": "/wiki/features/experiments",
  "/workbench/projects": "/wiki/features/projects",
  "/methods": "/wiki/features/methods",
  "/pcr": "/wiki/features/pcr",
  "/purchases": "/wiki/features/purchases",
  "/calendar": "/wiki/features/calendar",
  "/lab-overview": "/wiki/features/lab-overview",
  "/search": "/wiki/features/search",
  "/links": "/wiki/features/links",
  "/settings": "/wiki/features/settings",
  "/trash": "/wiki/features/trash",
};

/** Prefix-aware lookup. Tries an exact match first, then walks the
 *  pathname's path segments back toward `/`, returning the first
 *  matching wiki entry. So `/workbench/projects/42` resolves to the
 *  `/workbench/projects` entry; `/workbench/foo` falls back to
 *  `/workbench`; an unrecognized top-level path returns null.
 *  Returns null when nothing matches, so callers can choose between
 *  the landing-page fallback and hiding the affordance. */
export function getWikiForRouteWithPrefix(pathname: string): string | null {
  if (APP_ROUTE_TO_WIKI[pathname]) return APP_ROUTE_TO_WIKI[pathname];
  // Walk back through path prefixes by trimming the last segment.
  let cursor = pathname;
  while (cursor.length > 0) {
    const lastSlash = cursor.lastIndexOf("/");
    if (lastSlash < 0) break;
    cursor = cursor.slice(0, lastSlash);
    if (cursor === "") cursor = "/";
    if (APP_ROUTE_TO_WIKI[cursor]) return APP_ROUTE_TO_WIKI[cursor];
    if (cursor === "/") break;
  }
  return null;
}

/** Lookup with wiki-landing fallback. Use for affordances that should
 *  always land somewhere reasonable (e.g. the `?` help icon). Prefix-
 *  matches so dynamic routes like `/workbench/projects/<id>` resolve
 *  to their documented parent (`/wiki/features/projects`). */
export function appRouteToWikiRoute(pathname: string): string {
  return getWikiForRouteWithPrefix(pathname) ?? HELP_HREF;
}

/** Strict, exact-match lookup. Returns null for unmapped routes;
 *  use for affordances that should hide rather than dump the user on
 *  the landing page (e.g. the demo-mode "Read the docs" button).
 *  Stays exact-match (NOT prefix-aware) because consumers prefer
 *  the "hide rather than fall back" behavior on dynamic routes. */
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
    href: "/wiki/start-here",
    label: "Start Here",
    blurb: "If you only read one wiki page, read this one. The 7 things worth knowing up front.",
  },
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
        label: "Welcome Tour (BeakerBot)",
        blurb: "Guided walkthrough on your real account: setup Q&A, hands-on tour, cleanup grid.",
      },
      {
        href: "/wiki/getting-started/demo-mode",
        label: "Demo Mode",
        blurb: "Try ResearchOS in the browser with a seeded yeast lab.",
      },
      {
        href: "/wiki/getting-started/user-archiving",
        label: "User Archiving",
        blurb: "Hide a former member from active views while preserving their data.",
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
        href: "/wiki/shared-lab-accounts/box",
        label: "Box",
        blurb: "Box Drive with Make Available Offline.",
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
        blurb: "Card anatomy, kebab menu actions, and the full Workspace route for each project.",
      },
      {
        href: "/wiki/features/gantt",
        label: "Gantt Chart",
        blurb: "Drag to reschedule, dependencies cascade automatically.",
      },
      {
        href: "/wiki/features/experiments",
        label: "The Workbench",
        blurb: "Three tabs (Experiments, Notes, Lists) with a shared project filter, popup with Details / Lab Notes / Method / Results, PDF / HTML / Raw export.",
      },
      {
        href: "/wiki/features/markdown-editor",
        label: "The Markdown Editor",
        blurb: "Three modes, keyboard shortcuts, image strip, code blocks.",
      },
      {
        href: "/wiki/features/version-history",
        label: "Version History",
        blurb: "A timeline of every save, an in-place per-editor diff, and a default-off restore pilot. Notes pilot, rolling out.",
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
          {
            href: "/wiki/features/method-catalog",
            label: "Template Library",
            blurb: "91 ready-to-use protocol templates by lab task; 33 bundle the verifiable source PDF (rolling out).",
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
        href: "/wiki/features/lab-overview",
        label: "Lab Overview",
        blurb: "The PI's customizable dashboard at /lab-overview.",
        children: [
          {
            href: "/wiki/features/lab-overview/widgets-and-tools",
            label: "Widgets and Tools",
            blurb: "The 13 Tools, widget variants, and the + Add widget palette.",
          },
          {
            href: "/wiki/features/lab-overview/customizable-sidebar",
            label: "Customizable sidebar",
            blurb: "The always-visible right-edge tile rail for PIs.",
          },
          {
            href: "/wiki/features/lab-overview/snapshot-tiles-and-expanded-views",
            label: "Snapshot tiles and expanded views",
            blurb: "Tile-to-popup model, drag to reorder, edit mode, Reset to default.",
          },
        ],
      },
      {
        href: "/wiki/features/lab-inbox",
        label: "Lab Inbox",
        blurb: "Lab-wide comments, @-mentions, and announcements in one stream.",
        children: [
          {
            href: "/wiki/features/lab-inbox/comments",
            label: "Comments",
            blurb: "Threaded replies on tasks, notes, and purchases, with @-mention chips.",
          },
          {
            href: "/wiki/features/lab-inbox/announcements",
            label: "Announcements",
            blurb: "PI broadcasts: pin, edit, audit trail, draft persistence.",
          },
        ],
      },
      {
        href: "/wiki/features/lab-head",
        label: "PI",
        blurb: "The per-user role that unlocks the Lab Overview and soft-write surfaces.",
        children: [
          {
            href: "/wiki/features/lab-head/edit-session-and-password",
            label: "Edit session and password",
            blurb: "The 5-minute password-gated unlock that fronts every soft-write.",
          },
          {
            href: "/wiki/features/lab-head/soft-write-actions",
            label: "Soft-write actions",
            blurb: "Purchase approval / decline, task assignment, flag for review.",
          },
          {
            href: "/wiki/features/lab-head/audit-log",
            label: "Audit log",
            blurb: "_pi_audit.json: every soft-write captured as a forensic row.",
          },
        ],
      },
      {
        href: "/wiki/features/sharing-and-permissions",
        label: "Sharing and permissions",
        blurb: "shared_with, the WHOLE_LAB_SENTINEL, canRead vs canWrite, PI view-all.",
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
        blurb: "The 7-step wizard, page-as-task semantics, and idempotent re-runs.",
      },
      {
        href: "/wiki/features/settings",
        label: "Settings",
        blurb: "Profile, password, preferences, tab visibility.",
      },
      {
        href: "/wiki/features/trash",
        label: "Trash & History",
        blurb: "Soft-delete with a 30-day recovery window. Restore or permanently delete from the /trash page.",
      },
      {
        href: "/wiki/features/notifications",
        label: "Notifications & Inbox",
        blurb: "Bell, Telegram inbox, event reminders.",
      },
      {
        href: "/wiki/features/feedback",
        label: "Feedback",
        blurb: "Bug, feature, and feedback reports via pre-filled GitHub issues.",
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
        blurb: "Import Offline Notebook ZIPs via the credential-free path; optional API path for online-only inline images.",
      },
    ],
  },
  {
    href: "/wiki/compliance",
    label: "Compliance",
    blurb: "How ResearchOS supports the NIH Data Management & Sharing Policy, and how it stacks up against LabArchives.",
    children: [
      {
        href: "/wiki/compliance/nih-data-management",
        label: "NIH Data Management & Sharing",
        blurb: "What the policy actually requires, why there is no certification, and how ResearchOS supports it.",
      },
      {
        href: "/wiki/compliance/labarchives-comparison",
        label: "ResearchOS vs LabArchives",
        blurb: "An honest side-by-side: where ResearchOS wins, where LabArchives is still ahead.",
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
