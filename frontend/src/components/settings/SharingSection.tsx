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
//      against the 1 GB / 100-share ceilings, the 30-day policy, a jump to the
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

import FileDropzone from "@/components/ui/FileDropzone";
import Tooltip from "@/components/Tooltip";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { usePopupLayer } from "@/lib/ui/popup-stack";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  KeyIcon,
  UploadIcon,
  WarningIcon,
} from "@/components/sharing/icons";
import {
  type UseSharingIdentityResult,
} from "@/hooks/useSharingIdentity";
import { type SharingIdentitySidecar } from "@/lib/sharing/identity/sidecar";
import {
  deleteSharingIdentity,
  writeSharingIdentity,
} from "@/lib/sharing/identity/sidecar";
import {
  buildRotateRequest,
  createIdentityMaterial,
  restoreFromRecoveryWords,
} from "@/lib/sharing/identity/setup";
import { normalizeRecoveryInput } from "@/lib/sharing/identity/recovery-code";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import {
  parseRecoveryKit,
  type RecoveryKitData,
} from "@/lib/sharing/identity/recovery-kit";
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
import {
  type OrcidWork,
  type PublishedProfile,
  fetchMyProfile,
  fetchOrcidPublications,
  publishProfile,
  unpublishProfile,
} from "@/lib/sharing/profile";
import { trackProfilePublished } from "@/lib/analytics/events";
import {
  MAX_LENGTH_NAME,
  charsOver,
  hardenName,
} from "@/lib/validation/input-hardening";

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
  onReset: () => void;
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
  onReset,
}: SharingSectionProps) {
  return (
    <>
      {/* Your researcher profile and the directory search moved to the dedicated
          /profile and /researchers destinations (2026-06-05). This section now
          holds only the identity and its inbox. */}
      <SharingIdentitySection
        sharing={sharing}
        onSetUp={onSetUp}
        onRotate={onRotate}
        onRestore={onRestore}
        onDisconnect={onDisconnect}
        onReset={onReset}
      />
      <InboxStorageSection sharing={sharing} onSetUp={onSetUp} />
      {/* Cloud storage + billing lives in the consolidated BillingPopup, opened
          from the CloudStorageLauncher card on the Profile page, not nested here. */}
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
      className="bg-surface-raised rounded-xl border border-border shadow-sm p-6 scroll-mt-4"
    >
      <div className="mb-4">
        <h2 className="text-title font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="text-meta text-foreground-muted mt-1">{description}</p>
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
  onReset,
}: {
  sharing: UseSharingIdentityResult;
  onSetUp: () => void;
  onRotate: () => void;
  onRestore: () => void;
  onDisconnect: () => void;
  onReset: () => void;
}) {
  const { status, sidecar } = sharing;
  return (
    <Card
      id="sharing"
      title="Account and keys"
      description="The verified email and the on-device keypair behind your profile. This is what proves it is you when you send a share or open one someone sent you."
    >
      {status === "loading" && (
        <p className="text-body text-foreground-muted">Checking your sharing setup…</p>
      )}

      {status === "none" && (
        <div className="flex items-start justify-between gap-4">
          <p className="text-body text-foreground leading-relaxed max-w-prose">
            You have not set up sharing yet. Set it up to send and receive
            research across folders. It takes about a minute and you stay in
            control of your keys.
          </p>
          <button
            type="button"
            onClick={onSetUp}
            className="ros-btn-raise px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg whitespace-nowrap"
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
          onReset={onReset}
        />
      )}

      {status === "needs-restore" && sidecar && (
        <NeedsRestoreIdentity
          sidecar={sidecar}
          onRestore={onRestore}
          onReset={onReset}
        />
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
      ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30"
      : "text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 border-amber-300 dark:border-amber-500/30";
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
    <span className="text-meta font-medium text-foreground-muted w-32 shrink-0">
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
      <div className="min-w-0 flex-1 text-body text-foreground">{children}</div>
    </div>
  );
}

function ReadyIdentity({
  sidecar,
  onRotate,
  onDisconnect,
  onReset,
}: {
  sidecar: SharingIdentitySidecar;
  onRotate: () => void;
  onDisconnect: () => void;
  onReset: () => void;
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
        <h3 className="text-body font-semibold text-foreground">Your identity</h3>
        <Pill
          tone="emerald"
          label="On this device"
          tip="Your private key is stored in this browser on this device. Shares are sealed to it."
        />
      </div>

      {/* The email row only exists once the identity has been PUBLISHED to the
          directory (OAuth, optional). A local-only account has keys but no email. */}
      {sidecar.email && (
        <InfoRow label="Email">
          <span className="break-all">{sidecar.email}</span>
        </InfoRow>
      )}

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
            className="inline-flex items-center gap-1 text-meta text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
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

      {/* "Set up" shows the publish date when published, else the local
          create date. Both are optional on older/local-only sidecars. */}
      {(sidecar.claimedAt ?? sidecar.createdAt) && (
        <InfoRow label="Set up">
          {formatDate((sidecar.claimedAt ?? sidecar.createdAt) as string)}
        </InfoRow>
      )}

      <InfoRow label="Recovery words">
        {sidecar.recoveryConfirmedAt ? (
          <span className="text-emerald-600 dark:text-emerald-400 font-medium">Confirmed</span>
        ) : (
          <div className="space-y-1">
            <span className="text-foreground-muted">Not confirmed</span>
            <p className="text-meta text-foreground-muted leading-relaxed">
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
            className="ros-btn-neutral px-3 py-1.5 text-body"
          >
            Rotate key
          </button>
        </Tooltip>
        <button
          type="button"
          onClick={onDisconnect}
          className="ros-btn-destructive px-3 py-1.5 text-body"
        >
          Disconnect from this device
        </button>
        <Tooltip
          label="Abandon this identity and start fresh with a new keypair and new recovery words. Use this if you lost your recovery words or want a clean slate."
          placement="top"
        >
          <button
            type="button"
            onClick={onReset}
            className="ros-btn-destructive px-3 py-1.5 text-body"
          >
            Reset identity
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function NeedsRestoreIdentity({
  sidecar,
  onRestore,
  onReset,
}: {
  sidecar: SharingIdentitySidecar;
  onRestore: () => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-body font-semibold text-foreground">Your account</h3>
        <Pill
          tone="amber"
          label="Key not in this browser"
          tip="Your account is set up; the private key that signs your shares just is not in this browser yet. Restore it with your recovery words."
        />
      </div>

      {/* Email only present once published to the directory (optional). */}
      {sidecar.email && (
        <InfoRow label="Email">
          <span className="break-all">{sidecar.email}</span>
        </InfoRow>
      )}
      <InfoRow
        label="Fingerprint"
        labelTip="Read these characters aloud with the other person to confirm you are sending to the right identity."
      >
        <span className="font-mono tracking-wide break-all">
          {sidecar.fingerprint}
        </span>
      </InfoRow>
      {(sidecar.claimedAt ?? sidecar.createdAt) && (
        <InfoRow label="Set up">
          {formatDate((sidecar.claimedAt ?? sidecar.createdAt) as string)}
        </InfoRow>
      )}

      <p className="text-body text-foreground leading-relaxed max-w-prose pt-1">
        Your account is set up. The private key that signs your shares just is
        not in this browser yet. Restore it with your recovery words to send
        and open shares from here.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRestore}
          className="ros-btn-raise px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg"
        >
          Restore with recovery words
        </button>
        <Tooltip
          label="Lost your recovery words? Abandon this identity and start fresh with a new keypair and new recovery words."
          placement="top"
        >
          <button
            type="button"
            onClick={onReset}
            className="ros-btn-destructive px-3 py-2 text-body"
          >
            Reset identity
          </button>
        </Tooltip>
      </div>
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
          <p className="text-body text-foreground-muted leading-relaxed">
            Encrypted items may be waiting. Restore your key on this device to see
            and open them.
          </p>
        ) : status === "ready" ? (
          // Account exists and is unlocked here, but it is local-only (no
          // published email), so there is no directory inbox yet. Publishing a
          // profile is what opens the inbox.
          <div className="flex items-center justify-between gap-4">
            <p className="text-body text-foreground-muted leading-relaxed">
              Publish a profile to receive shares in your inbox.
            </p>
            <button
              type="button"
              onClick={onSetUp}
              className="ros-btn-raise px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg whitespace-nowrap"
            >
              Publish a profile
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="text-body text-foreground-muted leading-relaxed">
              Set up sharing to use the inbox.
            </p>
            {status === "none" && (
              <button
                type="button"
                onClick={onSetUp}
                className="ros-btn-raise px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg whitespace-nowrap"
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

/**
 * One labeled budget gauge for the Inbox and storage card. Always rendered,
 * even at zero, so a user always sees the framing (an empty bar at 0 percent,
 * not a missing one). Turns amber past 80 percent of the ceiling.
 */
function BudgetBar({
  label,
  valueLabel,
  pct,
}: {
  label: string;
  valueLabel: string;
  pct: number;
}) {
  const over80 = pct > 80;
  const pctLabel = pct === 0 ? "0%" : pct < 1 ? "<1%" : `${Math.round(pct)}%`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-meta font-medium text-foreground-muted">{label}</span>
        <span className="text-meta text-foreground-muted">
          {valueLabel}
          <span className={`ml-2 font-semibold ${over80 ? "text-amber-600 dark:text-amber-400" : "text-foreground-muted"}`}>
            {pctLabel}
          </span>
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={`h-full rounded-full ${over80 ? "bg-amber-500" : "bg-blue-500"}`}
          style={{ width: `${pct > 0 ? Math.max(pct, 2) : 0}%` }}
        />
      </div>
    </div>
  );
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
  const storagePct = Math.min((totalBytes / FREE_STORAGE_BYTES) * 100, 100);
  const sharePct = Math.min((count / PENDING_SHARE_CAP) * 100, 100);

  return (
    <Card
      title="Inbox and storage"
      description="Shares people send you wait in an encrypted inbox until you import them."
    >
      {query.isLoading && (
        <p className="text-body text-foreground-muted">Loading your inbox…</p>
      )}

      {unavailable && (
        <p className="text-body text-foreground-muted leading-relaxed">
          Your inbox is unavailable offline. Your identity and keys are still
          here on this device.
        </p>
      )}

      {!query.isLoading && !unavailable && query.isError && (
        <p className="text-body text-foreground-muted leading-relaxed">
          Could not load your inbox right now. Try again in a moment.
        </p>
      )}

      {!query.isLoading && !unavailable && !query.isError && (
        <>
          <p className="text-body text-foreground">
            {count === 0
              ? "Nothing pending yet. Shares people send you wait in your encrypted inbox until you import them."
              : `${count} pending ${count === 1 ? "share" : "shares"} in your encrypted inbox.`}
          </p>

          <div className="mt-3 space-y-3">
            <BudgetBar
              label="Storage"
              valueLabel={`${humanBytes(totalBytes)} of ${humanBytes(FREE_STORAGE_BYTES)}`}
              pct={storagePct}
            />
            <BudgetBar
              label="Shares"
              valueLabel={`${count} of ${PENDING_SHARE_CAP}`}
              pct={sharePct}
            />
          </div>

          <p className="mt-3 text-meta text-foreground-muted leading-relaxed">
            Pending shares are held for {TTL_DAYS} days, then removed.
          </p>

          <div className="flex items-center justify-between gap-4 pt-1">
            <p className="text-meta text-foreground-muted leading-relaxed">
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
                className="px-3 py-2 text-body bg-surface-sunken text-foreground-muted rounded-lg whitespace-nowrap cursor-not-allowed"
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
// PublicationManager — inline sub-component for pin/hide management.
// ===========================================================================

function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PublicationManager({
  orcid,
  pinned,
  hidden,
  onChange,
}: {
  orcid: string;
  pinned: string[];
  hidden: string[];
  onChange: (pinned: string[], hidden: string[]) => void;
}) {
  const [works, setWorks] = useState<OrcidWork[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchOrcidPublications(orcid).then((w) => {
      if (!cancelled) setWorks(w);
    });
    return () => {
      cancelled = true;
    };
  }, [orcid]);

  const pinnedSet = new Set(pinned);
  const hiddenSet = new Set(hidden);

  const togglePin = useCallback(
    (putCode: string) => {
      if (pinnedSet.has(putCode)) {
        onChange(
          pinned.filter((pc) => pc !== putCode),
          hidden,
        );
      } else {
        onChange([...pinned, putCode], hidden);
      }
    },
    [pinned, hidden, pinnedSet, onChange],
  );

  const toggleHide = useCallback(
    (putCode: string) => {
      if (hiddenSet.has(putCode)) {
        onChange(pinned, hidden.filter((pc) => pc !== putCode));
      } else {
        // Hiding a work that was pinned also removes it from pins.
        onChange(
          pinned.filter((pc) => pc !== putCode),
          [...hidden, putCode],
        );
      }
    },
    [pinned, hidden, hiddenSet, onChange],
  );

  if (works === undefined) {
    return (
      <p className="text-meta text-foreground-muted">Loading publications from ORCID...</p>
    );
  }

  if (works.length === 0) {
    return (
      <p className="text-meta text-foreground-muted">
        No public works found on ORCID for this iD.
      </p>
    );
  }

  // Show pinned works first, then the rest.
  const sorted = [...works].sort((a, b) => {
    const ia = pinned.indexOf(a.putCode);
    const ib = pinned.indexOf(b.putCode);
    const pa = ia >= 0 ? ia : Infinity;
    const pb = ib >= 0 ? ib : Infinity;
    if (pa !== pb) return pa - pb;
    return (b.year ?? "0000").localeCompare(a.year ?? "0000");
  });

  return (
    <div className="space-y-1.5">
      {sorted.map((w) => {
        const isPinned = pinnedSet.has(w.putCode);
        const isHidden = hiddenSet.has(w.putCode);
        return (
          <div
            key={w.putCode}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
              isHidden
                ? "border-border bg-surface-sunken opacity-50"
                : isPinned
                ? "border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/15"
                : "border-border bg-surface-raised"
            }`}
          >
            <div className="min-w-0 flex-1">
              <p
                className={`text-meta leading-snug font-medium ${
                  isHidden ? "line-through text-foreground-muted" : "text-foreground"
                }`}
              >
                {w.title}
              </p>
              {(w.journal || w.year) && (
                <p className="text-meta text-foreground-muted">
                  {[w.journal, w.year].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip
                label={isPinned ? "Unpin" : "Pin to top"}
                placement="top"
              >
                <button
                  type="button"
                  onClick={() => togglePin(w.putCode)}
                  disabled={isHidden}
                  className={`rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                    isPinned
                      ? "text-sky-600 hover:text-sky-800"
                      : "text-foreground-muted hover:text-sky-500"
                  }`}
                  aria-pressed={isPinned}
                >
                  <PinIcon className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
              <Tooltip
                label={isHidden ? "Show" : "Hide from profile"}
                placement="top"
              >
                <button
                  type="button"
                  onClick={() => toggleHide(w.putCode)}
                  className={`rounded p-1 transition-colors ${
                    isHidden
                      ? "text-foreground-muted hover:text-foreground"
                      : "text-foreground-muted hover:text-foreground-muted"
                  }`}
                  aria-pressed={isHidden}
                >
                  {isHidden ? (
                    <EyeIcon className="h-3.5 w-3.5" />
                  ) : (
                    <EyeOffIcon className="h-3.5 w-3.5" />
                  )}
                </button>
              </Tooltip>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Section 3, Researcher profile (opt-in searchable directory, section 17).
// ===========================================================================

/** ORCID iD format validator — 16 digits in 4 groups, last char may be X. */
function isValidOrcid(v: string): boolean {
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(v);
}

// The researcher profile editor, now rendered on the dedicated /profile page
// (2026-06-05). Exported for that page. Gate on a ready identity at the call
// site, the editor assumes a published identity exists.
export function ProfileEditorCard() {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<PublishedProfile | null | undefined>(
    undefined,
  ); // undefined = not loaded yet

  // Draft fields
  const [draftName, setDraftName] = useState("");
  const [draftAffiliation, setDraftAffiliation] = useState("");
  const [draftOrcid, setDraftOrcid] = useState("");
  const [draftPinned, setDraftPinned] = useState<string[]>([]);
  const [draftHidden, setDraftHidden] = useState<string[]>([]);
  // Email-nudge preference. Defaults to true (opted in) for a brand-new profile
  // and reads the published value (already coerced to a boolean) when editing.
  const [draftNotify, setDraftNotify] = useState(true);

  // Load on mount
  useEffect(() => {
    let cancelled = false;
    fetchMyProfile().then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openEdit = useCallback(() => {
    setDraftName(profile?.displayName ?? "");
    setDraftAffiliation(profile?.affiliation ?? "");
    setDraftOrcid(profile?.orcid ?? "");
    setDraftPinned(profile?.pinnedWorks ?? []);
    setDraftHidden(profile?.hiddenWorks ?? []);
    setDraftNotify(profile?.notifyOnCollabInvite ?? true);
    setError(null);
    setEditing(true);
  }, [profile]);

  const handlePublicationChange = useCallback(
    (pinned: string[], hidden: string[]) => {
      setDraftPinned(pinned);
      setDraftHidden(hidden);
    },
    [],
  );

  const save = useCallback(async () => {
    const name = hardenName(draftName, MAX_LENGTH_NAME).trim();
    if (!name) {
      setError("A display name is required.");
      return;
    }
    if (charsOver(draftName, MAX_LENGTH_NAME) > 0) {
      setError(`Display name must be ${MAX_LENGTH_NAME} characters or fewer.`);
      return;
    }
    const affiliation = draftAffiliation.trim() || null;
    if (affiliation && affiliation.length > 200) {
      setError("Affiliation must be 200 characters or fewer.");
      return;
    }
    const orcid = draftOrcid.trim() || null;
    if (orcid && !isValidOrcid(orcid)) {
      setError(
        "ORCID iD format is 0000-0002-1825-0097. Check the value and try again.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    // `name` is already hardened (stripControlChars + cap) by the hardenName
    // call at the top of save. Reflect it in the draft so the input shows the
    // cleaned form if the user cancels and re-opens.
    if (name !== draftName.trim()) setDraftName(name);
    const result = await publishProfile({
      displayName: name,
      affiliation,
      orcid,
      pinnedWorks: draftPinned,
      hiddenWorks: draftHidden,
      notifyOnCollabInvite: draftNotify,
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save your profile. Try again.");
      return;
    }

    // Anonymous adoption counter, booleans only (no name, institution, ORCID).
    trackProfilePublished({
      hasOrcid: !!orcid,
      hasAffiliation: !!affiliation,
    });

    // Refresh from server so affiliationDomain reflects what the server set.
    const updated = await fetchMyProfile();
    setProfile(updated);
    setEditing(false);
  }, [draftName, draftAffiliation, draftOrcid, draftPinned, draftHidden, draftNotify]);

  const remove = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await unpublishProfile();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not remove your profile. Try again.");
      return;
    }
    setProfile(null);
  }, []);

  const loading = profile === undefined;

  return (
    <Card
      id="researcher-profile"
      title="Your researcher profile"
      description="This is your profile on ResearchOS. Other researchers can find you by name or institution, and you control what it shows."
    >
      {loading && (
        <p className="text-body text-foreground-muted">Loading your profile…</p>
      )}

      {!loading && !editing && profile === null && (
        <div className="flex items-start justify-between gap-4">
          <p className="text-body text-foreground leading-relaxed max-w-prose">
            Your profile just needs a name. Add it so other researchers can find
            you, then fill in your institution and ORCID whenever you like.
          </p>
          <button
            type="button"
            onClick={openEdit}
            className="ros-btn-raise px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg whitespace-nowrap"
          >
            Add your name
          </button>
        </div>
      )}

      {!loading && !editing && profile !== null && profile !== undefined && (
        <div className="space-y-3">
          <InfoRow label="Display name">
            <span className="font-medium">{profile.displayName}</span>
          </InfoRow>

          {profile.affiliation && (
            <InfoRow label="Affiliation">
              <div className="flex flex-wrap items-center gap-2">
                <span>{profile.affiliation}</span>
                {profile.affiliationDomain && (
                  <Tooltip
                    label={`Verified from your ${profile.affiliationDomain} login`}
                    placement="top"
                  >
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 px-2 py-0.5 text-meta font-medium text-emerald-700 dark:text-emerald-300">
                      Verified
                    </span>
                  </Tooltip>
                )}
              </div>
            </InfoRow>
          )}

          {profile.orcid && (
            <InfoRow label="ORCID iD">
              <a
                href={`https://orcid.org/${profile.orcid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sky-700 dark:text-sky-400 hover:underline underline-offset-2"
              >
                {profile.orcid}
              </a>
            </InfoRow>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={openEdit}
              className="ros-btn-neutral px-3 py-1.5 text-body"
            >
              Edit profile
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="ros-btn-destructive px-3 py-1.5 text-body disabled:opacity-50"
            >
              {busy ? "Removing…" : "Remove from directory"}
            </button>
          </div>

          {error && (
            <p className="text-meta text-red-600 dark:text-red-400 leading-relaxed">{error}</p>
          )}
        </div>
      )}

      {!loading && editing && (
        <div className="space-y-4">
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-meta font-medium text-foreground">
                  Display name
                  <span className="text-red-500 ml-0.5" aria-label="required">
                    *
                  </span>
                </label>
                {charsOver(draftName, MAX_LENGTH_NAME) > 0 && (
                  <span className="text-meta text-red-600 dark:text-red-400" role="alert">
                    {charsOver(draftName, MAX_LENGTH_NAME)} over limit
                  </span>
                )}
              </div>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Your name as other researchers will see it"
                maxLength={MAX_LENGTH_NAME + 20}
                disabled={busy}
                className={`w-full rounded-lg border px-3 py-2 text-body text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 disabled:opacity-50 ${
                  charsOver(draftName, MAX_LENGTH_NAME) > 0
                    ? "border-red-400 focus:border-red-400 focus:ring-red-200"
                    : "border-border focus:border-sky-500 focus:ring-sky-200"
                }`}
              />
            </div>

            <div>
              <label className="block text-meta font-medium text-foreground mb-1">
                Affiliation
              </label>
              <input
                type="text"
                value={draftAffiliation}
                onChange={(e) => setDraftAffiliation(e.target.value)}
                placeholder="University, institution, or lab"
                maxLength={200}
                disabled={busy}
                className="w-full rounded-lg border border-border px-3 py-2 text-body text-foreground placeholder-foreground-muted focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-50"
              />
              <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
                If you sign in with an institutional account, your email domain
                will be shown as verified on your profile automatically.
              </p>
            </div>

            <div>
              <label className="block text-meta font-medium text-foreground mb-1">
                ORCID iD
              </label>
              <input
                type="text"
                value={draftOrcid}
                onChange={(e) => setDraftOrcid(e.target.value)}
                placeholder="0000-0002-1825-0097"
                maxLength={19}
                disabled={busy}
                className="w-full rounded-lg border border-border px-3 py-2 font-mono text-body text-foreground placeholder-foreground-muted focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-50"
              />
              <p className="mt-1 text-meta text-foreground-muted leading-relaxed">
                Optional. Your ORCID iD is shown on your profile as a public
                identifier, not verified here.
              </p>
            </div>

            {isValidOrcid(draftOrcid.trim()) && (
              <div>
                <p className="text-meta font-medium text-foreground mb-1.5">
                  Manage publications
                </p>
                <p className="mb-2 text-meta text-foreground-muted leading-relaxed">
                  Pin papers to show them first, or hide ones you prefer not to
                  display. Changes take effect when you save.
                </p>
                <PublicationManager
                  orcid={draftOrcid.trim()}
                  pinned={draftPinned}
                  hidden={draftHidden}
                  onChange={handlePublicationChange}
                />
              </div>
            )}

            <div className="border-t border-border pt-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftNotify}
                  onChange={(e) => setDraftNotify(e.target.checked)}
                  disabled={busy}
                  className="mt-0.5 h-4 w-4 rounded border-border text-blue-600 focus:ring-2 focus:ring-sky-200 disabled:opacity-50"
                />
                <span className="text-meta text-foreground leading-relaxed">
                  <span className="font-medium">
                    Email me when someone invites me to collaborate
                  </span>
                  <span className="block text-foreground-muted">
                    You always see invites in ResearchOS under Shared with me.
                    Turn this on to also get an email nudge. The email names the
                    sender and the item title, never any research content.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {error && (
            <p className="text-meta text-red-600 dark:text-red-400 leading-relaxed">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={busy}
              className="ros-btn-neutral flex-1 px-3 py-2 text-body disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="ros-btn-raise flex-1 px-3 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg font-medium disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save profile"}
            </button>
          </div>
        </div>
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
  // Escape closes any dialog built on this shell (app-wide convention).
  useEscapeToClose(onClose);
  // These identity dialogs are little popups, so they never blur (Grant
  // 2026-06-06). They open from inside the Profile popup, which already dims +
  // blurs the page, so register in the popup stack and only paint our own dim
  // when we are the bottom-most popup. Otherwise we double-dim the popup below.
  const { shouldDim } = usePopupLayer(true, false);
  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center ${
        shouldDim ? "bg-black/50" : ""
      }`}
      onClick={onClose}
    >
      <div
        className="bg-surface-raised rounded-2xl ros-popup-card-shadow border border-border max-w-xl w-full mx-4 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-start justify-between shrink-0">
          <div>
            <h3 className="text-title font-semibold text-foreground">{title}</h3>
            {subtitle && (
              <p className="text-meta text-foreground-muted mt-0.5">{subtitle}</p>
            )}
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
        <div className="px-6 py-5 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

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
      placeholder="Enter your recovery code, or your 12 recovery words"
      className="w-full px-3 py-2 bg-surface-sunken border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500 text-body font-mono disabled:opacity-50"
      autoFocus
    />
  );
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
type RestoreMode = "email" | "kit";

/**
 * Unwraps a backup blob with the entered words, verifies the recovered identity
 * matches the sidecar, persists the private keys to this device, and marks
 * recovery confirmed. Shared by the email-OTP path and the offline Recovery Kit
 * path, so both end the same way. Returns null on success or a user-facing error
 * message on failure (a bad phrase, or a phrase that belongs to a different
 * identity).
 */
async function finalizeRestore(
  blob: string,
  words: string,
  sidecar: SharingIdentitySidecar,
  username: string,
): Promise<string | null> {
  // Accept either the recovery code or the 12 words, both canonicalize to the
  // same mnemonic string the unwrap path expects.
  const mnemonic = normalizeRecoveryInput(words);
  if (!mnemonic) {
    return "That recovery code or phrase is not valid. Check it and try again.";
  }

  // Unwrap with the recovered mnemonic. A wrong secret throws (Poly1305).
  let restored;
  try {
    restored = restoreFromRecoveryWords(mnemonic, blob);
  } catch {
    return "That recovery code or phrase does not match this identity. Check it and try again.";
  }

  // The recovered keys must match the published identity, otherwise the secret
  // belongs to a different identity.
  if (restored.ed25519PublicKey !== sidecar.ed25519PublicKey) {
    return "That recovery code or phrase does not match this identity. Check it and try again.";
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
      recoveryConfirmedAt:
        sidecar.recoveryConfirmedAt ?? new Date().toISOString(),
    });
  } catch {
    // The key is restored even if the sidecar rewrite fails, do not block.
  }

  return null;
}

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
  const [mode, setMode] = useState<RestoreMode>("email");
  const [words, setWords] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The parsed Recovery Kit, when the user uploads or pastes one.
  const [kit, setKit] = useState<RecoveryKitData | null>(null);

  const email = sidecar?.email ?? "";

  const sendCode = useCallback(async () => {
    setError(null);
    if (!normalizeRecoveryInput(words)) {
      setError("Enter your recovery code, or your 12 recovery words.");
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

      const failure = await finalizeRestore(
        fetched.blob,
        words,
        sidecar,
        username,
      );
      if (failure) {
        setError(failure);
        setStep("code");
        return;
      }

      setStep("done");
    } finally {
      setBusy(false);
    }
  }, [sidecar, email, otp, words, username]);

  // ---- Recovery Kit path (offline, no email, no network) -------------------

  // Reads a chosen kit file and parses it. We accept the SAME kit whichever way
  // it arrives (file upload or paste), so this just hands the text to the parser.
  const loadKitText = useCallback((text: string) => {
    setError(null);
    const parsed = parseRecoveryKit(text);
    if (!parsed) {
      setKit(null);
      setError(
        "That file is not a ResearchOS Recovery Kit. Choose the kit you downloaded when you set up sharing.",
      );
      return;
    }
    setKit(parsed);
  }, []);

  const onKitFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      try {
        const text = await file.text();
        loadKitText(text);
      } catch {
        setError("Could not read that file. Try choosing it again.");
      }
    },
    [loadKitText],
  );

  const restoreFromKit = useCallback(async () => {
    if (!sidecar || !kit) return;
    setError(null);
    if (!normalizeRecoveryInput(words)) {
      setError("Enter your recovery code, or your 12 recovery words.");
      return;
    }
    setStep("verifying");
    setBusy(true);
    try {
      const failure = await finalizeRestore(
        kit.backupBlob,
        words,
        sidecar,
        username,
      );
      if (failure) {
        setError(failure);
        setStep("intro");
        return;
      }
      setStep("done");
    } finally {
      setBusy(false);
    }
  }, [sidecar, kit, words, username]);

  const switchMode = useCallback((next: RestoreMode) => {
    setMode(next);
    setError(null);
    setOtp("");
    setStep("intro");
  }, []);

  return (
    <ModalShell title="Restore your sharing identity" subtitle={`for ${username}`} onClose={onClose}>
      {step === "intro" && mode === "email" && (
        <div className="space-y-4">
          <p className="text-body text-foreground-muted leading-relaxed">
            Restore your sharing identity on this device. Enter the recovery
            code (or the 12 recovery words) you saved when you set up sharing.
          </p>
          <WordsInput value={words} onChange={setWords} disabled={busy} />
          {error && <ErrorNotice message={error} />}
          <button
            type="button"
            onClick={sendCode}
            disabled={busy}
            className="ros-btn-raise w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white disabled:opacity-50"
          >
            {busy ? "Sending code…" : "Continue"}
          </button>
          <p className="text-meta text-foreground-muted leading-relaxed">
            We send a 6-digit code to {email || "your email"} to confirm it is you
            before handing back your encrypted key backup. Only your words can
            unlock it.
          </p>
          <button
            type="button"
            onClick={() => switchMode("kit")}
            className="text-meta text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-2"
          >
            No access to your email? Use your Recovery Kit
          </button>
        </div>
      )}

      {step === "intro" && mode === "kit" && (
        <div className="space-y-4">
          <p className="text-body text-foreground-muted leading-relaxed">
            Restore offline with the Recovery Kit you downloaded. Upload or paste
            the kit, then enter your recovery code (or your 12 recovery words). No
            email and no network are needed.
          </p>

          <div className="space-y-2">
            <FileDropzone
              accept=".html,text/html,application/json,.json"
              disabled={busy}
              label="Drag and drop your Recovery Kit file"
              hint=".html or .json"
              icon="import"
              compact
              onFiles={(files) => void onKitFile(files[0])}
            />
            <textarea
              onChange={(e) => loadKitText(e.target.value)}
              disabled={busy}
              rows={2}
              placeholder="Or paste the contents of your Recovery Kit file here"
              className="w-full px-3 py-2 bg-surface-sunken border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500 text-meta font-mono disabled:opacity-50"
            />
          </div>

          {kit && (
            <div className="flex items-start gap-2 p-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-400/25 rounded-lg">
              <span className="text-emerald-700 dark:text-emerald-300 mt-0.5">
                <CheckIcon className="w-4 h-4" />
              </span>
              <p className="text-meta text-emerald-700 dark:text-emerald-200 leading-relaxed break-all">
                Kit loaded for {kit.email}.
              </p>
            </div>
          )}

          <WordsInput value={words} onChange={setWords} disabled={busy} />
          {error && <ErrorNotice message={error} />}
          <button
            type="button"
            onClick={restoreFromKit}
            disabled={busy || !kit}
            className="ros-btn-raise w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <UploadIcon className="w-4 h-4" />
            Restore my key
          </button>
          <button
            type="button"
            onClick={() => switchMode("email")}
            className="text-meta text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-2"
          >
            Use email instead
          </button>
        </div>
      )}

      {step === "code" && (
        <div className="space-y-4">
          <p className="text-body text-foreground-muted leading-relaxed">
            Enter the 6-digit code we sent to{" "}
            <span className="text-foreground font-medium">{email}</span>.
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="w-full px-3 py-2 bg-surface-sunken border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500 text-title tracking-[0.4em] text-center"
            autoFocus
          />
          {error && <ErrorNotice message={error} />}
          <button
            type="button"
            onClick={verify}
            disabled={busy || otp.length !== 6}
            className="ros-btn-raise w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white disabled:opacity-50"
          >
            Restore my key
          </button>
        </div>
      )}

      {step === "verifying" && (
        <div className="py-8 flex flex-col items-center text-center">
          <div className="w-10 h-10 rounded-full border-2 border-border border-t-blue-400 animate-spin" />
          <p className="text-body text-foreground-muted mt-4 font-medium">
            Checking your recovery code…
          </p>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center text-center py-2">
            <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/30 flex items-center justify-center text-emerald-700 dark:text-emerald-300">
              <CheckIcon className="w-6 h-6" />
            </div>
            <p className="text-title font-semibold text-foreground mt-3">
              Your key is restored
            </p>
            <p className="text-body text-foreground-muted mt-1 leading-relaxed">
              You can send and open shares on this device now.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ros-btn-raise w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white"
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
          <p className="text-body text-foreground-muted leading-relaxed">
            Rotate your key? This replaces your keypair and gives you fresh
            recovery words. Your email stays the same. People you have shared with
            will need your new fingerprint to verify you.
          </p>
          {pendingCount !== null && pendingCount > 0 && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-400/30 rounded-lg">
              <span className="text-amber-700 dark:text-amber-300 mt-0.5">
                <WarningIcon className="w-4 h-4" />
              </span>
              <p className="text-meta text-amber-700 dark:text-amber-200 leading-relaxed">
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
              className="ros-btn-neutral flex-1 py-2 text-body"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setStep("generating")}
              className="ros-btn-raise flex-1 py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white"
            >
              Rotate key
            </button>
          </div>
        </div>
      )}

      {(step === "generating" || step === "publishing") && (
        <div className="py-8 flex flex-col items-center text-center">
          <div className="w-10 h-10 rounded-full border-2 border-border border-t-blue-400 animate-spin" />
          <p className="text-body text-foreground-muted mt-4 font-medium">
            {step === "generating" ? "Generating your new keys" : "Rotating your key"}
          </p>
          <p className="text-meta text-foreground-muted mt-1 leading-relaxed">
            {step === "generating"
              ? "This runs once and can take a few seconds. The app may pause briefly while it works."
              : "Binding your new keys to the same email."}
          </p>
        </div>
      )}

      {step === "show-words" && material && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-300">
            <KeyIcon className="w-5 h-5" />
            <p className="text-body font-medium text-foreground">
              Your new Recovery Words
            </p>
          </div>
          <p className="text-body text-foreground-muted leading-relaxed">
            Write these 12 words down and store them somewhere safe. Your old
            words no longer work after this rotation.
          </p>
          <div className="grid grid-cols-3 gap-2 p-3 bg-surface-sunken border border-border rounded-lg">
            {words.map((word, i) => (
              <div key={`${word}-${i}`} className="flex items-center gap-1.5 text-body text-foreground">
                <span className="text-meta text-foreground-muted w-4 text-right tabular-nums">
                  {i + 1}
                </span>
                <span className="font-mono">{word}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={copyWords}
            className="flex items-center gap-1.5 text-meta text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
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
            <span className="text-body text-foreground-muted leading-relaxed">
              I have saved my new recovery words somewhere safe.
            </span>
          </label>
          {error && <ErrorNotice message={error} />}
          <button
            type="button"
            onClick={publish}
            disabled={!recoverySaved}
            className="ros-btn-raise w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white disabled:opacity-50"
          >
            Publish my new key
          </button>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center text-center py-2">
            <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/30 flex items-center justify-center text-emerald-700 dark:text-emerald-300">
              <CheckIcon className="w-6 h-6" />
            </div>
            <p className="text-title font-semibold text-foreground mt-3">
              Your key is rotated
            </p>
            <p className="text-body text-foreground-muted mt-1 leading-relaxed">
              Save your new recovery words, the old ones no longer work.
            </p>
          </div>
          {error && <ErrorNotice message={error} />}
          <button
            type="button"
            onClick={onClose}
            className="ros-btn-raise w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white"
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
        <p className="text-body text-foreground-muted leading-relaxed">
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
            className="ros-btn-neutral flex-1 py-2 text-body disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="ros-btn-raise flex-1 py-2 text-body rounded-lg font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// ResetIdentityPopup, abandon the current identity and start over fresh.
//
// Unlike Disconnect (which keeps the published identity and only drops the local
// key), Reset deletes the sidecar AND the local key, then reopens the setup
// wizard. The wizard mints a brand-new keypair and re-verifies the email, and the
// server's upsertBinding overwrites the old email -> key binding. This is the
// escape hatch for a user who lost their recovery words, suspects key compromise,
// or just wants a clean slate. It is destructive (the old words and anything
// sealed to the old key become unusable), so it stays behind this confirm modal.
// ---------------------------------------------------------------------------

export function ResetIdentityPopup({
  username,
  pendingCount,
  onConfirmed,
  onClose,
}: {
  username: string;
  pendingCount: number | null;
  onConfirmed: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      // Delete the public sidecar first so the account reads as unclaimed, then
      // drop any local private key. The wizard the parent opens next mints a
      // fresh keypair and the server upsert replaces the old binding.
      await deleteSharingIdentity(username);
      await clearIdentity();
      onConfirmed();
    } catch {
      setError("Could not reset your identity. Try again.");
      setBusy(false);
    }
  }, [username, onConfirmed]);

  return (
    <ModalShell
      title="Reset your identity and start over?"
      subtitle={`for ${username}`}
      onClose={onClose}
    >
      <div className="space-y-4">
        <p className="text-body text-foreground-muted leading-relaxed">
          This abandons your current sharing identity and sets up a fresh one. A
          new keypair and a new fingerprint will be generated, and your current 12
          recovery words will stop working. Anyone who verified your old
          fingerprint will need to verify the new one before they can send to you.
        </p>
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-400/30 rounded-lg">
          <span className="text-amber-700 dark:text-amber-300 mt-0.5">
            <WarningIcon className="w-4 h-4" />
          </span>
          <p className="text-meta text-amber-700 dark:text-amber-200 leading-relaxed">
            Anything sealed to your old key becomes permanently unopenable.
            {pendingCount !== null && pendingCount > 0 && (
              <>
                {" "}You have {pendingCount} pending{" "}
                {pendingCount === 1 ? "item" : "items"} waiting that you will not
                be able to open after you reset.
              </>
            )}
          </p>
        </div>
        {error && <ErrorNotice message={error} />}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="ros-btn-neutral flex-1 py-2 text-body disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="ros-btn-raise flex-1 py-2 text-body rounded-lg font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
          >
            {busy ? "Resetting…" : "Reset and start over"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
