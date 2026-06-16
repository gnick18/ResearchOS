// Phone-note block formatter (phone notes P2, mobile side).
//
// Builds the portable, attributed callout markdown the phone pushes into an
// experiment's notes/results doc. The laptop's RenderedMarkdown styles a
// `[!phone-note]` callout as a phone-note card; in any other markdown tool it
// degrades to a plain blockquote (the marker is just leading text), per the
// embed-hybrid portability invariant.
//
// Shape:
//   > [!phone-note] {author} · {YYYY-MM-DD HH:MM} · from phone
//   > {body line 1}
//   > {body line 2}
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** Two-digit zero-pad for the local timestamp parts. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local "YYYY-MM-DD HH:MM" stamp for the callout header. */
export function phoneNoteTimestamp(d: Date = new Date()): string {
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${date} ${time}`;
}

/**
 * Build the phone-note callout block for `body`, attributed to `author` (falls
 * back to "Phone"). Every body line is prefixed with the blockquote marker so
 * the whole thing is one self-contained block. Returns an empty string when the
 * body is blank (the caller should not push an empty note).
 */
export function buildPhoneNoteBlock(
  body: string,
  author: string | null | undefined,
  at: Date = new Date(),
): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  const who = (author ?? '').trim() || 'Phone';
  const header = `> [!phone-note] ${who} · ${phoneNoteTimestamp(at)} · from phone`;
  const bodyLines = trimmed
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${header}\n${bodyLines}`;
}
