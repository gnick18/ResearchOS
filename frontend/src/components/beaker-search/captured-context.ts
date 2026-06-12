// BeakerSearch captured-context labels. This pure helper turns raw values
// (route, a beaker-target key, a text selection) into the friendly one-line
// labels that can be used for display or logging. No DOM, no clock; the React
// layer reads the raw values and hands them here.
//
// beaker-hover.ts is deleted; parseBeakerTargetKey is inlined below.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

/** What "Re-check page" captured, already display-ready. Each field is null when
 *  nothing of that sort was found, so the card can render a quiet "none". */
export interface CapturedContext {
  /** The current route, prettified (e.g. "Sequences", "Gantt"). */
  route: string | null;
  /** The element the pointer was last over, as a friendly kind label. */
  pointer: string | null;
  /** A short excerpt of the current text selection. */
  selection: string | null;
}

/** Split a `data-beaker-target` value into its kind prefix and the rest of the
 *  key. The kind is everything before the FIRST colon, the key is everything
 *  after (which itself may contain colons, e.g. a composite "owner:id").
 *  Returns null when there is no kind separator. Inlined from the now-deleted
 *  beaker-hover.ts; kept here because prettyPointer below still uses it. */
function parseBeakerTargetKey(
  value: string | null | undefined,
): { kind: string; key: string } | null {
  if (!value) return null;
  const i = value.indexOf(":");
  if (i <= 0 || i === value.length - 1) return null;
  return { kind: value.slice(0, i), key: value.slice(i + 1) };
}

/** Friendly names for the known `data-beaker-target` kinds, so "task" reads as
 *  "Task" and a composite key like "lab-member:alex" reads as "Lab member". A
 *  kind not listed here falls back to a title-cased version of the kind. */
const KIND_LABELS: Record<string, string> = {
  task: "Task",
  project: "Project",
  method: "Method",
  sequence: "Sequence",
  note: "Note",
  experiment: "Experiment",
  feature: "Feature",
  primer: "Primer",
  goal: "Goal",
  event: "Event",
  person: "Person",
  "lab-member": "Lab member",
  link: "Link",
  funding: "Funding",
  inventory: "Inventory item",
  action: "Action",
  route: "Route",
};

/** Title-case a single dash / space separated token group, for an unknown kind. */
function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Turn a raw `data-beaker-target` value into a friendly "Pointing at" label,
 *  e.g. "task:self:5" becomes "Task". Returns null for an empty / unparseable
 *  value. */
export function prettyPointer(rawKey: string | null): string | null {
  if (!rawKey) return null;
  const parsed = parseBeakerTargetKey(rawKey);
  if (!parsed) return null;
  return KIND_LABELS[parsed.kind] ?? titleCase(parsed.kind);
}

/** Map a pathname to a friendly route label. Reads only the first path segment
 *  (the section), so "/gantt/abc" reads as "Gantt" and "/" reads as "Home". */
export function prettyRoute(pathname: string | null): string | null {
  if (!pathname) return null;
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return "Home";
  return titleCase(seg);
}

/** Read and trim the live window selection into a short excerpt, or null when
 *  nothing is selected. Caps the length so the card stays one line. */
export function selectionExcerpt(
  selectionText: string | null | undefined,
  max = 60,
): string | null {
  if (!selectionText) return null;
  const trimmed = selectionText.replace(/\s+/g, " ").trim();
  if (trimmed === "") return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
