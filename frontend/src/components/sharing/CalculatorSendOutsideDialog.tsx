"use client";

// Cross-boundary sharing, the standalone CUSTOM CALCULATOR "Share outside this
// folder" send dialog (calculators tier, the simplest tier alongside sequences).
//
// Sends ONE calculator to ONE recipient as an encrypted snapshot. A SEPARATE
// component mirroring SequenceSendOutsideDialog.tsx, the note / experiment /
// method / sequence dialogs must not be edited. A calculator is self-contained,
// just its spec plus a little meta, with no attachments and no lineage, so this
// is one of the smallest dialogs, no compound / cannot-share state, just the
// identity gate plus the send / invite paths. The only real differences from the
// sequence dialog are the summary line and the payload builder
// (buildCalculatorSendPayload).
//
// Identity gating is the same four-state gate as the other dialogs
// (useSharingIdentity), launching SharingSetupWizard on "none" and pointing at
// recovery on "needs-restore". On RecipientNotFound it offers the same
// invite-a-non-user path the other dialogs use.
//
// Icons go through <Icon> from @/components/icons (no hand-rolled inline SVG,
// the icon-guard hook blocks new inline icon markup under src/).

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
import { buildCalculatorSendPayload } from "@/lib/sharing/calculator-transfer";
import InviteOutOfBandPanel from "@/components/sharing/InviteOutOfBandPanel";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import type { CustomCalculator } from "@/lib/types";

// A light, permissive email check, only to gate the Send button. The real
// recipient validation is the server-side directory lookup inside sendRawShare.
function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

interface CalculatorSendOutsideDialogProps {
  /** The calculator to send. Its current snapshot is what the recipient gets. */
  calculator: CustomCalculator;
  /** The folder-local username (sender identity context). */
  ownerUsername: string;
  /** Dismiss the dialog. */
  onClose: () => void;
}

