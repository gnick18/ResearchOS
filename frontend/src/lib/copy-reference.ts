// sequence editor master. Copy reference. Writes a link to an object onto the OS
// clipboard so it can be pasted into a note (where the renderer upgrades it to a
// live chip) or anywhere else (where it stays readable markdown + a working URL).
//
// The clipboard payload is the markdown reference on the first line and the plain
// deep link on a second line, so a paste target that strips markdown still keeps
// a usable URL. Returns the toast text so the caller can surface it; takes the
// clipboard writer as a dependency (the sequences page already has writeOsClipboard)
// so this stays a pure, testable helper.
//
// Voice. No em-dashes, no emojis, no mid-sentence colons.

import {
  objectDeepLink,
  objectReferenceMarkdown,
  type ObjectRefType,
} from "@/lib/references";
import type { ObjectMenuItem } from "@/lib/object-menu";

/** Build the two-line clipboard payload for an object reference. Line 1 is the
 *  markdown link (upgraded to a chip in a note); line 2 is the bare deep link. */
export function referenceClipboardText(
  type: ObjectRefType,
  id: string | number,
  name: string,
): string {
  const markdown = objectReferenceMarkdown(type, id, name);
  const link = objectDeepLink(type, id);
  return `${markdown}\n${link}`;
}

/** Copy a reference to the given object. Writes the two-line payload through the
 *  supplied clipboard writer and returns the toast text. The writer mirrors the
 *  sequences page's writeOsClipboard (a no-throw navigator.clipboard wrapper). */
export function copyObjectReference(
  item: ObjectMenuItem,
  writeOsClipboard: (text: string) => void,
): string {
  const text = referenceClipboardText(item.type, item.id, item.name);
  writeOsClipboard(text);
  return `Copied a link to ${item.name}.`;
}
