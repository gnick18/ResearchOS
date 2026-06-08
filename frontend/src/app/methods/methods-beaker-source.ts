// sequence editor master (Methods source sub-bot). BeakerSearch step 3, a
// per-page SOURCE, the Method Library page.
//
// This module is the PURE builder behind the Methods page's BeakerSearch
// registration. It takes a plain snapshot of the page state (own + shared
// methods, the on-screen filtered lists, the categories, the static catalog
// templates, the open viewer / compound-builder selection, the search query)
// plus a bag of handler callbacks, and returns one BeakerSearchSource (context
// card + commands + suggested ids + nav groups). It reads NO store, holds NO
// React, and calls NO Date.now(), so the context-card copy, the command ids /
// groups / enabled gating, the Suggested ordering per context, the TWO navigate
// kinds, and the recent-methods MRU resolution are all unit-tested without
// rendering. The thin useMethodsBeakerSource hook (co-located) wires the live
// queries + store + useMethodPermissions + the real page handlers into this
// builder inside a useMemo.
//
// The spec is docs/proposals/beakersearch-methods.md. This maps the spec's
// older function-based sketch (context() / suggested() / entities() / results())
// onto the ACTUAL generic BeakerSearchSource contract, contextCard + commands
// (with stable ids + page-defined groups) + suggestedIds + navGroups.
//
// The distinctive Methods wrinkle (spec 4) is TWO navigable entity kinds, the
// user's own / shared METHODS (tone "method") and the static CATALOG TEMPLATES
// (NO tone, a neutral library glyph), kept visually distinct by icon + group
// header. Grant approved templates staying neutral (icon-distinguished), so no
// new tone is added.
//
// Permission model (spec 3.1), every write command gates on a canModifyMethod
// predicate the hook passes in (the real useMethodPermissions().canModifyMethod).
// Three tiers, OWN (writes unscoped), SHARED-WITH-EDIT (writes owner-routed via
// ownerScopedMethodsApi, but Delete excluded so only the owner destroys the
// file), and READ-ONLY (no write, only a public method's Retire row is offered,
// plus Fork which is always allowed). FORK is the universal make-my-own-copy
// move and is never gated. The reasons land in each command's detail.
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
import type { Method } from "@/lib/types";
import { getMethodTypeMeta, type MethodTypeId } from "@/lib/methods/method-type-registry";
import type { MethodCatalogManifestEntry } from "@/lib/methods/method-catalog";

// ── Page-defined command groups ────────────────────────────────────────────
// These print between the page's nav groups and the global "Go to" / "App"
// layer, in first-appearance order (see editor-commands commandGroupOrder).
export const METHODS_GROUP_SELECTED = "Selected method";
export const METHODS_GROUP_CREATE = "Create";
export const METHODS_GROUP_TEMPLATES = "Templates";
export const METHODS_GROUP_OPEN_EDIT = "Open / edit";
export const METHODS_GROUP_KITS = "Kits";
export const METHODS_GROUP_SHARE = "Share";
export const METHODS_GROUP_COPY = "Copy";
export const METHODS_GROUP_DELETE = "Delete";
export const METHODS_GROUP_FIND = "Find";

// Registered icon names per affordance family. The registry has no "flask" /
// "globe" glyph (icon-guard blocks new inline svg), so each maps to the nearest
// registered <Icon>. The "method" entity uses "file" (a method document); the
// catalog "template library" uses "book" (the same library glyph Workbench uses
// for notebooks), which is the neutral, no-tone cue that distinguishes a
// template ("Use") from a method ("Open") in the list.
const ICON_METHOD: IconName = "file";
const ICON_TEMPLATE: IconName = "book";

// How many recent methods the MRU keeps (spec 5).
export const METHODS_RECENT_CAP = 6;

// The "Uncategorized" folder label the page uses for a method with a null
// folder_path. Mirrors the page's grouping key so the move-picker + detail line
// agree with the library.
const UNCATEGORIZED = "Uncategorized";

