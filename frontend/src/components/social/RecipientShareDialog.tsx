"use client";

// Recipient-first share dialog (social layer, Phase C2 / seamless send).
//
// Launched from a researcher you found on the network: pick one of your objects
// and send it straight to them. The inverse of the entity-first SendOutsideDialog
// (start from an object, find a recipient); here the recipient is already known.
//
// Supports notes, methods, and sequences, REUSING the existing send machinery
// unchanged: notes seal a built RO-Crate bundle (buildNoteBundleInput -> sendShare
// with an inviteShare one-time-link fallback); methods and sequences seal an
// opaque export payload (buildMethodSendPayload / buildSequenceSendPayload ->
// sendRawShare with an inviteRawShare fallback). decideDeliveryMethod is the
// seal-vs-link predicate. No new crypto, no relay protocol, no edits to the send
// tree. A note is the richest carrier (it bundles its embedded methods,
// molecules, datasets, and figures), so it stays the default tab.
//
// INTERIM: the relay mailbox is email-keyed, so a found researcher still needs a
// delivery email. When Popup ships the fingerprint-routed sealed send, the email
// step drops and this becomes one-click (the recipient + key are already here).
//
// Every glyph is the shared <Icon> (the icon-guard forbids new inline SVG).
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useMemo, useState } from "react";