export default function CalculatorSendOutsideDialog({
  calculator,
  ownerUsername,
  onClose,
}: CalculatorSendOutsideDialogProps) {
  const identity = useSharingIdentity();
  const [wizardOpen, setWizardOpen] = useState(false);

  useEscapeToClose(onClose, true);

  const handleWizardComplete = useCallback(async () => {
    setWizardOpen(false);
    await identity.refresh();
  }, [identity]);

  const body = (
    <>
      {identity.status === "loading" && <LoadingBody />}

      {identity.status === "none" && (
        <NoIdentityBody onSetUp={() => setWizardOpen(true)} />
      )}

      {identity.status === "needs-restore" && <NeedsRestoreBody />}

      {identity.status === "ready" && (
        <SendForm
          calculator={calculator}
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

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]"
      onClick={onClose}
    >
      <div
        className="bg-surface-overlay border border-border rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
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
              className="text-foreground-muted hover:text-foreground"
              aria-label="Close"
            >
              <Icon name="close" className="w-5 h-5" />
            </button>
          </Tooltip>
        </div>

        <div className="px-5 py-5 overflow-y-auto">{body}</div>
      </div>
    </div>
  );
}

function LoadingBody() {
  return (
    <div className="py-8 flex flex-col items-center text-center">
      <div className="w-9 h-9 rounded-full border-2 border-border border-t-sky-500 animate-spin" />
      <p className="text-body text-foreground-muted mt-4">Checking your sharing setup</p>
    </div>
  );
}

function NoIdentityBody({ onSetUp }: { onSetUp: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-sky-500">
          <Icon name="lock" className="w-5 h-5" />
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
        className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 w-full py-2 text-body font-medium"
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
          <Icon name="alert" className="w-5 h-5" />
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
  | { phase: "sending" }
  | { phase: "sent"; recipient: string }
  | { phase: "error"; message: string }
  // The recipient is not on ResearchOS, offer the invite-a-non-user path instead
  // of a dead-end. Carries the address so the offer + invite call use the exact
  // email the lookup rejected. Mirrors the sequence dialog.
  | { phase: "offer-invite"; recipient: string }
  | { phase: "inviting"; recipient: string }
  // The out-of-band material (P1-A) the sender must hand the recipient.
  | {
      phase: "invited";
      recipient: string;
      privateLink: string;
      unlockCode: string;
    };

function SendForm({
  calculator,
  ownerUsername,
  senderEmail,
  onClose,
}: {
  calculator: CustomCalculator;
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
      // Build the small JSON envelope carrying this calculator's spec + the meta
      // the recipient needs, marked kind: "calculator", and relay the sealed
      // bytes. ownerUsername is read to stamp the verified sender block.
      const payload = await buildCalculatorSendPayload(calculator, ownerUsername);
      await sendRawShare({
        email: senderEmail,
        recipientEmail,
        payload,
        kind: "calculator",
      });
      setState({ phase: "sent", recipient: recipientEmail });
    } catch (err) {
      // Recipient-missing is not a dead-end. Both the typed RecipientNotFoundError
      // and a relay 404 mean the person is not on ResearchOS, so we offer the
      // invite-a-non-user path instead of an error.
      if (
        err instanceof RecipientNotFoundError ||
        (err instanceof RelayError && err.status === 404)
      ) {
        setState({ phase: "offer-invite", recipient: recipientEmail });
        return;
      }
      setState({ phase: "error", message: "Could not send, please try again." });
    }
  }, [calculator, ownerUsername, recipient, senderEmail]);

  // Invite the non-user, seal the calculator envelope under a one-time key, park
  // it on the relay, and have ResearchOS send the branded email. The title is the
  // only content exposed in the email. Mirrors the sequence dialog's invite.
  const handleInvite = useCallback(async () => {
    if (!senderEmail) {
      setState({ phase: "error", message: "Could not invite, please try again." });
      return;
    }
    const recipientEmail = recipient.trim();
    setState({ phase: "inviting", recipient: recipientEmail });
    try {
      const payload = await buildCalculatorSendPayload(calculator, ownerUsername);
      const result = await inviteRawShare({
        email: senderEmail,
        recipientEmail,
        payload,
        itemTitle: calculator.name || "Untitled calculator",
        senderLabel: senderEmail,
        itemKind: "calculator",
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
        message: "Could not send the invite. Please try again in a moment.",
      });
    }
  }, [calculator, ownerUsername, recipient, senderEmail]);

  // The recipient is not on ResearchOS. Instead of a dead-end, offer to invite
  // them and share this calculator. The copy states the lower-assurance trust
  // boundary honestly, the invitation email is keyless and the sender delivers
  // the unlock key out of band (P1-A).
  if (state.phase === "offer-invite") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-sky-500">
            <Icon name="share" className="w-5 h-5" />
          </span>
          <div>
            <p className="text-body font-medium text-foreground">
              {state.recipient} is not on ResearchOS yet
            </p>
            <p className="text-body text-foreground-muted mt-1 leading-relaxed">
              ResearchOS emails {state.recipient} a branded invitation to create
              a free account. The email holds no key, so it cannot open the
              calculator on its own. After you send it, ResearchOS gives you a
              private link and an unlock code to pass to {state.recipient}
              yourself, and the calculator stays encrypted until they open it
              with that key.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-500/30 rounded-lg">
          <span className="text-amber-500 mt-0.5">
            <Icon name="alert" className="w-4 h-4" />
          </span>
          <p className="text-meta text-amber-800 dark:text-amber-300 leading-relaxed">
            An invite is a lower-assurance channel than sending to an existing
            account. The unlock key never travels through our relay or the
            invitation email, you deliver it to the recipient over a channel you
            trust. Whoever holds that key can open the calculator, so send it
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
            className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 flex-1 py-2 text-body font-medium"
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
        <div className="w-9 h-9 rounded-full border-2 border-border border-t-sky-500 animate-spin" />
        <p className="text-body text-foreground-muted mt-4">Inviting {state.recipient}</p>
      </div>
    );
  }

  if (state.phase === "invited") {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center text-center py-2">
          <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-300">
            <Icon name="check" className="w-6 h-6" />
          </div>
          <p className="text-title font-semibold text-foreground mt-3">
            We have invited {state.recipient}
          </p>
          <p className="text-body text-foreground-muted mt-1 leading-relaxed">
            They will get an email inviting them to create a free account. The
            calculator is held encrypted for 30 days.
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
          className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 w-full py-2 text-body font-medium"
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
            <Icon name="check" className="w-6 h-6" />
          </div>
          <p className="text-title font-semibold text-foreground mt-3">
            Sent to {state.recipient}
          </p>
          <p className="text-body text-foreground-muted mt-1 leading-relaxed">
            They will see it in their inbox and can save it in one click. You sent
            a copy, so any later edits you make stay on your version.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 w-full py-2 text-body font-medium"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface-sunken border border-border rounded-lg px-3 py-2.5">
        <p className="text-meta text-foreground-muted">Sending this calculator</p>
        <p className="text-body font-medium text-foreground mt-0.5 break-words">
          {calculator.name || "Untitled calculator"}
        </p>
      </div>

      <p className="text-body text-foreground-muted leading-relaxed">
        This sends an encrypted copy, a snapshot of the calculator as it is now,
        its inputs, steps, and outputs. It is not live shared editing, the
        recipient gets their own copy to run and edit.
      </p>

      <div>
        <label
          htmlFor="calculator-send-outside-recipient"
          className="block text-meta font-medium text-foreground mb-1"
        >
          Recipient email
        </label>
        <input
          id="calculator-send-outside-recipient"
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
          className="w-full px-3 py-2 border border-border rounded-lg text-body text-foreground placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400 disabled:opacity-60"
        />
      </div>

      {state.phase === "error" && (
        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
          <span className="text-red-500 mt-0.5">
            <Icon name="alert" className="w-4 h-4" />
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
          className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 flex-1 py-2 text-body font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