// ── The session-local recently-opened MRU reference (spec 5) ───────────────
// A lightweight {owner, id, name, method_type} snapshot, kept by the hook and
// re-resolved against the LIVE ["methods", currentUser] list every render so a
// since-deleted method silently drops out and the row label stays fresh.
export interface MethodRecentRef {
  owner: string;
  id: number;
  name: string;
  method_type: MethodTypeId | null;
}

// ── The plain state snapshot the builder reads ─────────────────────────────
export interface MethodsSourceData {
  /** Every method, own + public + shared-with-me, merged + decorated (the
   *  page's ["methods", currentUser] cache). The typed-query nav list widens to
   *  this; the MRU re-resolves against it. */
  methods: Method[];
  /** Own methods after the search filter (the on-screen "My Methods" list). */
  filteredOwnMethods: Method[];
  /** Shared-with-me methods after the search filter (the on-screen "Shared with
   *  Lab" list). */
  filteredSharedMethods: Method[];
  /** Every category the user has (own folders + empty categories), for the
   *  context-card count. */
  allFolders: string[];
  /** Existing folders for the move / create-in-category pickers. */
  existingFolders: string[];

  // ON SCREEN.
  /** The live cross-section search query (drives the filtered lists). */
  searchQuery: string;
  /** Whether the template browser is open (biases Suggested + the card line). */
  browsingTemplates: boolean;

  // SELECTED / FOCUSED. The open viewer beats the open compound builder.
  /** The method open in the per-type viewer (ViewMethodModal), or null. */
  viewingMethod: Method | null;
  /** The compound open in the builder (CompoundMethodBuilder), or null. */
  editingCompound: Method | null;

  // HOVERED (spec 2.3 / 3.3). The method card the cursor was over when the
  // palette opened, resolved by the hook from the data-beaker-target key
  // ("method:<owner>:<id>"). SELECTED always outranks this, so a real open
  // method wins over a stale hover. Null when nothing tagged was under the
  // pointer. A hovered method drives the SAME per-method Suggested + the SAME
  // command gating as the selected path; only the framing ("Pointing at" vs
  // "Open") changes.
  hovered: Method | null;

  // Permission seam (spec 3.1). The hook passes the real
  // useMethodPermissions().canModifyMethod so the builder stays pure and
  // testable. true => writable (own or shared-with-edit), false => read-only.
  canModify: (method: Method) => boolean;
  /** The signed-in user, for the own-vs-shared partition + the MRU resolve. */
  currentUser: string;

  /** The static catalog manifest entries (the second navigable kind, spec 4).
   *  Empty until the manifest loads (the hook prefetches it once). */
  templates: MethodCatalogManifestEntry[];

  /** The session-local recently-opened MRU refs (newest first), for the
   *  "Recent methods" nav group (spec 5). */
  recent: MethodRecentRef[];
}

// ── The handler bag (closures over the page's real handlers + invalidations) ─
export interface MethodsSourceHandlers {
  // Open / select.
  /** setViewingMethod(m), opens the per-type viewer in ViewMethodModal. */
  openMethod: (method: Method) => void;
  /** setEditingCompound(m), opens CompoundMethodBuilder. */
  editCompound: (method: Method) => void;

  // Create surfaces (spec 3.5 / 6).
  /** setCreating(true), the blank CreateMethodModal. */
  createMethod: () => void;
  /** setPrefilledFolder(folder) + setCreating(true), create in a category. */
  createMethodInFolder: (folder: string) => void;
  /** setCreatingCategory(true), the CreateCategoryModal. */
  createCategory: () => void;
  /** setCreating(true) + setForceWholeLabOnCreate(true), the lab-wide path. */
  publishLabWideMethod: () => void;

  // Templates (spec 3.3 / 3.4 / 6).
  /** setBrowsingTemplates(true), opens MethodTemplateLibraryModal. */
  browseTemplates: () => void;
  /** setBrowsingTemplates(false), closes the browser. */
  closeTemplates: () => void;
  /** Instantiate a catalog template by slug (optionally into a folder), then
   *  handleTemplateUsed(created). Always lands an OWNED method (no gate). */
  useTemplate: (slug: string, folderPath?: string) => void;

