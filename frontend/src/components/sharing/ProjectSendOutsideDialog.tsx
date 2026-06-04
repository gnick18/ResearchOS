"use client";

// Cross-boundary PROJECT sharing (v1), the "Share outside this folder" send
// dialog (project track).
//
// Sends a WHOLE project to ONE recipient as an encrypted snapshot, a copy of the
// project plus all its experiments, notes, results, files, methods, and the
// in-project experiment links. It mirrors the experiment send dialog's shape and
// copy ("encrypted copy, not live") but builds a `researchos-project` bundle
// (buildProjectSendPayload) sealed and relayed by sendRawShare.
//
// QUOTA. buildProjectSendPayload rejects up front (ProjectTooLargeError) if the
// sealed bundle alone would exceed the recipient's relay budget; the relay route
// is the authoritative backstop. Identity gating is the same four-state gate as
// the experiment dialog (useSharingIdentity).
//
// DEFERRED (design §3, P2). v1 ships the project as one sealed blob, fine for
// small/medium projects. The manifest + per-file-sealing + resumable transport
// for large projects is a Phase B follow-up.

import { useCallback, useEffect, useState } from "react";

import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import {
  sendRawShare,
  inviteRawShare,
  RecipientNotFoundError,
  RelayError,
} from "@/lib/sharing/relay/client";
import {
  buildProjectSendPayload,
  countProjectExperiments,
  ProjectTooLargeError,
} from "@/lib/sharing/project-transfer";
import Tooltip from "@/components/Tooltip";
import type { Project } from "@/lib/types";

function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

interface ProjectSendOutsideDialogProps {
  /** The project to send. Its current snapshot is what the recipient gets. */
  project: Project;
  /** The folder-local username that owns the project (export collect root). */
  ownerUsername: string;
  onClose: () => void;
  /** Unified Share entry point (2026-06-04): render only the inner body (no
   *  overlay, no header) under the UnifiedShareDialog "Outside your lab" tab. */
  embedded?: boolean;
}

