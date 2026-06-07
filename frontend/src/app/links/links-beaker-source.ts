// sequence editor master (Links source sub-bot). BeakerSearch step 3, the LAST
// per-page SOURCE, the Links page.
//
// This module is the PURE builder behind the Links page's BeakerSearch
// registration. It takes a plain snapshot of the page state (the merged
// own + shared-in links, the category grouping, the selection / create form,
// the palette-managed category filter) plus a bag of handler callbacks, and
// returns one BeakerSearchSource (context card + commands + suggested ids +
// nav groups + the query-aware interpretQuery seam). It reads NO store, holds
// NO React, and calls NO Date.now(), so the context-card copy, the command ids
// / groups / enabled gating, the Suggested ordering, the nav groups, and the
// typed-url interpretation are all unit-tested without rendering. The thin
// useLinksBeakerSource hook (co-located) wires the live page state + the real
// labLinksApi handlers into this builder inside a useMemo.
//
// The spec is docs/proposals/beakersearch-links.md, the approved target is
// docs/mockups/beakersearch-links-palette.html. Where the spec's sketch uses an
// older function-based source shape (context() / suggested() / entities()),
// this maps it onto the ACTUAL generic BeakerSearchSource contract, contextCard
// + commands (with stable ids + page-defined groups) + suggestedIds + navGroups
// + interpretQuery.
//
// Ownership gate (spec 3.1), own links (isOwnLink, !owner || owner ===
// currentUser) allow every action, shared-in links are VIEW-ONLY so every write
// row is OMITTED and only Open / Copy / Jump survive. The external open (spec
// 4.2) is always a new tab with noopener,noreferrer and is never the
// default-highlighted row.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import type { IconName } from "@/components/icons";
import type { BeakerSearchSource } from "@/components/beaker-search/types";
import type {
  EditorCommand,
  PaletteContextCard,
  PaletteNavGroup,
  PaletteNavItem,
} from "@/components/sequences/editor-commands";
import type { LabLink } from "@/lib/types";

// ── Page-defined command groups ────────────────────────────────────────────
// These print between the page's nav groups and the global "Go to" / "App"
// layer, in first-appearance order (see editor-commands COMMAND_GROUP_ORDER).
export const LINKS_GROUP_SELECTED = "Selected link";
export const LINKS_GROUP_CREATE = "Create";
export const LINKS_GROUP_EDIT = "Edit";
export const LINKS_GROUP_VISIBILITY = "Visibility";
export const LINKS_GROUP_DELETE = "Delete";
export const LINKS_GROUP_OPEN = "Open / copy";
export const LINKS_GROUP_FILTER = "Filter / view";

// ── The plain state snapshot the builder reads ─────────────────────────────
export interface LinksSourceData {
  /** Own + shared-in links, the page's privacy-filtered ["lab-links"] list. */
  links: LabLink[];
  /** The category grouping the page renders (link.category || "Other"). */
  groupedLinks: Record<string, LabLink[]>;

  // Selection / form (SELECTED + FOCUSED).
  editingLink: LabLink | null;
  isCreating: boolean;
  isLoadingPreview: boolean;

  // Create / edit form state (drives the draft Suggested set, spec 3.5).
  title: string;
  url: string;
  wholeLab: boolean;
  color: string;

  // Palette-owned view state (NEW, the page has no filter today, spec 7).
  activeCategory: string | null;

  // Identity.
  currentUser: string;
  profileMap: Record<string, { displayName?: string | null }>;

  // Hovered card key, "link:{owner}:{id}" (the provider's [data-beaker-target]).
  // Inert until step 4, the hook passes null for now.
  hoveredKey: string | null;
}

// ── The handler bag (closures over the real page setters + labLinksApi) ─────
export interface LinksSourceHandlers {
  // Form flows (the page's real handlers).
  startCreate: () => void;
  startEdit: (link: LabLink) => void;
  cancelEdit: () => void;
  handleCreate: () => void | Promise<void>;
  handleUpdate: () => void | Promise<void>;
  handleFetchPreview: () => void | Promise<void>;
  setDeleteConfirmId: (id: number | null) => void;
  setColor: (hex: string) => void;
  setWholeLab: (b: boolean) => void;

