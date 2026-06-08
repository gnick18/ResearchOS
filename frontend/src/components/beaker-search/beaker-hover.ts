// sequence editor master. BeakerSearch website-wide (step 4), the app-wide
// mouse-awareness primitive.
//
// The provider tracks the LAST element the pointer was over that carried a
// `[data-beaker-target]` attribute, and exposes its key as `hoveredKey` snapshot
// at the moment the palette opens. A page opts a row / card into hover-context by
// tagging it `data-beaker-target="<kind>:<key>"` (e.g. "task:self:5",
// "lab-member:alex", "link:morgan:12"). Each per-page source parses the key for
// its own kinds and resolves it to the hovered entity, which biases Suggested and
// the context card ("Open the experiment you were pointing at"). SELECTED still
// outranks HOVERED, so a real open entity wins over a stale hover.
//
// This helper is the pure DOM read, factored out so it is unit-testable without
// mounting the provider. It walks up from the event target to the nearest tagged
// ancestor, so tagging a card wrapper covers everything inside it.
//
// Voice in comments, no em-dashes, no en-dashes, no emojis, no mid-sentence
// colons.

/** The `data-beaker-target` key of the nearest tagged ancestor of an event
 *  target, or null when the pointer is over nothing tagged (the palette, the
 *  scrim, untagged page chrome). Used by the provider's pointer listener, which
 *  updates its ref ONLY when this returns non-null, so hovering untagged surfaces
 *  never clears the last real target. */
export function beakerTargetKeyOf(target: EventTarget | null): string | null {
  if (target == null || !(target instanceof Element)) return null;
  const el = target.closest("[data-beaker-target]");
  if (el == null) return null;
  const key = el.getAttribute("data-beaker-target");
  return key && key.trim() !== "" ? key : null;
}

/** Split a `data-beaker-target` value into its kind prefix and the rest of the
 *  key. The kind is everything before the FIRST colon, the key is everything
 *  after (which itself may contain colons, e.g. a composite "owner:id"). Returns
 *  null when there is no kind separator. A page source matches on the kind and
 *  resolves the key against its own entity list. */
export function parseBeakerTargetKey(
  value: string | null | undefined,
): { kind: string; key: string } | null {
  if (!value) return null;
  const i = value.indexOf(":");
  if (i <= 0 || i === value.length - 1) return null;
  return { kind: value.slice(0, i), key: value.slice(i + 1) };
}
