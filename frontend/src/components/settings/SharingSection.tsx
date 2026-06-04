"use client";

// Cross-boundary sharing, the two Settings sections (Personal tab).
//
// This file holds the user-facing Settings surface for the global sharing
// identity and the relay budget, plus the three small modals that act on the
// identity (rotate, restore, disconnect). It is split out of settings/page.tsx
// (already 4500+ lines) and rendered only in the Personal stream, after
// AccountSection.
//
// TWO SEPARATE SECTIONS (Grant, FINAL 2026-06-03), not one combined card:
//   1. SharingIdentitySection  - the identity itself, branching on the four
//      useSharingIdentity status values (loading / none / ready / needs-restore).
//   2. InboxStorageSection      - the relay budget, pending count + bytes used
//      against the 5 GB / 100-share ceilings, the 30-day policy, a jump to the
//      inbox. Renders a "set up sharing" stub until status === "ready".
//
// The sections do NOT use the settings/update contract, the identity link is not
// a settings.json field, it lives in the per-user sidecar plus IndexedDB. They
// take the useSharingIdentity() result plus a small set of open-modal callbacks
// owned by SettingsBody (the same parent-owns-the-open-state pattern as
// AccountPasswordPopup). The light-theme rows mirror AccountSection /
// SecuritySection, the dark modals mirror SharingSetupWizard.
//
// RECOVERY-WORDS LIMITATION (flagged). The original 12 words are NOT derivable
// from the public sidecar, they only ever existed in the wizard's in-memory
// material. So neither "confirm recovery words" nor "restore" can re-derive them
// from local state. Both modals work the honest way, the user re-enters the words
// they saved, we fetch the wrapped backup blob from the directory by proving the
// email (a 6-digit code), unwrap it with the entered words, and compare the
// recovered Ed25519 public key to the sidecar's stored key. We never display or
// store the original words.

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import Tooltip from "@/components/Tooltip";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  KeyIcon,
  WarningIcon,
} from "@/components/sharing/icons";
import {
  type UseSharingIdentityResult,
} from "@/hooks/useSharingIdentity";
import { type SharingIdentitySidecar } from "@/lib/sharing/identity/sidecar";
import { writeSharingIdentity } from "@/lib/sharing/identity/sidecar";
import {
  buildRotateRequest,
  createIdentityMaterial,
  restoreFromRecoveryWords,
} from "@/lib/sharing/identity/setup";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { generateDeviceSalt } from "@/lib/sharing/identity/backup";
import {
  clearIdentity,
  loadIdentity,
  saveIdentity,
} from "@/lib/sharing/identity/storage";
import { canonicalizeEmail } from "@/lib/sharing/directory/email";
import { listInbox, RelayError } from "@/lib/sharing/relay/client";
import {
  FREE_STORAGE_BYTES,
  PENDING_SHARE_CAP,
  TTL_DAYS,
} from "@/lib/sharing/relay/limits";

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

/**
 * Human-readable bytes for the storage line, kept local and pure so this section
 * does not pull in the heavy export module that also exports a formatBytes. Uses
 * the same binary units (KB / MB / GB) the rest of the app shows.
 */
function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

// ---------------------------------------------------------------------------
// SharingSection, the two-section wrapper rendered by SettingsBody.
// ---------------------------------------------------------------------------

interface SharingSectionProps {
  currentUser: string | null;
  sharing: UseSharingIdentityResult;
  onSetUp: () => void;
  onRotate: () => void;
  onRestore: () => void;
  onDisconnect: () => void;
}

/**
 * Renders the two sharing sections in order, identity first then inbox + storage.
 * Both are wrapped in plain <section> cards that mirror the SectionShell look from
 * settings/page.tsx (SectionShell lives in page.tsx and is not exported, so the
 * cards are inlined here with the same classes). Keeping both in one component
 * lets the inbox block share the single useSharingIdentity result without a second
 * read, while still rendering as two visually separate cards per the FINAL layout.
 */
