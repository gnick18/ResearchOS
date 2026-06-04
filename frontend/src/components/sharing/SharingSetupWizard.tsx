"use client";

// Cross-boundary sharing, the identity setup wizard (Phase 1c-i, claim-flow UI).
//
// One-time setup that turns a folder-local account into a globally addressable
// sharing identity. It walks the user through proving an email (OAuth or a
// 6-digit code), generating a keypair, saving Recovery Words, and publishing the
// public keys to the directory. Everything security-sensitive lives in pure
// helpers we only orchestrate here (createIdentityMaterial, buildBindRequest),
// and we never touch private keys beyond stashing them in IndexedDB.
//
// This is the first user-facing piece of the feature. It is wired into nothing
// but the dev test route for now (sign-in-to-unlock and identity badges land
// separately). Do not wire this into existing UI.

import { useCallback, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";

import {
  buildBindRequest,
  createIdentityMaterial,
  type BindRequestBody,
  type IdentityMaterial,
} from "@/lib/sharing/identity/setup";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { generateDeviceSalt } from "@/lib/sharing/identity/backup";
import { saveIdentity } from "@/lib/sharing/identity/storage";
import {
  writeSharingIdentity,
  type SharingIdentitySidecar,
} from "@/lib/sharing/identity/sidecar";
import { canonicalizeEmail } from "@/lib/sharing/directory/email";
import Tooltip from "@/components/Tooltip";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  GitHubIcon,
  GoogleIcon,
  KeyIcon,
  MailIcon,
  WarningIcon,
} from "./icons";

interface SharingSetupWizardProps {
  /** The folder-local username this identity is claimed for. */
  username: string;
  /** Called once the directory publish succeeds (local link best-effort). */
  onComplete: (result: { fingerprint: string }) => void;
  /** Dismiss the wizard without finishing. */
  onClose: () => void;
}

// The query flag the OAuth callbackUrl carries so we know the page reloaded
// through the provider redirect and should resume mid-wizard.
const CLAIM_QUERY_PARAM = "sharingClaim";

type Step =
  | "choose" // pick a verification method
  | "email-enter" // type the email, request a code
  | "email-code" // type the 6-digit code
  | "generate" // run the (heavy) keygen, show Recovery Words
  | "publish" // posting to the directory
  | "done"; // finished

// Whether the email-bind path or the oauth-bind path was used, so the publish
// step knows which directory route to call.
type VerifiedVia = "google" | "github" | "email" | null;

