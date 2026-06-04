"use client";

// Cross-boundary sharing, the standalone METHOD "Share outside this folder"
// send dialog (methods tier).
//
// Sends ONE method to ONE recipient as an encrypted snapshot. A SEPARATE
// component mirroring ExperimentSendOutsideDialog.tsx, the note and experiment
// dialogs must not be edited. The only real differences from the experiment
// dialog are the summary line ("Sending this method") and the payload builder
// (buildMethodSendPayload instead of buildExperimentSendPayload). Methods carry
// their body / structured protocol record inside the same researchos-experiment
// bundle, so the recipient's existing import pipeline reads it unchanged.
//
// COMPOUND methods are deferred. A compound references child methods that would
// each have to ride along and id-remap on import; that is not built yet. When
// the method is compound we show a clear "cannot be shared yet" notice and
// disable Send, never relaying a bundle whose component references would dangle.
//
// Identity gating is the same four-state gate as the experiment / note dialogs
// (useSharingIdentity), launching SharingSetupWizard on "none" and pointing at
// recovery on "needs-restore".

import { useCallback, useState } from "react";

import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import {
  sendRawShare,
  RecipientNotFoundError,
  RelayError,
} from "@/lib/sharing/relay/client";
import {
  buildMethodSendPayload,
  CompoundMethodNotSupportedError,
} from "@/lib/sharing/method-transfer";
import Tooltip from "@/components/Tooltip";
import type { Method } from "@/lib/types";

// A light, permissive email check, only to gate the Send button. The real
// recipient validation is the server-side directory lookup inside sendRawShare.
function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

interface MethodSendOutsideDialogProps {
  /** The method to send. Its current snapshot is what the recipient gets. */
  method: Method;
  /** The folder-local username (export collect context). */
  ownerUsername: string;
  /** Dismiss the dialog. */
  onClose: () => void;
}

export default function MethodSendOutsideDialog({
  method,
  ownerUsername,
  onClose,
}: MethodSendOutsideDialogProps) {
  const identity = useSharingIdentity();
  const [wizardOpen, setWizardOpen] = useState(false);
  const isCompound = method.method_type === "compound";

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
          {isCompound ? (
            <CompoundBody method={method} />
          ) : (
            <>
              {identity.status === "loading" && <LoadingBody />}

              {identity.status === "none" && (
                <NoIdentityBody onSetUp={() => setWizardOpen(true)} />
              )}

              {identity.status === "needs-restore" && <NeedsRestoreBody />}

              {identity.status === "ready" && (
                <SendForm
                  method={method}
                  ownerUsername={ownerUsername}
                  senderEmail={identity.email}
                  onClose={onClose}
                />
              )}
            </>
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

function LoadingBody() {
  return (
    <div className="py-8 flex flex-col items-center text-center">
      <div className="w-9 h-9 rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin" />
      <p className="text-body text-gray-500 mt-4">Checking your sharing setup</p>
    </div>
  );
}

// Compound methods are deferred (methods tier). Their child methods would each
// have to ride along and id-remap on import, which is not built; show a clear
// notice and offer no Send action.
function CompoundBody({ method }: { method: Method }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-amber-500">
          <WarnGlyph className="w-5 h-5" />
        </span>
        <div>
          <p className="text-body font-medium text-gray-900">
            Compound methods cannot be shared yet
          </p>
          <p className="text-body text-gray-600 mt-1 leading-relaxed">
            &ldquo;{method.name || "This method"}&rdquo; is a kit that bundles
            other methods. Sharing a kit across folders also has to send each
            method inside it, which is not supported yet. You can share the
            individual methods on their own for now.
          </p>
        </div>
      </div>
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

type SendState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "sent"; recipient: string }
  | { phase: "error"; message: string };

function SendForm({
  method,
  ownerUsername,
  senderEmail,
  onClose,
}: {
  method: Method;
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
      setState({ phase: "error", message: "Could not send, please try again." });
      return;
    }
    const recipientEmail = recipient.trim();
    setState({ phase: "sending" });
    try {
      // Build the researchos-experiment bundle carrying this one method (its
      // record + body / structured protocol + bundled source PDF), marked
      // kind: "method", and relay the sealed bytes. ownerUsername threads into
      // the build for parity with the experiment path; the method read keys on
      // method.owner.
      const payload = await buildMethodSendPayload(method, ownerUsername);
      await sendRawShare({ email: senderEmail, recipientEmail, payload });
      setState({ phase: "sent", recipient: recipientEmail });
    } catch (err) {
      if (err instanceof CompoundMethodNotSupportedError) {
        setState({
          phase: "error",
          message:
            "Compound methods cannot be shared yet. Share the individual methods inside the kit instead.",
        });
        return;
      }
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
      setState({ phase: "error", message: "Could not send, please try again." });
    }
  }, [method, ownerUsername, recipient, senderEmail]);

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
            They will see it in their inbox and choose how to import it. You sent
            a copy, so any later edits you make stay on your version.
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
        <p className="text-meta text-gray-500">Sending this method</p>
        <p className="text-body font-medium text-gray-900 mt-0.5 break-words">
          {method.name || "Untitled method"}
        </p>
      </div>

      <p className="text-body text-gray-600 leading-relaxed">
        This sends an encrypted copy, a snapshot of the method as it looks now,
        with its protocol and any attached files. It is not live shared editing,
        the recipient gets their own copy.
      </p>

      <div>
        <label
          htmlFor="method-send-outside-recipient"
          className="block text-meta font-medium text-gray-700 mb-1"
        >
          Recipient email
        </label>
        <input
          id="method-send-outside-recipient"
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
          <p className="text-meta text-red-700 leading-relaxed">{state.message}</p>
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
// Inline SVG glyphs (no icon library, no emoji). currentColor + caller-sized.
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
