"use client";

// Cross-boundary sharing, BULK sequence send (sequence sharing manager, HR).
//
// Sends MANY selected sequences to ONE recipient. This is a deliberate
// fan-out, NOT a new batch envelope: the recipient picks the recipient once,
// then we loop the EXISTING single-sequence send path (buildSequenceSendPayload
// + sendRawShare / inviteRawShare) once per selected sequence, so each lands as
// its OWN {kind:"sequence"} inbox item the recipient can sort independently
// (receiver placement on import). No multi-sequence transport is invented.
//
// The component mirrors SequenceSendOutsideDialog's identity gate (the same
// four-state useSharingIdentity gate, the same SharingSetupWizard launch on
// "none", the same recovery prompt on "needs-restore") and its send / invite
// mechanics, extended to load each selected sequence's full detail (the bulk
// list only carries summaries) and to loop the send. The single-sequence dialog
// is left untouched.

import { useCallback, useState } from "react";

import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  sendRawShare,
  inviteRawShare,
  RecipientNotFoundError,
  RelayError,
} from "@/lib/sharing/relay/client";
import { buildSequenceSendPayload } from "@/lib/sharing/sequence-transfer";
import { sequencesApi } from "@/lib/local-api";
import InviteOutOfBandPanel, {
  type InviteOutOfBandItem,
} from "@/components/sharing/InviteOutOfBandPanel";
import Tooltip from "@/components/Tooltip";

// A light, permissive email check, only to gate the Send button. The real
// recipient validation is the server-side directory lookup inside sendRawShare.
function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

interface BulkSequenceSendDialogProps {
  /** The ids of the selected sequences to send, each as its own share. */
  ids: number[];
  /** The folder-local username (sender identity context). */
  ownerUsername: string;
  /** Dismiss the dialog. */
  onClose: () => void;
  /** Called after a successful bulk send / invite so the caller can clear the
   *  selection. */
  onSent?: () => void;
}