import { Icon, type IconName } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import ProfileAvatar from "@/components/account/ProfileAvatar";
import InviteOutOfBandPanel from "@/components/sharing/InviteOutOfBandPanel";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { notesApi, methodsApi, sequencesApi } from "@/lib/local-api";
import type { Note, Method, SequenceRecord } from "@/lib/types";
import { buildNoteBundleInput } from "@/lib/sharing/note-transfer";
import { buildMethodSendPayload } from "@/lib/sharing/method-transfer";
import { buildSequenceSendPayload } from "@/lib/sharing/sequence-transfer";
import {
  sendShare,
  inviteShare,
  sendRawShare,
  inviteRawShare,
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

type Kind = "note" | "method" | "sequence";

const KINDS: { key: Kind; label: string; icon: IconName }[] = [
  { key: "note", label: "Notes", icon: "text" },
  { key: "method", label: "Methods", icon: "book" },
  { key: "sequence", label: "Sequences", icon: "sequence" },
];

const KIND_ICON: Record<Kind, IconName> = {
  note: "text",
  method: "book",
  sequence: "sequence",
};

interface RecipientShareDialogProps {
  /** The researcher to share with, resolved from a network surface. */
  recipient: ShareRecipient;
  /** Sender's canonical directory email (from useSharingIdentity). */
  senderEmail: string;
  /** Sender's data-folder username, for reading the object off disk. */
  ownerUsername: string;
  onClose: () => void;
}

interface PickedObject {
  kind: Kind;
  id: number;
  title: string;
}

type Phase =
  | { name: "pick" }
  | { name: "confirm"; picked: PickedObject }
  | { name: "sending" }
  | { name: "sent"; recipient: string }
  | { name: "invited"; recipient: string; privateLink: string; unlockCode: string }
  | { name: "error"; message: string };

function isNoPublishedKey(err: unknown): boolean {
  return (
    err instanceof RecipientNotFoundError ||
    (err instanceof RelayError && err.status === 404)
  );
}

export default function RecipientShareDialog({
  recipient,
  senderEmail,
  ownerUsername,
  onClose,
}: RecipientShareDialogProps) {
  useEscapeToClose(onClose, true);

  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const [kind, setKind] = useState<Kind>("note");
  const [query, setQuery] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");

  // Raw record caches, loaded lazily the first time each tab is viewed. We keep
  // the full records so the send path can build the bundle/payload off the picked
  // id without a second list call.
  const [notesRaw, setNotesRaw] = useState<Note[] | null>(null);
  const [methodsRaw, setMethodsRaw] = useState<Method[] | null>(null);
  const [seqsRaw, setSeqsRaw] = useState<SequenceRecord[] | null>(null);

  useEffect(() => {
    if (kind === "note" && notesRaw === null) {
      void notesApi.list().then(setNotesRaw).catch(() => setNotesRaw([]));
    } else if (kind === "method" && methodsRaw === null) {
      void methodsApi.list().then(setMethodsRaw).catch(() => setMethodsRaw([]));
    } else if (kind === "sequence" && seqsRaw === null) {
      void sequencesApi.list().then(setSeqsRaw).catch(() => setSeqsRaw([]));
    }
  }, [kind, notesRaw, methodsRaw, seqsRaw]);

  const { loading, options } = useMemo<{
    loading: boolean;
    options: ShareableNoteOption[];
  }>(() => {
    if (kind === "note") {
      if (notesRaw === null) return { loading: true, options: [] };
      const mapped = notesRaw.map((n) => ({
        id: n.id,
        title: n.title || "Untitled note",
        updatedAt: n.updated_at,
      }));
      return { loading: false, options: filterNoteOptions(mapped, query) };
    }
    if (kind === "method") {
      if (methodsRaw === null) return { loading: true, options: [] };
      // Compound methods reference other methods and cannot be packaged for a
      // standalone send, so they are not offered.
      const mapped = methodsRaw
        .filter((m) => m.method_type !== "compound")
        .map((m) => ({
          id: m.id,
          title: m.name || "Untitled method",
          // Methods carry no timestamp, so sort newest-id first via a padded key.
          updatedAt: String(m.id).padStart(12, "0"),
        }));
      return { loading: false, options: filterNoteOptions(mapped, query) };
    }
    if (seqsRaw === null) return { loading: true, options: [] };
    const mapped = seqsRaw.map((s) => ({
      id: s.id,
      title: s.display_name || "Untitled sequence",
      updatedAt: s.added_at,
    }));
    return { loading: false, options: filterNoteOptions(mapped, query) };
  }, [kind, query, notesRaw, methodsRaw, seqsRaw]);

  // A directory researcher (one with a published key) can be sealed to by
  // fingerprint with no email at all, the one-click no-email send. A bare @handle
  // without a published key falls back to the email path (seal-or-one-time-link).
  const sealByFingerprint =
    Boolean(recipient.fingerprint) && recipient.hasPublishedKey;

  const onSend = useCallback(
    async (picked: PickedObject) => {
      const email = recipientEmail.trim();
      if (!sealByFingerprint && !isValidRecipientEmail(email)) {
        setPhase({
          name: "error",
          message: "Enter the recipient's email so we can deliver the share.",
        });
        return;
      }
      // The signed send is addressed by fingerprint (no email) or by email.
      const address = sealByFingerprint
        ? { recipientFingerprint: recipient.fingerprint as string }
        : { recipientEmail: email };
      const sentLabel = sealByFingerprint ? recipientLabel(recipient) : email;
      setPhase({ name: "sending" });
      try {
        if (picked.kind === "note") {
          const note = (notesRaw ?? []).find((n) => n.id === picked.id);
          if (!note) throw new Error("note not found");
          const bundle = await buildNoteBundleInput(note, ownerUsername);
          try {
            await sendShare({ email: senderEmail, ...address, bundle });
            setPhase({ name: "sent", recipient: sentLabel });
          } catch (err) {
            // The fingerprint path only targets a recipient who has a published
            // key, so there is no one-time-link fallback there, surface the error.
            if (sealByFingerprint || !isNoPublishedKey(err)) throw err;
            void decideDeliveryMethod({ hasPublishedKey: false });
            const result = await inviteShare({
              email: senderEmail,
              recipientEmail: email,
              bundle,
              itemTitle: picked.title,
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
          return;
        }

        // Methods + sequences ship as opaque export payloads via the raw relay.
        let payload: Uint8Array;
        if (picked.kind === "method") {
          const method = (methodsRaw ?? []).find((m) => m.id === picked.id);
          if (!method) throw new Error("method not found");
          payload = await buildMethodSendPayload(method, ownerUsername);
        } else {
          const detail = await sequencesApi.get(picked.id);
          if (!detail) throw new Error("sequence not found");
          payload = await buildSequenceSendPayload(detail, ownerUsername);
        }
        try {
          await sendRawShare({
            email: senderEmail,
            ...address,
            payload,
            kind: picked.kind,
          });
          setPhase({ name: "sent", recipient: sentLabel });
        } catch (err) {
          if (sealByFingerprint || !isNoPublishedKey(err)) throw err;
          void decideDeliveryMethod({ hasPublishedKey: false });
          const result = await inviteRawShare({
            email: senderEmail,
            recipientEmail: email,
            payload,
            itemTitle: picked.title,
            senderLabel: senderEmail,
            itemKind: picked.kind,
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
    [
      recipientEmail,
      sealByFingerprint,
      recipient,
      senderEmail,
      ownerUsername,
      notesRaw,
      methodsRaw,
    ],
  );

  const subtitle = recipientSubtitle(recipient);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-surface-raised ros-popup-card-shadow"
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
              {/* Kind tabs */}
              <div className="flex gap-1 rounded-lg bg-surface-sunken p-1">
                {KINDS.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => {
                      setKind(k.key);
                      setQuery("");
                    }}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-meta font-medium transition ${
                      kind === k.key
                        ? "bg-surface text-foreground shadow-sm"
                        : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    <Icon name={k.icon} className="h-3.5 w-3.5" />
                    {k.label}
                  </button>
                ))}
              </div>

              <p className="text-meta text-foreground-muted">
                {kind === "note"
                  ? "A note carries its embedded methods, molecules, datasets, and figures with it."
                  : "Send a copy. Your version stays yours."}
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
                  placeholder={`Search your ${kind}s`}
                  className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action"
                />
              </div>

              {loading ? (
                <p className="py-6 text-center text-meta text-foreground-muted">
                  Loading your {kind}s&hellip;
                </p>
              ) : options.length === 0 ? (
                <p className="py-6 text-center text-body text-foreground-muted">
                  {query.trim()
                    ? `No ${kind}s match that search.`
                    : `You have no ${kind}s to share yet.`}
                </p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {options.map((o) => (
                    <button
                      key={`${kind}:${o.id}`}
                      type="button"
                      onClick={() =>
                        setPhase({
                          name: "confirm",
                          picked: { kind, id: o.id, title: o.title },
                        })
                      }
                      className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-brand-action"
                    >
                      <Icon
                        name={KIND_ICON[kind]}
                        className="h-4 w-4 shrink-0 text-foreground-muted"
                      />
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
                <p className="mt-0.5 flex items-center gap-2 break-words text-body font-medium text-foreground">
                  <Icon
                    name={KIND_ICON[phase.picked.kind]}
                    className="h-4 w-4 shrink-0 text-foreground-muted"
                  />
                  {phase.picked.title}
                </p>
              </div>
              {sealByFingerprint ? (
                <p className="text-meta text-foreground-muted leading-relaxed">
                  We seal this directly to {recipientLabel(recipient)}&rsquo;s key
                  and drop it in their inbox. No email needed.
                </p>
              ) : (
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
                        onSend(phase.picked);
                    }}
                    placeholder="them@university.edu"
                    autoComplete="email"
                    className="w-full rounded-lg border border-border px-3 py-2 text-body text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-brand-action"
                  />
                  <p className="mt-1 text-meta text-foreground-muted">
                    If they have a published key we seal to it; if not, you get a
                    private link to pass along.
                  </p>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPhase({ name: "pick" })}
                  className="ros-btn-neutral flex-1 px-4 py-2 text-body font-medium"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => onSend(phase.picked)}
                  disabled={!sealByFingerprint && !isValidRecipientEmail(recipientEmail)}
                  className="ros-btn-raise flex-1 rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white disabled:opacity-50"
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
                className="ros-btn-raise w-full rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white"
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
                className="ros-btn-raise w-full rounded-lg bg-brand-action px-4 py-2 text-body font-medium text-white"
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
