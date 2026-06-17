"use client";

// Account creation, the LOCAL-identity path (IDENTITY_OAUTH_ONLY.md, revised
// 2026-06-06). The ACCOUNT is a local keypair, created fully OFFLINE with NO
// OAuth and NO network: mint a keypair, write+seal the sidecar under a fresh
// recovery code (createLocalIdentity), and show the recovery code once so the
// user can save it. Publishing a findable profile (OAuth) is a separate optional
// step the caller can offer afterwards.
//
// This replaces the SharingSetupWizard as the account-creation surface in the
// shared-folder gate and the create-user paths, which previously forced OAuth
// (unconfigured in dev, off in prod, so no account could be created at all).
//
// Argon2id runs inside createLocalIdentity (heavy, blocking on the main thread),
// so the spinner shown while it runs MUST be CSS-animated and we defer one frame
// before kicking it off so the loading state actually paints.

import { useCallback, useEffect, useRef, useState } from "react";

import { usePopupLayer } from "@/lib/ui/popup-stack";

import {
  confirmRecoveryInSidecar,
  createLocalIdentity,
} from "@/lib/sharing/identity/storage";
import { recordAgreementAcceptance } from "@/lib/lab/agreement-acceptance";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import Tooltip from "@/components/Tooltip";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  KeyIcon,
  WarningIcon,
} from "./icons";

interface CreateLocalIdentityStepProps {
  /** The folder-local username this identity belongs to. */
  username: string;
  /**
   * Called once the account is created and the user has confirmed they saved the
   * recovery code. The caller then signs the user in (the unlocked key is already
   * parked in the session by createLocalIdentity).
   */
  onComplete: () => void;
  /**
   * Dismiss without finishing. The caller decides what backing out means (the
   * shared-folder gate returns to the picker; the optional path enters the app).
   * NOTE: by the time the recovery code is on screen the account already EXISTS
   * (the keypair is minted and sealed); closing does not undo that.
   */
  onClose: () => void;
  /**
   * When true the close button and backdrop dismissal are hidden and Escape is
   * suppressed, forcing the user to confirm they saved their recovery code before
   * continuing. Use in contexts where the account is mandatory (shared/lab folders)
   * so the user cannot skip seeing the recovery code.
   */
  required?: boolean;
  /**
   * Lab membership agreement to present BEFORE finishing (LAB_ARCHIVE_CONTINUITY
   * .md). When set (the joined folder has a lab head with an enabled agreement
   * this user has not accepted), an agreement step follows the recovery-code
   * step: the user must accept before onComplete, and the acceptance is recorded
   * to their folder. Null/absent skips it (the default).
   */
  agreement?: { text: string; version: number; labHead: string } | null;
}