  // Method writes (own / owner-routed). Each wraps the real
  // ownerScopedMethodsApi / methodsApi call + the spec invalidation key
  // (["methods"]); the builder never calls an api.
  /** ownerScopedMethodsApi(m).update(m.id, { name }) + invalidate. */
  rename: (method: Method) => void;
  /** ownerScopedMethodsApi(m).update(m.id, { folder_path }) + invalidate. */
  move: (method: Method) => void;
  /** methodsApi.wrapAsCompound(m.id, ...) then open the compound builder. */
  extendIntoKit: (method: Method) => void;
  /** ConvertCompoundToSingleAction on the compound. */
  convertToSingle: (method: Method) => void;
  /** ownerScopedMethodsApi(m).fork(m.id, ...) + invalidate. Always allowed. */
  fork: (method: Method) => void;
  /** Open UnifiedShareDialog for the method. */
  share: (method: Method) => void;
  /** handleDelete(m.id), the compound-aware delete + per-type cascade. */
  deleteMethod: (method: Method) => void;
  /** handleRetirePublicMethod(m), confirm-gated, any member, public only. */
  retirePublic: (method: Method) => void;

  // Find (spec 6).
  setSearchQuery: (query: string) => void;
}

/** Whether a method is shared into the current user (not owned by them). Mirrors
 *  the page's isSharedMethod intent for the move / delete / share gates. */
export function isMethodSharedIntoMe(method: Method): boolean {
  return method.is_shared_with_me === true;
}

/** The human folder label for a method ("Uncategorized" for a null path). */
function folderLabel(method: Method): string {
  return method.folder_path && method.folder_path.trim().length > 0
    ? method.folder_path
    : UNCATEGORIZED;
}

/** The type label for a method via the single source of truth (spec 8). */
function typeLabel(method: Method): string {
  return getMethodTypeMeta(method.method_type).label;
}

/** The read-only reason for a write command's detail (spec 3.1), echoing why the
 *  row is greyed. A shared-with-view method names the owner; a public method
 *  points at the only available write (Retire). */
function readOnlyReason(method: Method): string {
  if (method.is_public) return "Lab-wide method, only retire is available";
  if (method.is_shared_with_me) {
    return method.owner ? `Read-only, shared by ${method.owner}` : "Read-only, shared";
  }
  return "Read-only";
}

/** Resolve the SELECTED / FOCUSED method (the open viewer beats the open
 *  compound builder, spec 2.2). Null when neither is open. */
function resolveSelection(data: MethodsSourceData): Method | null {
  return data.viewingMethod ?? data.editingCompound ?? null;
}

/** Resolve the active context method by the SELECTED > HOVERED rule. When a real
 *  selection exists (an open viewer / compound builder), hovered is ignored. When
 *  nothing is selected, the card the cursor was pointing at drives the SAME
 *  context-card selection line and the SAME Suggested action set, only the
 *  framing ("Pointing at" vs "Open") changes. `isHovered` lets the copy and the
 *  Suggested hint switch voice without duplicating the per-method logic. While
 *  the template browser is open, hover is suppressed so the browser context
 *  stays authoritative (spec 3.4 beats a stale card hover behind the modal). */
function resolveContext(
  data: MethodsSourceData,
): { method: Method; isHovered: boolean } | null {
  const sel = resolveSelection(data);
  if (sel) return { method: sel, isHovered: false };
  if (data.browsingTemplates) return null;
  if (data.hovered) return { method: data.hovered, isHovered: true };
  return null;
}

/** Whether a method is a compound (kit). */
function isCompound(method: Method): boolean {
  return method.method_type === "compound";
}

/** A compound's component count (0 for a non-compound). */
function componentCount(method: Method): number {
  return method.components?.length ?? 0;
}

