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
import {
  decodePublicKey,
  encodePublicKey,
  type IdentityKeys,
} from "@/lib/sharing/identity/keys";
import { wrapDeviceKeyWithWords } from "@/lib/sharing/identity/device-key";
import {
  isOAuthPublishAvailable,
  isDevMockAuth,
  isMicrosoftAuthEnabled,
} from "@/lib/sharing/oauth-availability";
import { ensureGitignoreEntries } from "@/lib/file-system/gitignore";
import { downloadRecoveryKit } from "@/lib/sharing/identity/recovery-kit";
import { generateDeviceSalt } from "@/lib/sharing/identity/backup";
import {
  buildKeyBackupEnvelope,
  serializeKeyBackupEnvelope,
} from "@/lib/sharing/identity/key-backup-envelope";
import { mnemonicToRecoveryCode } from "@/lib/sharing/identity/recovery-code";
import { loadIdentity, saveIdentity } from "@/lib/sharing/identity/storage";
import {
  readSharingIdentity,
  writeSharingIdentity,
  type SharingIdentitySidecar,
} from "@/lib/sharing/identity/sidecar";
import { canonicalizeEmail } from "@/lib/sharing/directory/email";
import { trackIdentityCreated } from "@/lib/analytics/events";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { usePopupLayer } from "@/lib/ui/popup-stack";
import Tooltip from "@/components/Tooltip";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  GitHubIcon,
  GoogleIcon,
  KeyIcon,
  LinkedInIcon,
  MailIcon,
  MicrosoftIcon,
  OrcidIcon,
  WarningIcon,
} from "./icons";

interface SharingSetupWizardProps {
  /** The folder-local username this identity is claimed for. */
  username: string;
  /** Called once the directory publish succeeds (local link best-effort). The
   *  canonical verified email is included when known (always on the email-OTP
   *  path, where the caller may need it, e.g. lab-create binding the head to an
   *  ORCID-proven email). */
  onComplete: (result: { fingerprint: string; email?: string }) => void;
  /** Dismiss the wizard without finishing. */
  onClose: () => void;
  /** Which step to open on. Defaults to "choose". A caller that already wants
   *  the email path (the welcome page and the v0.5 popup "verify with email"
   *  links) passes "email-enter" to skip the provider chooser and land straight
   *  on email entry. */
  initialStep?: "choose" | "email-enter";
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

// The OAuth providers wired into the choose step. These strings are the Auth.js
// provider ids (see @/lib/sharing/auth), passed straight to signIn() and used to
// build the /api/auth/callback/<id> redirect, so they must match exactly.
type OAuthProvider = "google" | "github" | "microsoft-entra-id" | "linkedin" | "orcid" | "devmock";

export default function SharingSetupWizard({
  username,
  onComplete,
  onClose,
  initialStep = "choose",
}: SharingSetupWizardProps) {
  const [step, setStep] = useState<Step>(initialStep);
  const [verifiedVia, setVerifiedVia] = useState<VerifiedVia>(null);

  // Escape closes this wizard (app-wide convention).
  useEscapeToClose(onClose);

  // Register in the popup stack so the dim is owned by the bottom-most popup
  // only. This wizard often opens ON TOP of the Profile popup, so it must not
  // paint its own scrim there (that double-dims the popup below). It is a little
  // dim-only popup (no blur of its own).
  const { shouldDim } = usePopupLayer(true, false);

  // Email subflow state.
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);

  // Display name for the researcher profile created at signup (account = profile).
  // Prefilled from the OAuth/ORCID session name when available; the email-only
  // path collects it via a field. Sent on the bind body, where the route upserts
  // the profile. Blank just means no profile is auto-created (finish it later in
  // Settings).
  const [displayName, setDisplayName] = useState("");

  // Generated identity material, held only in memory for the life of the
  // wizard. Private keys go to IndexedDB at publish, never to React devtools-
  // friendly serialized state beyond this object. ONLY used on the
  // create-then-publish path (no pre-existing local identity).
  const [material, setMaterial] = useState<IdentityMaterial | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // EXISTING local identity (the common case under the revised model,
  // IDENTITY_OAUTH_ONLY.md 2026-06-06): the account is a LOCAL keypair created
  // offline before this wizard ever runs. When one is present, publishing must
  // BIND THE EXISTING keypair to the verified email, NOT mint a fresh one (the
  // old two-keypair bug). We capture the existing keys (from the unlocked
  // session) plus the existing sidecar (for its recoveryBlob, which becomes the
  // directory backup blob without ever needing the recovery words).
  // null = none found yet, so the wizard falls back to create-then-publish.
  const [existing, setExisting] = useState<{
    keys: IdentityKeys;
    sidecar: SharingIdentitySidecar;
  } | null>(null);
  // Whether the existing-identity probe has finished, so the generate step does
  // not flash the (wrong) "minting a fresh keypair" UI before we know.
  const [existingResolved, setExistingResolved] = useState(false);

