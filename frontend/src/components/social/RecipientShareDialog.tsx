"use client";

// Recipient-first share dialog (social layer, Phase C2 / seamless send).
//
// Launched from a researcher you found on the network: pick one of your notes
// and send it straight to them. This is the inverse of the existing entity-first
// SendOutsideDialog (start from an object, find a recipient); here the recipient
// is already known and you pick the work.
//
// It REUSES the existing send machinery unchanged: buildNoteBundleInput for the
// payload, sendShare (sealed) with an inviteShare (one-time link) fallback, and
// decideDeliveryMethod for the seal-vs-link predicate. No new crypto, no relay
// protocol. Notes are the carrier because a note bundles its embedded methods,
// molecules, datasets, and figures, so "send a note" covers most sharing.
//
// INTERIM: the relay mailbox is email-keyed, so a found researcher still needs a
// delivery email. When Popup ships the fingerprint-routed sealed send, the email
// step drops and this becomes one-click (the recipient + key are already here).
//
// Every glyph is the shared <Icon> (the icon-guard forbids new inline SVG).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import ProfileAvatar from "@/components/account/ProfileAvatar";
import InviteOutOfBandPanel from "@/components/sharing/InviteOutOfBandPanel";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { notesApi } from "@/lib/local-api";
import type { Note } from "@/lib/types";
import { buildNoteBundleInput } from "@/lib/sharing/note-transfer";
import {
  sendShare,
  inviteShare,
  RecipientNotFoundError,
  RelayError,
} from "@/lib/sharing/relay/client";
import { decideDeliveryMethod } from "@/lib/account/find-and-share";
import {
  filterNoteOptions,
  isValidRecipientEmail,
  recipientLabel,
  recipientSubtitle,
  type ShareableNoteOption,
  type ShareRecipient,
} from "@/lib/social/share-recipient";

interface RecipientShareDialogProps {
  /** The researcher to share with, resolved from a network surface. */
  recipient: ShareRecipient;
  /** Sender's canonical directory email (from useSharingIdentity). */
  senderEmail: string;
  /** Sender's data-folder username, for reading the note off disk. */
  ownerUsername: string;
  onClose: () => void;
}

type Phase =
  | { name: "pick" }
  | { name: "confirm"; note: Note }
  | { name: "sending" }
  | { name: "sent"; recipient: string }
  | { name: "invited"; recipient: string; privateLink: string; unlockCode: string }
  | { name: "error"; message: string };

