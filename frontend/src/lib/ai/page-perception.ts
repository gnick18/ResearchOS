// BeakerBot live page perception (ai perception bot, 2026-06-11).
//
// The core of the tour replacement. Instead of a hand-built catalog of every
// button (brittle, goes stale the moment the UI moves), BeakerBot reads the LIVE
// page at call time. This module walks the real DOM for interactive, visible
// elements, computes each element's ACCESSIBLE NAME and ROLE the way a screen
// reader would, filters to what is actually on the page, and hands back a small
// model-friendly list. The model picks a target by name, and the guide action
// spotlights the element the SAME turn via a transient ref.
//
// Why a ref and not a selector: the model never needs to understand the DOM. We
// stamp a short-lived data-bb-ref on each perceived element and remember it in an
// in-memory map, so the guide action can target the exact node the model chose
// without the model writing a CSS selector. Refs are re-minted on every read, so
// they never go stale across reads.
//
// Pure where it can be. walkPerceivableElements and the name/role/visibility
// helpers take a Document so they unit-test against a jsdom fixture with no React
// and no network. Only the ref minting touches module state.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

// One perceived element as the model sees it. Deliberately tiny, the model only
// needs to recognize the element by name and role and then hand back its ref.
export type PerceivedElement = {
  // Transient id minted at read time. The guide action resolves this back to the
  // live node. Format bb-<n>.
  ref: string;
  // The element's ARIA role, normalized (button, link, textbox, checkbox, tab,
  // menuitem, combobox, heading, ...). Lets the model reason about what kind of
  // control it is.
  role: string;
  // The accessible name, computed the way assistive tech would (aria-label, the
  // associated label, visible text, title, placeholder). This is what the model
  // matches the user's request against, so it must read like a human label.
  name: string;
  // Optional extra context, for example the section heading the element sits
  // under, to disambiguate two same-named controls.
  hint?: string;
};

// The ref -> live element map for the most recent read. Replaced on every read so
// stale refs from an old page state cannot resolve. Kept module-local because the
// guide action and the read tool both live in this same browser context.
let refMap = new Map<string, HTMLElement>();

// Monotonic counter for ref minting, so refs are unique within a read and across
// reads in a session (helps logging and avoids accidental reuse confusion).
let refCounter = 0;

// The attribute we stamp on perceived elements. Cleared from the previous read's
// elements before a new read, so the DOM does not accumulate stale markers.
const REF_ATTR = "data-bb-ref";

/** Resolve a ref minted by the last perceiveLivePage call back to its live node.
 *  Returns null when the ref is unknown or its element has detached, so the guide
 *  action can fail gracefully. Falls back to a DOM lookup by the stamped attribute
 *  in case the in-memory map was reset (for example a hot reload). */
export function resolveRef(ref: string): HTMLElement | null {
  const fromMap = refMap.get(ref);
  if (fromMap && fromMap.isConnected) return fromMap;
  if (typeof document === "undefined") return null;
  const escaped = ref.replace(/"/g, '\\"');
  const found = document.querySelector(`[${REF_ATTR}="${escaped}"]`);
  return found instanceof HTMLElement && found.isConnected ? found : null;
}

/** Clear all ref state and remove stamped attributes from the prior read's
 *  elements. Called at the start of each read so refs always describe the page as
 *  it is now. */
function resetRefs(doc: Document): void {
  for (const el of refMap.values()) {
    if (el.isConnected) el.removeAttribute(REF_ATTR);
  }
  // Also sweep any stray markers that outlived the map (defensive).
  doc.querySelectorAll(`[${REF_ATTR}]`).forEach((el) => {
    el.removeAttribute(REF_ATTR);
  });
  refMap = new Map();
}

function mintRef(el: HTMLElement): string {
  refCounter += 1;
  const ref = `bb-${refCounter}`;
  el.setAttribute(REF_ATTR, ref);
  refMap.set(ref, el);
  return ref;
}

// ---------------------------------------------------------------------------
// Role resolution.
// ---------------------------------------------------------------------------

// Map a tag (plus type for inputs) to the implicit ARIA role, so a plain <button>
// or <a href> reads as the right role without an explicit role attribute. Kept to
// the controls a user is actually guided to.
function implicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "button":
      return "button";
    case "a":
      return el.hasAttribute("href") ? "link" : null;
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "summary":
      return "button";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "input": {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      switch (type) {
        case "button":
        case "submit":
        case "reset":
        case "image":
          return "button";
        case "checkbox":
          return "checkbox";
        case "radio":
          return "radio";
        case "range":
          return "slider";
        case "hidden":
          return null;
        case "search":
          return "searchbox";
        default:
          return "textbox";
      }
    }
    default:
      return null;
  }
}

/** Resolve an element's effective role. An explicit role attribute wins, otherwise
 *  the implicit role for its tag. Returns null when the element is not a control
 *  we would guide a user to. Exported for tests. */