// ── Context card (spec 2.5) ─────────────────────────────────────────────────

/** Line 1, the scope + snapshot. While the template browser is open it reads
 *  "Template library, N protocols". While searching it reads
 *  "qpcr matches 3". The resting library reads "14 of yours, 6 shared". */
export function methodsScopeMeta(data: MethodsSourceData): string {
  if (data.browsingTemplates) {
    const n = data.templates.length;
    return `Template library, ${n} protocol${n === 1 ? "" : "s"}`;
  }

  const own = data.filteredOwnMethods.length;
  const shared = data.filteredSharedMethods.length;

  const query = data.searchQuery.trim();
  if (query) {
    const total = own + shared;
    return `"${query}" matches ${total}`;
  }

  // Empty library (no own methods, no categories, nothing shared in view).
  if (own === 0 && shared === 0 && data.allFolders.length === 0) {
    const t = data.templates.length;
    return `no methods yet, ${t} template${t === 1 ? "" : "s"} available`;
  }

  return `${own} of yours, ${shared} shared`;
}

/** Build the context card (spec 2.5). Title "Method Library"; meta = the scope /
 *  snapshot line; a second stacked selection line under a hairline divider when
 *  a method viewer / compound builder is open (name + type + folder, plus a
 *  read-only or provenance hint). */
function buildContextCard(data: MethodsSourceData): PaletteContextCard {
  const ctx = resolveContext(data);
  let selection: PaletteContextCard["selection"];

  if (ctx) {
    const sel = ctx.method;
    const bits: string[] = [];
    if (isCompound(sel)) {
      const n = componentCount(sel);
      bits.push("Kit", `${n} component${n === 1 ? "" : "s"}`);
    } else {
      bits.push(typeLabel(sel), folderLabel(sel));
    }

    // Read-only / provenance hint (spec 2.5 line 2 alt + line 3).
    if (!data.canModify(sel)) {
      if (sel.is_public) bits.push("read-only, lab-wide");
      else if (sel.is_shared_with_me) {
        bits.push(sel.owner ? `read-only, shared by ${sel.owner}` : "read-only, shared");
      } else bits.push("read-only");
    } else if (sel.received_from) {
      bits.push(`received from ${sel.received_from}, verified`);
    }

    // Frame a real selection as the open method, a hover as the card you were
    // pointing at, so the user knows which one drives Suggested.
    const lead = ctx.isHovered ? "Pointing at" : "Open";
    selection = {
      iconName: isCompound(sel) ? "wrapped" : ICON_METHOD,
      text: `${lead}, "${sel.name}", ${bits.join(", ")}`,
    };
  }

  return {
    iconName: "book",
    title: "Method Library",
    meta: methodsScopeMeta(data),
    selection,
  };
}

// ── Commands (spec 3 + 6) ───────────────────────────────────────────────────

/** Build the full command set with stable ids + page-defined groups (spec 3 +
 *  6). The selection-specific rows carry stable ids the Suggested rule names.
 *  Write commands gate on data.canModify; fork is always enabled; retire is
 *  enabled only when the method is public; delete is excluded for a method
 *  shared into me (only the owner destroys the file). */