export default function RecipientShareDialog({
  recipient,
  senderEmail,
  ownerUsername,
  onClose,
}: RecipientShareDialogProps) {
  useEscapeToClose(onClose, true);

  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [query, setQuery] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const loadedFor = useRef(false);

  useEffect(() => {
    if (loadedFor.current) return;
    loadedFor.current = true;
    void notesApi
      .list()
      .then((all) => setNotes(all))
      .catch(() => setNotes([]));
  }, []);

  const options: ShareableNoteOption[] = useMemo(() => {
    const mapped = (notes ?? []).map((n) => ({
      id: n.id,
      title: n.title || "Untitled note",
      updatedAt: n.updated_at,
    }));
    return filterNoteOptions(mapped, query);
  }, [notes, query]);

  const onSend = useCallback(
    async (note: Note) => {
      const email = recipientEmail.trim();
      if (!isValidRecipientEmail(email)) {
        setPhase({
          name: "error",
          message: "Enter the recipient's email so we can deliver the share.",
        });
        return;
      }
      setPhase({ name: "sending" });
      try {
        const bundle = await buildNoteBundleInput(note, ownerUsername);
        try {
          await sendShare({ email: senderEmail, recipientEmail: email, bundle });
          setPhase({ name: "sent", recipient: email });
          return;
        } catch (err) {
          const noPublishedKey =
            err instanceof RecipientNotFoundError ||
            (err instanceof RelayError && err.status === 404);
          if (!noPublishedKey) throw err;
          // decideDeliveryMethod({ hasPublishedKey: false }) === "one-time-link".
          void decideDeliveryMethod({ hasPublishedKey: false });
          const result = await inviteShare({
            email: senderEmail,
            recipientEmail: email,
            bundle,
            itemTitle: note.title || "Untitled note",
            senderLabel: senderEmail,
            itemKind: "note",
          });
          setPhase({
            name: "invited",
            recipient: email,
            privateLink: result.privateLink,
            unlockCode: result.unlockCode,
          });
        }
      } catch {
        setPhase({
          name: "error",
          message: "Could not send the share. Try again in a moment.",
        });
      }
    },
    [recipientEmail, senderEmail, ownerUsername],
  );

  const subtitle = recipientSubtitle(recipient);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-surface-raised shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: who you are sharing with */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <ProfileAvatar avatarUrl={null} name={recipientLabel(recipient)} sizePx={40} />
            <div className="min-w-0">
              <h3 className="truncate text-title font-semibold text-foreground">
                Share work with {recipientLabel(recipient)}
              </h3>
              {subtitle && (
                <p className="truncate font-mono text-meta text-foreground-muted">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <Tooltip label="Close">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 text-foreground-muted hover:text-foreground"
            >
              <Icon name="close" className="h-5 w-5" />
            </button>
          </Tooltip>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          {phase.name === "pick" && (
            <div className="space-y-3">
              <p className="text-meta text-foreground-muted">
                Pick a note to send. It carries its embedded methods, molecules,
                datasets, and figures with it.
              </p>
              <div className="relative">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your notes"
                  className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action"
                />
              </div>

              {notes === null ? (
                <p className="py-6 text-center text-meta text-foreground-muted">
                  Loading your notes&hellip;
                </p>
              ) : options.length === 0 ? (
                <p className="py-6 text-center text-body text-foreground-muted">
                  {query.trim()
                    ? "No notes match that search."
                    : "You have no notes to share yet."}
                </p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => {
                        const full = (notes ?? []).find((n) => n.id === o.id);
                        if (full) setPhase({ name: "confirm", note: full });
                      }}
                      className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-brand-action"
                    >
                      <Icon name="text" className="h-4 w-4 shrink-0 text-foreground-muted" />
                      <span className="truncate text-body font-medium text-foreground">
                        {o.title}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {phase.name === "confirm" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2.5">
                <p className="text-meta text-foreground-muted">Sending</p>
                <p className="mt-0.5 break-words text-body font-medium text-foreground">
                  {phase.note.title || "Untitled note"}
                </p>
              </div>
              <div>
                <label
                  htmlFor="recipient-share-email"
                  className="mb-1 block text-meta font-medium text-foreground"
                >
                  Recipient email
                </label>
                <input
                  id="recipient-share-email"
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isValidRecipientEmail(recipientEmail))
                      onSend(phase.note);
                  }}
                  placeholder="them@university.edu"
                  autoComplete="email"
                  className="w-full rounded-lg border border-border px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action"
                />
                <p className="mt-1 text-meta text-foreground-muted">
                  If they have a published key we seal to it; if not, you get a
                  private link to pass along. A one-click no-email send is coming.
                </p>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPhase({ name: "pick" })}
                  className="flex-1 rounded-lg bg-surface-sunken px-4 py-2 text-body font-medium text-foreground"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => onSend(phase.note)}
                  disabled={!isValidRecipientEmail(recipientEmail)}
                  className="flex-1 rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          )}

          {phase.name === "sending" && (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="h-9 w-9 animate-spin rounded-full border-2 border-border border-t-brand-action" />
              <p className="mt-4 text-body text-foreground-muted">Sending</p>
            </div>
          )}

          {phase.name === "sent" && (
            <div className="space-y-4 text-center">
              <p className="text-title font-semibold text-foreground">
                Sent to {phase.recipient}
              </p>
              <p className="text-body text-foreground-muted">
                They will see it in their inbox. You sent a copy, so your version
                stays yours.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white"
              >
                Done
              </button>
            </div>
          )}

          {phase.name === "invited" && (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-title font-semibold text-foreground">
                  We have invited {phase.recipient}
                </p>
                <p className="mt-1 text-body text-foreground-muted">
                  They do not have a published key yet, so we sealed this under a
                  one-time key. Send them the link or code below over a channel you
                  trust. The email holds no key.
                </p>
              </div>
              <InviteOutOfBandPanel
                recipient={phase.recipient}
                items={[{ privateLink: phase.privateLink, unlockCode: phase.unlockCode }]}
              />
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white"
              >
                Done
              </button>
            </div>
          )}

          {phase.name === "error" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-meta text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300">
                {phase.message}
              </div>
              <button
                type="button"
                onClick={() => setPhase({ name: "pick" })}
                className="w-full rounded-lg border border-border px-4 py-2 text-body font-medium text-foreground"
              >
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