  // Palette-managed category filter.
  setActiveCategory: (c: string | null) => void;

  // Direct writes (wrap labLinksApi.update + the single ["lab-links"]
  // invalidation in the hook), used by the per-link Suggested rows.
  toggleVisibility: (link: LabLink) => void | Promise<void>;
  refreshPreview: (link: LabLink) => void | Promise<void>;

  // Read-only moves (allowed on shared-in links too).
  openExternally: (link: LabLink) => void;
  /** Open every link in a category in new tabs, behind a confirm past a few
   *  (spec 3.3 / 4.2 bulk rule). The confirm lives in the handler. */
  openAll: (links: LabLink[]) => void;
  copyUrl: (link: LabLink) => void | Promise<void>;
  jumpToLink: (link: LabLink) => void;
  jumpToCategory: (category: string) => void;
}

// The eight suggested category constants (mirrored from the page's CATEGORIES,
// kept here so the builder stays pure without importing the React page).
export const LINKS_CATEGORIES = [
  "Protocol",
  "Database",
  "Tool",
  "Reference",
  "Supplier",
  "Publication",
  "Software",
  "Other",
];

// Above this many links in a bucket, "Open all in {category}" hides behind a
// confirm (spec 3.3 / 8, the bulk-open question). The confirm itself lives in
// the hook's handler; the builder only labels the row honestly.
export const BULK_OPEN_CONFIRM_THRESHOLD = 4;

/** A link is OWNED by the viewer when its owner is unset (legacy, lives in the
 *  viewer's own folder) or equals the current user. The page's isOwnLink. */
export function isOwnLink(link: LabLink, currentUser: string): boolean {
  return !link.owner || link.owner === currentUser;
}

/** The composite owner:id key, ids are per-user namespaced so a bare numeric id
 *  could collide across owners (spec 1.3). */
export function linkKey(link: LabLink, currentUser: string): string {
  return `${link.owner ?? currentUser}:${link.id}`;
}

/** Whether the link is shared with the whole lab (the "*" sentinel). Mirrors
 *  the page's isWholeLabShared(link.shared_with ?? []) without importing it, so
 *  the builder stays pure. */
function isWholeLab(link: LabLink): boolean {
  return (link.shared_with ?? []).some((s) => s.username === "*");
}

/** The hostname for a url, guarded, so a malformed stored url degrades to the
 *  raw string rather than throwing (spec 4.2 rule 3 + edge cases). */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** The display category for a link, "Uncategorized" when null (spec edge
 *  cases, clearer than the synthetic "Other" bucket name). */
function displayCategory(link: LabLink): string {
  return link.category ?? "Uncategorized";
}

/** The visibility descriptor for the context card / echoes. */
function visibilityWord(link: LabLink): string {
  return isWholeLab(link) ? "shared with the whole lab" : "private to you";
}

/** The owner display name for a shared-in card (spec 3.1). */
function ownerName(
  link: LabLink,
  profileMap: Record<string, { displayName?: string | null }>,
): string {
  if (!link.owner) return "";
  return profileMap[link.owner]?.displayName?.trim() || link.owner;
}

/** Parse a typed query as a url (spec 4.2, the typed-url quick-open). Accepts a
 *  full http/https url OR a bare domain like "addgene.org" (a dotted token, no
 *  spaces). Returns the normalized url + its hostname, or null when the query is
 *  not a url ("lab meeting" is not). Pure, unit-tested. */