function buildCommands(
  data: MethodsSourceData,
  handlers: MethodsSourceHandlers,
): EditorCommand[] {
  const out: EditorCommand[] = [];
  // SELECTED > HOVERED. A hovered card drives the SAME action rows as a selection
  // (same ids, same canModify gating), so Suggested can reference them either way.
  const sel = resolveContext(data)?.method ?? null;

  // ── Selected / hovered method actions (spec 3.2). ─────────────────────────
  if (sel) {
    const writable = data.canModify(sel);
    const sharedIn = isMethodSharedIntoMe(sel);
    const reason = readOnlyReason(sel);

    // Open / Edit (read is allowed for shared / public).
    out.push({
      id: "methods-selected-open",
      label: `Open "${sel.name}"`,
      detail: `${typeLabel(sel)}, ${folderLabel(sel)}`,
      group: METHODS_GROUP_SELECTED,
      iconName: "eye",
      run: () => handlers.openMethod(sel),
    });
    out.push({
      id: "methods-selected-edit",
      label: `Edit "${sel.name}"`,
      detail: writable ? "opens the editor" : reason,
      group: METHODS_GROUP_SELECTED,
      iconName: "pencil",
      enabled: writable,
      run: () => handlers.openMethod(sel),
    });
    out.push({
      id: "methods-selected-rename",
      label: `Rename "${sel.name}"`,
      detail: writable ? "currently named " + `"${sel.name}"` : reason,
      group: METHODS_GROUP_SELECTED,
      iconName: "pencil",
      enabled: writable,
      run: () => handlers.rename(sel),
    });
    out.push({
      id: "methods-selected-move",
      label: `Move "${sel.name}" to a category`,
      detail: writable && !sharedIn ? `currently in ${folderLabel(sel)}` : reason,
      group: METHODS_GROUP_SELECTED,
      iconName: "folder",
      // Shared methods are non-draggable today (spec 3.2), so move is OWN only.
      enabled: writable && !sharedIn,
      run: () => handlers.move(sel),
    });

    // Fork (the universal make-my-own-copy move, always enabled, spec 3.2).
    out.push({
      id: "methods-selected-fork",
      label: `Fork "${sel.name}" into my library`,
      detail: "copies it to your library",
      group: METHODS_GROUP_SELECTED,
      iconName: "copy",
      run: () => handlers.fork(sel),
    });

    // Kit affordances (spec 3.2). Extend (own, non-compound) vs Edit components
    // / Convert to single (compound). The compound's per-component rows collapse
    // into these two so Suggested never balloons.
    if (isCompound(sel)) {
      out.push({
        id: "methods-selected-edit-components",
        label: `Edit components of "${sel.name}"`,
        detail: writable
          ? `${componentCount(sel)} component${componentCount(sel) === 1 ? "" : "s"}`
          : reason,
        group: METHODS_GROUP_KITS,
        iconName: "assemble",
        enabled: writable,
        run: () => handlers.editCompound(sel),
      });
      if (componentCount(sel) <= 1) {
        out.push({
          id: "methods-selected-convert-single",
          label: `Convert "${sel.name}" back to a single method`,
          detail: writable ? "removes the kit wrapper" : reason,
          group: METHODS_GROUP_KITS,
          iconName: "merge",
          enabled: writable,
          run: () => handlers.convertToSingle(sel),
        });
      }
    } else {
      out.push({
        id: "methods-selected-extend-kit",
        label: `Extend "${sel.name}" into a kit`,
        detail: writable ? "wraps it as the first component" : reason,
        group: METHODS_GROUP_KITS,
        iconName: "wrapped",
        enabled: writable,
        run: () => handlers.extendIntoKit(sel),
      });
    }

    // Share / unshare (own only, spec 3.2). The viewer hides Share for shared
    // records, so gate on canModify AND not-shared-in.
    out.push({
      id: "methods-selected-share",
      label: `Share or unshare "${sel.name}"`,
      detail:
        writable && !sharedIn
          ? sel.is_public
            ? "currently lab-wide"
            : "currently private"
          : reason,
      group: METHODS_GROUP_SHARE,
      iconName: "share",
      enabled: writable && !sharedIn,
      run: () => handlers.share(sel),
    });

    // Delete (own only, excluded for shared-with-edit so only the owner destroys
    // the file, spec 3.1 / 3.2).
    out.push({
      id: "methods-selected-delete",
      label: `Delete "${sel.name}"`,
      detail:
        writable && !sharedIn
          ? "removes the method and its files"
          : sharedIn
            ? "only the owner can delete this"
            : reason,
      group: METHODS_GROUP_DELETE,
      iconName: "trash",
      enabled: writable && !sharedIn,
      run: () => handlers.deleteMethod(sel),
    });

    // Retire from the lab (public only, any member, spec 3.1). A SEPARATE row,
    // enabled only when the method is public.
    out.push({
      id: "methods-selected-retire",
      label: `Retire "${sel.name}" from the lab`,
      detail: sel.is_public
        ? "removes it for everyone, cannot be undone"
        : "only lab-wide methods can be retired",
      group: METHODS_GROUP_DELETE,
      iconName: "trash",
      enabled: sel.is_public === true,
      run: () => handlers.retirePublic(sel),
    });
  }

  // ── Create (spec 3.5 / 6). ────────────────────────────────────────────────
  out.push({
    id: "methods-new",
    label: "New method",
    group: METHODS_GROUP_CREATE,
    iconName: "plus",
    run: handlers.createMethod,
  });
  for (const folder of data.existingFolders) {
    out.push({
      id: `methods-new-in-${folder}`,
      label: `New method in ${folder}`,
      keywords: "category folder",
      group: METHODS_GROUP_CREATE,
      iconName: "folder",
      run: () => handlers.createMethodInFolder(folder),
    });
  }
  out.push({
    id: "methods-new-category",
    label: "New category",
    keywords: "folder",
    group: METHODS_GROUP_CREATE,
    iconName: "folder",
    run: handlers.createCategory,
  });
  out.push({
    id: "methods-publish-labwide",
    label: "Publish a lab-wide method",
    keywords: "public share everyone",
    group: METHODS_GROUP_CREATE,
    iconName: "users",
    run: handlers.publishLabWideMethod,
  });

  // ── Templates (spec 3.3 / 3.4 / 6). ───────────────────────────────────────
  if (data.browsingTemplates) {
    out.push({
      id: "methods-templates-close",
      label: "Close the template library",
      group: METHODS_GROUP_TEMPLATES,
      iconName: "close",
      run: handlers.closeTemplates,
    });
    out.push({
      id: "methods-templates-new-blank",
      label: "New blank method instead",
      group: METHODS_GROUP_TEMPLATES,
      iconName: "plus",
      run: () => {
        handlers.closeTemplates();
        handlers.createMethod();
      },
    });
  } else {
    out.push({
      id: "methods-templates-browse",
      label: "Browse the template library",
      keywords: "catalog protocol kit",
      group: METHODS_GROUP_TEMPLATES,
      iconName: ICON_TEMPLATE,
      run: handlers.browseTemplates,
    });
  }
  // One "Use {title}" command per catalog template (spec 6, the long tail), so a
  // typed query finds and instantiates a template without opening the browser.
  for (const entry of data.templates) {
    out.push({
      id: `methods-use-template-${entry.slug}`,
      label: `Use "${entry.title}" template`,
      detail: templateDetail(entry),
      keywords: [entry.category, ...(entry.tags ?? []), entry.description]
        .filter(Boolean)
        .join(" "),
      group: METHODS_GROUP_TEMPLATES,
      iconName: ICON_TEMPLATE,
      run: () => handlers.useTemplate(entry.slug),
    });
  }

  // ── Find (spec 6). ────────────────────────────────────────────────────────
  out.push({
    id: "methods-clear-search",
    label: "Clear the search",
    group: METHODS_GROUP_FIND,
    iconName: "refresh",
    enabled: data.searchQuery.trim().length > 0,
    run: () => handlers.setSearchQuery(""),
  });

  return out;
}

