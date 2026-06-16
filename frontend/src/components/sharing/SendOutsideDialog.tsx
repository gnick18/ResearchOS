"use client";

// Cross-boundary sharing, the "Share outside this folder" send dialog (Phase 2b).
//
// Sends ONE note to ONE recipient as an encrypted snapshot. This is a one-time
// copy, not live shared editing, the recipient gets a sealed bundle of the note
// as it looks right now and files it into their own folder. Re-sending later
// sends a fresh copy.
//
// The dialog is gated by the device's sharing identity (useSharingIdentity). The
// caller can have one of four states and we render a different body for each,
//   "loading"       a brief spinner while we read the identity
//   "none"          an explainer plus a button that launches SharingSetupWizard;
//                   on a successful claim we refresh the gate and drop into the form
//   "needs-restore" the published identity exists but this device has no private
//                   key, so there is no send path here, we point at recovery
//   "ready"         the send form, one recipient email, then Send
//
// Everything security-sensitive lives in helpers we only orchestrate here.
// buildNoteBundleInput collects the note plus its images off disk, sendShare
// resolves the recipient in the directory, seals the bundle to their public key,
// and hands the relay only opaque bytes. We never touch raw private keys.

import { useCallback, useMemo, useState } from "react";

import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import {
  sendShare,
  inviteShare,
  RecipientNotFoundError,
  RelayError,
} from "@/lib/sharing/relay/client";
import { buildNoteBundleInput } from "@/lib/sharing/note-transfer";
import InviteOutOfBandPanel from "@/components/sharing/InviteOutOfBandPanel";
import FindAndShareModal from "@/components/account/FindAndShareModal";
import { isFindAndShareEnabled } from "@/lib/account/find-and-share";
import Tooltip from "@/components/Tooltip";
import { scanNoteDependencies } from "@/lib/sharing/note-dependencies";
import {
  NoteDependencyPanel,
  useDependencySelection,
} from "@/components/sharing/NoteDependencyPanel";
import type { Note } from "@/lib/types";

interface SendOutsideDialogProps {
  /** The note to send. Its current snapshot is what the recipient receives. */
  note: Note;
  /** The folder-local username that owns the note (the bundle's collect root). */
  ownerUsername: string;
  /** Dismiss the dialog. */
  onClose: () => void;
  /** Unified Share entry point (2026-06-04): when true, render only the inner
   *  body (the four-state send flow + setup wizard) with no overlay and no
   *  header. The UnifiedShareDialog owns the modal chrome and renders this body
   *  under its "Outside your lab" tab. Defaults to false (standalone dialog). */
  embedded?: boolean;
}

