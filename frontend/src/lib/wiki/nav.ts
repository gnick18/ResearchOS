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
  "/purchases": "/wiki/features/purchases",
  "/inventory": "/wiki/features/inventory",
  "/calendar": "/wiki/features/calendar",
  "/lab-overview": "/wiki/features/lab-overview",
  "/lab-experiments": "/wiki/features/lab-experiments",
  "/lab-notes": "/wiki/features/lab-notes",
  "/lab-inbox": "/wiki/features/lab-inbox",
  // No dedicated /people wiki page yet; point at the lab-head overview, the
  // closest surface that explains the roster + workload + approvals.
  "/people": "/wiki/features/lab-head",
  "/search": "/wiki/features/search",
  "/links": "/wiki/features/links",
  "/settings": "/wiki/features/settings",
  "/trash": "/wiki/features/trash",
  "/sequences": "/wiki/features/sequences",
  "/datahub": "/wiki/features/datahub",
  "/chemistry": "/wiki/features/chemistry",
  "/phylo": "/wiki/features/phylo",
  "/figures": "/wiki/features/figures",
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
    blurb: "If you read one wiki page, read this one. What the app is, and the few things worth knowing before you start.",
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
        href: "/wiki/getting-started/accounts",
        label: "Account tiers",
        blurb: "Local-only, Free account, and Lab: what each unlocks, how to create one, how to join a lab.",
      },
      {
        href: "/wiki/getting-started/browser-requirements",
        label: "Browser Requirements",
        blurb: "Why ResearchOS needs Chrome or Edge.",
      },
      {
        href: "/wiki/getting-started/connecting-your-folder",
        label: "Connecting Your Folder",
        blurb: "How the folder picker works and what it stores.",
      },
      {
        href: "/wiki/getting-started/converting-to-single-user",
        label: "Converting to single-user",
        blurb: "Split an older shared folder so everyone gets their own workspace. Recoverable, and your own data is untouched.",
      },
      {
        href: "/wiki/getting-started/creating-a-user",
        label: "Creating a User",
        blurb: "Pick a username, set an optional password.",
      },
      {
        href: "/wiki/getting-started/welcome-wizard",
        label: "Welcome Tour (BeakerBot)",
        blurb: "The original guided walkthrough is retired and fresh accounts no longer launch it. A new flag-gated onboarding wizard is in progress.",
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
        label: "Where you land",
        blurb: "Members land on the Workbench Projects grid; PIs on the curated Lab Overview. No customizable home dashboard.",
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
        href: "/wiki/features/ai-helper",
        label: "Use any AI with your data",
        blurb: "Your notebook is plain files, so any AI can read it. The built-in AI Helper prompt plus the paste and agentic flows.",
      },
      {
        href: "/wiki/features/beakerbot",
        label: "BeakerBot assistant",
        blurb: "The built-in assistant that operates the app for you: mentions, slash commands, macros, full object CRUD, summaries, and PDF reproduce.",
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
            blurb: "91 ready-to-use protocol templates by lab task; 52 bundle the verifiable source PDF (rolling out).",
          },
        ],
      },
      {
        href: "/wiki/features/sequences",
        label: "Sequences",
        blurb: "View, edit, annotate, and clone DNA, RNA, and protein sequences. Your plasmid library lives alongside your notes and experiments.",
      },
      {
        href: "/wiki/features/datahub",
        label: "Data Hub",
        blurb: "A free, open-source GraphPad Prism alternative. Statistics and publication figures that run in the browser, with your data staying in your folder.",
      },
      {
        href: "/wiki/features/chemistry",
        label: "Chemistry",
        blurb: "A free ChemDraw and SciFinder alternative. Draw structures, build a molecule library, and find the papers and patents for a compound, all in the browser.",
      },
      {
        href: "/wiki/features/phylo",
        label: "Phylogenetics",
        blurb: "A Tree Builder that writes you a verified, runnable tree-building recipe, and a Tree Studio that renders and annotates trees in the browser, a free iTOL alternative.",
      },
      {
        href: "/wiki/features/figures",
        label: "Figure Composer",
        blurb: "Lay your real data figures out on a single publication page, with live panels from sequences, molecules, trees, and Data Hub plots, exported as one clean vector SVG.",
      },
      {
        href: "/wiki/features/cloning",
        label: "Cloning",
        blurb: "In-silico assembly: Gibson and NEBuilder overlap, Golden Gate, restriction-ligation, and Gateway, with a review step before anything is saved.",
      },
      {
        href: "/wiki/features/restriction-digest",
        label: "Restriction digest",
        blurb: "Find where enzymes cut on both strands, with fragment sizes for linear and circular molecules.",
      },
      {
        href: "/wiki/features/lab-calculators",
        label: "Lab calculators",
        blurb: "Molarity, dilution, primer Tm, nucleic-acid mass, protein properties, and a scientific calculator, computed live in your browser.",
      },
      {
        href: "/wiki/features/image-annotation",
        label: "Image annotation",
        blurb: "Mark up gels and micrographs without touching the original image. Annotations live in a sidecar you can delete to revert.",
      },
      {
        href: "/wiki/features/companion",
        label: "Companion",
        blurb: "The phone app that pairs to your laptop, so you capture photos, scan handwriting, glance at today, read methods, and track inventory at the bench.",
        children: [
          {
            href: "/wiki/features/companion/pairing",
            label: "Pairing",
            blurb: "Scan a QR to link your phone to a laptop. No account, no password, just public keys.",
          },
          {
            href: "/wiki/features/companion/capture-and-route",
            label: "Capture and route",
            blurb: "Take or upload a photo, caption it, and file it into an experiment's Lab Notes or Results.",
          },
          {
            href: "/wiki/features/companion/scanning-notes",
            label: "Scanning handwritten notes",
            blurb: "Scan a paper page; on-device recognition makes the handwriting searchable on the laptop.",
          },
          {
            href: "/wiki/features/companion/today-glance",
            label: "Today glance",
            blurb: "Pull down to see what is scheduled, overdue, and upcoming, delivered from the laptop.",
          },
          {
            href: "/wiki/features/companion/view-method",
            label: "View a method on your phone",
            blurb: "Read a method big and scrollable at the bench, and log a variation back to the experiment.",
          },
          {
            href: "/wiki/features/companion/inventory-scanning",
            label: "Inventory scanning",
            blurb: "Barcode-scan to count stock down, see what is low, and mark a purchase as arrived.",
          },
        ],
      },
      {
        href: "/wiki/features/purchases",
        label: "Purchases & Funding",
        blurb: "Track buys against lab-wide funding accounts.",
      },
      {
        href: "/wiki/features/cloud-and-plans",
        label: "Cloud storage & plans",
        blurb: "Local-first by default, an optional 5 GB shared lab pool, flat-price plans for heavy use, and only the PI ever pays.",
      },
      {
        href: "/wiki/features/inventory",
        label: "Inventory",
        blurb: "The inventory you will actually keep: count containers not volumes, one-tap status, and expiry, stale, and low signals computed for free.",
      },
      {
        href: "/wiki/features/calendar",
        label: "Calendar",
        blurb: "Native events plus external read-only feeds.",
      },
      {
        href: "/wiki/features/lab-overview",
        label: "Lab Overview",
        blurb: "The PI's curated landing page at /lab-overview with a What-needs-you hero, a lab stat strip, the people snapshot, and an inline announcement composer.",
      },
      {
        href: "/wiki/features/lab-experiments",
        label: "Browse lab experiments",
        blurb: "The PI's read-first view of every member's experiments at /lab-experiments. Open one to review it, or edit it as the lab head with the change recorded against the owner.",
      },
      {
        href: "/wiki/features/lab-notes",
        label: "Browse lab notes",
        blurb: "The PI's read-first view of every member's notes at /lab-notes. The notes counterpart to Browse lab experiments.",
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
        href: "/wiki/features/one-on-ones",
        label: "Mentoring and check-ins",
        blurb: "The 1:1 advising surface a lab head and a member share: weekly goals, meeting notes, notes, and a running agenda.",
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
        blurb: "Bell, photo inbox, and event reminders.",
      },
      {
        href: "/wiki/features/feedback",
        label: "Feedback",
        blurb: "Bug, feature, and feedback reports via pre-filled GitHub issues.",
      },
    ],
  },
  {
    href: "/wiki/stats",
    label: "Reading your statistics",
    blurb: "Plain-English guides to the numbers the Data Hub gives you: effect sizes, ANOVA, regression, survival, and more.",
    children: [
      {
        href: "/wiki/stats/effect-sizes",
        label: "Effect sizes and confidence intervals",
        blurb: "Why the size of a difference and its range matter more than a bare p-value. The foundation page.",
      },
      {
        href: "/wiki/stats/anova",
        label: "ANOVA, post-hoc, and two-way",
        blurb: "Compare three or more groups, find which pairs differ, and handle two factors at once.",
      },
      {
        href: "/wiki/stats/repeated-measures",
        label: "Repeated measures and nested designs",
        blurb: "Repeated-measures ANOVA, mixed models, and why cells-within-mice are not your sample size.",
      },
      {
        href: "/wiki/stats/correlation-and-regression",
        label: "Correlation and regression",
        blurb: "How tightly two variables track, fitting a line with a slope you can read, and multiple predictors.",
      },
      {
        href: "/wiki/stats/dose-response",
        label: "Dose-response curves",
        blurb: "EC50 and IC50, the 4PL and 5PL fits, the Hill slope, model comparison, and global fits.",
      },
      {
        href: "/wiki/stats/survival",
        label: "Survival curves and hazard ratios",
        blurb: "Kaplan-Meier curves, the log-rank test, and the Cox hazard ratio for time-to-event data.",
      },
      {
        href: "/wiki/stats/contingency",
        label: "Contingency tables and odds ratios",
        blurb: "Chi-square vs Fisher exact, odds ratios (including logistic regression), and relative risk.",
      },
      {
        href: "/wiki/stats/roc-auc",
        label: "ROC curves and AUC",
        blurb: "How well a measurement separates two groups: sensitivity, specificity, AUC, and a cut point.",
      },
      {
        href: "/wiki/stats/outliers",
        label: "Outlier tests",
        blurb: "The Grubbs test, and the honest caution that removing a data point needs a real reason.",
      },
    ],
  },
  {
    href: "/wiki/integrations",
    label: "Integrations",
    children: [
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
      {
        href: "/wiki/compliance/depositing-to-a-repository",
        label: "Depositing to a repository",
        blurb: "Guided deposit to Zenodo or Figshare with prefilled DataCite metadata. You control the final publish.",
      },
    ],
  },
  {
    href: "/wiki/security",
    label: "Security",
    blurb: "What stays on your computer, what briefly touches our server, and what we never collect.",
  },
  {
    href: "/wiki/trust",
    label: "Trust",
    blurb: "Why you can trust ResearchOS: your data stays local, the science is validated against the tools labs already trust, the code is open, and the funding is clean.",
    children: [
      {
        href: "/wiki/trust/method-validation",
        label: "Method validation",
        blurb: "Every sequence and lab calculation is checked against Biopython, primer3, and pydna on every commit.",
      },
      {
        href: "/wiki/trust/open-source",
        label: "Open source and license",
        blurb: "AGPLv3 lets a lab read, fork, and self-host the code; the credits page carries the attribution we owe.",
      },
      {
        href: "/wiki/trust/how-we-fund-it",
        label: "How it stays free",
        blurb: "Grant-funded through a UW Distinguished Research Fellowship at UW-Madison, no per-seat fees.",
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
