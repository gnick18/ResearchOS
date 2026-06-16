// Recipient-first share model (social layer, Phase C2 / seamless send).
//
// The researcher network's payoff is sending your work straight to a collaborator
// you found, instead of starting from an object and typing an email. This module
// holds the small pure logic for that recipient-first direction. The actual send
// reuses the existing relay client (sendShare / inviteShare) and the delivery
// decision (decideDeliveryMethod) unchanged, so this adds no crypto and no relay
// protocol.
//
// INTERIM (until Popup ships fingerprint-routed sealed send): the relay mailbox
// is email-keyed, so even a found researcher needs a recipient email to deliver.
// When the fingerprint-routed path lands, the email step drops and a found
// researcher becomes a true one-click sealed send. See the social-layer build
// plan C2 + the message to the Popup Unifier lane.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** A researcher to share with, resolved from a network surface. */
export interface ShareRecipient {
  /** Display name (always present for a listed researcher). */
  displayName: string;
  /** Space-grouped directory fingerprint, when the recipient is in the directory. */
  fingerprint?: string | null;
  /** @handle, when the recipient was resolved from a cloud-account profile. */
  handle?: string | null;
  /**
   * True when the recipient has a published key, so a sealed send is possible.
   * Drives decideDeliveryMethod (seal vs one-time-link). A directory result has
   * one by definition; a bare @handle may not.
   */
  hasPublishedKey: boolean;
}

/** The primary label for a recipient (their name). */
export function recipientLabel(r: ShareRecipient): string {
  return r.displayName?.trim() || (r.handle ? `@${r.handle}` : "this researcher");
}

/** A secondary identifier line, the @handle or the key fingerprint. */
export function recipientSubtitle(r: ShareRecipient): string | null {
  if (r.handle) return `@${r.handle}`;
  if (r.fingerprint) return r.fingerprint;
  return null;
}

/** Loose email shape check, mirrors the existing send dialogs. */
export function isValidRecipientEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** A note as offered in the share picker (a trimmed view of the Note record). */
export interface ShareableNoteOption {
  id: number;
  title: string;
  updatedAt: string;
}

/** Filter + sort notes for the picker: newest first, optional title query. */
export function filterNoteOptions(
  options: ShareableNoteOption[],
  query: string,
): ShareableNoteOption[] {
  const q = query.trim().toLowerCase();
  const matched = q
    ? options.filter((o) => o.title.toLowerCase().includes(q))
    : options;
  return [...matched].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