export function resolveRole(el: Element): string | null {
  const explicit = el.getAttribute("role");
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim().toLowerCase();
  }
  return implicitRole(el);
}

// ---------------------------------------------------------------------------
// Accessible name computation. A pragmatic subset of the ARIA accname algorithm,
// enough to produce a human label for the kinds of controls in this app, without
// pulling in a dependency.
// ---------------------------------------------------------------------------

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Resolve aria-labelledby to the concatenated text of the referenced elements.
function labelledByText(el: Element, doc: Document): string {
  const ids = el.getAttribute("aria-labelledby");
  if (!ids) return "";
  const parts: string[] = [];
  for (const id of ids.split(/\s+/).filter(Boolean)) {
    const escaped = id.replace(/"/g, '\\"');
    const ref = doc.getElementById(id) ?? doc.querySelector(`#${escaped}`);
    if (ref) parts.push(normalizeWhitespace(ref.textContent ?? ""));
  }
  return normalizeWhitespace(parts.join(" "));
}

// For a form field, find its associated <label> text, either a wrapping label or
// one whose for attribute points at the field's id.
function associatedLabelText(el: Element, doc: Document): string {
  const id = el.getAttribute("id");
  if (id) {
    const escaped = id.replace(/"/g, '\\"');
    const label = doc.querySelector(`label[for="${escaped}"]`);
    if (label) return normalizeWhitespace(label.textContent ?? "");
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    // Clone-free read, strip the field's own value so a wrapping label does not
    // echo the input text back as the name.
    return normalizeWhitespace(wrapping.textContent ?? "");
  }
  return "";
}

/** Compute the accessible name for an element, the human label the model matches
 *  against. Order mirrors the practical accname priority, aria-label, then
 *  aria-labelledby, then an associated form label, then the element's own visible
 *  text, then title, then placeholder, then the value of a button-like input.
 *  Pure given the document, so it unit-tests against a fixture. */
export function accessibleName(el: Element, doc: Document): string {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) return normalizeWhitespace(ariaLabel);

  const byText = labelledByText(el, doc);
  if (byText) return byText;

  const tag = el.tagName.toLowerCase();
  const isField =
    tag === "input" || tag === "textarea" || tag === "select";

  if (isField) {
    const label = associatedLabelText(el, doc);
    if (label) return label;
  }

  // Visible text content for buttons, links, headings, and role-based controls.
  // Skip for plain text fields where the text content is the typed value.
  if (!isField) {
    const text = normalizeWhitespace(el.textContent ?? "");
    if (text) return text;
  }

  const title = el.getAttribute("title");
  if (title && title.trim()) return normalizeWhitespace(title);

  const placeholder = el.getAttribute("placeholder");
  if (placeholder && placeholder.trim()) return normalizeWhitespace(placeholder);

  // A button-like input carries its label in value.
  if (tag === "input") {
    const value = el.getAttribute("value");
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (value && (type === "button" || type === "submit" || type === "reset")) {
      return normalizeWhitespace(value);
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// Visibility. We only perceive what the user can actually act on, so a hidden,
// zero-size, or collapsed element is excluded. jsdom does not lay elements out,
// so getBoundingClientRect is always zero there, which is why the size check is
// guarded behind a real-layout signal (see isPerceivable).
// ---------------------------------------------------------------------------

/** True when an element is rendered and not hidden by the obvious mechanisms,
 *  display:none, visibility:hidden, [hidden], aria-hidden, or zero opacity. Walks
 *  ancestors for display:none/hidden because a hidden parent hides its children.
 *  Uses getComputedStyle when available (the browser) and falls back to inline +
 *  attribute checks (jsdom) so it stays testable. */
export function isVisible(el: Element, win?: Window): boolean {
  const getStyle =
    win && typeof win.getComputedStyle === "function"
      ? (n: Element) => win.getComputedStyle(n)
      : null;

  let node: Element | null = el;
  while (node && node instanceof HTMLElement) {
    if (node.hasAttribute("hidden")) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;

    const inlineDisplay = node.style?.display;
    const inlineVisibility = node.style?.visibility;
    if (inlineDisplay === "none") return false;
    if (inlineVisibility === "hidden" || inlineVisibility === "collapse")
      return false;

    if (getStyle) {
      const cs = getStyle(node);
      if (cs.display === "none") return false;
      if (cs.visibility === "hidden" || cs.visibility === "collapse")
        return false;
      // Only treat opacity 0 on the element itself as hidden, an ancestor with a
      // fade can still hold visible children mid-transition.
      if (node === el && cs.opacity === "0") return false;
    }
    node = node.parentElement;
  }
  return true;
}

// Whether the element carries real on-screen size. In a browser we trust the
// bounding rect, in jsdom (no layout) the rect is always zero, so we treat a
// zero-by-zero rect as "size unknown, do not exclude" and lean on the visibility
// checks instead.
function hasLayoutSize(el: Element, hasLayout: boolean): boolean {
  if (!hasLayout) return true;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// Disabled controls are perceivable for context but flagged, since guiding a user
// to a greyed-out control is rarely useful. We exclude them to keep the list to
// things the user can act on now.
function isDisabled(el: Element): boolean {
  if (el.hasAttribute("disabled")) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  return false;
}

// The selector for candidate interactive nodes. Broad on purpose, the role +
// name + visibility pass below does the real filtering.
const CANDIDATE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="combobox"]',
  '[role="option"]',
  '[role="searchbox"]',
  '[role="textbox"]',
  "[tabindex]",
].join(",");

// Roles that count as interactive targets the user would be guided to. Headings
// are collected separately as context, not as targets.
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "option",
  "searchbox",
  "textbox",
  "slider",
]);

// The hard cap on how many elements we return to the model. A page can have
// hundreds of focusable nodes, the model only needs a relevant, scannable set.
const DEFAULT_MAX = 40;

type WalkOptions = {
  doc: Document;
  win?: Window;
  // Whether the environment lays elements out (a real browser true, jsdom false).
  // Drives the size filter.
  hasLayout?: boolean;
  max?: number;
};

// Find the nearest preceding section heading for an element, to use as a hint
// that disambiguates two same-named controls (for example two "New" buttons in
// different sections). Cheap, walks up to a sectioning ancestor then back to its
// heading.
function sectionHint(el: Element): string | undefined {
  const section = el.closest("section, [role='region'], article, aside, dialog");
  if (section) {
    const heading = section.querySelector("h1, h2, h3, h4, h5, h6, legend");
    if (heading) {
      const text = normalizeWhitespace(heading.textContent ?? "");
      if (text) return text;
    }
    const labelled = section.getAttribute("aria-label");
    if (labelled) return normalizeWhitespace(labelled);
  }
  return undefined;
}

/** Walk the document for perceivable interactive elements and return the compact
 *  model list, minting a ref for each. The first element of a duplicate
 *  name+role+hint group wins, so the list does not repeat identical controls. The
 *  return is capped at `max`, document order, which puts top-of-page controls
 *  first (usually the most relevant primary actions). Pure aside from ref minting.
 */
export function perceiveDocument(options: WalkOptions): PerceivedElement[] {
  const { doc, win, max = DEFAULT_MAX } = options;
  const hasLayout = options.hasLayout ?? true;
  resetRefs(doc);

  const nodes = Array.from(doc.querySelectorAll(CANDIDATE_SELECTOR));
  const out: PerceivedElement[] = [];
  // Dedupe key set, so the model is not handed five identical "Save" buttons.
  const seen = new Set<string>();

  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    const role = resolveRole(node);
    if (!role || !INTERACTIVE_ROLES.has(role)) continue;
    if (isDisabled(node)) continue;
    if (!isVisible(node, win)) continue;
    if (!hasLayoutSize(node, hasLayout)) continue;

    const name = accessibleName(node, doc);
    // An unnamed control is useless to the model, it has nothing to match on, and
    // is almost always a decorative or wrapper node. Skip it.
    if (!name) continue;
    // Skip absurdly long names (a control wrapping a whole card), they are not
    // real labels and only bloat the payload.
    if (name.length > 120) continue;

    const hint = sectionHint(node);
    const key = `${role}|${name.toLowerCase()}|${hint ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      ref: mintRef(node),
      role,
      name,
      ...(hint ? { hint } : {}),
    });

    if (out.length >= max) break;
  }

  return out;
}

// The route the perception was taken on, so the model knows which page the refs
// describe. SSR-safe.
function currentPath(win?: Window): string {
  const w = win ?? (typeof window !== "undefined" ? window : undefined);
  return w ? w.location.pathname : "";
}

export type PerceivePageResult = {
  page: string;
  count: number;
  // True when the returned list was capped, so the model knows there is more and
  // can ask the user to scroll or narrow.
  truncated: boolean;
  elements: PerceivedElement[];
};

/** Perceive the live page in the browser. Thin wrapper over perceiveDocument that
 *  supplies the real document and window and reports the current route. Returns an
 *  empty result with the page when there is no DOM (SSR), so callers never throw.
 */
export function perceiveLivePage(max: number = DEFAULT_MAX): PerceivePageResult {
  if (typeof document === "undefined") {
    return { page: "", count: 0, truncated: false, elements: [] };
  }
  const win = typeof window !== "undefined" ? window : undefined;
  // Count candidates before capping so we can honestly report truncation.
  const all = perceiveDocument({ doc: document, win, max });
  // perceiveDocument already capped at max, so truncation is "did we hit the cap".
  const truncated = all.length >= max;
  return {
    page: currentPath(win),
    count: all.length,
    truncated,
    elements: all,
  };
}