// A light, permissive email check. The real recipient validation happens server
// side when the directory lookup runs, this only gates the Send button so an
// empty or obviously malformed address cannot be submitted.
function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export default function SendOutsideDialog({
  note,
  ownerUsername,
  onClose,
  embedded = false,
}: SendOutsideDialogProps) {
  const identity = useSharingIdentity();

  // Escape closes this dialog (app-wide convention). Skip in embedded mode:
  // the UnifiedShareDialog shell owns the overlay and its own Escape handling.
  useEscapeToClose(onClose, !embedded);

  // When the user has no identity yet we launch the setup wizard inline. Once it
  // completes we refresh the gate so the body re-renders into the send form.
  const [wizardOpen, setWizardOpen] = useState(false);

  const handleWizardComplete = useCallback(async () => {
    setWizardOpen(false);
    await identity.refresh();
  }, [identity]);

  // The inner four-state send flow plus the inline setup wizard. Shared by the
  // standalone dialog and the embedded (UnifiedShareDialog tab) mode.
  const body = (
    <>
      {identity.status === "loading" && <LoadingBody />}

      {identity.status === "none" && (
        <NoIdentityBody onSetUp={() => setWizardOpen(true)} />
      )}

      {identity.status === "needs-restore" && <NeedsRestoreBody />}

      {identity.status === "ready" && (
        <SendForm
          note={note}
          ownerUsername={ownerUsername}
          senderEmail={identity.email}
          onClose={onClose}
        />
      )}

      {wizardOpen && (
        <SharingSetupWizard
          username={ownerUsername}
          onComplete={handleWizardComplete}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </>
  );

  if (embedded) {
    // No overlay, no header — the UnifiedShareDialog owns the chrome.
    return body;
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-start justify-between">
          <div>
            <h3 className="text-title font-semibold text-foreground">
              Share outside this folder
            </h3>
            <p className="text-meta text-foreground-muted mt-0.5">
              Send an encrypted copy to someone on ResearchOS
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

        <div className="px-5 py-5 overflow-y-auto">{body}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading.
// ---------------------------------------------------------------------------

function LoadingBody() {
  return (
    <div className="py-8 flex flex-col items-center text-center">
      <div className="w-9 h-9 rounded-full border-2 border-border border-t-blue-500 animate-spin" />
      <p className="text-body text-foreground-muted mt-4">Checking your sharing setup</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// No identity yet, offer setup.
// ---------------------------------------------------------------------------

function NoIdentityBody({ onSetUp }: { onSetUp: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-blue-500">
          <KeyGlyph className="w-5 h-5" />
        </span>
        <div>
          <p className="text-body font-medium text-foreground">
            Set up sharing to send this outside your lab
          </p>
          <p className="text-body text-foreground-muted mt-1 leading-relaxed">
            Sending across folders needs a one-time setup that proves your email
            and generates a keypair, so your copy stays private end to end. It
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

// ---------------------------------------------------------------------------
// Identity published, but this device has no private key.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The send form, shown only when the identity is ready.
// ---------------------------------------------------------------------------

type SendState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "sent"; recipient: string }
  | { phase: "error"; message: string }
  // The recipient is not on ResearchOS, offer the invite-a-non-user path
  // instead of a dead-end. Carries the address so the offer + invite call use
  // the exact email the lookup rejected.
  | { phase: "offer-invite"; recipient: string }
  | { phase: "inviting"; recipient: string }
  // The out-of-band material (P1-A) the sender must hand the recipient. The
  // branded email is keyless, so the private link / unlock code surface here.
  | {
      phase: "invited";
      recipient: string;
      privateLink: string;
      unlockCode: string;
    };

function SendForm({
  note,
  ownerUsername,
  senderEmail,
  onClose,
}: {
  note: Note;
  ownerUsername: string;
  senderEmail: string | null;
  onClose: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [state, setState] = useState<SendState>({ phase: "idle" });
  // Phase 3 Chunk 3B: the find-and-share modal entry (flag-gated). Lets the
  // sender search by @handle/name instead of typing an email from memory.
  const [findShareOpen, setFindShareOpen] = useState(false);

  // Scan the note's entry bodies for embedded objects once (memoized).
  // The note body lives in note.entries[].content (each entry is a markdown
  // block). We join all entry contents to get the full note markdown, mirroring
  // exactly how buildNoteBundleInput reads it in note-transfer.ts (line 221).
  const deps = useMemo(() => {
    const allMarkdown = (note.entries ?? [])
      .map((e) => e.content ?? "")
      .join("\n");
    return scanNoteDependencies(allMarkdown);
  }, [note]);

  // Dependency selection state: which embeds to include + which datahub rows
  // to send as full dataset. Defaults: all included, no full-data flags.
  const {
    included,
    fullData,
    selectionSets,
    handleToggleIncluded,
    handleToggleFullData,
  } = useDependencySelection(deps);

  const sending = state.phase === "sending";
  const canSend = !sending && senderEmail !== null && looksLikeEmail(recipient);

  const handleSend = useCallback(async () => {
    if (!senderEmail) {
      setState({
        phase: "error",
        message: "Could not send, please try again.",
      });
      return;
    }
    const recipientEmail = recipient.trim();
    setState({ phase: "sending" });
    try {
      const bundle = await buildNoteBundleInput(note, ownerUsername, {
        embedOpts: selectionSets,
      });
      await sendShare({ email: senderEmail, recipientEmail, bundle });
      setState({ phase: "sent", recipient: recipientEmail });
    } catch (err) {
      // Recipient-missing is no longer a dead-end. Both the typed
      // RecipientNotFoundError and a relay 404 mean the person is not on
      // ResearchOS, so we offer the invite-a-non-user path instead of an error.
      if (
        err instanceof RecipientNotFoundError ||
        (err instanceof RelayError && err.status === 404)
      ) {
        setState({ phase: "offer-invite", recipient: recipientEmail });
        return;
      }
      setState({
        phase: "error",
        message: "Could not send, please try again.",
      });
    }
  }, [note, ownerUsername, recipient, senderEmail, selectionSets]);

  // Invite the non-user, seal the note under a one-time key, park it on the
  // relay, and have ResearchOS send the branded email. The title is the only
  // content exposed in the email. On success we show the invited confirmation.
  const handleInvite = useCallback(async () => {
    if (!senderEmail) {
      setState({
        phase: "error",
        message: "Could not invite, please try again.",
      });
      return;
    }
    const recipientEmail = recipient.trim();
    setState({ phase: "inviting", recipient: recipientEmail });
    try {
      const bundle = await buildNoteBundleInput(note, ownerUsername, {
        embedOpts: selectionSets,
      });
      const result = await inviteShare({
        email: senderEmail,
        recipientEmail,
        bundle,
        itemTitle: note.title || "Untitled note",
        senderLabel: senderEmail,
      });
      setState({
        phase: "invited",
        recipient: recipientEmail,
        privateLink: result.privateLink,
        unlockCode: result.unlockCode,
      });
    } catch {
      setState({
        phase: "error",
        message:
          "Could not send the invite. Please try again in a moment.",
      });
    }
  }, [note, ownerUsername, recipient, senderEmail, selectionSets]);

  if (state.phase === "sent") {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center text-center py-2">
          <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-300">
            <CheckGlyph className="w-6 h-6" />
          </div>
          <p className="text-title font-semibold text-foreground mt-3">
            Sent to {state.recipient}
          </p>
          <p className="text-body text-foreground-muted mt-1 leading-relaxed">
            They will see it in their inbox. You sent a copy, so any later edits
            you make stay on your version.
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

  // The recipient is not on ResearchOS. Instead of a dead-end, offer to invite
  // them and share this note. The copy states the lower-assurance trust boundary
  // honestly, the invitation email is keyless and the sender delivers the unlock
  // key out of band (P1-A), so it is a lower-assurance channel than sending to an
  // existing account.
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
              free account. The email holds no key, so it cannot open the note on
              its own. After you send it, ResearchOS gives you a private link and
              an unlock code to pass to {state.recipient} yourself, and the note
              stays encrypted until they open it with that key.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg">
          <span className="text-amber-500 mt-0.5">
            <WarnGlyph className="w-4 h-4" />
          </span>
          <p className="text-meta text-amber-800 dark:text-amber-300 leading-relaxed">
            An invite is a lower-assurance channel than sending to an existing
            account. The unlock key never travels through our relay or the
            invitation email, you deliver it to the recipient over a channel you
            trust. Whoever holds that key can open the note, so send it carefully
            and only invite an address you trust.
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
          Inviting {state.recipient}
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
            They will get an email inviting them to create a free account. The
            note is held encrypted for 30 days.
          </p>
        </div>
        <InviteOutOfBandPanel
          recipient={state.recipient}
          items={[
            { privateLink: state.privateLink, unlockCode: state.unlockCode },
          ]}
        />
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
        <p className="text-meta text-foreground-muted">Sending this note</p>
        <p className="text-body font-medium text-foreground mt-0.5 break-words">
          {note.title || "Untitled note"}
        </p>
      </div>

      <p className="text-body text-foreground-muted leading-relaxed">
        This sends an encrypted copy, a snapshot of the note as it looks now. It
        is not live shared editing, the recipient gets their own copy.
      </p>

      {isFindAndShareEnabled() && senderEmail && (
        <button
          type="button"
          onClick={() => setFindShareOpen(true)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-meta font-semibold text-foreground hover:border-brand-action"
        >
          Find a researcher by name or @handle
        </button>
      )}

      {findShareOpen && senderEmail && (
        <FindAndShareModal
          senderEmail={senderEmail}
          senderLabel={senderEmail}
          itemTitle={note.title || "Untitled note"}
          itemKind="note"
          buildBundle={() =>
            buildNoteBundleInput(note, ownerUsername, { embedOpts: selectionSets })
          }
          onClose={() => setFindShareOpen(false)}
        />
      )}

      <div>
        <label
          htmlFor="send-outside-recipient"
          className="block text-meta font-medium text-foreground mb-1"
        >
          Recipient email
        </label>
        <input
          id="send-outside-recipient"
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

      {/* Dependency panel: shown when the note embeds at least one object (D1/D8). */}
      {deps.length > 0 && (
        <NoteDependencyPanel
          deps={deps}
          included={included}
          fullData={fullData}
          onToggleIncluded={handleToggleIncluded}
          onToggleFullData={handleToggleFullData}
        />
      )}

      {state.phase === "error" && (
        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
          <span className="text-red-500 mt-0.5">
            <WarnGlyph className="w-4 h-4" />
          </span>
          <p className="text-meta text-red-700 dark:text-red-300 leading-relaxed">
            {state.message}
          </p>
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
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG glyphs (no icon library, no emoji). Light-theme local copies that
// match the popup's iconography, currentColor + caller-sized via className.
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
