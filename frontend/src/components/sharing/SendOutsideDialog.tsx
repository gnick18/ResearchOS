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

import { useCallback, useState } from "react";

import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import {
  sendShare,
  RecipientNotFoundError,
  RelayError,
} from "@/lib/sharing/relay/client";
import { buildNoteBundleInput } from "@/lib/sharing/note-transfer";
import Tooltip from "@/components/Tooltip";
import type { Note } from "@/lib/types";

interface SendOutsideDialogProps {
  /** The note to send. Its current snapshot is what the recipient receives. */
  note: Note;
  /** The folder-local username that owns the note (the bundle's collect root). */
  ownerUsername: string;
  /** Dismiss the dialog. */
  onClose: () => void;
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
}: SendOutsideDialogProps) {
  const identity = useSharingIdentity();

  // When the user has no identity yet we launch the setup wizard inline. Once it
  // completes we refresh the gate so the body re-renders into the send form.
  const [wizardOpen, setWizardOpen] = useState(false);

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
        className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between">
          <div>
            <h3 className="text-title font-semibold text-gray-900">
              Share outside this folder
            </h3>
            <p className="text-meta text-gray-500 mt-0.5">
              Send an encrypted copy to someone on ResearchOS
            </p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
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
              note={note}
              ownerUsername={ownerUsername}
              senderEmail={identity.email}
              onClose={onClose}
            />
          )}
        </div>
      </div>

      {wizardOpen && (
        <SharingSetupWizard
          username={ownerUsername}
          onComplete={handleWizardComplete}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading.
// ---------------------------------------------------------------------------

function LoadingBody() {
  return (
    <div className="py-8 flex flex-col items-center text-center">
      <div className="w-9 h-9 rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin" />
      <p className="text-body text-gray-500 mt-4">Checking your sharing setup</p>
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
          <p className="text-body font-medium text-gray-900">
            Set up sharing to send this outside your lab
          </p>
          <p className="text-body text-gray-600 mt-1 leading-relaxed">
            Sending across folders needs a one-time setup that proves your email
            and generates a keypair, so your copy stays private end to end. It
            takes a minute and you only do it once.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onSetUp}
        className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
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
          <p className="text-body font-medium text-gray-900">
            Restore your key on this device first
          </p>
          <p className="text-body text-gray-600 mt-1 leading-relaxed">
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
  | { phase: "error"; message: string };

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
      const bundle = await buildNoteBundleInput(note, ownerUsername);
      await sendShare({ email: senderEmail, recipientEmail, bundle });
      setState({ phase: "sent", recipient: recipientEmail });
    } catch (err) {
      // Recipient-missing is the one error worth its own message. Both the typed
      // RecipientNotFoundError and a relay 404 mean the same thing to the user,
      // the person they typed has not set up sharing.
      if (
        err instanceof RecipientNotFoundError ||
        (err instanceof RelayError && err.status === 404)
      ) {
        setState({
          phase: "error",
          message:
            "That email is not on ResearchOS yet. Cross-boundary sharing only works between people who have set up sharing.",
        });
        return;
      }
      setState({
        phase: "error",
        message: "Could not send, please try again.",
      });
    }
  }, [note, ownerUsername, recipient, senderEmail]);

  if (state.phase === "sent") {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center text-center py-2">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
            <CheckGlyph className="w-6 h-6" />
          </div>
          <p className="text-title font-semibold text-gray-900 mt-3">
            Sent to {state.recipient}
          </p>
          <p className="text-body text-gray-600 mt-1 leading-relaxed">
            They will see it in their inbox. You sent a copy, so any later edits
            you make stay on your version.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
        <p className="text-meta text-gray-500">Sending this note</p>
        <p className="text-body font-medium text-gray-900 mt-0.5 break-words">
          {note.title || "Untitled note"}
        </p>
      </div>

      <p className="text-body text-gray-600 leading-relaxed">
        This sends an encrypted copy, a snapshot of the note as it looks now. It
        is not live shared editing, the recipient gets their own copy.
      </p>

      <div>
        <label
          htmlFor="send-outside-recipient"
          className="block text-meta font-medium text-gray-700 mb-1"
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
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-body text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60"
        />
      </div>

      {state.phase === "error" && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <span className="text-red-500 mt-0.5">
            <WarnGlyph className="w-4 h-4" />
          </span>
          <p className="text-meta text-red-700 leading-relaxed">
            {state.message}
          </p>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={sending}
          className="flex-1 py-2 text-body rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="flex-1 py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? "Sending..." : "Send"}
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
