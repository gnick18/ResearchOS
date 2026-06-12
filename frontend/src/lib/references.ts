// sequence editor master. Object references + deep links (the "Copy reference"
// and note-chip foundation).
//
// A reference is a SAME-ORIGIN in-app URL. It survives markdown sanitization (no
// scheme to strip) and works as a real link even outside notes. Copy reference
// writes the markdown form; the note chip renderer upgrades a matching link to a
// live chip; the per-surface deep-link resolver reads the param back.
//
// v1 wires sequences + collections. Methods / notes / files / projects slot in
// by adding a row to OBJECT_ROUTES (the map is the single source of truth for
// building AND parsing, so the two never drift). Voice. No em-dashes, no emojis,
// no mid-sentence colons.

/** The object kinds a reference can point at. v1 resolves sequence + collection;
 *  the rest are reserved so the chip renderer and the map already know them.
 *  "task" covers any Task record (task_type = "list" | "purchase"). "experiment"
 *  covers Task records whose task_type = "experiment". Both use the same
 *  ?openTask= deep link on "/" and are handled by the root popup host without
 *  navigating away from the current page. */
export type ObjectRefType =
  | "sequence"
  | "collection"
  | "method"
  | "note"
  | "file"
  | "project"
  | "molecule"
  | "datahub"
  | "task"
  | "experiment";

/** One route shape. `build` makes the in-app path for an id; `match` recognizes a
 *  path (already split into pathname + query params) and returns the id, or null
 *  when it is not this kind of route. Keeping build + match together per type is
 *  what keeps the round-trip honest. */
interface RouteShape {
  build: (id: string) => string;
  match: (pathname: string, params: URLSearchParams) => string | null;
}

/** The single source of truth for every object route. Order matters only in that
 *  query-param routes (e.g. /sequences?seq=) are checked before bare-path routes
 *  so a /sequences path without a known param does not match a sequence. */
const OBJECT_ROUTES: Record<ObjectRefType, RouteShape> = {
  sequence: {
    build: (id) => `/sequences?seq=${encodeURIComponent(id)}`,
    match: (pathname, params) => {
      if (pathname !== "/sequences") return null;
      const seq = params.get("seq");
      return seq && seq.length > 0 ? seq : null;
    },
  },
  collection: {
    build: (id) => `/sequences?collection=${encodeURIComponent(id)}`,
    match: (pathname, params) => {
      if (pathname !== "/sequences") return null;
      const col = params.get("collection");
      return col && col.length > 0 ? col : null;
    },
  },
  // Reserved for later surfaces. The chip renderer handles all types from the
  // start; each surface wires its own resolver when it is built.
  method: {
    build: (id) => `/methods/${encodeURIComponent(id)}`,
    match: (pathname) => idFromSegmentRoute(pathname, "/methods/"),
  },
  note: {
    build: (id) => `/notes/${encodeURIComponent(id)}`,
    match: (pathname) => idFromSegmentRoute(pathname, "/notes/"),
  },
  file: {
    build: (id) => `/files/${encodeURIComponent(id)}`,
    match: (pathname) => idFromSegmentRoute(pathname, "/files/"),
  },
  project: {
    build: (id) => `/projects/${encodeURIComponent(id)}`,
    match: (pathname) => idFromSegmentRoute(pathname, "/projects/"),
  },
  // The chemistry workbench opens a molecule via a query param (the editor is a
  // popup over the hub, not its own route), so this is a query-param route like
  // sequence/collection, checked before the bare-path routes. The /chemistry page
  // reads the same `molecule` param to auto-open the editor.
  molecule: {
    build: (id) => `/chemistry?molecule=${encodeURIComponent(id)}`,
    match: (pathname, params) => {
      if (pathname !== "/chemistry") return null;
      const mol = params.get("molecule");
      return mol && mol.length > 0 ? mol : null;
    },
  },
  // Data Hub opens a document (a workbook) via a query param. The /datahub page
  // reads the same `doc` param to auto-select that table, so a reference in a
  // note jumps straight to the analysis surface for that data.
  datahub: {
    build: (id) => `/datahub?doc=${encodeURIComponent(id)}`,
    match: (pathname, params) => {
      if (pathname !== "/datahub") return null;
      const doc = params.get("doc");
      return doc && doc.length > 0 ? doc : null;
    },
  },
  // Tasks and experiments reuse the existing ?openTask= deep link on "/".
  // The id here is the composite taskKey ("self:<numericId>" for own tasks,
  // "<owner>:<numericId>" for shared tasks). The root popup host resolves
  // it via tasksApi rather than triggering a full page navigation, so the
  // user never leaves the current view or the BeakerBot conversation.
  task: {
    build: (id) => `/?openTask=${encodeURIComponent(id)}`,
    match: (pathname, params) => {
      if (pathname !== "/") return null;
      const t = params.get("openTask");
      return t && t.length > 0 ? t : null;
    },
  },
  // Experiments are Task records with task_type = "experiment". They share
  // the same deep link and the same popup component. A separate type entry
  // lets BeakerBot mark the distinction in the chip so the user knows at a
  // glance whether the tile is an experiment or a generic task.
  experiment: {
    build: (id) => `/?openTask=${encodeURIComponent(id)}`,
    match: (_pathname, _params) => {
      // Experiments and tasks share the same URL form (?openTask=). The
      // match for "task" above already consumes it. Returning null here
      // ensures parseObjectDeepLink resolves ?openTask= to "task" (the
      // first match wins), which is correct because we cannot distinguish
      // a task from an experiment purely from the URL. This entry exists
      // only so objectDeepLink("experiment", id) is valid.
      return null;
    },
  },
};