export default function CreateLocalIdentityStep({
  username,
  onComplete,
  onClose,
  required = false,
  agreement = null,
}: CreateLocalIdentityStepProps) {
  useEscapeToClose(onClose, !required);

  // Account creation is a big, attention-demanding step, so it wants blur. But
  // it frequently opens ON TOP of another popup (the profile modal, the sharing
  // wizard), so it registers with the shared popup stack and only blurs when it
  // is the bottom-most blur layer. That stops the muddy double-blur where its
  // own backdrop-blur compounded on the popup already blurring behind it.
  const { shouldBlur, shouldDim } = usePopupLayer(true, true);

  // The minted recovery code, shown once. Null while keygen runs.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recoverySaved, setRecoverySaved] = useState(false);
  // Agreement step (shown after the recovery code when an agreement is passed).
  const [showAgreement, setShowAgreement] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);

  // Mint the identity once, deferred a frame so the CSS spinner paints before
  // Argon2id locks the main thread. StrictMode-safe: a LOCAL cancelled flag, not
  // a persistent ref. Under React Strict Mode the first mount's cleanup cancels
  // its own (still-pending) timeout, and the second mount schedules + runs the
  // real one. A persistent ref guard here is the classic footgun, the cleanup
  // clears the only scheduled run and the second mount skips it, so the spinner
  // hangs forever. Only the surviving mount's timeout fires, so the keypair is
  // still minted exactly once (no double-mint).
  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      void (async () => {
        try {
          const { recoveryCode: code } = await createLocalIdentity(username);
          if (!cancelled) setRecoveryCode(code);
        } catch {
          if (!cancelled) {
            setError("Could not create your account. Close and try again.");
          }
        }
      })();
    }, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [username]);

  const copyCode = useCallback(async () => {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [recoveryCode]);

  // Stamp recoveryConfirmedAt in the sidecar before handing off to the caller,
  // so SharingSection and any lab gate can trust the field is set.
  const completing = useRef(false);
  // Continue from the recovery-code step. Stamps the sidecar, then either shows
  // the agreement step (when one was passed) or finishes.
  const handleContinueFromRecovery = useCallback(async () => {
    try {
      await confirmRecoveryInSidecar(username);
    } catch {
      // best-effort: sidecar stamp failure must not block entry
    }
    if (agreement) {
      setShowAgreement(true);
      return;
    }
    onComplete();
  }, [username, agreement, onComplete]);

  // Accept the agreement, record it to the member's folder, then finish.
  const handleAcceptAgreement = useCallback(async () => {
    if (!agreement || completing.current) return;
    completing.current = true;
    try {
      await recordAgreementAcceptance(username, agreement.version, agreement.labHead);
    } catch {
      // best-effort: a failed record must not trap the user out of their folder
    }
    onComplete();
  }, [username, agreement, onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center ${
        shouldDim ? "bg-black/50" : ""
      } ${shouldBlur ? "backdrop-blur-sm" : ""}`}
      onClick={required ? undefined : onClose}
    >
      <div
        className="bg-surface-raised rounded-2xl ros-popup-card-shadow border border-border max-w-3xl w-full mx-4 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid="create-local-identity"
      >
        <div className="px-6 py-4 border-b border-border flex items-start justify-between shrink-0">
          <div>
            <h3 className="text-title font-semibold text-foreground">
              Create your account
            </h3>
            <p className="text-meta text-foreground-muted mt-0.5">for {username}</p>
          </div>
          {required ? (
            // Even when an account is required, never hard-trap the user on this
            // step (loading, error, or recovery-code). This always-visible
            // escape backs out to the account picker, the account may already be
            // minted, which is fine; onClose just returns there. The primary
            // "Continue" still gates on confirming the recovery code, so this is
            // a deliberate back-out, not the default path.
            <button
              type="button"
              onClick={onClose}
              className="text-meta font-medium text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
            >
              Back to accounts
            </button>
          ) : (
            <Tooltip label="Close" placement="bottom">
              <button
                onClick={onClose}
                className="text-foreground-muted hover:text-foreground"
                aria-label="Close"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </Tooltip>
          )}
        </div>

        <div className="px-6 py-5 flex-1 overflow-y-auto">
          {showAgreement && agreement ? (
            <div className="space-y-5">
              <div>
                <h4 className="text-body font-medium text-foreground">
                  Lab membership agreement
                </h4>
                <p className="text-meta text-foreground-muted mt-0.5">
                  Please read and accept this to join the lab.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface-sunken p-4 max-h-64 overflow-y-auto">
                <p className="text-meta text-foreground whitespace-pre-wrap leading-relaxed">
                  {agreement.text}
                </p>
              </div>
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={agreementAccepted}
                  onChange={(e) => setAgreementAccepted(e.target.checked)}
                  className="mt-0.5 accent-blue-500"
                  data-testid="agreement-accept"
                />
                <span className="text-body text-foreground-muted leading-relaxed">
                  I have read and accept this agreement.
                </span>
              </label>
              {error && <ErrorNotice message={error} />}
              <button
                type="button"
                onClick={() => void handleAcceptAgreement()}
                disabled={!agreementAccepted}
                className="ros-btn-raise w-full py-2.5 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white disabled:opacity-50"
                data-testid="agreement-continue"
              >
                Accept and continue
              </button>
            </div>
          ) : !recoveryCode ? (
            <div className="py-8 flex flex-col items-center text-center">
              <div className="w-10 h-10 rounded-full border-2 border-border border-t-blue-500 animate-spin" />
              <p className="text-body text-foreground-muted mt-4 font-medium">
                Creating your account
              </p>
              <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
                This runs once and can take a few seconds. The app may pause
                briefly while it works.
              </p>
              {error && (
                <div className="mt-4 w-full">
                  <ErrorNotice message={error} />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-body text-foreground-muted leading-relaxed">
                Your account is a keypair on this device. It works offline, with
                no password and no sign-in. Save your recovery code -- it is the
                only way to restore your account on another device.
              </p>

              <div className="rounded-lg border border-border bg-surface-sunken p-4 space-y-2">
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                  <KeyIcon className="w-5 h-5" />
                  <p className="text-body font-medium text-foreground">
                    Your recovery code
                  </p>
                </div>
                <p className="text-meta text-foreground-muted leading-relaxed">
                  Save this somewhere safe. It is the only way to restore your
                  account on another device. If you lose it, it cannot be
                  recovered.
                </p>
                <div className="p-3 bg-surface border border-border rounded-lg">
                  <p className="font-mono text-body text-foreground tracking-wide break-all text-center">
                    {recoveryCode}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copyCode}
                  className="flex items-center gap-1.5 text-meta text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {copied ? (
                    <>
                      <CheckIcon className="w-3.5 h-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <CopyIcon className="w-3.5 h-3.5" />
                      Copy code
                    </>
                  )}
                </button>
              </div>

              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={recoverySaved}
                  onChange={(e) => setRecoverySaved(e.target.checked)}
                  className="mt-0.5 accent-blue-500"
                  data-testid="create-recovery-saved"
                />
                <span className="text-body text-foreground-muted leading-relaxed">
                  I have saved my recovery code somewhere safe.
                </span>
              </label>

              {error && <ErrorNotice message={error} />}

              <button
                type="button"
                onClick={() => void handleContinueFromRecovery()}
                disabled={!recoverySaved}
                className="ros-btn-raise w-full py-2.5 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white disabled:opacity-50"
                data-testid="create-local-identity-continue"
              >
                Continue
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 p-2 bg-red-500/15 border border-red-500/30 rounded-lg">
      <span className="text-red-300 mt-0.5">
        <WarningIcon className="w-4 h-4" />
      </span>
      <p className="text-meta text-red-300 leading-relaxed">{message}</p>
    </div>
  );
}