export default function ProjectSendOutsideDialog({
  project,
  ownerUsername,
  onClose,
  embedded = false,
}: ProjectSendOutsideDialogProps) {
  const identity = useSharingIdentity();
  const [wizardOpen, setWizardOpen] = useState(false);

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
          project={project}
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

  if (embedded) return body;

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
              Send an encrypted copy of this project to someone on ResearchOS
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

        <div className="px-5 py-5 overflow-y-auto">{body}</div>
      </div>
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
  | { phase: "error"; message: string }
  // The recipient is not on ResearchOS, offer the invite-a-non-user path instead
  | { phase: "offer-invite"; recipient: string }
  | { phase: "inviting"; recipient: string }
  | { phase: "invited"; recipient: string };

function SendForm({
  project,
  ownerUsername,
  senderEmail,
  onClose,
}: {
  project: Project;
  ownerUsername: string;
  senderEmail: string | null;
  onClose: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [state, setState] = useState<SendState>({ phase: "idle" });
  const [expCount, setExpCount] = useState<number | null>(null);

  // Best-effort experiment count for the summary line. Failure is non-blocking.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const n = await countProjectExperiments(project);
        if (!cancelled) setExpCount(n);
      } catch {
        /* leave null */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

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
      const payload = await buildProjectSendPayload(project, ownerUsername);
      await sendRawShare({ email: senderEmail, recipientEmail, payload });
      setState({ phase: "sent", recipient: recipientEmail });
    } catch (err) {
      // Surface the real cause, the generic fallback below otherwise swallows it.
      console.error("[sharing] project send failed:", err);
      if (err instanceof ProjectTooLargeError) {
        setState({
          phase: "error",
          message:
            "This project is too large to share right now. Large-project sharing (streamed in pieces) is coming soon.",
        });
        return;
      }
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
      if (err instanceof RelayError && err.status === 413) {
        setState({
          phase: "error",
          message:
            "This project would exceed the recipient's available relay space. Ask them to clear some pending shared items, then try again.",
        });
        return;
      }
      setState({ phase: "error", message: "Could not send, please try again." });
    }
  }, [project, ownerUsername, recipient, senderEmail]);

  // Invite the non-user, seal the project bundle under a one-time key, park it on
  // the relay, and have ResearchOS send the branded email. The title is the only
  // content exposed in the email. Mirrors the note dialog's invite. The same
  // over-budget guards as the registered send apply (a project that does not fit
  // the relay budget cannot be invited either).
  const handleInvite = useCallback(async () => {
    if (!senderEmail) {
      setState({ phase: "error", message: "Could not invite, please try again." });
      return;
    }
    const recipientEmail = recipient.trim();
    setState({ phase: "inviting", recipient: recipientEmail });
    try {
      const payload = await buildProjectSendPayload(project, ownerUsername);
      await inviteRawShare({
        email: senderEmail,
        recipientEmail,
        payload,
        itemTitle: project.name || "Untitled project",
        senderLabel: senderEmail,
        itemKind: "project",
      });
      setState({ phase: "invited", recipient: recipientEmail });
    } catch (err) {
      if (err instanceof ProjectTooLargeError) {
        setState({
          phase: "error",
          message:
            "This project is too large to share right now. Large-project sharing (streamed in pieces) is coming soon.",
        });
        return;
      }
      if (err instanceof RelayError && err.status === 413) {
        setState({
          phase: "error",
          message:
            "This project would exceed the available relay space for this invite. Try a smaller project for now.",
        });
        return;
      }
      setState({
        phase: "error",
        message: "Could not send the invite. Please try again in a moment.",
      });
    }
  }, [project, ownerUsername, recipient, senderEmail]);

  // The recipient is not on ResearchOS. Instead of a dead-end, offer to invite
  // them and share this project. The copy states the lower-assurance trust
  // boundary honestly, an invite sends the unlock key in the email link.
  if (state.phase === "offer-invite") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-blue-500">
            <MailGlyph className="w-5 h-5" />
          </span>
          <div>
            <p className="text-body font-medium text-gray-900">
              {state.recipient} is not on ResearchOS yet
            </p>
            <p className="text-body text-gray-600 mt-1 leading-relaxed">
              ResearchOS can email them an invitation with a private link to this
              project. They create a free account to open it, the project stays
              encrypted until they do.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-amber-500 mt-0.5">
            <WarnGlyph className="w-4 h-4" />
          </span>
          <p className="text-meta text-amber-800 leading-relaxed">
            An invite is a lower-assurance channel than sending to an existing
            account. The unlock key travels in the email link, so anyone who can
            read that email can open the project. Only invite an address you trust.
          </p>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setState({ phase: "idle" })}
            className="flex-1 py-2 text-body rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleInvite}
            className="flex-1 py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
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
        <div className="w-9 h-9 rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin" />
        <p className="text-body text-gray-500 mt-4">Inviting {state.recipient}</p>
      </div>
    );
  }

  if (state.phase === "invited") {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center text-center py-2">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
            <CheckGlyph className="w-6 h-6" />
          </div>
          <p className="text-title font-semibold text-gray-900 mt-3">
            We have invited {state.recipient}
          </p>
          <p className="text-body text-gray-600 mt-1 leading-relaxed">
            They will get an email with a private link to this project. Once they
            create a free account and open it, it lands in their workspace as a
            new project. The project is held encrypted for 30 days.
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
            They will see it in their inbox and choose to import it as a new
            project. You sent a copy, so any later edits you make stay on your
            version.
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
        <p className="text-meta text-gray-500">Sending this project</p>
        <p className="text-body font-medium text-gray-900 mt-0.5 break-words">
          {project.name || "Untitled project"}
        </p>
        {expCount !== null && (
          <p className="text-meta text-gray-500 mt-0.5">
            {expCount} experiment{expCount === 1 ? "" : "s"}
          </p>
        )}
      </div>

      <p className="text-body text-gray-600 leading-relaxed">
        This sends an encrypted copy, a snapshot of the project as it looks now,
        with its experiments, notes, results, files, and methods. It is not live
        shared editing, the recipient gets their own copy as a new project.
      </p>

      <div>
        <label
          htmlFor="project-send-outside-recipient"
          className="block text-meta font-medium text-gray-700 mb-1"
        >
          Recipient email
        </label>
        <input
          id="project-send-outside-recipient"
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
          {sending ? "Sending…" : "Send"}
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