// ── Suggested (spec 3) ──────────────────────────────────────────────────────

/** The ordered ids of the contextually relevant commands for the current
 *  context (spec 3). Four contexts, a selected / open method (3.2), a template
 *  browser open (3.4), nothing-selected main library (3.5), and the empty
 *  library. Ids that are disabled / absent are silently skipped by the palette,
 *  so the rule can be generous. */
function buildSuggestedIds(data: MethodsSourceData): string[] {
  // SELECTED > HOVERED, both lead with the same per-method action ids.
  const sel = resolveContext(data)?.method ?? null;

  // 3.2, a method open in the viewer / compound builder, OR the card the cursor
  // was pointing at. Open, Edit, Rename,
  // Move, Fork, then the kit + share + delete affordances. The compound's
  // per-component rows are collapsed into Edit components + Convert to single.
  if (sel) {
    const ids = [
      "methods-selected-open",
      "methods-selected-edit",
      "methods-selected-rename",
      "methods-selected-move",
      "methods-selected-fork",
    ];
    if (isCompound(sel)) {
      ids.push("methods-selected-edit-components");
      if (componentCount(sel) <= 1) ids.push("methods-selected-convert-single");
    } else {
      ids.push("methods-selected-extend-kit");
    }
    ids.push("methods-selected-share", "methods-selected-delete");
    if (sel.is_public) ids.push("methods-selected-retire");
    return ids;
  }

  // 3.4, the template browser is open, nothing selected.
  if (data.browsingTemplates) {
    return [
      "methods-templates-close",
      "methods-templates-new-blank",
    ];
  }

  // 3.5, nothing selected, main library. The empty-library case (no own
  // methods, no categories) shows only New method + Browse the templates.
  const ownEmpty =
    data.filteredOwnMethods.length === 0 && data.allFolders.length === 0;
  if (ownEmpty) {
    return ["methods-new", "methods-templates-browse"];
  }
  const ids = ["methods-new", "methods-templates-browse", "methods-new-category", "methods-publish-labwide"];
  if (data.searchQuery.trim().length > 0) ids.push("methods-clear-search");
  return ids;
}