export function parseLinkUrl(
  query: string,
): { url: string; hostname: string } | null {
  const q = query.trim();
  if (q === "" || /\s/.test(q)) return null;

  // Explicit http/https, parse directly and require a dotted host.
  if (/^https?:\/\//i.test(q)) {
    try {
      const u = new URL(q);
      if (!u.hostname.includes(".")) return null;
      return { url: u.href, hostname: u.hostname };
    } catch {
      return null;
    }
  }

  // Bare domain like "addgene.org" or "blast.ncbi.nlm.nih.gov/Blast.cgi". A
  // dotted token with a plausible TLD label, no protocol. Reject things that
  // are clearly not hosts (a leading dot, a trailing dot before the path, no
  // letter in the TLD).
  const host = q.split("/")[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return null;
  try {
    const u = new URL(`https://${q}`);
    return { url: u.href, hostname: u.hostname };
  } catch {
    return null;
  }
}

/** The scope summary line for the context card (spec 2.5). "24 saved, 6
 *  categories" unfiltered, "Protocol, 5 links" when a category filter is
 *  active, "none saved yet" when empty. */
export function linksScopeSummary(data: LinksSourceData): string {
  if (data.activeCategory) {
    const count = data.groupedLinks[data.activeCategory]?.length ?? 0;
    return `${data.activeCategory}, ${count} link${count === 1 ? "" : "s"}`;
  }
  const total = data.links.length;
  if (total === 0) return "none saved yet";
  const cats = Object.keys(data.groupedLinks).length;
  return `${total} saved, ${cats} categor${cats === 1 ? "y" : "ies"}`;
}

/** Build the context card (spec 2.5). Line 1 is the scope (title + meta), line 2
 *  under a hairline divider is the editing link, the new-link draft, or absent. */
function buildContextCard(data: LinksSourceData): PaletteContextCard {
  let selection: PaletteContextCard["selection"];

  if (data.editingLink) {
    const l = data.editingLink;
    selection = {
      iconName: "share",
      text: `Selected, "${l.title}", ${displayCategory(l)}, ${visibilityWord(l)}`,
    };
  } else if (data.isCreating) {
    const dirty = data.title.trim() !== "" || data.url.trim() !== "";
    selection = {
      iconName: "plus",
      text: dirty ? "New link draft, unsaved" : "New link draft",
    };
  }

  return {
    iconName: "share",
    title: "Links",
    meta: linksScopeSummary(data),
    selection,
  };
}

/** The url echo, truncated for the Copy row detail. */
function truncatedUrl(url: string): string {
  return url.length > 48 ? `${url.slice(0, 47)}...` : url;
}

// ── Per-link command builders ──────────────────────────────────────────────
// Stable ids are namespaced by the composite key so a shared-in link and an own
// link of the same numeric id never collide (spec 1.3). The Suggested rule
// names these ids back.

function readOnlyLinkCommands(
  link: LabLink,
  data: LinksSourceData,
  handlers: LinksSourceHandlers,
): EditorCommand[] {
  const key = linkKey(link, data.currentUser);
  return [
    {
      id: `links-open-${key}`,
      label: `Open "${link.title}"`,
      detail: `${hostnameOf(link.url)}, opens in a new tab`,
      group: LINKS_GROUP_OPEN,
      iconName: "export",
      run: () => handlers.openExternally(link),
    },
    {
      id: `links-copy-${key}`,
      label: "Copy URL",
      detail: truncatedUrl(link.url),
      group: LINKS_GROUP_OPEN,
      iconName: "copy",
      run: () => void handlers.copyUrl(link),
    },
    {
      id: `links-jump-${key}`,
      label: `Jump to "${link.title}"`,
      detail: "scroll to the card on the board",
      group: LINKS_GROUP_OPEN,
      iconName: "share",
      run: () => handlers.jumpToLink(link),
    },
  ];
}

function writeLinkCommands(
  link: LabLink,
  data: LinksSourceData,
  handlers: LinksSourceHandlers,
): EditorCommand[] {
  const key = linkKey(link, data.currentUser);
  const editing = data.editingLink?.id === link.id && data.editingLink?.owner === link.owner;
  const formValid = data.title.trim() !== "" && data.url.trim() !== "";
  const out: EditorCommand[] = [];

  // Save / Cancel lead only while THIS link is the one being edited (spec 3.2).
  if (editing) {
    out.push({
      id: `links-save-${key}`,
      label: "Save changes",
      detail: "saves your edits",
      group: LINKS_GROUP_EDIT,
      iconName: "check",
      enabled: formValid,
      run: () => void handlers.handleUpdate(),
    });
    out.push({
      id: `links-cancel-${key}`,
      label: "Cancel editing",
      detail: "discards unsaved edits",
      group: LINKS_GROUP_EDIT,
      iconName: "refresh",
      run: () => handlers.cancelEdit(),
    });
  }

  out.push({
    id: `links-edit-${key}`,
    label: `Edit "${link.title}"`,
    detail: `${displayCategory(link)}, ${isWholeLab(link) ? "whole lab" : "private"}`,
    group: LINKS_GROUP_EDIT,
    iconName: "pencil",
    run: () => handlers.startEdit(link),
  });
  out.push({
    id: `links-category-${key}`,
    label: "Change category",
    detail: displayCategory(link),
    group: LINKS_GROUP_EDIT,
    iconName: "folder",
    run: () => handlers.startEdit(link),
  });
  out.push({
    id: `links-visibility-${key}`,
    label: isWholeLab(link) ? "Make private" : "Make whole-lab",
    detail: isWholeLab(link) ? "only you" : "everyone in your lab",
    group: LINKS_GROUP_VISIBILITY,
    iconName: "eye",
    run: () => void handlers.toggleVisibility(link),
  });
  out.push({
    id: `links-refresh-${key}`,
    label: "Refresh preview",
    detail: "re-fetches the thumbnail",
    group: LINKS_GROUP_EDIT,
    iconName: "refresh",
    run: () => void handlers.refreshPreview(link),
  });
  out.push({
    id: `links-delete-${key}`,
    label: `Delete "${link.title}"`,
    detail: "removes the bookmark",
    group: LINKS_GROUP_DELETE,
    iconName: "trash",
    run: () => handlers.setDeleteConfirmId(link.id),
  });

  return out;
}

/** The full per-link command set, gated on ownership (spec 3.1 / 3.2). Own
 *  links get read-only + write rows, shared-in links get read-only rows only
 *  (the write rows are OMITTED, not greyed). */
function linkCommands(
  link: LabLink,
  data: LinksSourceData,
  handlers: LinksSourceHandlers,
): EditorCommand[] {
  const reads = readOnlyLinkCommands(link, data, handlers);
  if (!isOwnLink(link, data.currentUser)) return reads;
  return [...reads, ...writeLinkCommands(link, data, handlers)];
}

/** Build the full command set with stable ids + page-defined groups (spec 6).
 *  The per-link rows for the focused (selected or hovered) link lead, then the
 *  always-on Create / Filter rows. */
function buildCommands(
  data: LinksSourceData,
  handlers: LinksSourceHandlers,
): EditorCommand[] {
  const out: EditorCommand[] = [];
  const focus = resolveFocus(data);

  // Per-link rows for the focused link (spec 3.2), gated on ownership.
  if (focus) out.push(...linkCommands(focus, data, handlers));

  // ── Create (spec 6). ──────────────────────────────────────────────────────
  out.push({
    id: "links-add",
    label: "Add a link",
    group: LINKS_GROUP_CREATE,
    iconName: "plus",
    run: () => handlers.startCreate(),
  });
  if (data.isCreating) {
    const formValid = data.title.trim() !== "" && data.url.trim() !== "";
    out.push({
      id: "links-create",
      label: "Create link",
      detail: "saves the draft",
      group: LINKS_GROUP_CREATE,
      iconName: "check",
      enabled: formValid,
      run: () => void handlers.handleCreate(),
    });
    out.push({
      id: "links-fetch-preview",
      label: "Fetch preview for the draft",
      detail: "fills title and thumbnail",
      group: LINKS_GROUP_CREATE,
      iconName: "refresh",
      enabled: data.url.trim() !== "" && !data.isLoadingPreview,
      run: () => void handlers.handleFetchPreview(),
    });
    out.push({
      id: "links-draft-visibility",
      label: data.wholeLab ? "Set visibility to just me" : "Set visibility to whole lab",
      detail: data.wholeLab ? "only you" : "everyone in your lab",
      group: LINKS_GROUP_VISIBILITY,
      iconName: "eye",
      run: () => handlers.setWholeLab(!data.wholeLab),
    });
    out.push({
      id: "links-draft-cancel",
      label: "Cancel",
      detail: "discards the draft",
      group: LINKS_GROUP_CREATE,
      iconName: "refresh",
      run: () => handlers.cancelEdit(),
    });
  }

  // ── Filter / view (spec 6, palette-managed). ──────────────────────────────
  const categories = Object.keys(data.groupedLinks);
  for (const cat of categories) {
    out.push({
      id: `links-filter-${cat}`,
      label: `Filter by category, ${cat}`,
      keywords: cat,
      group: LINKS_GROUP_FILTER,
      iconName: "list",
      enabled: data.links.length > 0,
      run: () => handlers.setActiveCategory(cat),
    });
  }
  out.push({
    id: "links-clear-filter",
    label: "Clear category filter",
    detail: data.activeCategory ?? "no filter set",
    group: LINKS_GROUP_FILTER,
    iconName: "refresh",
    enabled: data.activeCategory !== null,
    run: () => handlers.setActiveCategory(null),
  });
  for (const cat of categories) {
    out.push({
      id: `links-jump-cat-${cat}`,
      label: `Jump to category, ${cat}`,
      keywords: cat,
      group: LINKS_GROUP_FILTER,
      iconName: "folder",
      enabled: data.links.length > 0,
      run: () => handlers.jumpToCategory(cat),
    });
  }

  // ── Category-filter-active extras (spec 3.3). ─────────────────────────────
  if (data.activeCategory) {
    const bucket = data.groupedLinks[data.activeCategory] ?? [];
    out.push({
      id: "links-new-in-category",
      label: `New link in ${data.activeCategory}`,
      detail: "prefills the category",
      group: LINKS_GROUP_CREATE,
      iconName: "plus",
      run: () => handlers.startCreate(),
    });
    out.push({
      id: "links-open-all-in-category",
      label: `Open all in ${data.activeCategory}`,
      detail:
        bucket.length > BULK_OPEN_CONFIRM_THRESHOLD
          ? `${bucket.length} tabs, asks first`
          : `${bucket.length} tab${bucket.length === 1 ? "" : "s"}`,
      group: LINKS_GROUP_OPEN,
      iconName: "export",
      enabled: bucket.length > 0,
      run: () => handlers.openAll(bucket),
    });
  }

  return out;
}

/** Resolve the current FOCUS, the selected (editing) link beats a hovered one
 *  (spec 7, SELECTED > HOVERED). The create draft is handled separately. */
function resolveFocus(data: LinksSourceData): LabLink | null {
  if (data.editingLink) return data.editingLink;
  if (data.isCreating) return null;
  if (data.hoveredKey?.startsWith("link:")) {
    return (
      data.links.find(
        (l) => `link:${linkKey(l, data.currentUser)}` === data.hoveredKey,
      ) ?? null
    );
  }
  return null;
}

/** The ordered ids of the contextually relevant commands (spec 3, the Suggested
 *  rule). Ids that are disabled / absent are silently skipped by the palette. */
function buildSuggestedIds(data: LinksSourceData): string[] {
  const ids: string[] = [];

  // Creating a new link drives the draft form (spec 3.5).
  if (data.isCreating) {
    ids.push(
      "links-create",
      "links-fetch-preview",
      "links-draft-visibility",
      "links-add",
      "links-draft-cancel",
    );
    return ids;
  }

  // A focused link (selected or hovered) leads with its per-link actions
  // (spec 3.2), ownership-gated, Save / Cancel first while editing.
  const focus = resolveFocus(data);
  if (focus) {
    const key = linkKey(focus, data.currentUser);
    const own = isOwnLink(focus, data.currentUser);
    const editing = data.editingLink?.id === focus.id && data.editingLink?.owner === focus.owner;
    if (own && editing) ids.push(`links-save-${key}`, `links-cancel-${key}`);
    ids.push(`links-open-${key}`, `links-copy-${key}`);
    if (own) {
      ids.push(
        `links-edit-${key}`,
        `links-category-${key}`,
        `links-visibility-${key}`,
        `links-refresh-${key}`,
        `links-delete-${key}`,
      );
    } else {
      ids.push(`links-jump-${key}`);
    }
    return ids;
  }

  // A category filter active, nothing selected (spec 3.3).
  if (data.activeCategory) {
    ids.push("links-new-in-category", "links-clear-filter", "links-open-all-in-category");
    return ids;
  }

  // Board visible, nothing selected (spec 3.4), "Add a link" leads.
  ids.push("links-add");
  if (data.links.length > 0) {
    // One representative filter + jump-to-category so the board moves are
    // surfaced (the full per-category set lives in the grouped commands).
    const firstCat = Object.keys(data.groupedLinks)[0];
    if (firstCat) {
      ids.push(`links-filter-${firstCat}`, `links-jump-cat-${firstCat}`);
    }
  }
  return ids;
}

/** The Suggested heading hint (spec 3). */
function buildSuggestedHint(data: LinksSourceData): string | undefined {
  if (data.isCreating) return "for the new link";
  const focus = resolveFocus(data);
  if (focus) {
    return isOwnLink(focus, data.currentUser)
      ? "for the selected link"
      : "for the shared link";
  }
  if (data.activeCategory) return `in ${data.activeCategory}`;
  return undefined;
}

/** A link nav item, the INTERNAL jump (scroll + pulse the card, spec 4.1). Fuzzy
 *  match runs over title + url + description + category + owner name (spec 4.3). */
function linkNavItem(
  link: LabLink,
  data: LinksSourceData,
  handlers: LinksSourceHandlers,
  detailOverride?: string,
): PaletteNavItem {
  const key = linkKey(link, data.currentUser);
  const own = isOwnLink(link, data.currentUser);
  const cat = displayCategory(link);
  const detail =
    detailOverride ??
    (own
      ? `${cat}, ${hostnameOf(link.url)}`
      : `${cat}, shared by ${ownerName(link, data.profileMap)}`);
  const keywords = [
    link.url,
    link.description ?? "",
    link.category ?? "",
    own ? "" : ownerName(link, data.profileMap),
  ]
    .filter(Boolean)
    .join(" ");
  return {
    id: key,
    label: link.title,
    detail,
    keywords,
    iconName: "share",
    tone: "link",
    onRun: () => handlers.jumpToLink(link),
  };
}

/** A link's EXTERNAL-open nav item (spec 4.2, the new navigate-to-external
 *  kind). Always a new tab via the handler's window.open(noopener,noreferrer);
 *  the destination hostname is shown plainly, guarded so a malformed url
 *  degrades to "opens externally". Never the default-highlighted row (it is in
 *  its own group, below the leads). */
function externalNavItem(
  link: LabLink,
  data: LinksSourceData,
  handlers: LinksSourceHandlers,
): PaletteNavItem {
  let host: string;
  try {
    host = new URL(link.url).hostname;
  } catch {
    host = "";
  }
  const detail = host ? `${host}, opens in a new tab` : "opens externally";
  const keywords = [link.url, link.category ?? ""].filter(Boolean).join(" ");
  return {
    id: `ext:${linkKey(link, data.currentUser)}`,
    label: `Open ${link.title}`,
    detail,
    keywords,
    iconName: "export",
    tone: "link",
    onRun: () => handlers.openExternally(link),
  };
}

/** The recent links substitute for RESULTS (spec 5). Newest first by
 *  last_edited_at, falling back to created_at; selecting one reopens the
 *  destination (the external open). Distinguishes "edited" (has last_edited_at)
 *  from "added". */
const RECENT_CAP = 5;
function recentLinks(links: LabLink[]): LabLink[] {
  const stamp = (l: LabLink) => l.last_edited_at ?? l.created_at ?? "";
  return [...links]
    .filter((l) => stamp(l) !== "")
    .sort((a, b) => (stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : 0))
    .slice(0, RECENT_CAP);
}

function recentNavItem(
  link: LabLink,
  data: LinksSourceData,
  handlers: LinksSourceHandlers,
): PaletteNavItem {
  const word = link.last_edited_at ? "edited recently" : "added recently";
  return {
    id: `recent:${linkKey(link, data.currentUser)}`,
    label: link.title,
    detail: `${displayCategory(link)}, ${word}`,
    keywords: [link.url, link.category ?? ""].filter(Boolean).join(" "),
    iconName: "share",
    tone: "link",
    onRun: () => handlers.openExternally(link),
  };
}

/** Build the nav groups (spec 4 + 5). Order, internal jump, external open,
 *  recent links. The empty-query jump list is the active category's links first
 *  (else the whole board), all with the blue "link" tone. */
function buildNavGroups(
  data: LinksSourceData,
  handlers: LinksSourceHandlers,
): PaletteNavGroup[] {
  const groups: PaletteNavGroup[] = [];

  // On-screen first when a category filter is active, else the whole board.
  const base =
    data.activeCategory && data.groupedLinks[data.activeCategory]
      ? data.groupedLinks[data.activeCategory]
      : data.links;

  // Jump to a link (internal scroll + pulse).
  const jumpItems = base.map((l) => linkNavItem(l, data, handlers));
  groups.push({
    title: "Jump to a link",
    hint: data.activeCategory
      ? `in ${data.activeCategory} (${jumpItems.length})`
      : `in view (${jumpItems.length})`,
    items: jumpItems,
  });

  // Open externally (the new external kind, a new tab each).
  const extItems = base.map((l) => externalNavItem(l, data, handlers));
  groups.push({ title: "Open externally", hint: "new tab", items: extItems });

  // Recent links (the RESULTS substitute). Omit when empty (mirrors the
  // Recently-opened omission on Gantt).
  const recent = recentLinks(data.links);
  if (recent.length > 0) {
    groups.push({
      title: "Recent links",
      items: recent.map((l) => recentNavItem(l, data, handlers)),
    });
  }

  return groups;
}

/** Build the whole Links BeakerSearch source from a pure state snapshot. */
export function buildLinksSource(
  data: LinksSourceData,
  handlers: LinksSourceHandlers,
): BeakerSearchSource {
  return {
    id: "links",
    contextCard: buildContextCard(data),
    commands: buildCommands(data, handlers),
    suggestedIds: buildSuggestedIds(data),
    suggestedHint: buildSuggestedHint(data),
    navGroups: buildNavGroups(data, handlers),
    // Query-aware seam (spec 4.2, the typed-url quick-open). When the query
    // parses as a url, lead with an "Open <hostname>" row that opens it in a new
    // tab. Guarded, so a malformed query never throws. Never auto-highlighted
    // beyond the palette's normal lead handling, and the open itself is a new
    // tab via the handler.
    interpretQuery: (query: string): PaletteNavGroup[] => {
      const parsed = parseLinkUrl(query);
      if (!parsed) return [];
      return [
        {
          title: "Open externally",
          hint: "new tab",
          items: [
            {
              id: "links-open-typed-url",
              label: `Open ${parsed.hostname}`,
              detail: `${parsed.url}, opens in a new tab`,
              iconName: "export",
              tone: "link",
              onRun: () =>
                handlers.openExternally({
                  // A synthetic link carrying just the typed url. Only `url` is
                  // read by openExternally (window.open), the rest are filler.
                  id: -1,
                  title: parsed.hostname,
                  url: parsed.url,
                  description: null,
                  category: null,
                  color: null,
                  preview_image_url: null,
                  sort_order: 0,
                  created_at: "",
                } as LabLink),
            },
          ],
        },
      ];
    },
  };
}

// Re-export so the hook / tests can name the icon set without re-deriving it.
export type { IconName };