/** Pull the id out of a single-segment path route like `/methods/<id>`. Returns
 *  null when the pathname does not start with the prefix or carries a deeper
 *  sub-path (so `/methods/12/edit` does not falsely match). */
function idFromSegmentRoute(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (rest.length === 0 || rest.includes("/")) return null;
  return decodeURIComponent(rest);
}

/** The in-app path that opens an object, e.g. `/sequences?seq=5`. The id is
 *  coerced to a string so numeric ids (sequences) and string ids both work. */
export function objectDeepLink(type: ObjectRefType, id: string | number): string {
  return OBJECT_ROUTES[type].build(String(id));
}

/** A markdown link to an object, `[name](<deepLink>)`. Pasted into a note this
 *  yields a link our renderer upgrades to a chip; pasted elsewhere it stays
 *  readable markdown. The name is escaped so a `]` in it cannot break the link. */
export function objectReferenceMarkdown(
  type: ObjectRefType,
  id: string | number,
  name: string,
): string {
  const safeName = (name ?? "").replace(/\\/g, "\\\\").replace(/]/g, "\\]");
  return `[${safeName}](${objectDeepLink(type, id)})`;
}

/** Recognize one of our internal object routes. Tolerant of an absolute app URL
 *  (https://host/sequences?seq=5) and a relative path (/sequences?seq=5). Returns
 *  the type + id, or null for any href that is not an object route (a normal
 *  external link, an anchor, a mailto, and so on). */
export function parseObjectDeepLink(
  href: string | null | undefined,
): { type: ObjectRefType; id: string } | null {
  if (!href) return null;
  const raw = href.trim();
  if (raw.length === 0) return null;

  let pathname: string;
  let params: URLSearchParams;
  try {
    // A base lets the URL parser accept BOTH absolute app URLs and relative
    // paths. For an absolute external URL the pathname/params still parse; the
    // route match below simply will not recognize it.
    const url = new URL(raw, "https://researchos.internal");
    pathname = url.pathname;
    params = url.searchParams;
  } catch {
    return null;
  }

  for (const type of Object.keys(OBJECT_ROUTES) as ObjectRefType[]) {
    const id = OBJECT_ROUTES[type].match(pathname, params);
    if (id != null) return { type, id };
  }
  return null;
}