export default function BulkSequenceSendDialog({
  ids,
  ownerUsername,
  onClose,
  onSent,
}: BulkSequenceSendDialogProps) {
  const identity = useSharingIdentity();
  const [wizardOpen, setWizardOpen] = useState(false);

  // Escape closes this dialog (app-wide convention).
  useEscapeToClose(onClose);

  const handleWizardComplete = useCallback(async () => {
    setWizardOpen(false);
    await identity.refresh();
  }, [identity]);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised rounded-xl ros-popup-card-shadow max-w-md w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-start justify-between">
          <div>
            <h3 className="text-title font-semibold text-foreground">
              Send sequences outside this folder
            </h3>
            <p className="text-meta text-foreground-muted mt-0.5">
              Send an encrypted copy of each to someone on ResearchOS
            </p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-foreground-muted hover:text-foreground-muted"
              aria-label="Close"
            >
              <CloseGlyph className="w-5 h-5" />
            </button>
          </Tooltip>
        </div>

        <div className="px-5 py-5 overflow-y-auto">
          {identity.status === "loading" && <LoadingBody />}

          {identity.status === "none" && (
            <NoIdentityBody onSetUp={() => setWizardOpen(true)} />
          )}

          {identity.status === "needs-restore" && <NeedsRestoreBody />}

          {identity.status === "ready" && (
            <SendForm
              ids={ids}
              ownerUsername={ownerUsername}
              senderEmail={identity.email}
              onClose={onClose}
              onSent={onSent}
            />
          )}

          {wizardOpen && (
            <SharingSetupWizard
              username={ownerUsername}
              onComplete={handleWizardComplete}
              onClose={() => setWizardOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingBody() {
  return (
    <div className="py-8 flex flex-col items-center text-center">
      <div className="w-9 h-9 rounded-full border-2 border-border border-t-blue-500 animate-spin" />
      <p className="text-body text-foreground-muted mt-4">Checking your sharing setup</p>
    </div>
  );
}

function NoIdentityBody({ onSetUp }: { onSetUp: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-blue-500">
          <KeyGlyph className="w-5 h-5" />
        </span>
        <div>
          <p className="text-body font-medium text-foreground">
            Set up sharing to send these outside your lab
          </p>
          <p className="text-body text-foreground-muted mt-1 leading-relaxed">
            Sending across folders needs a one-time setup that proves your email
            and generates a keypair, so your copies stay private end to end. It
            takes a minute and you only do it once.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onSetUp}
        className="ros-btn-raise w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors"
      >
        Set up sharing
      </button>
    </div>
  );
}

function NeedsRestoreBody() {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-amber-500">
          <WarnGlyph className="w-5 h-5" />
        </span>
        <div>
          <p className="text-body font-medium text-foreground">
            Restore your key on this device first
          </p>
          <p className="text-body text-foreground-muted mt-1 leading-relaxed">
            You already set up sharing, but this device does not have your
            private key, so it cannot send. Restore it with your recovery words
            on this device, then come back to send.
          </p>
        </div>
      </div>
    </div>
  );
}

type SendState =
  | { phase: "idle" }
  | { phase: "sending"; done: number; total: number }
  | { phase: "sent"; recipient: string; count: number }
  | { phase: "error"; message: string }
  // The recipient is not on ResearchOS, offer the invite-a-non-user path for the
  // whole batch instead of a dead-end. Mirrors the single-sequence dialog.
  | { phase: "offer-invite"; recipient: string }
  | { phase: "inviting"; recipient: string; done: number; total: number }
  // Each invited sequence has its OWN one-time key, so the out-of-band material
  // (P1-A) is a per-item list the sender hands the recipient.
  | {
      phase: "invited";
      recipient: string;
      count: number;
      items: InviteOutOfBandItem[];
    };

function SendForm({
  ids,
  ownerUsername,
  senderEmail,
  onClose,
  onSent,
}: {
  ids: number[];
  ownerUsername: string;
  senderEmail: string | null;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [state, setState] = useState<SendState>({ phase: "idle" });

  const total = ids.length;
  const sending = state.phase === "sending" || state.phase === "inviting";
  const canSend = !sending && senderEmail !== null && looksLikeEmail(recipient);

  // Build + relay one sequence's envelope. Loaded lazily per id so the bulk send
  // never holds every full GenBank in memory at once, and a missing / deleted id
  // is skipped rather than aborting the whole batch.
  const sendOne = useCallback(
    async (id: number, fromEmail: string, recipientEmail: string): Promise<boolean> => {
      const seq = await sequencesApi.get(id);
      if (!seq) return false; // deleted between select and send, skip it
      const payload = await buildSequenceSendPayload(seq, ownerUsername);
      await sendRawShare({
        email: fromEmail,
        recipientEmail,
        payload,
        kind: "sequence",
      });
      return true;
    },
    [ownerUsername],
  );

  const inviteOne = useCallback(
    async (
      id: number,
      fromEmail: string,
      recipientEmail: string,
    ): Promise<InviteOutOfBandItem | null> => {
      const seq = await sequencesApi.get(id);
      if (!seq) return null; // deleted between select and send, skip it
      const title = seq.display_name || "Untitled sequence";
      const payload = await buildSequenceSendPayload(seq, ownerUsername);
      const result = await inviteRawShare({
        email: fromEmail,
        recipientEmail,
        payload,
        itemTitle: title,
        senderLabel: fromEmail,
        itemKind: "sequence",
      });
      return {
        title,
        privateLink: result.privateLink,
        unlockCode: result.unlockCode,
      };
    },
    [ownerUsername],
  );

  const handleSend = useCallback(async () => {
    if (!senderEmail) {
      setState({ phase: "error", message: "Could not send, please try again." });
      return;
    }
    const recipientEmail = recipient.trim();
    setState({ phase: "sending", done: 0, total });
    // Probe with the FIRST sequence that still exists so a RecipientNotFound
    // (the person is not on ResearchOS) surfaces the invite offer for the whole
    // batch BEFORE we relay any of them. Probing ids[0] blindly missed this when
    // the first selected sequence was deleted between select and send (the skip
    // looked like a success), so walk forward until one actually sends. Mirrors
    // the single dialog's recipient-missing branch.
    let i = 0;
    let probed = false;
    for (; i < ids.length; i += 1) {
      setState({ phase: "sending", done: i, total });
      try {
        const sent = await sendOne(ids[i], senderEmail, recipientEmail);
        if (sent) {
          probed = true;
          i += 1; // this one is done; relay the rest below
          break;
        }
        // sent === false: this id was deleted, keep probing with the next one.
      } catch (err) {
        if (
          err instanceof RecipientNotFoundError ||
          (err instanceof RelayError && err.status === 404)
        ) {
          setState({ phase: "offer-invite", recipient: recipientEmail });
          return;
        }
        setState({ phase: "error", message: "Could not send, please try again." });
        return;
      }
    }
    if (!probed) {
      // Every selected sequence was deleted before we could send any.
      setState({
        phase: "error",
        message: "Those sequences are no longer available.",
      });
      return;
    }
    // The recipient exists. Relay the rest, one at a time, updating progress.
    for (; i < ids.length; i += 1) {
      setState({ phase: "sending", done: i, total });
      try {
        await sendOne(ids[i], senderEmail, recipientEmail);
      } catch {
        setState({
          phase: "error",
          message:
            "Some sequences could not be sent. The ones that did send are on their way.",
        });
        return;
      }
    }
    setState({ phase: "sent", recipient: recipientEmail, count: total });
    onSent?.();
  }, [senderEmail, recipient, ids, total, sendOne, onSent]);

  const handleInvite = useCallback(async () => {
    if (!senderEmail) {
      setState({ phase: "error", message: "Could not invite, please try again." });
      return;
    }
    const recipientEmail = recipient.trim();
    setState({ phase: "inviting", recipient: recipientEmail, done: 0, total });
    const items: InviteOutOfBandItem[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      setState({ phase: "inviting", recipient: recipientEmail, done: i, total });
      try {
        const item = await inviteOne(ids[i], senderEmail, recipientEmail);
        if (item) items.push(item);
      } catch {
        setState({
          phase: "error",
          message: "Could not send the invites. Please try again in a moment.",
        });
        return;
      }
    }
    setState({
      phase: "invited",
      recipient: recipientEmail,
      count: items.length,
      items,
    });
    onSent?.();
  }, [senderEmail, recipient, ids, total, inviteOne, onSent]);

  // The recipient is not on ResearchOS. Offer to invite them and share all of
  // the selected sequences, with the same honest trust-boundary warning.
  if (state.phase === "offer-invite") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-blue-500">
            <MailGlyph className="w-5 h-5" />
          </span>
          <div>
            <p className="text-body font-medium text-foreground">
              {state.recipient} is not on ResearchOS yet
            </p>
            <p className="text-body text-foreground-muted mt-1 leading-relaxed">
              ResearchOS emails {state.recipient} a branded invitation to create a
              free account. The email holds no keys, so it cannot open the
              sequences on its own. After you send it, ResearchOS gives you a
              private link and an unlock code for each sequence to pass to{" "}
              {state.recipient} yourself, and the sequences stay encrypted until
              they open them with those keys.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg">
          <span className="text-amber-500 mt-0.5">
            <WarnGlyph className="w-4 h-4" />
          </span>
          <p className="text-meta text-amber-800 dark:text-amber-300 leading-relaxed">
            An invite is a lower-assurance channel than sending to an existing
            account. The unlock keys never travel through our relay or the
            invitation email, you deliver them to the recipient over a channel you
            trust. Whoever holds a key can open that sequence, so send them
            carefully and only invite an address you trust.
          </p>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setState({ phase: "idle" })}
            className="ros-btn-neutral flex-1 py-2 text-body"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleInvite}
            className="ros-btn-raise flex-1 py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors"
          >
            Invite and share
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "inviting") {
    return (
      <div className="py-8 flex flex-col items-center text-center">
        <div className="w-9 h-9 rounded-full border-2 border-border border-t-blue-500 animate-spin" />
        <p className="text-body text-foreground-muted mt-4">
          Inviting {state.recipient} ({state.done} of {state.total})
        </p>
      </div>
    );
  }

  if (state.phase === "invited") {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center text-center py-2">
          <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-300">
            <CheckGlyph className="w-6 h-6" />
          </div>
          <p className="text-title font-semibold text-foreground mt-3">
            We have invited {state.recipient}
          </p>
          <p className="text-body text-foreground-muted mt-1 leading-relaxed">
            They will get an email inviting them to create a free account. The{" "}
            {state.count} sequence{state.count === 1 ? "" : "s"}{" "}
            {state.count === 1 ? "is" : "are"} held encrypted for 30 days.
          </p>
        </div>
        <InviteOutOfBandPanel recipient={state.recipient} items={state.items} />
        <button
          type="button"
          onClick={onClose}
          className="ros-btn-raise w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  if (state.phase === "sent") {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center text-center py-2">
          <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-300">
            <CheckGlyph className="w-6 h-6" />
          </div>
          <p className="text-title font-semibold text-foreground mt-3">
            Sent {state.count} sequence{state.count === 1 ? "" : "s"} to{" "}
            {state.recipient}
          </p>
          <p className="text-body text-foreground-muted mt-1 leading-relaxed">
            They arrive as separate inbox items, each one savable on its own. You
            sent copies, so any later edits you make stay on your versions.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ros-btn-raise w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface-sunken border border-border rounded-lg px-3 py-2.5">
        <p className="text-meta text-foreground-muted">
          Sending {total} sequence{total === 1 ? "" : "s"}
        </p>
        <p className="text-body font-medium text-foreground mt-0.5">
          Each goes as its own encrypted copy
        </p>
      </div>

      <p className="text-body text-foreground-muted leading-relaxed">
        This sends an encrypted copy of each selected sequence, a snapshot as it
        looks now, its GenBank file with every feature and annotation. It is not
        live shared editing, the recipient gets their own copies, one inbox item
        per sequence.
      </p>

      <div>
        <label
          htmlFor="bulk-sequence-send-recipient"
          className="block text-meta font-medium text-foreground mb-1"
        >
          Recipient email
        </label>
        <input
          id="bulk-sequence-send-recipient"
          type="email"
          value={recipient}
          onChange={(e) => {
            setRecipient(e.target.value);
            if (state.phase === "error") setState({ phase: "idle" });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSend) handleSend();
          }}
          placeholder="them@university.edu"
          autoComplete="email"
          disabled={sending}
          className="w-full px-3 py-2 border border-border rounded-lg text-body text-foreground placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60"
        />
      </div>

      {state.phase === "error" && (
        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
          <span className="text-red-500 mt-0.5">
            <WarnGlyph className="w-4 h-4" />
          </span>
          <p className="text-meta text-red-700 dark:text-red-300 leading-relaxed">{state.message}</p>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={sending}
          className="ros-btn-neutral flex-1 py-2 text-body disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="ros-btn-raise flex-1 py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state.phase === "sending"
            ? `Sending ${state.done + 1} of ${state.total}…`
            : `Send ${total} sequence${total === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG glyphs (no icon library, no emoji). currentColor + caller-sized.
// Mirrors SequenceSendOutsideDialog's glyph set.
// ---------------------------------------------------------------------------

interface GlyphProps {
  className?: string;
}

function CloseGlyph({ className }: GlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function CheckGlyph({ className }: GlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function KeyGlyph({ className }: GlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 9.6-9.6" />
      <path d="m16 5 3 3" />
    </svg>
  );
}

function WarnGlyph({ className }: GlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function MailGlyph({ className }: GlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}