/** The Suggested heading hint (spec 3). */
function buildSuggestedHint(data: MethodsSourceData): string | undefined {
  const ctx = resolveContext(data);
  if (ctx) {
    if (ctx.isHovered) {
      return isCompound(ctx.method)
        ? "for the kit you were pointing at"
        : "for the method you were pointing at";
    }
    return isCompound(ctx.method) ? "for the open kit" : "for the open method";
  }
  if (data.browsingTemplates) return "in the template library";
  return undefined;
}

// ── Navigate (spec 4, the TWO entity kinds) ─────────────────────────────────

/** The composite owner:id key for a method nav row (collision-safe across
 *  owners, spec 1.3). */
export function methodNavKey(method: Method): string {
  return `method-${method.owner}:${method.id}`;
}

/** A method nav row (tone "method", hint "Open"). Fuzzy fields mirror the page's
 *  matchesMethodSearch, name + method_type + tags + folder, plus the owner for a
 *  shared method. Selecting it opens the per-type viewer. */
function methodNavItem(
  method: Method,
  handlers: MethodsSourceHandlers,
  detailOverride?: string,
): PaletteNavItem {
  const bits: string[] = [typeLabel(method), folderLabel(method)];
  if (method.is_public) bits.push("lab-wide");
  else if (method.is_shared_with_me) {
    bits.push(method.owner ? `shared by ${method.owner}, read-only` : "shared, read-only");
  }
  const keywords = [
    method.method_type ?? "",
    ...(method.tags ?? []),
    folderLabel(method),
    method.is_shared_with_me ? method.owner : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    id: methodNavKey(method),
    label: method.name,
    detail: detailOverride ?? bits.join(", "),
    keywords,
    iconName: isCompound(method) ? "wrapped" : ICON_METHOD,
    tone: "method",
    onRun: () => handlers.openMethod(method),
  };
}

/** A short "Template, PCR, Molecular biology" detail for a catalog row. A kit
 *  template notes "kit" so the user can tell it apart. */
function templateDetail(entry: MethodCatalogManifestEntry): string {
  const typeMeta = getMethodTypeMeta(
    // CatalogMethodType is a subset of MethodTypeId, safe to pass through.
    entry.method_type as MethodTypeId,
  );
  const bits = ["Template"];
  if (entry.method_type === "compound") bits.push("kit");
  else bits.push(typeMeta.label);
  if (entry.category) bits.push(entry.category);
  return bits.join(", ");
}

