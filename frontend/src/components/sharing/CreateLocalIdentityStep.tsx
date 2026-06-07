"use client";

// Account creation, the LOCAL-identity path (IDENTITY_OAUTH_ONLY.md, revised
// 2026-06-06). The ACCOUNT is a local keypair, created fully OFFLINE with NO
// OAuth and NO network: mint a keypair, write+seal the sidecar under a fresh
// recovery code (createLocalIdentity), offer an optional passkey for everyday
// unlock, and ALWAYS show the recovery code once. Publishing a findable profile
// (OAuth) is a separate optional step the caller can offer afterwards.
//
// This replaces the SharingSetupWizard as the account-creation surface in the
// shared-folder gate and the create-user paths, which previously forced OAuth
// (unconfigured in dev, off in prod, so no account could be created at all).
//
// Argon2id runs inside createLocalIdentity (heavy, blocking on the main thread),
// so the spinner shown while it runs MUST be CSS-animated and we defer one frame
// before kicking it off so the loading state actually paints.

import { useCallback, useEffect, useRef, useState } from "react";

import { decodePublicKey } from "@/lib/sharing/identity/keys";
import {
  createLocalIdentity,
  enrollPasskeyIntoSidecar,
} from "@/lib/sharing/identity/storage";
import {
  enrollPasskey,
  isPasskeySupported,
  PasskeyCancelledError,
  PasskeyPrfUnavailableError,
} from "@/lib/sharing/identity/webauthn";
import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";
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
}

export default function CreateLocalIdentityStep({
  username,
  onComplete,
  onClose,
}: CreateLocalIdentityStepProps) {
  useEscapeToClose(onClose);

  // The minted recovery code, shown once. Null while keygen runs.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recoverySaved, setRecoverySaved] = useState(false);

  // Passkey enrollment, the everyday unlock. Optional, the recovery code is the
  // backstop and the account works without one.
  const [passkeyEnrolled, setPasskeyEnrolled] = useState(false);
  const [passkeyEnrolling, setPasskeyEnrolling] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  // Mint the identity once, deferred a frame so the CSS spinner paints before
  // Argon2id locks the main thread. The ref guards against Strict Mode's double
  // mount minting two keypairs (the second would overwrite the first's sidecar).
  const creating = useRef(false);
  useEffect(() => {
    if (creating.current) return;
    creating.current = true;
    const id = window.setTimeout(() => {
      void (async () => {
        try {
          const { recoveryCode: code } = await createLocalIdentity(username);
          setRecoveryCode(code);
        } catch {
          setError("Could not create your account. Close and try again.");
        }
      })();
    }, 50);
    return () => window.clearTimeout(id);
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

  // Add a passkey for everyday unlock. The session key is already parked by
  // createLocalIdentity, so enrollPasskeyIntoSidecar can wrap it directly. We
  // read the sidecar's ed25519 public key to seed the WebAuthn user id.
  const enrollPasskeyForIdentity = useCallback(async () => {
    setPasskeyError(null);
    setPasskeyEnrolling(true);
    try {
      const sidecar = await readSharingIdentity(username);
      if (!sidecar) {
        setPasskeyError("Could not read your account. Try again.");
        return;
      }
      const { prfOutput, credentialId } = await enrollPasskey({
        userId: decodePublicKey(sidecar.ed25519PublicKey),
        userName: username,
        userDisplayName: username,
      });
      const ok = await enrollPasskeyIntoSidecar(
        username,
        prfOutput,
        credentialId,
      );
      if (!ok) {
        setPasskeyError("Could not save your passkey. Use your recovery code instead.");
        return;
      }
      setPasskeyEnrolled(true);
    } catch (err) {
      if (err instanceof PasskeyCancelledError) {
        setPasskeyError("Passkey setup was cancelled. You can try again.");
      } else if (err instanceof PasskeyPrfUnavailableError) {
        setPasskeyError(
          "This passkey cannot unlock your key. Use your recovery code instead.",
        );
      } else {
        setPasskeyError(
          "Could not set up a passkey. Use your recovery code instead.",
        );
      }
    } finally {
      setPasskeyEnrolling(false);
    }
  }, [username]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised rounded-2xl shadow-2xl border border-border max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid="create-local-identity"
      >
        <div className="px-6 py-4 border-b border-border flex items-start justify-between">
          <div>
            <h3 className="text-title font-semibold text-foreground">
              Create your account
            </h3>
            <p className="text-meta text-foreground-muted mt-0.5">for {username}</p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-foreground-muted hover:text-foreground"
              aria-label="Close"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </Tooltip>
        </div>

        <div className="px-6 py-5">
          {!recoveryCode ? (
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
            <div className="space-y-4">
              <p className="text-body text-foreground-muted leading-relaxed">
                Your account is a keypair on this device. It works offline, with
                no password and no sign-in. Set up a one-tap unlock and save your
                recovery code below.
              </p>

              {/* Passkey, the everyday unlock. Optional, the recovery code is the
                  backstop and the account works without one. */}
              <div className="rounded-lg border border-border bg-surface-sunken p-3 space-y-2">
                <div className="flex items-center gap-2 text-blue-300">
                  <KeyIcon className="w-5 h-5" />
                  <p className="text-body font-medium text-foreground">One-tap unlock</p>
                </div>
                {isPasskeySupported() ? (
                  passkeyEnrolled ? (
                    <div className="flex items-start gap-2 text-emerald-200">
                      <span className="text-emerald-300 mt-0.5">
                        <CheckIcon className="w-4 h-4" />
                      </span>
                      <p className="text-meta leading-relaxed">
                        Passkey ready. You can unlock on this device, and your
                        synced devices, with no code to type.
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="text-meta text-foreground-muted leading-relaxed">
                        Add a passkey so you can unlock with your fingerprint,
                        face, or device PIN. It syncs through your Google or Apple
                        keychain, so a new device just works.
                      </p>
                      <button
                        type="button"
                        onClick={enrollPasskeyForIdentity}
                        disabled={passkeyEnrolling}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                      >
                        <KeyIcon className="w-3.5 h-3.5" />
                        {passkeyEnrolling
                          ? "Waiting for your passkey…"
                          : "Set up a passkey"}
                      </button>
                    </>
                  )
                ) : (
                  <p className="text-meta text-foreground-muted leading-relaxed">
                    Passkeys are not available in this browser. Your recovery code
                    below is how you unlock on another device.
                  </p>
                )}
                {passkeyError && <ErrorNotice message={passkeyError} />}
              </div>

              <div className="flex items-center gap-2 text-blue-300">
                <KeyIcon className="w-5 h-5" />
                <p className="text-body font-medium text-foreground">
                  Your recovery code
                </p>
              </div>
              <p className="text-body text-foreground-muted leading-relaxed">
                Save this code somewhere safe. It is your backstop if you lose
                your passkey and this device, and the only way to restore your
                account. If you lose it, it cannot be recovered.
              </p>

              <div className="p-3 bg-surface-sunken border border-border rounded-lg">
                <p className="font-mono text-body text-foreground tracking-wide break-all text-center">
                  {recoveryCode}
                </p>
              </div>

              <button
                type="button"
                onClick={copyCode}
                className="flex items-center gap-1.5 text-meta text-blue-400 hover:text-blue-300"
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
                onClick={onComplete}
                disabled={!recoverySaved}
                className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
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