export default function SharingSection({
  currentUser,
  sharing,
  onSetUp,
  onRotate,
  onRestore,
  onDisconnect,
}: SharingSectionProps) {
  return (
    <>
      <SharingIdentitySection
        sharing={sharing}
        onSetUp={onSetUp}
        onRotate={onRotate}
        onRestore={onRestore}
        onDisconnect={onDisconnect}
      />
      <InboxStorageSection sharing={sharing} onSetUp={onSetUp} />
      {/* currentUser is threaded through to the modals by SettingsBody, not used
          directly here, named in the props so the wiring reads cleanly. */}
      {currentUser ? null : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// A lightweight card matching SectionShell's outer look (page.tsx, not exported).
// ---------------------------------------------------------------------------

function Card({
  title,
  description,
  id,
  children,
}: {
  title: string;
  description?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-settings-section-marker="1"
      className="bg-white rounded-xl border border-gray-200 p-6 scroll-mt-4"
    >
      <div className="mb-4">
        <h2 className="text-title font-semibold text-gray-900">{title}</h2>
        {description && (
          <p className="text-meta text-gray-500 mt-1">{description}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 1, Sharing identity.
// ---------------------------------------------------------------------------

function SharingIdentitySection({
  sharing,
  onSetUp,
  onRotate,
  onRestore,
  onDisconnect,
}: {
  sharing: UseSharingIdentityResult;
  onSetUp: () => void;
  onRotate: () => void;
  onRestore: () => void;
  onDisconnect: () => void;
}) {
  const { status, sidecar } = sharing;
  return (
    <Card
      id="sharing"
      title="Sharing identity"
      description="Send notes, methods, and files to people outside your folder, and pick up what they send you. Your identity is one verified email plus a keypair that lives on this device."
    >
      {status === "loading" && (
        <p className="text-body text-gray-500">Checking your sharing setup…</p>
      )}

      {status === "none" && (
        <div className="flex items-start justify-between gap-4">
          <p className="text-body text-gray-700 leading-relaxed max-w-prose">
            You have not set up sharing yet. Set it up to send and receive
            research across folders. It takes about a minute and you stay in
            control of your keys.
          </p>
          <button
            type="button"
            onClick={onSetUp}
            className="px-3 py-2 text-body bg-blue-600 hover:bg-blue-700 text-white rounded-lg whitespace-nowrap"
          >
            Set up sharing
          </button>
        </div>
      )}

      {status === "ready" && sidecar && (
        <ReadyIdentity
          sidecar={sidecar}
          onRotate={onRotate}
          onDisconnect={onDisconnect}
        />
      )}

      {status === "needs-restore" && sidecar && (
        <NeedsRestoreIdentity sidecar={sidecar} onRestore={onRestore} />
      )}
    </Card>
  );
}

function Pill({
  tone,
  label,
  tip,
}: {
  tone: "emerald" | "amber";
  label: string;
  tip: string;
}) {
  const cls =
    tone === "emerald"
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : "text-amber-800 bg-amber-50 border-amber-300";
  return (
    <Tooltip label={tip} placement="bottom">
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full border text-meta font-medium ${cls}`}
      >
        {label}
      </span>
    </Tooltip>
  );
}

/** A label/value row in the identity card. */
function InfoRow({
  label,
  labelTip,
  children,
}: {
  label: string;
  labelTip?: string;
  children: React.ReactNode;
}) {
  const labelNode = (
    <span className="text-meta font-medium text-gray-500 w-32 shrink-0">
      {label}
    </span>
  );
  return (
    <div className="flex items-start gap-3">
      {labelTip ? (
        <Tooltip label={labelTip} placement="top">
          {labelNode}
        </Tooltip>
      ) : (
        labelNode
      )}
      <div className="min-w-0 flex-1 text-body text-gray-800">{children}</div>
    </div>
  );
}

function ReadyIdentity({
  sidecar,
  onRotate,
  onDisconnect,
}: {
  sidecar: SharingIdentitySidecar;
  onRotate: () => void;
  onDisconnect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyFingerprint = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sidecar.fingerprint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [sidecar.fingerprint]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-body font-semibold text-gray-900">Your identity</h3>
        <Pill
          tone="emerald"
          label="On this device"
          tip="Your private key is stored in this browser on this device. Shares are sealed to it."
        />
      </div>

      <InfoRow label="Email">
        <span className="break-all">{sidecar.email}</span>
      </InfoRow>

      <InfoRow
        label="Fingerprint"
        labelTip="Read these characters aloud with the other person to confirm you are sending to the right identity."
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono tracking-wide break-all">
            {sidecar.fingerprint}
          </span>
          <button
            type="button"
            onClick={copyFingerprint}
            className="inline-flex items-center gap-1 text-meta text-blue-600 hover:text-blue-700"
          >
            {copied ? (
              <>
                <CheckIcon className="w-3.5 h-3.5" />
                Copied
              </>
            ) : (
              <>
                <CopyIcon className="w-3.5 h-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </InfoRow>

      <InfoRow label="Set up">{formatDate(sidecar.claimedAt)}</InfoRow>

      <InfoRow label="Recovery words">
        {sidecar.recoveryConfirmedAt ? (
          <span className="text-emerald-600 font-medium">Confirmed</span>
        ) : (
          <div className="space-y-1">
            <span className="text-gray-500">Not confirmed</span>
            <p className="text-meta text-gray-400 leading-relaxed">
              You skipped saving your recovery words. Save them now so you can
              restore your identity on another device.
            </p>
          </div>
        )}
      </InfoRow>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Tooltip
          label="Replace your keypair while keeping the same email. Use this if your key may have been exposed."
          placement="top"
        >
          <button
            type="button"
            onClick={onRotate}
            className="px-3 py-1.5 text-body bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg"
          >
            Rotate key
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={onDisconnect}
          className="px-3 py-1.5 text-body bg-gray-100 hover:bg-gray-200 text-red-600 rounded-lg"
        >
          Disconnect from this device
        </button>
      </div>
    </div>
  );
}

function NeedsRestoreIdentity({
  sidecar,
  onRestore,
}: {
  sidecar: SharingIdentitySidecar;
  onRestore: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-body font-semibold text-gray-900">Your identity</h3>
        <Pill
          tone="amber"
          label="Key not on device"
          tip="You set up this identity on another device. Restore your key here with your recovery words."
        />
      </div>

      <InfoRow label="Email">
        <span className="break-all">{sidecar.email}</span>
      </InfoRow>
      <InfoRow
        label="Fingerprint"
        labelTip="Read these characters aloud with the other person to confirm you are sending to the right identity."
      >
        <span className="font-mono tracking-wide break-all">
          {sidecar.fingerprint}
        </span>
      </InfoRow>
      <InfoRow label="Set up">{formatDate(sidecar.claimedAt)}</InfoRow>

      <p className="text-body text-gray-700 leading-relaxed max-w-prose pt-1">
        This account has a sharing identity, but its private key is not on this
        device. Restore it with your recovery words to send and open shares here.
      </p>
      <button
        type="button"
        onClick={onRestore}
        className="px-3 py-2 text-body bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
      >
        Restore on this device
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 2, Inbox and storage.
// ---------------------------------------------------------------------------

function InboxStorageSection({
  sharing,
  onSetUp,
}: {
  sharing: UseSharingIdentityResult;
  onSetUp: () => void;
}) {
  const { status, email } = sharing;

  // Until an identity is ready, the inbox is meaningless. Render the stub
  // (FINAL: the empty-state handling moved to this section as its own card).
  if (status !== "ready" || !email) {
    return (
      <Card
        title="Inbox and storage"
        description="Shares people send you wait in an encrypted inbox until you import them."
      >
        {status === "needs-restore" ? (
          <p className="text-body text-gray-600 leading-relaxed">
            Encrypted items may be waiting. Restore your key on this device to see
            and open them.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="text-body text-gray-600 leading-relaxed">
              Set up sharing to use the inbox.
            </p>
            {status === "none" && (
              <button
                type="button"
                onClick={onSetUp}
                className="px-3 py-2 text-body bg-blue-600 hover:bg-blue-700 text-white rounded-lg whitespace-nowrap"
              >
                Set up sharing
              </button>
            )}
          </div>
        )}
      </Card>
    );
  }

  return <InboxStorageReady email={email} />;
}

function InboxStorageReady({ email }: { email: string }) {
  const query = useQuery({
    queryKey: ["sharing-inbox", email],
    queryFn: () => listInbox({ email }),
    // The inbox surface is the source of truth, this is a budget snapshot, so a
    // short stale window keeps it cheap without going stale across a settings
    // visit.
    staleTime: 30_000,
    retry: false,
  });

  // A 404 means sharing is disabled on this build (the relay routes 404), treat
  // as "unavailable" rather than an error.
  const unavailable =
    query.error instanceof RelayError && query.error.status === 404;

  const items = query.data ?? [];
  const count = items.length;
  const totalBytes = items.reduce(
    (sum, it) => sum + (it.sizeBytes ?? 0),
    0,
  );
  const fraction = Math.min(totalBytes / FREE_STORAGE_BYTES, 1);
  const over80 = fraction > 0.8;

  return (
    <Card
      title="Inbox and storage"
      description="Shares people send you wait in an encrypted inbox until you import them."
    >
      {query.isLoading && (
        <p className="text-body text-gray-500">Loading your inbox…</p>
      )}

      {unavailable && (
        <p className="text-body text-gray-600 leading-relaxed">
          Your inbox is unavailable offline. Your identity and keys are still
          here on this device.
        </p>
      )}

      {!query.isLoading && !unavailable && query.isError && (
        <p className="text-body text-gray-600 leading-relaxed">
          Could not load your inbox right now. Try again in a moment.
        </p>
      )}

      {!query.isLoading && !unavailable && !query.isError && (
        <>
          {count === 0 ? (
            <p className="text-body text-gray-600">
              Nothing pending. Shares people send you will appear here.
            </p>
          ) : (
            <p className="text-body text-gray-800">
              {count} pending {count === 1 ? "share" : "shares"},{" "}
              {humanBytes(totalBytes)} of {humanBytes(FREE_STORAGE_BYTES)} used
            </p>
          )}

          <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                over80 ? "bg-amber-500" : "bg-blue-500"
              }`}
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>

          <p className="text-meta text-gray-400 leading-relaxed">
            Pending shares are held for {TTL_DAYS} days, then removed. Each person
            can hold up to {PENDING_SHARE_CAP} pending shares at a time.
          </p>

          <div className="flex items-center justify-between gap-4 pt-1">
            <p className="text-meta text-gray-400 leading-relaxed">
              Later, collaborate mode will draw on this same space. One budget,
              two uses.
            </p>
            {/* The receive surface is the InboxPanel popover, it has no routable
                URL yet, so the button is disabled with the spec's tooltip until
                the receive screen ships. */}
            <Tooltip
              label="The inbox opens here once the receive screen ships."
              placement="top"
            >
              <button
                type="button"
                disabled
                className="px-3 py-2 text-body bg-gray-100 text-gray-400 rounded-lg whitespace-nowrap cursor-not-allowed"
              >
                Open inbox
              </button>
            </Tooltip>
          </div>
        </>
      )}
    </Card>
  );
}

// ===========================================================================
// The three modals. Owned (open-state) by SettingsBody, each calls
// sharing.refresh() on close so the sections re-read.
// ===========================================================================

/** A dark modal shell matching SharingSetupWizard / AccountPasswordPopup. */
function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 rounded-2xl shadow-2xl border border-white/20 max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between">
          <div>
            <h3 className="text-title font-semibold text-white">{title}</h3>
            {subtitle && (
              <p className="text-meta text-slate-400 mt-0.5">{subtitle}</p>
            )}
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
        <div className="px-6 py-5">{children}</div>
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

/** The 12-word recovery input, shared by Rotate's confirm-new-words and Restore. */
function WordsInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      rows={3}
      placeholder="Enter your 12 recovery words, separated by spaces"
      className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-body font-mono disabled:opacity-50"
      autoFocus
    />
  );
}

/** Normalizes free-typed words to a single-spaced lowercase phrase. */
function normalizeWords(raw: string): string {
  return raw.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}
function wordCount(raw: string): number {
  return normalizeWords(raw).split(" ").filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Fetch-the-backup-blob helper, used by both Restore and Confirm.
//
// The wrapped backup blob is NOT in the sidecar (public fields only) and NOT in
// IndexedDB, it lives in the directory. To get it the user proves the email with
// a 6-digit code (the same signup -> recover OTP flow the wizard's email path
// uses). recover returns { found, keyBackupBlob }. The blob is end-to-end
// encrypted by the recovery words, so the server handing it back on email proof
// is safe, only the words unwrap it.
// ---------------------------------------------------------------------------

async function requestRecoveryCode(email: string): Promise<{ ok: boolean; rateLimited: boolean }> {
  try {
    const res = await fetch("/api/directory/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: canonicalizeEmail(email) }),
    });
    if (res.status === 429) return { ok: false, rateLimited: true };
    return { ok: res.ok, rateLimited: false };
  } catch {
    return { ok: false, rateLimited: false };
  }
}

interface RecoverBlobResult {
  blob: string | null;
  rateLimited: boolean;
  badCode: boolean;
  networkError: boolean;
}

async function fetchBackupBlob(
  email: string,
  otp: string,
): Promise<RecoverBlobResult> {
  try {
    const res = await fetch("/api/directory/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: canonicalizeEmail(email), otp }),
    });
    if (res.status === 429) {
      return { blob: null, rateLimited: true, badCode: false, networkError: false };
    }
    if (!res.ok) {
      return { blob: null, rateLimited: false, badCode: true, networkError: false };
    }
    const data = (await res.json()) as {
      found?: boolean;
      keyBackupBlob?: string;
    };
    if (!data.found || !data.keyBackupBlob) {
      return { blob: null, rateLimited: false, badCode: false, networkError: false };
    }
    return {
      blob: data.keyBackupBlob,
      rateLimited: false,
      badCode: false,
      networkError: false,
    };
  } catch {
    return { blob: null, rateLimited: false, badCode: false, networkError: true };
  }
}

// ---------------------------------------------------------------------------
// RestoreIdentityPopup, the needs-restore path.
// ---------------------------------------------------------------------------

type RestoreStep = "intro" | "code" | "verifying" | "done";

export function RestoreIdentityPopup({
  username,
  sidecar,
  onClose,
}: {
  username: string;
  sidecar: SharingIdentitySidecar | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<RestoreStep>("intro");
  const [words, setWords] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const email = sidecar?.email ?? "";

  const sendCode = useCallback(async () => {
    setError(null);
    if (wordCount(words) !== 12) {
      setError("Enter all 12 recovery words.");
      return;
    }
    setBusy(true);
    const r = await requestRecoveryCode(email);
    setBusy(false);
    if (r.rateLimited) {
      setError("Too many attempts. Wait a minute, then try again.");
      return;
    }
    if (!r.ok) {
      setError("Could not reach the recovery service. Check your connection and try again.");
      return;
    }
    setStep("code");
  }, [words, email]);

  const verify = useCallback(async () => {
    if (!sidecar) return;
    setError(null);
    setStep("verifying");
    setBusy(true);
    try {
      const fetched = await fetchBackupBlob(email, otp);
      if (fetched.rateLimited) {
        setError("Too many attempts. Wait a minute, then try again.");
        setStep("code");
        return;
      }
      if (fetched.networkError) {
        setError("Could not reach the recovery service. Check your connection and try again.");
        setStep("code");
        return;
      }
      if (!fetched.blob) {
        setError("That code was wrong or expired. Request a new code and try again.");
        setStep("code");
        return;
      }

      // Unwrap with the entered words. A wrong phrase throws (Poly1305).
      let restored;
      try {
        restored = restoreFromRecoveryWords(normalizeWords(words), fetched.blob);
      } catch {
        setError("Those words do not match this identity. Check them and try again.");
        setStep("code");
        return;
      }

      // The recovered keys must match the published identity, otherwise the words
      // belong to a different identity.
      if (restored.ed25519PublicKey !== sidecar.ed25519PublicKey) {
        setError("Those words do not match this identity. Check them and try again.");
        setStep("code");
        return;
      }

      await saveIdentity({
        keys: {
          encryption: {
            publicKey: decodePublicKey(restored.x25519PublicKey),
            privateKey: restored.x25519PrivateKey,
          },
          signing: {
            publicKey: decodePublicKey(restored.ed25519PublicKey),
            privateKey: restored.ed25519PrivateKey,
          },
        },
        deviceSalt: generateDeviceSalt(),
      });

      // Mark recovery confirmed, the user just proved they hold the words.
      try {
        await writeSharingIdentity(username, {
          ...sidecar,
          recoveryConfirmedAt: sidecar.recoveryConfirmedAt ?? new Date().toISOString(),
        });
      } catch {
        // The key is restored even if the sidecar rewrite fails, do not block.
      }

      setStep("done");
    } finally {
      setBusy(false);
    }
  }, [sidecar, email, otp, words, username]);

  return (
    <ModalShell title="Restore your sharing identity" subtitle={`for ${username}`} onClose={onClose}>
      {step === "intro" && (
        <div className="space-y-4">
          <p className="text-body text-slate-300 leading-relaxed">
            Restore your sharing identity on this device. Enter the 12 recovery
            words you saved when you set up sharing.
          </p>
          <WordsInput value={words} onChange={setWords} disabled={busy} />
          {error && <ErrorNotice message={error} />}
          <button
            type="button"
            onClick={sendCode}
            disabled={busy}
            className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            {busy ? "Sending code…" : "Continue"}
          </button>
          <p className="text-meta text-slate-500 leading-relaxed">
            We send a 6-digit code to {email || "your email"} to confirm it is you
            before handing back your encrypted key backup. Only your words can
            unlock it.
          </p>
        </div>
      )}

      {step === "code" && (
        <div className="space-y-4">
          <p className="text-body text-slate-300 leading-relaxed">
            Enter the 6-digit code we sent to{" "}
            <span className="text-white font-medium">{email}</span>.
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-title tracking-[0.4em] text-center"
            autoFocus
          />
          {error && <ErrorNotice message={error} />}
          <button
            type="button"
            onClick={verify}
            disabled={busy || otp.length !== 6}
            className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            Restore my key
          </button>
        </div>
      )}

      {step === "verifying" && (
        <div className="py-8 flex flex-col items-center text-center">
          <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-blue-400 animate-spin" />
          <p className="text-body text-slate-300 mt-4 font-medium">
            Checking your recovery words…
          </p>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center text-center py-2">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
              <CheckIcon className="w-6 h-6" />
            </div>
            <p className="text-title font-semibold text-white mt-3">
              Your key is restored
            </p>
            <p className="text-body text-slate-300 mt-1 leading-relaxed">
              You can send and open shares on this device now.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white"
          >
            Done
          </button>
        </div>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// RotateIdentityPopup, replace the keypair, same email.
// ---------------------------------------------------------------------------

type RotateStep = "confirm" | "generating" | "show-words" | "publishing" | "done";

export function RotateIdentityPopup({
  username,
  sidecar,
  pendingCount,
  onClose,
}: {
  username: string;
  sidecar: SharingIdentitySidecar | null;
  pendingCount: number | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<RotateStep>("confirm");
  const [error, setError] = useState<string | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [copied, setCopied] = useState(false);
  // The freshly generated material, held in memory only for the modal's life.
  const [material, setMaterial] = useState<ReturnType<typeof createIdentityMaterial> | null>(null);

  const email = sidecar?.email ?? "";

  // Step 1 -> generate. createIdentityMaterial runs Argon2id, a heavy blocking
  // step, so the spinner must be CSS-animated and we defer a frame so it paints.
  useEffect(() => {
    if (step !== "generating") return;
    if (material) return;
    const id = window.setTimeout(() => {
      try {
        setMaterial(createIdentityMaterial());
        setStep("show-words");
      } catch {
        setError("Could not generate your keys. Close and try again.");
        setStep("confirm");
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
      setCopied(false);
    }
  }, [material]);

  const publish = useCallback(async () => {
    if (!material || !sidecar) return;
    setError(null);
    setStep("publishing");

    // Sign the rotate with the OLD key from IndexedDB.
    const existing = await loadIdentity();
    if (!existing) {
      setError("Your current key is not on this device, so it cannot be rotated.");
      setStep("show-words");
      return;
    }

    const issuedAt = new Date().toISOString();
    const body = buildRotateRequest({
      email,
      newX25519PublicKey: material.x25519PublicKey,
      newEd25519PublicKey: material.ed25519PublicKey,
      oldEd25519PrivateKey: existing.keys.signing.privateKey,
      backupBlob: material.backupBlob,
      issuedAt,
    });

    let fingerprint: string;
    try {
      const res = await fetch("/api/directory/rotate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        setError("Too many attempts. Wait a minute, then try again.");
        setStep("show-words");
        return;
      }
      if (!res.ok) {
        setError("Rotating failed. Check your connection and try again.");
        setStep("show-words");
        return;
      }
      const data = (await res.json()) as { fingerprint?: string };
      fingerprint = data.fingerprint ?? material.fingerprint;
    } catch {
      setError("Network error while rotating. Try again.");
      setStep("show-words");
      return;
    }

    // Save the NEW private keys (overwriting), then rewrite the sidecar with the
    // new public keys and fingerprint, recovery unconfirmed (the words changed).
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
      await writeSharingIdentity(username, {
        ...sidecar,
        x25519PublicKey: material.x25519PublicKey,
        ed25519PublicKey: material.ed25519PublicKey,
        fingerprint,
        recoveryConfirmedAt: null,
      });
    } catch {
      // The directory rotation stands even if a local write fails, do not hard
      // fail, the user can restore. Surface it lightly.
      setError("Your key rotated, but saving it locally failed. Restore it with your new words.");
    }

    setStep("done");
  }, [material, sidecar, email, username]);

  const words = material ? material.recoveryWords.split(/\s+/) : [];

  return (
    <ModalShell title="Rotate your key" subtitle={`for ${username}`} onClose={onClose}>
      {step === "confirm" && (
        <div className="space-y-4">
          <p className="text-body text-slate-300 leading-relaxed">
            Rotate your key? This replaces your keypair and gives you fresh
            recovery words. Your email stays the same. People you have shared with
            will need your new fingerprint to verify you.
          </p>
          {pendingCount !== null && pendingCount > 0 && (
            <div className="flex items-start gap-2 p-3 bg-amber-500/15 border border-amber-400/30 rounded-lg">
              <span className="text-amber-300 mt-0.5">
                <WarningIcon className="w-4 h-4" />
              </span>
              <p className="text-meta text-amber-200 leading-relaxed">
                You have {pendingCount} pending{" "}
                {pendingCount === 1 ? "share" : "shares"} sealed to your current
                key. Rotating means you will not be able to open{" "}
                {pendingCount === 1 ? "it" : "them"}. Pick those up first if you
                can.
              </p>
            </div>
          )}
          {error && <ErrorNotice message={error} />}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 text-body bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setStep("generating")}
              className="flex-1 py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white"
            >
              Rotate key
            </button>
          </div>
        </div>
      )}

      {(step === "generating" || step === "publishing") && (
        <div className="py-8 flex flex-col items-center text-center">
          <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-blue-400 animate-spin" />
          <p className="text-body text-slate-300 mt-4 font-medium">
            {step === "generating" ? "Generating your new keys" : "Rotating your key"}
          </p>
          <p className="text-meta text-slate-500 mt-1 leading-relaxed">
            {step === "generating"
              ? "This runs once and can take a few seconds. The app may pause briefly while it works."
              : "Binding your new keys to the same email."}
          </p>
        </div>
      )}

      {step === "show-words" && material && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-blue-300">
            <KeyIcon className="w-5 h-5" />
            <p className="text-body font-medium text-white">
              Your new Recovery Words
            </p>
          </div>
          <p className="text-body text-slate-300 leading-relaxed">
            Write these 12 words down and store them somewhere safe. Your old
            words no longer work after this rotation.
          </p>
          <div className="grid grid-cols-3 gap-2 p-3 bg-slate-900/60 border border-white/10 rounded-lg">
            {words.map((word, i) => (
              <div key={`${word}-${i}`} className="flex items-center gap-1.5 text-body text-slate-200">
                <span className="text-meta text-slate-500 w-4 text-right tabular-nums">
                  {i + 1}
                </span>
                <span className="font-mono">{word}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={copyWords}
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
              I have saved my new recovery words somewhere safe.
            </span>
          </label>
          {error && <ErrorNotice message={error} />}
          <button
            type="button"
            onClick={publish}
            disabled={!recoverySaved}
            className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            Publish my new key
          </button>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center text-center py-2">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
              <CheckIcon className="w-6 h-6" />
            </div>
            <p className="text-title font-semibold text-white mt-3">
              Your key is rotated
            </p>
            <p className="text-body text-slate-300 mt-1 leading-relaxed">
              Save your new recovery words, the old ones no longer work.
            </p>
          </div>
          {error && <ErrorNotice message={error} />}
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white"
          >
            Done
          </button>
        </div>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// DisconnectIdentityPopup, remove the local key from THIS device only.
// ---------------------------------------------------------------------------

export function DisconnectIdentityPopup({
  username,
  pendingCount,
  onClose,
}: {
  username: string;
  pendingCount: number | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      // Only the local private key is removed, the sidecar stays so the account
      // reads as needs-restore (not none) and the published identity is untouched.
      await clearIdentity();
      onClose();
    } catch {
      setError("Could not remove your key from this device. Try again.");
      setBusy(false);
    }
  }, [onClose]);

  return (
    <ModalShell
      title="Disconnect from this device?"
      subtitle={`for ${username}`}
      onClose={onClose}
    >
      <div className="space-y-4">
        <p className="text-body text-slate-300 leading-relaxed">
          This removes your private key from this browser on this device. Your
          identity stays published and your account keeps it, but until you
          restore your key here you cannot send shares or open the encrypted items
          waiting for you on this device. You can restore any time with your
          recovery words.
          {pendingCount !== null && pendingCount > 0 && (
            <>
              {" "}You have {pendingCount} encrypted{" "}
              {pendingCount === 1 ? "item" : "items"} waiting that you will not be
              able to open until you restore.
            </>
          )}
        </p>
        {error && <ErrorNotice message={error} />}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2 text-body bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="flex-1 py-2 text-body rounded-lg font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