/** A catalog template nav row (NO tone, the neutral library glyph, hint "Use").
 *  Grant approved templates staying neutral (icon-distinguished), so no tone is
 *  set. Fuzzy fields, title + description + category + tags. Selecting it
 *  instantiates the template (which opens the new owned method). */
function templateNavItem(
  entry: MethodCatalogManifestEntry,
  handlers: MethodsSourceHandlers,
): PaletteNavItem {
  const keywords = [
    entry.description,
    entry.category,
    ...(entry.tags ?? []),
    entry.method_type === "compound" ? "kit" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    id: `template-${entry.slug}`,
    label: entry.title,
    detail: templateDetail(entry),
    keywords,
    iconName: ICON_TEMPLATE,
    // No tone, neutral by design (Grant approved icon-distinguished templates).
    onRun: () => handlers.useTemplate(entry.slug),
  };
}

/** Lead the on-screen-scoped methods first (own then shared), then the rest of
 *  the full list, so the empty-query view matches the library while a typed
 *  query still reaches every method (the palette fuzzy-scores them all). De-duped
 *  by composite key. */
function orderedMethods(data: MethodsSourceData): Method[] {
  const lead = [...data.filteredOwnMethods, ...data.filteredSharedMethods];
  const leadKeys = new Set(lead.map(methodNavKey));
  const rest = data.methods.filter((m) => !leadKeys.has(methodNavKey(m)));
  return [...lead, ...rest];
}

/** Build the nav groups (spec 4 + 5). Your methods (tone "method", "Open"),
 *  Template library (neutral, "Use"), then Recent methods (the MRU). */
function buildNavGroups(
  data: MethodsSourceData,
  handlers: MethodsSourceHandlers,
): PaletteNavGroup[] {
  const groups: PaletteNavGroup[] = [];

  // Your methods (own + shared), on-screen first.
  const methodItems = orderedMethods(data).map((m) => methodNavItem(m, handlers));
  const onScreenCount =
    data.filteredOwnMethods.length + data.filteredSharedMethods.length;
  groups.push({
    title: "Your methods",
    hint: `in view (${onScreenCount})`,
    items: methodItems,
  });

  // Template library (the static catalog, the second navigable kind).
  if (data.templates.length > 0) {
    groups.push({
      title: "Template library",
      hint: `${data.templates.length}`,
      items: data.templates.map((e) => templateNavItem(e, handlers)),
    });
  }

  // Recent methods (the MRU, spec 5). Re-resolve each ref against the live list
  // so a deleted method drops out. Omit the group when empty.
  const recentItems = resolveRecent(data, handlers);
  if (recentItems.length > 0) {
    groups.push({ title: "Recent methods", items: recentItems });
  }

  return groups;
}

/** Resolve the MRU refs (spec 5) to live method nav rows, dropping any no longer
 *  present, preserving order, with an "opened recently" detail. Exported via
 *  buildNavGroups; kept separate so the resolution is unit-tested. */
function resolveRecent(
  data: MethodsSourceData,
  handlers: MethodsSourceHandlers,
): PaletteNavItem[] {
  const out: PaletteNavItem[] = [];
  for (const ref of data.recent) {
    const m = data.methods.find(
      (x) => x.owner === ref.owner && x.id === ref.id,
    );
    if (m) out.push(methodNavItem(m, handlers, "opened recently"));
  }
  return out;
}

// ── Assembly ────────────────────────────────────────────────────────────────

/** Build the whole Methods BeakerSearch source from a pure state snapshot. */
export function buildMethodsSource(
  data: MethodsSourceData,
  handlers: MethodsSourceHandlers,
): BeakerSearchSource {
  return {
    id: "methods",
    contextCard: buildContextCard(data),
    commands: buildCommands(data, handlers),
    suggestedIds: buildSuggestedIds(data),
    suggestedHint: buildSuggestedHint(data),
    navGroups: buildNavGroups(data, handlers),
  };
}

// Re-export so the hook / tests can name the icon set without re-deriving it.
export type { IconName };