  // True when the user signed in via ORCID (which returns no email) and has
  // been routed to the email-enter step to prove an email via OTP.
  const [orcidLinked, setOrcidLinked] = useState(false);

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
          user?: { email?: string | null; name?: string | null } | null;
          orcidId?: string | null;
        } | null;
        const sessionEmail = session?.user?.email;
        const sessionOrcidId = session?.orcidId;
        const sessionName = session?.user?.name;
        if (cancelled) return;
        // Prefill the profile name from the login (Google/GitHub/LinkedIn/
        // Microsoft/ORCID all return one), so the OAuth path needs no extra typing.
        if (sessionName) setDisplayName(sessionName);
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
        } else if (sessionOrcidId) {
          // ORCID never returns an email. Mark the session as ORCID-linked and
          // route to the email-enter step so the user can prove an email via OTP.
          // The verify route will read the still-active ORCID session server-side
          // and record the orcid_id -> email_hash link automatically.
          setOrcidLinked(true);
          setStep("email-enter");
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

  // Probe for an EXISTING local identity once on mount. If this user already has
  // a sealed keypair (sidecar recoveryBlob) AND it is unlocked on this device
  // (loadIdentity returns the session/IndexedDB key), publishing will BIND that
  // keypair to the verified email rather than minting a new one. A locked or
  // absent identity leaves `existing` null, so the wizard falls back to the
  // create-then-publish path unchanged.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [sidecar, stored] = await Promise.all([
          readSharingIdentity(username),
          loadIdentity(),
        ]);
        if (cancelled) return;
        if (sidecar?.recoveryBlob && stored?.keys) {
          // Sanity check: the unlocked key must match the sidecar's published
          // public key, otherwise we would bind the wrong keypair. If they
          // disagree, fall back to create-then-publish (existing stays null).
          if (
            encodePublicKey(stored.keys.signing.publicKey) ===
            sidecar.ed25519PublicKey
          ) {
            setExisting({ keys: stored.keys, sidecar });
          }
        }
      } catch {
        // Best-effort, a read failure just means the create-then-publish path.
      } finally {
        if (!cancelled) setExistingResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  const startOAuth = useCallback((provider: OAuthProvider) => {
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
    // EXISTING-identity publish path: there is already a keypair, so we never
    // mint a new one. The generate step renders a "publish your existing keys"
    // view instead, and publish() binds the existing keypair.
    if (existing) return;
    // Wait until the existing-identity probe settles, so we never kick off keygen
    // a frame before learning the user already has a keypair.
    if (!existingResolved) return;
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
  }, [step, material, existing, existingResolved]);

  // The recovery code is the high-entropy backstop, the same 128-bit secret as
  // the 12 Recovery Words rendered as a friendlier grouped code. Derived from the
  // generated words, not stored separately.
  const recoveryCode = material
    ? mnemonicToRecoveryCode(material.recoveryWords)
    : "";

  const copyCode = useCallback(async () => {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the code is still visible to copy by hand.
      setCopied(false);
    }
  }, [recoveryCode]);

  // Step 4, publish to the directory then save locally.
  const publish = useCallback(async () => {
    // Two sourcing paths for the keypair we bind:
    //  - EXISTING: the account already has a local keypair (the common case),
    //    so we bind THAT keypair, reusing its sidecar recoveryBlob as the
    //    directory backup blob (no recovery words needed, it is the same wrapped
    //    artifact). We must NOT mint a new keypair here.
    //  - CREATE: no prior identity, fall back to the freshly minted `material`.
    if (!verifiedVia) return;
    if (!existing && !material) return;
    setError(null);
    setLocalLinkFailed(false);
    setStep("publish");

    const issuedAt = new Date().toISOString();
    const canonical = canonicalizeEmail(email);

    // The public keys (hex), the ed25519 private key (raw, for the signature),
    // the local fingerprint, and the directory backup blob, all sourced from
    // whichever path applies.
    const x25519PublicKeyHex = existing
      ? encodePublicKey(existing.keys.encryption.publicKey)
      : material!.x25519PublicKey;
    const ed25519PublicKeyHex = existing
      ? encodePublicKey(existing.keys.signing.publicKey)
      : material!.ed25519PublicKey;
    const ed25519PrivateKey = existing
      ? existing.keys.signing.privateKey
      : material!.ed25519PrivateKey;
    const localFingerprint = existing
      ? existing.sidecar.fingerprint
      : material!.fingerprint;

    // The directory backup blob (the recovery-words-wrapped key envelope). On
    // the existing path we rebuild it from the sidecar's stored recoveryBlob so
    // the directory copy matches the local one without ever needing the recovery
    // words in memory. On the create path it is the freshly minted blob.
    const backupBlob = existing
      ? serializeKeyBackupEnvelope(
          buildKeyBackupEnvelope(existing.sidecar.recoveryBlob!),
        )
      : material!.backupBlob;
    const bind: BindRequestBody = buildBindRequest({
      email: canonical,
      x25519PublicKey: x25519PublicKeyHex,
      ed25519PublicKey: ed25519PublicKeyHex,
      ed25519PrivateKey,
      backupBlob,
      issuedAt,
    });

    const isEmailPath = verifiedVia === "email";
    const url = isEmailPath
      ? "/api/directory/verify"
      : "/api/directory/oauth-bind";
    // The trimmed display name rides on the bind body (not part of the signed
    // binding payload); the route upserts the profile from it. Blank -> null,
    // so no profile is created and the user finishes it in Settings.
    const profileName = displayName.trim() || null;
    const requestBody = isEmailPath
      ? { ...bind, email: canonical, otp, displayName: profileName }
      : { ...bind, displayName: profileName };

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
      publishedFingerprint = data.fingerprint ?? localFingerprint;
      // Anonymous adoption counter, bare count (no email, fingerprint, or path).
      trackIdentityCreated();
    } catch {
      setError("Network error while publishing. Try again.");
      setStep(isEmailPath ? "email-code" : "generate");
      return;
    }

    // Directory publish succeeded. On the CREATE path we now persist the private
    // keys on this device. On the EXISTING path the key is already in the session
    // (and its sidecar recoveryBlob is untouched), so there is nothing to save.
    if (!existing) {
      try {
        await saveIdentity({
          keys: {
            encryption: {
              publicKey: decodePublicKey(material!.x25519PublicKey),
              privateKey: material!.x25519PrivateKey,
            },
            signing: {
              publicKey: decodePublicKey(material!.ed25519PublicKey),
              privateKey: material!.ed25519PrivateKey,
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
    }

    try {
      if (existing) {
        // EXISTING path: bind only ADDS the email + claimedAt to the existing
        // sidecar. The recoveryBlob, public keys, and fingerprint are kept
        // EXACTLY as they were, so the one local keypair stays the one identity
        // (this is the unification, no fresh keypair, no second blob).
        const updated: SharingIdentitySidecar = {
          ...existing.sidecar,
          email: canonical,
          claimedAt: new Date().toISOString(),
        };
        await writeSharingIdentity(username, updated);
      } else {
        // CREATE path: seal the SAME freshly minted keypair into the sidecar
        // under the SAME recovery words the directory blob used, so the folder
        // is a self-contained identity with one recovery secret.
        const recoveryBlob = wrapDeviceKeyWithWords(
          {
            encryption: {
              publicKey: decodePublicKey(material!.x25519PublicKey),
              privateKey: material!.x25519PrivateKey,
            },
            signing: {
              publicKey: decodePublicKey(material!.ed25519PublicKey),
              privateKey: material!.ed25519PrivateKey,
            },
          },
          material!.recoveryWords,
        ).recoveryBlob;
        const sidecar: SharingIdentitySidecar = {
          version: 1,
          email: canonical,
          x25519PublicKey: material!.x25519PublicKey,
          ed25519PublicKey: material!.ed25519PublicKey,
          fingerprint: publishedFingerprint,
          claimedAt: new Date().toISOString(),
          recoveryConfirmedAt: recoverySaved ? new Date().toISOString() : null,
          recoveryBlob,
        };
        await writeSharingIdentity(username, sidecar);
      }
      // The sidecar holds wrapped key material, keep it out of any git repo
      // in the data folder.
      try {
        await ensureGitignoreEntries([
          "_sharing_identity.json",
          "users/*/_sharing_identity.json",
        ]);
      } catch {
        // best-effort
      }
    } catch {
      // No folder connected (or the write failed). The directory publish still
      // stands, so we complete, but we flag that the local link was not saved.
      setLocalLinkFailed(true);
    }

    setFingerprint(publishedFingerprint);
    setStep("done");
    onComplete({
      fingerprint: publishedFingerprint,
      email: canonical || undefined,
    });
  }, [
    material,
    existing,
    verifiedVia,
    email,
    otp,
    displayName,
    recoverySaved,
    username,
    onComplete,
  ]);

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center ${
        shouldDim ? "bg-black/50" : ""
      }`}
      data-tour-popup-occluding="sharing-setup"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised rounded-2xl shadow-2xl border border-border max-w-xl w-full mx-4 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-start justify-between shrink-0">
          <div>
            <h3 className="text-title font-semibold text-foreground">
              Set up sharing
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

        <div className="px-6 py-5 flex-1 overflow-y-auto">
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
              orcidLinked={orcidLinked}
              onSubmit={requestCode}
              onBack={() => {
                setError(null);
                setOrcidLinked(false);
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

          {step === "generate" && existing && (
            <PublishExistingStep
              displayName={displayName}
              setDisplayName={setDisplayName}
              error={error}
              onContinue={publish}
            />
          )}

          {step === "generate" && !existing && (
            <GenerateStep
              material={material}
              email={email}
              displayName={displayName}
              setDisplayName={setDisplayName}
              error={error}
              recoverySaved={recoverySaved}
              setRecoverySaved={setRecoverySaved}
              copied={copied}
              onCopy={copyCode}
              onContinue={publish}
              recoveryCode={recoveryCode}
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
  onOAuth: (provider: OAuthProvider) => void;
  onEmail: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-body text-foreground-muted leading-relaxed">
        Sharing lets you send notes, methods, and files to people outside your
        folder. First, prove the email others will reach you at, then we generate
        a keypair so your shares stay private.
      </p>
      <div className="space-y-2">
        {/* DEV MOCK: one working amber button that drives the same claim flow,
            so the link path is testable on localhost with no real creds. The
            real provider buttons below would dead-end, so they are hidden while
            the mock is on. */}
        {isDevMockAuth() && (
          <button
            type="button"
            onClick={() => onOAuth("devmock")}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-amber-500 text-white hover:bg-amber-600 font-medium transition-colors"
          >
            Dev mock sign-in (test the link flow)
          </button>
        )}
        {/* OAuth providers are only offered where they actually work (sharing
            configured). Where they are not, only the email path shows, so the
            chooser never dead-ends at NextAuth's /api/auth/error. */}
        {!isDevMockAuth() && isOAuthPublishAvailable() && (
          <>
            {/* White button (not ORCID green) so the iD logo's green circle stays
                visible, matching the welcome page + the Google button below. */}
            <button
              type="button"
              onClick={() => onOAuth("orcid")}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-white text-slate-800 hover:bg-slate-100 font-medium transition-colors border border-border"
            >
              <OrcidIcon className="w-4 h-4" />
              Sign in with ORCID
            </button>
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
            {/* Microsoft needs its own Entra app registration. The server
                provider is gated on AUTH_MICROSOFT_ENTRA_ID_ID in
                @/lib/sharing/auth, and this button on NEXT_PUBLIC_AUTH_MICROSOFT_ENABLED,
                so it only shows once the deployer has configured Microsoft. */}
            {isMicrosoftAuthEnabled() && (
              <button
                type="button"
                onClick={() => onOAuth("microsoft-entra-id")}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-white text-slate-800 hover:bg-slate-100 font-medium transition-colors border border-border"
              >
                <MicrosoftIcon className="w-4 h-4" />
                Continue with Microsoft
              </button>
            )}
            <button
              type="button"
              onClick={() => onOAuth("linkedin")}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-[#0A66C2] text-white hover:bg-[#004182] font-medium transition-colors"
            >
              <LinkedInIcon className="w-4 h-4" />
              Continue with LinkedIn
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onEmail}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-body rounded-lg bg-surface-raised/5 border border-border text-foreground hover:bg-surface-raised/10 font-medium transition-colors"
        >
          <MailIcon className="w-4 h-4" />
          Use email instead
        </button>
      </div>
      <p className="text-meta text-foreground-muted leading-relaxed">
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
  orcidLinked,
  onSubmit,
  onBack,
}: {
  email: string;
  setEmail: (v: string) => void;
  busy: boolean;
  error: string | null;
  orcidLinked: boolean;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      {orcidLinked && (
        <div className="px-3 py-2 rounded-lg bg-[#A6CE39]/15 border border-[#A6CE39]/30 text-meta text-foreground leading-relaxed">
          Signed in with ORCID. Confirm your email so collaborators can reach
          you.
        </div>
      )}
      <p className="text-body text-foreground-muted leading-relaxed">
        Enter the email you want others to find you by. We send a 6-digit code to
        confirm you own it.
      </p>
      <div>
        <label className="block text-meta font-medium text-foreground-muted mb-1">
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
          className="w-full px-3 py-2 bg-surface-raised/10 border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500 text-body"
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
          className="flex-1 py-2 text-body bg-surface-raised/5 hover:bg-surface-raised/10 border border-border text-foreground rounded-lg disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="flex-1 py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send code"}
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
      <p className="text-body text-foreground-muted leading-relaxed">
        Enter the 6-digit code we sent to{" "}
        <span className="text-foreground font-medium">{email}</span>. It expires in a
        few minutes.
      </p>
      <div>
        <label className="block text-meta font-medium text-foreground-muted mb-1">
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
          className="w-full px-3 py-2 bg-surface-raised/10 border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500 text-title tracking-[0.4em] text-center"
          autoFocus
        />
      </div>
      {error && <ErrorNotice message={error} />}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onResend}
          className="text-meta text-blue-600 dark:text-blue-400 hover:text-blue-600 dark:text-blue-300 underline"
        >
          Resend code
        </button>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2 text-body bg-surface-raised/5 hover:bg-surface-raised/10 border border-border text-foreground rounded-lg"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!ready}
          className="flex-1 py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white disabled:opacity-50"
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
  email,
  displayName,
  setDisplayName,
  error,
  recoverySaved,
  setRecoverySaved,
  copied,
  onCopy,
  onContinue,
  recoveryCode,
}: {
  material: IdentityMaterial | null;
  email: string;
  displayName: string;
  setDisplayName: (v: string) => void;
  error: string | null;
  recoverySaved: boolean;
  setRecoverySaved: (v: boolean) => void;
  copied: boolean;
  onCopy: () => void;
  onContinue: () => void;
  recoveryCode: string;
}) {
  // Loading state while Argon2id runs. The animation is pure CSS
  // (animate-pulse / a CSS-keyframe spinner) because the main thread is blocked
  // during keygen and any JS-driven animation would freeze mid-spin.
  if (!material) {
    return (
      <div className="py-8 flex flex-col items-center text-center">
        <div className="w-10 h-10 rounded-full border-2 border-border border-t-blue-400 animate-spin" />
        <p className="text-body text-foreground-muted mt-4 font-medium">
          Generating your keys
        </p>
        <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
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

  return (
    <div className="space-y-4">
      {/* Profile name, so the account IS a researcher profile from the start.
          Prefilled from the login on the OAuth path, typed here on the email
          path. Optional, blank just means the profile is finished later in
          Settings. */}
      <div>
        <label
          htmlFor="profile-name"
          className="block text-meta font-medium text-foreground-muted mb-1"
        >
          Name on your researcher profile
        </label>
        <input
          id="profile-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your full name"
          maxLength={100}
          className="w-full px-3 py-2 text-body rounded-lg bg-surface-sunken border border-border text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-blue-500"
        />
        <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
          Other ResearchOS users can find you by this name. You can change it
          anytime in Settings.
        </p>
      </div>

      <div className="flex items-center gap-2 text-blue-600 dark:text-blue-300">
        <KeyIcon className="w-5 h-5" />
        <p className="text-body font-medium text-foreground">Your recovery code</p>
      </div>
      <p className="text-body text-foreground-muted leading-relaxed">
        Save this code somewhere safe. It is your backstop if you lose your
        passkey and this device, and the only way to restore your identity. If
        you lose it, it cannot be recovered.
      </p>

      <div className="p-3 bg-surface-sunken border border-border rounded-lg">
        <p className="font-mono text-body text-foreground tracking-wide break-all text-center">
          {recoveryCode}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1.5 text-meta text-blue-600 dark:text-blue-400 hover:text-blue-600 dark:text-blue-300"
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
        <button
          type="button"
          onClick={() =>
            downloadRecoveryKit({
              email,
              fingerprint: material.fingerprint,
              backupBlob: material.backupBlob,
              createdAt: new Date().toISOString(),
            })
          }
          className="flex items-center gap-1.5 text-meta font-medium text-blue-600 dark:text-blue-400 hover:text-blue-600 dark:text-blue-300"
        >
          <DownloadIcon className="w-3.5 h-3.5" />
          Download Recovery Kit
        </button>
      </div>
      <p className="text-meta text-foreground-muted leading-relaxed">
        The Recovery Kit is your encrypted key backup in a single file, safe to
        keep because it is useless without your recovery code.
      </p>

      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={recoverySaved}
          onChange={(e) => setRecoverySaved(e.target.checked)}
          className="mt-0.5 accent-blue-500"
        />
        <span className="text-body text-foreground-muted leading-relaxed">
          I have saved my recovery code somewhere safe.
        </span>
      </label>

      {error && <ErrorNotice message={error} />}

      <button
        type="button"
        onClick={onContinue}
        disabled={!recoverySaved}
        className="w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white disabled:opacity-50"
      >
        Publish my keys
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 (existing-identity variant), publish the EXISTING keypair.
//
// When the account already has a local keypair, publishing does NOT mint or show
// a new recovery code, the user already has one. This step only collects the
// optional profile name and binds the existing keys to the verified email.
// ---------------------------------------------------------------------------

function PublishExistingStep({
  displayName,
  setDisplayName,
  error,
  onContinue,
}: {
  displayName: string;
  setDisplayName: (v: string) => void;
  error: string | null;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-body text-foreground-muted leading-relaxed">
        You already have an account on this device. Publishing links your existing
        keys to this verified email so other researchers can find you. Your keys
        and recovery code do not change.
      </p>

      <div>
        <label
          htmlFor="profile-name"
          className="block text-meta font-medium text-foreground-muted mb-1"
        >
          Name on your researcher profile
        </label>
        <input
          id="profile-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your full name"
          maxLength={100}
          className="w-full px-3 py-2 text-body rounded-lg bg-surface-sunken border border-border text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-blue-500"
        />
        <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
          Other ResearchOS users can find you by this name. You can change it
          anytime in Settings.
        </p>
      </div>

      {error && <ErrorNotice message={error} />}

      <button
        type="button"
        onClick={onContinue}
        className="w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white"
      >
        Publish my profile
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
      <div className="w-10 h-10 rounded-full border-2 border-border border-t-blue-400 animate-spin" />
      <p className="text-body text-foreground-muted mt-4 font-medium">
        Publishing your keys
      </p>
      <p className="text-meta text-foreground-muted mt-1">
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
        <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/30 flex items-center justify-center text-emerald-700 dark:text-emerald-300">
          <CheckIcon className="w-6 h-6" />
        </div>
        <p className="text-title font-semibold text-foreground mt-3">
          Sharing is set up
        </p>
        <p className="text-body text-foreground-muted mt-1 leading-relaxed">
          Your keys are published. People can now send you research across
          folders.
        </p>
      </div>

      {fingerprint && (
        <div className="p-3 bg-surface-sunken border border-border rounded-lg">
          <p className="text-meta text-foreground-muted mb-1">
            Your safety-check fingerprint
          </p>
          <p className="text-body font-mono text-foreground tracking-wide">
            {fingerprint}
          </p>
        </div>
      )}

      {localLinkFailed && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-400/30 rounded-lg">
          <span className="text-amber-700 dark:text-amber-300 mt-0.5">
            <WarningIcon className="w-4 h-4" />
          </span>
          <p className="text-meta text-amber-700 dark:text-amber-200 leading-relaxed">
            Your keys were published, but we could not save the local link in
            your folder. Connect your data folder and run setup again to record
            it, your published identity is unaffected.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white"
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
    <div className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
      <span className="text-red-700 dark:text-red-300 mt-0.5">
        <WarningIcon className="w-4 h-4" />
      </span>
      <p className="text-meta text-red-700 dark:text-red-300 leading-relaxed">{message}</p>
    </div>
  );
}