export default function SharingSetupWizard({
  username,
  onComplete,
  onClose,
}: SharingSetupWizardProps) {
  const [step, setStep] = useState<Step>("choose");
  const [verifiedVia, setVerifiedVia] = useState<VerifiedVia>(null);

  // Email subflow state.
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  // Generated identity material, held only in memory for the life of the
  // wizard. Private keys go to IndexedDB at publish, never to React devtools-
  // friendly serialized state beyond this object.
  const [material, setMaterial] = useState<IdentityMaterial | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Result + error surfaces.
  const [error, setError] = useState<string | null>(null);
  const [localLinkFailed, setLocalLinkFailed] = useState(false);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  // OAuth-redirect resume. When the page comes back from Google or GitHub it
  // carries ?sharingClaim=1 in the URL and a signed-in session. If both hold we
  // jump straight to the generate step with the OAuth-verified email, then strip
  // the query param so a manual refresh does not re-resume. We read the email by
  // fetching the session endpoint (no SessionProvider needed). No ref guard, in
  // React Strict Mode the first mount is cancelled by its cleanup, so a ref that
  // persisted across the remount would block the real (second) attempt.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(CLAIM_QUERY_PARAM) !== "1") return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", {
          headers: { accept: "application/json" },
        });
        const session = (await res.json()) as {
          user?: { email?: string | null } | null;
        } | null;
        const sessionEmail = session?.user?.email;
        if (cancelled) return;
        if (sessionEmail) {
          setEmail(sessionEmail);
          // We cannot tell Google from GitHub from the session alone, and the
          // oauth-bind route ignores the provider, so "google" stands in for
          // "verified via OAuth" on the publish branch.
          setVerifiedVia("google");
          setStep("generate");
          // Strip the flag only AFTER a successful resume, so a later refresh
          // does not re-run keygen. We deliberately do NOT strip on a cancelled
          // or failed run, so Strict Mode's second mount still gets a real try.
          url.searchParams.delete(CLAIM_QUERY_PARAM);
          window.history.replaceState(
            null,
            "",
            url.pathname + url.search + url.hash,
          );
        }
      } catch {
        // A failed session read just leaves the user on the choose step, a safe
        // place to retry from.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startOAuth = useCallback((provider: "google" | "github") => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set(CLAIM_QUERY_PARAM, "1");
    // Send the user back to wherever the wizard is mounted, with the resume flag.
    void signIn(provider, { callbackUrl: url.pathname + url.search + url.hash });
  }, []);

  const requestCode = useCallback(async () => {
    setError(null);
    const canonical = canonicalizeEmail(email);
    if (!canonical || !canonical.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setEmailBusy(true);
    try {
      const res = await fetch("/api/directory/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: canonical }),
      });
      if (res.status === 429) {
        setError("Too many attempts. Wait a minute, then try again.");
        return;
      }
      if (!res.ok) {
        setError("Could not send the code. Check the address and try again.");
        return;
      }
      setVerifiedVia("email");
      setStep("email-code");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setEmailBusy(false);
    }
  }, [email]);

  // Step 3, generate the identity. createIdentityMaterial runs Argon2id, which
  // is a heavy one-to-a-few-second BLOCKING step on the main thread, so the
  // spinner shown while we are here MUST be CSS-animated (a JS rAF spinner would
  // freeze with the thread). FOLLOW-UP, move createIdentityMaterial into a Web
  // Worker so keygen does not jank the UI at all (tracked, deferred).
  const generating = useRef(false);
  useEffect(() => {
    if (step !== "generate") return;
    if (material) return; // already generated, do not regenerate on re-render
    if (generating.current) return;
    generating.current = true;
    setError(null);

    // Defer one frame so the CSS spinner actually paints before the main thread
    // locks up inside Argon2id. Without this the loading state never shows.
    const id = window.setTimeout(() => {
      try {
        const result = createIdentityMaterial();
        setMaterial(result);
      } catch {
        setError("Could not generate your keys. Close and try again.");
      } finally {
        generating.current = false;
      }
    }, 50);
    return () => window.clearTimeout(id);
  }, [step, material]);

  const copyWords = useCallback(async () => {
    if (!material) return;
    try {
      await navigator.clipboard.writeText(material.recoveryWords);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the words are still visible to copy by hand.
      setCopied(false);
    }
  }, [material]);

  // Step 4, publish to the directory then save locally.
  const publish = useCallback(async () => {
    if (!material || !verifiedVia) return;
    setError(null);
    setLocalLinkFailed(false);
    setStep("publish");

    const issuedAt = new Date().toISOString();
    const canonical = canonicalizeEmail(email);
    const bind: BindRequestBody = buildBindRequest({
      email: canonical,
      x25519PublicKey: material.x25519PublicKey,
      ed25519PublicKey: material.ed25519PublicKey,
      ed25519PrivateKey: material.ed25519PrivateKey,
      backupBlob: material.backupBlob,
      issuedAt,
    });

    const isEmailPath = verifiedVia === "email";
    const url = isEmailPath
      ? "/api/directory/verify"
      : "/api/directory/oauth-bind";
    const requestBody = isEmailPath
      ? { ...bind, email: canonical, otp }
      : bind;

    let publishedFingerprint: string;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (res.status === 429) {
        setError("Too many attempts. Wait a minute, then try again.");
        setStep(isEmailPath ? "email-code" : "generate");
        return;
      }
      if (res.status === 401) {
        setError("Your sign-in expired. Start over to prove your email again.");
        setStep("choose");
        return;
      }
      if (!res.ok) {
        setError(
          isEmailPath
            ? "That code was wrong or expired. Request a new code and try again."
            : "Publishing failed. Check your connection and try again.",
        );
        setStep(isEmailPath ? "email-code" : "generate");
        return;
      }
      const data = (await res.json()) as { fingerprint?: string };
      // Fall back to the locally computed fingerprint if the server omits it;
      // both are derived from the same Ed25519 key so they agree.
      publishedFingerprint = data.fingerprint ?? material.fingerprint;
    } catch {
      setError("Network error while publishing. Try again.");
      setStep(isEmailPath ? "email-code" : "generate");
      return;
    }

    // Directory publish succeeded. Now persist the private keys on this device,
    // and write the per-folder sidecar so the account reads as claimed. The
    // private-key save is mandatory (without it the user cannot decrypt later);
    // the sidecar is best-effort and only fails when no folder is connected.
    try {
      await saveIdentity({
        keys: {
          encryption: {
            publicKey: decodePublicKey(material.x25519PublicKey),
            privateKey: material.x25519PrivateKey,
          },
          signing: {
            publicKey: decodePublicKey(material.ed25519PublicKey),
            privateKey: material.ed25519PrivateKey,
          },
        },
        deviceSalt: generateDeviceSalt(),
      });
    } catch {
      // If even IndexedDB is unavailable we still finished the directory
      // publish, but the user should know the keys are not stored. Surface it
      // through the same local-link notice rather than a hard failure.
      setLocalLinkFailed(true);
    }

    try {
      const sidecar: SharingIdentitySidecar = {
        version: 1,
        email: canonical,
        x25519PublicKey: material.x25519PublicKey,
        ed25519PublicKey: material.ed25519PublicKey,
        fingerprint: publishedFingerprint,
        claimedAt: new Date().toISOString(),
        recoveryConfirmedAt: recoverySaved ? new Date().toISOString() : null,
      };
      await writeSharingIdentity(username, sidecar);
    } catch {
      // No folder connected (or the write failed). The directory publish still
      // stands, so we complete, but we flag that the local link was not saved.
      setLocalLinkFailed(true);
    }

    setFingerprint(publishedFingerprint);
    setStep("done");
    onComplete({ fingerprint: publishedFingerprint });
  }, [material, verifiedVia, email, otp, recoverySaved, username, onComplete]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      data-tour-popup-occluding="sharing-setup"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 rounded-2xl shadow-2xl border border-white/20 max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between">
          <div>
            <h3 className="text-title font-semibold text-white">
              Set up sharing
            </h3>
            <p className="text-meta text-slate-400 mt-0.5">for {username}</p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white"
              aria-label="Close"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </Tooltip>
        </div>

        <div className="px-6 py-5">
          {step === "choose" && (
            <ChooseStep
              onOAuth={startOAuth}
              onEmail={() => {
                setError(null);
                setStep("email-enter");
              }}
            />
          )}

          {step === "email-enter" && (
            <EmailEnterStep
              email={email}
              setEmail={setEmail}
              busy={emailBusy}
              error={error}
              onSubmit={requestCode}
              onBack={() => {
                setError(null);
                setStep("choose");
              }}
            />
          )}

          {step === "email-code" && (
            <EmailCodeStep
              email={email}
              otp={otp}
              setOtp={setOtp}
              error={error}
              onSubmit={() => setStep("generate")}
              onResend={requestCode}
              onBack={() => {
                setError(null);
                setOtp("");
                setStep("email-enter");
              }}
            />
          )}

          {step === "generate" && (
            <GenerateStep
              material={material}
              error={error}
              recoverySaved={recoverySaved}
              setRecoverySaved={setRecoverySaved}
              copied={copied}
              onCopy={copyWords}
              onContinue={publish}
            />
          )}

          {step === "publish" && <PublishStep />}

          {step === "done" && (
            <DoneStep
              fingerprint={fingerprint}
              localLinkFailed={localLinkFailed}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1, choose a verification method.
// ---------------------------------------------------------------------------

function ChooseStep({
  onOAuth,
  onEmail,
}: {
  onOAuth: (provider: "google" | "github") => void;
  onEmail: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-body text-slate-300 leading-relaxed">
        Sharing lets you send notes, methods, and files to people outside your
        folder. First, prove the email others will reach you at, then we generate
        a keypair so your shares stay private.
      </p>
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => onOAuth("google")}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-white text-slate-800 hover:bg-slate-100 font-medium transition-colors"
        >
          <GoogleIcon className="w-4 h-4" />
          Continue with Google
        </button>
        <button
          type="button"
          onClick={() => onOAuth("github")}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-[#24292e] text-white hover:bg-[#2f363d] font-medium transition-colors"
        >
          <GitHubIcon className="w-4 h-4" />
          Continue with GitHub
        </button>
        <button
          type="button"
          onClick={onEmail}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 font-medium transition-colors"
        >
          <MailIcon className="w-4 h-4" />
          Use email instead
        </button>
      </div>
      <p className="text-meta text-slate-500 leading-relaxed">
        We only learn the address you verify. Your private keys are generated on
        this device and never leave it unencrypted.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2a, email entry.
// ---------------------------------------------------------------------------

function EmailEnterStep({
  email,
  setEmail,
  busy,
  error,
  onSubmit,
  onBack,
}: {
  email: string;
  setEmail: (v: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-body text-slate-300 leading-relaxed">
        Enter the email you want others to find you by. We send a 6-digit code to
        confirm you own it.
      </p>
      <div>
        <label className="block text-meta font-medium text-slate-300 mb-1">
          Email address
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) onSubmit();
          }}
          placeholder="you@university.edu"
          className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-body"
          autoFocus
          autoComplete="email"
        />
      </div>
      {error && <ErrorNotice message={error} />}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="flex-1 py-2 text-body bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-lg disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="flex-1 py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
        >
          {busy ? "Sending..." : "Send code"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2a (cont.), 6-digit code entry.
// ---------------------------------------------------------------------------

function EmailCodeStep({
  email,
  otp,
  setOtp,
  error,
  onSubmit,
  onResend,
  onBack,
}: {
  email: string;
  otp: string;
  setOtp: (v: string) => void;
  error: string | null;
  onSubmit: () => void;
  onResend: () => void;
  onBack: () => void;
}) {
  const ready = otp.trim().length === 6;
  return (
    <div className="space-y-4">
      <p className="text-body text-slate-300 leading-relaxed">
        Enter the 6-digit code we sent to{" "}
        <span className="text-white font-medium">{email}</span>. It expires in a
        few minutes.
      </p>
      <div>
        <label className="block text-meta font-medium text-slate-300 mb-1">
          Verification code
        </label>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          value={otp}
          onChange={(e) =>
            setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) onSubmit();
          }}
          placeholder="000000"
          className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-title tracking-[0.4em] text-center"
          autoFocus
        />
      </div>
      {error && <ErrorNotice message={error} />}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onResend}
          className="text-meta text-blue-400 hover:text-blue-300 underline"
        >
          Resend code
        </button>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2 text-body bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-lg"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!ready}
          className="flex-1 py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3, generate the identity and show the Recovery Words.
// ---------------------------------------------------------------------------

function GenerateStep({
  material,
  error,
  recoverySaved,
  setRecoverySaved,
  copied,
  onCopy,
  onContinue,
}: {
  material: IdentityMaterial | null;
  error: string | null;
  recoverySaved: boolean;
  setRecoverySaved: (v: boolean) => void;
  copied: boolean;
  onCopy: () => void;
  onContinue: () => void;
}) {
  // Loading state while Argon2id runs. The animation is pure CSS
  // (animate-pulse / a CSS-keyframe spinner) because the main thread is blocked
  // during keygen and any JS-driven animation would freeze mid-spin.
  if (!material) {
    return (
      <div className="py-8 flex flex-col items-center text-center">
        <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-blue-400 animate-spin" />
        <p className="text-body text-slate-300 mt-4 font-medium">
          Generating your keys
        </p>
        <p className="text-meta text-slate-500 mt-1 leading-relaxed">
          This runs once and can take a few seconds. The app may pause briefly
          while it works.
        </p>
        {error && (
          <div className="mt-4 w-full">
            <ErrorNotice message={error} />
          </div>
        )}
      </div>
    );
  }

  const words = material.recoveryWords.split(/\s+/);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-blue-300">
        <KeyIcon className="w-5 h-5" />
        <p className="text-body font-medium text-white">Your Recovery Words</p>
      </div>
      <p className="text-body text-slate-300 leading-relaxed">
        Write these 12 words down and store them somewhere safe. They are the
        only way to restore your sharing identity on another device. If you lose
        them they cannot be recovered.
      </p>

      <div className="grid grid-cols-3 gap-2 p-3 bg-slate-900/60 border border-white/10 rounded-lg">
        {words.map((word, i) => (
          <div
            key={`${word}-${i}`}
            className="flex items-center gap-1.5 text-body text-slate-200"
          >
            <span className="text-meta text-slate-500 w-4 text-right tabular-nums">
              {i + 1}
            </span>
            <span className="font-mono">{word}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onCopy}
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
            Copy words
          </>
        )}
      </button>

      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={recoverySaved}
          onChange={(e) => setRecoverySaved(e.target.checked)}
          className="mt-0.5 accent-blue-500"
        />
        <span className="text-body text-slate-300 leading-relaxed">
          I have saved my recovery words somewhere safe.
        </span>
      </label>

      {error && <ErrorNotice message={error} />}

      <button
        type="button"
        onClick={onContinue}
        disabled={!recoverySaved}
        className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
      >
        Publish my keys
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4, publishing.
// ---------------------------------------------------------------------------

function PublishStep() {
  return (
    <div className="py-8 flex flex-col items-center text-center">
      <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-blue-400 animate-spin" />
      <p className="text-body text-slate-300 mt-4 font-medium">
        Publishing your keys
      </p>
      <p className="text-meta text-slate-500 mt-1">
        Linking your verified email to your new identity.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5, done.
// ---------------------------------------------------------------------------

function DoneStep({
  fingerprint,
  localLinkFailed,
  onClose,
}: {
  fingerprint: string | null;
  localLinkFailed: boolean;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center text-center py-2">
        <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
          <CheckIcon className="w-6 h-6" />
        </div>
        <p className="text-title font-semibold text-white mt-3">
          Sharing is set up
        </p>
        <p className="text-body text-slate-300 mt-1 leading-relaxed">
          Your keys are published. People can now send you research across
          folders.
        </p>
      </div>

      {fingerprint && (
        <div className="p-3 bg-slate-900/60 border border-white/10 rounded-lg">
          <p className="text-meta text-slate-400 mb-1">
            Your safety-check fingerprint
          </p>
          <p className="text-body font-mono text-slate-100 tracking-wide">
            {fingerprint}
          </p>
        </div>
      )}

      {localLinkFailed && (
        <div className="flex items-start gap-2 p-3 bg-amber-500/15 border border-amber-400/30 rounded-lg">
          <span className="text-amber-300 mt-0.5">
            <WarningIcon className="w-4 h-4" />
          </span>
          <p className="text-meta text-amber-200 leading-relaxed">
            Your keys were published, but we could not save the local link in
            your folder. Connect your data folder and run setup again to record
            it, your published identity is unaffected.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white"
      >
        Done
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared error notice.
// ---------------------------------------------------------------------------

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
