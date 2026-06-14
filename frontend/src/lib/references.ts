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
  | "dataset"
  | "phylo"
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
  // The methods page is a single list route (/methods); it opens a specific
  // method's detail panel via the ?openMethod=<id> deep link (methods/page.tsx
  // reads it), NOT a per-id segment route. The old /methods/<id> build produced a
  // 404 dead link (no such route exists), which closed the palette and lost the
  // BeakerBot conversation when a method chip was clicked. This is the query-param
  // form like sequence/molecule/datahub, matched before the bare-path routes.
  method: {
    build: (id) => `/methods?openMethod=${encodeURIComponent(id)}`,
    match: (pathname, params) => {
      if (pathname !== "/methods") return null;
      const m = params.get("openMethod");
      return m && m.length > 0 ? m : null;
    },
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
  // The Data Hub large-table lane opens a DATASET (the DuckDB-backed big table,
  // distinct from the editable-lane `doc`) via its own query param. The /datahub
  // page reads `dataset` to auto-select that dataset, so a reference in a note jumps
  // straight to the preview grid. Kept a separate type from `datahub` so the embed
  // renderer and the deep link never confuse a big-table dataset with an editable
  // workbook (they read different stores).
  dataset: {
    build: (id) => `/datahub?dataset=${encodeURIComponent(id)}`,
    match: (pathname, params) => {
      if (pathname !== "/datahub") return null;
      const ds = params.get("dataset");
      return ds && ds.length > 0 ? ds : null;
    },
  },
  // The phylogenetics Tree Studio opens a saved tree via a query param, like
  // Data Hub. The /phylo page reads the same `doc` param to auto-open that tree in
  // the Studio, so a reference in a note jumps straight to the figure.
  phylo: {
    build: (id) => `/phylo?doc=${encodeURIComponent(id)}`,
    match: (pathname, params) => {
      if (pathname !== "/phylo") return null;
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

// ── Method scope (public vs private) ────────────────────────────────────────
//
// Public methods live in a separate store from private methods but share the
// numeric id-space, so a private method id 1 and a public method id 1 both
// exist. A bare /methods/<id> resolves private-first, which means a reference to
// a PUBLIC method id 1 would render the wrong (private) method. We mark the
// scope by prefixing the method ref id with "public:", mirroring the composite
// task id form ("self:42", "<owner>:42"). Private method refs stay a bare
// numeric id so every existing reference is byte-for-byte unchanged and still
// resolves private-first.

const PUBLIC_METHOD_REF_PREFIX = "public:";

/** Build the id half of a method reference, marking the public store when the
 *  method is public. Pair with `splitMethodRefId` on the resolving side so the
 *  two never drift. */
export function methodRefId(id: string | number, isPublic: boolean): string {
  return isPublic ? `${PUBLIC_METHOD_REF_PREFIX}${id}` : String(id);
}

/** Split a method ref id back into its numeric id and owner scope. A "public:"
 *  prefix returns `owner: "public"` so the caller routes `methodsApi.get` at the
 *  public store; a bare id returns no owner so it resolves private-first, the
 *  pre-existing behavior. */
export function splitMethodRefId(refId: string): { id: number; owner?: "public" } {
  if (refId.startsWith(PUBLIC_METHOD_REF_PREFIX)) {
    return {
      id: Number(refId.slice(PUBLIC_METHOD_REF_PREFIX.length)),
      owner: "public",
    };
  }
  return { id: Number(refId) };
}

/** Escape a name for safe use as markdown link text. Backslash and BOTH brackets
 *  are escaped so a `[` or `]` in the name (e.g. `pGEX-3X [clone]`) cannot break
 *  the `[text](url)` form. Parens in the name are fine, CommonMark allows them in
 *  link text, and the destination is always a percent-encoded deep link. */
function escapeLinkText(name: string): string {
  return (name ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/]/g, "\\]");
}

/** A markdown link to an object, `[name](<deepLink>)`. Pasted into a note this
 *  yields a link our renderer upgrades to a chip; pasted elsewhere it stays
 *  readable markdown. This is the inline MENTION form (no embed fragment), see
 *  `objectEmbedMarkdown` for the block-embed form. */
export function objectReferenceMarkdown(
  type: ObjectRefType,
  id: string | number,
  name: string,
): string {
  return `[${escapeLinkText(name)}](${objectDeepLink(type, id)})`;
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

// ── Embed layer (markdown + ResearchOS embed hybrid, Phase 0) ───────────────
//
// An object reference is upgraded from a plain link to a rich embed by a `#ros=`
// URL fragment, e.g. `[pUC19](/sequences?seq=2#ros=map&region=1-500)`. Outside
// ResearchOS this stays a clickable link (the fragment is ignored), inside, the
// renderer reads the fragment and draws the object. No fragment, or `#ros=chip`,
// means the inline chip (today's behavior), so every existing reference is
// untouched. See docs/proposals/2026-06-11-markdown-embed-hybrid.md.
//
// This module is the FORMAT + PARSER only. It does not render anything, the
// `ObjectEmbed` component and the per-type renderers consume `parseObjectEmbed`
// in later phases.

/** Options carried in the `#ros=` fragment, all optional. Unknown keys are
 *  ignored so the grammar can grow without breaking older parsers. */
export interface EmbedOpts {
  /** Sequence base range to focus, e.g. "1-500". */
  region?: string;
  /** Table-preview row / column counts. */
  rows?: number;
  cols?: number;
  /** Size hints (px) for a map / plot / image. */
  w?: number;
  h?: number;
  /** Sub-object id inside a Data Hub doc (an analysis result / a plot). */
  analysis?: string;
  plot?: string;
  /** Freeze to a point in time, an ISO timestamp or a snapshot id. */
  pin?: string;
  /** Portable content identity for cross-library resolution. The path id is only
   *  a hint, this is what survives being shared into another person's library. */
  ref?: string;
  /** Heading of the section to transclude (P7-2). URL-encoded in the fragment,
   *  empty / absent means the whole note body. Used with view "transclude". */
  section?: string;
}

/** A parsed embed reference. `view` is the render mode, "chip" (the default)
 *  renders the inline pill, any other value is a block embed view. `isEmbed` is
 *  the convenience flag for "render as a block, not a chip". */
export interface EmbedDescriptor {
  type: ObjectRefType;
  id: string;
  view: string;
  isEmbed: boolean;
  opts: EmbedOpts;
}

/** The default block view per type (the view used when an embed is inserted
 *  without an explicit one). Locked 2026-06-11, sequence = map, molecule = the
 *  identity card. */
export const DEFAULT_EMBED_VIEW: Record<ObjectRefType, string> = {
  sequence: "map",
  collection: "card",
  method: "card",
  note: "card",
  file: "file",
  project: "card",
  molecule: "card",
  datahub: "table",
  dataset: "table",
  phylo: "studio",
  task: "card",
  experiment: "results",
};

const EMBED_STR_KEYS = ["region", "analysis", "plot", "pin", "ref", "section"] as const;
const EMBED_INT_KEYS = ["rows", "cols", "w", "h"] as const;

/** Parse the `#ros=...` fragment into a view + opts. Tolerant, an empty or
 *  malformed fragment yields no view and empty opts. */
function parseEmbedFragment(fragment: string): { view?: string; opts: EmbedOpts } {
  const opts: EmbedOpts = {};
  const clean = fragment.replace(/^#/, "");
  if (!clean) return { opts };
  const params = new URLSearchParams(clean);
  for (const k of EMBED_STR_KEYS) {
    const v = params.get(k);
    if (v) (opts as Record<string, unknown>)[k] = v;
  }
  for (const k of EMBED_INT_KEYS) {
    const v = params.get(k);
    if (v != null && v !== "") {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) (opts as Record<string, unknown>)[k] = n;
    }
  }
  const view = params.get("ros") || undefined;
  return { view, opts };
}

/** Recognize an object reference AND its embed fragment. Returns the type, id,
 *  view ("chip" when no `#ros=` is present), and opts, or null for any href that
 *  is not one of our object routes. Backward compatible, a plain
 *  `[name](/path)` parses to `view: "chip", isEmbed: false`. */
export function parseObjectEmbed(
  href: string | null | undefined,
): EmbedDescriptor | null {
  if (!href) return null;
  const raw = href.trim();
  if (raw.length === 0) return null;

  // Split the fragment off so the path parser sees a clean deep link. (The URL
  // parser in parseObjectDeepLink also drops the fragment, but we need it here.)
  const hashIdx = raw.indexOf("#");
  const pathPart = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  const fragment = hashIdx >= 0 ? raw.slice(hashIdx + 1) : "";

  const base = parseObjectDeepLink(pathPart);
  if (!base) return null;

  const { view: fragView, opts } = parseEmbedFragment(fragment);
  const view = fragView ?? "chip";
  return { type: base.type, id: base.id, view, isEmbed: view !== "chip", opts };
}

/** Build the href for an embed, `<deepLink>#ros=<view>&...`. A "chip" view (or
 *  none) and no opts produces a bare deep link (identical to the mention form),
 *  so the chip path stays byte-for-byte unchanged. */
export function buildObjectEmbedHref(
  type: ObjectRefType,
  id: string | number,
  opts: { view?: string } & EmbedOpts = {},
): string {
  const base = objectDeepLink(type, id);
  const { view, ...rest } = opts;
  const params = new URLSearchParams();
  if (view && view !== "chip") params.set("ros", view);
  for (const [k, v] of Object.entries(rest)) {
    if (v != null && v !== "") params.set(k, String(v));
  }
  const frag = params.toString();
  return frag ? `${base}#${frag}` : base;
}

/** A markdown link that renders as a block embed, `[caption](<deepLink>#ros=...)`.
 *  The link text doubles as the caption (locked 2026-06-11). Outside ResearchOS
 *  it is a normal link, inside, the renderer draws the embed. */
export function objectEmbedMarkdown(
  type: ObjectRefType,
  id: string | number,
  name: string,
  opts: { view?: string } & EmbedOpts = {},
): string {
  return `[${escapeLinkText(name)}](${buildObjectEmbedHref(type, id, opts)})`;
}

/** True when a markdown string is a single `[caption](href)` link that parses as
 *  a BLOCK embed (a `#ros=` view other than chip). Used by the editor to decide
 *  whether an inserted reference needs its own paragraph (a block embed only
 *  renders as a card when it is alone on its line). An inline mention (chip) or
 *  any other markdown returns false, so it inserts inline as before. */
export function isBlockEmbedMarkdown(markdown: string): boolean {
  const m = markdown.trim().match(/^\[[^\]]*\]\((.+)\)$/);
  if (!m) return false;
  const descriptor = parseObjectEmbed(m[1]);
  return descriptor?.isEmbed === true;
}

/** Swap only the view of an object-embed href, preserving type, id, and every opt
 *  (region / rows / cols / analysis / plot / pin / ref / size hints). Rebuilds
 *  through buildObjectEmbedHref so the byte form matches a freshly built embed of
 *  the new view. An href that does not parse as one of our object refs (an
 *  external URL, an anchor, a mailto) is returned unchanged, so this is safe to
 *  run over any link. A bare object link (view "chip") DOES parse, so it gains the
 *  new block view. Round-tripping back to the original view is byte-identical
 *  because the same builder produces both. */
export function swapEmbedView(href: string, newView: string): string {
  const descriptor = parseObjectEmbed(href);
  if (!descriptor) return href;
  return buildObjectEmbedHref(descriptor.type, descriptor.id, {
    view: newView,
    ...descriptor.opts,
  });
}

/** Set or clear a single embed opt on an object-embed href, preserving the type,
 *  id, view, and every other opt. Passing null or "" for `value` removes the opt.
 *  Rebuilds through buildObjectEmbedHref so the byte form matches a freshly built
 *  embed, which is what makes add-then-remove return the original href byte for
 *  byte (the same builder produces both). An href that does not parse as one of our
 *  object refs is returned unchanged, so this is safe to run over any link. This is
 *  the pin-fragment seam (P7-1a): the editor adds `&pin=s_xxx` on Pin and drops it
 *  on Unpin by calling this with key "pin". */
export function setEmbedOpt(
  href: string,
  key: keyof EmbedOpts,
  value: string | number | null | undefined,
): string {
  const descriptor = parseObjectEmbed(href);
  if (!descriptor) return href;
  const nextOpts: EmbedOpts = { ...descriptor.opts };
  if (value == null || value === "") {
    delete nextOpts[key];
  } else {
    (nextOpts as Record<string, unknown>)[key] = value;
  }
  return buildObjectEmbedHref(descriptor.type, descriptor.id, {
    view: descriptor.view,
    ...nextOpts,
  });
}
