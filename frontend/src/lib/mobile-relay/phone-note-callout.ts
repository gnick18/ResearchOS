// Phone-note callout parser (phone notes P2, laptop side).
//
// A phone note is inserted into an experiment doc as a portable, attributed
// callout blockquote, e.g.
//
//   > [!phone-note] Grant · 2026-06-15 17:40 · from phone
//   > Colonies looked good at 16 h, slightly more on plate B.
//
// RenderedMarkdown styles this as a "phone note" card. The marker line is the
// first line of the blockquote and starts with the literal `[!phone-note]`
// token; everything after it on that line is the attribution header (author,
// timestamp, "from phone"), and the remaining lines are the note body. The
// callout DEGRADES to a plain blockquote in any other markdown tool because the
// marker is just leading text, per the embed-hybrid portability invariant.
//
// This parser takes the blockquote's already-de-quoted plain text (the text the
// markdown renderer gives the blockquote node, with the leading `> ` stripped)
// and returns the header + body when the marker is present, or null otherwise.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** The literal marker that tags a blockquote as a phone note. */
export const PHONE_NOTE_MARKER = "[!phone-note]";

/** Parsed parts of a phone-note callout. */
export interface PhoneNoteCallout {
  /** The attribution header after the marker (author, timestamp, "from phone"). */
  header: string;
  /** The note body, with its original line breaks preserved (may be empty). */
  body: string;
}

/**
 * Parse a phone-note callout from the de-quoted text of a blockquote. Returns
 * null when the marker is absent (so the caller renders a normal blockquote).
 * Tolerant of an empty header or an empty body.
 */
export function parsePhoneNoteCallout(text: string): PhoneNoteCallout | null {
  // Trim outer whitespace first. The markdown renderer hands a blockquote's text
  // with leading/trailing newlines (the whitespace text nodes around the inner
  // paragraph), so the marker is not necessarily at byte 0.
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const newlineIdx = normalized.indexOf("\n");
  const firstLine = (newlineIdx === -1 ? normalized : normalized.slice(0, newlineIdx)).trim();
  if (!firstLine.startsWith(PHONE_NOTE_MARKER)) return null;

  const header = firstLine.slice(PHONE_NOTE_MARKER.length).trim();
  const body = newlineIdx === -1 ? "" : normalized.slice(newlineIdx + 1).trim();
  return { header, body };
}
