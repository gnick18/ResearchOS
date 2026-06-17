"use client";

// Shared-with-me segment of the unified inbox (cross-boundary sharing 2b-iii).
//
// One row per received bundle sitting in the relay, addressed to this user's
// key. The flow is review-then-import, nothing is auto-filed. The user reviews
// a decrypted preview, then explicitly imports into their notes (which stamps a
// provenance marker so the item stays traceable), or declines (acks without
// importing). The relay copy is deleted only AFTER the local write resolves
// (ack-after-write), so a crash mid-import never loses the bundle.
//
// IDENTITY GATE. The segment only functions when the current user has claimed a
// sharing identity (status "ready"). "none" launches the SharingSetupWizard,
// "needs-restore" prompts a key restore (no list actions are possible without
// the local key).
//
// SENDER LABEL. listInbox returns only a senderEmailHash (the relay is blind, it
// never sees a plaintext address). The sealed bundle, however, now carries the
// sender's own VERIFIED email + key fingerprint inside it (BundleSender, embedded
// on send from the sender's identity sidecar), which the recipient learns only
// after they decrypt the bundle in Review. So a row that has not been reviewed
// yet shows a short hash-derived label, and once Review decrypts a bundle we
// upgrade that row (and the import provenance) to the real email. A bundle built
// before the sender block existed has no embedded identity, so it gracefully
// falls back to the hash everywhere. We never invent a plaintext email we do not
// have.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import Tooltip from "@/components/Tooltip";
import { CloseIcon } from "@/components/sharing/icons";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import {
  listInbox,
  receiveRawShare,
  ackShare,
  type InboxItem,
  type ReceiveShareResult,
} from "@/lib/sharing/relay/client";
import { readBundle, type BundleSender } from "@/lib/sharing/bundle";
import { importNoteBundle } from "@/lib/sharing/note-transfer";
import {
  sniffSharePayload,
  experimentPayloadToFile,
  type SharePayloadKind,
} from "@/lib/sharing/experiment-transfer";
import { methodPayloadToFile } from "@/lib/sharing/method-transfer";
import { projectPayloadToFile } from "@/lib/sharing/project-transfer";
import {
  parseSequencePayload,
  readSequencePayloadSender,
  importSequencePayload,
  type SequenceSharePayload,
} from "@/lib/sharing/sequence-transfer";
import { EmbeddedImportPicker } from "@/components/sharing/EmbeddedImportPicker";
import {
  parseCalculatorPayload,
  readCalculatorPayloadSender,
  importCalculatorPayload,
  type CalculatorSharePayload,
} from "@/lib/sharing/calculator-transfer";
import { readManifestSenderFromPayload } from "@/lib/sharing/sender-stamp";
import ReceivedFromBadge from "@/components/ReceivedFromBadge";
import ImportExperimentDialog from "@/components/ImportExperimentDialog";
import ProjectImportDialog from "@/components/sharing/ProjectImportDialog";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import type { ProjectImportResult } from "@/lib/import/project-apply";
import { recordNoteHistory } from "@/lib/history";
import { fileService } from "@/lib/file-system/file-service";
import { projectsApi } from "@/lib/local-api";
import type { Note, Project } from "@/lib/types";
import type { ImportResult } from "@/lib/import/types";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import {
  listInvites,
  dismissInvite,
  type PendingInvite,
} from "@/lib/collab/client/inbox";
import { acceptInvite } from "@/lib/collab/client/accept";
import { blockSender } from "@/lib/collab/client/block-list";

// ── Pending live-collab invitations (external-collab chunk 4) ────────────────
// Discovery AND accept of a live-collab grant from an outside ResearchOS user.
// Polls listInvites() once on open and surfaces each pending invite.
//
// ACCEPT (chunk 4) runs verify -> materialize -> dismiss. The verify step looks
// the sender's claimed email up in the directory and confirms the registered
// pubkey equals the invite's fromPubkey (acceptInvite / verifySenderBinding).
// On a verify failure NOTHING materializes and a "could not verify sender"
// warning is shown inline. On success a real local note lands in the recipient's
// folder (it then auto-connects to the DO like any collab note) and the row is
// removed. DECLINE just dismisses the invite (no materialize).
//
// The whole section is gated by EXTERNAL_COLLAB_ENABLED and only renders for a
// device with a directory identity (the caller passes enabled accordingly).
// Accept is impossible without a directory identity (the verify lookup + the
// always-on connect token both need it).
type RowState =
  | { phase: "idle" }
  | { phase: "working"; label: string }
  | { phase: "error"; message: string };

function PendingCollabInvites({
  enabled,
  currentUser,
  onAccepted,
}: {
  enabled: boolean;
  currentUser: string | null;
  onAccepted?: (title: string) => void;
}) {
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listInvites();
        if (!cancelled) setInvites(rows);
      } catch (err) {
        // Discovery is best-effort; a failed poll just shows nothing.
        console.warn("[inbox] listInvites failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const setRow = useCallback((docId: string, state: RowState) => {
    setRowState((prev) => ({ ...prev, [docId]: state }));
  }, []);

  const dropInvite = useCallback((docId: string) => {
    setInvites((prev) => prev.filter((i) => i.collabDocId !== docId));
    setRowState((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  }, []);

  const handleAccept = useCallback(
    async (inv: PendingInvite) => {
      if (!currentUser) return;
      setRow(inv.collabDocId, { phase: "working", label: "Verifying sender…" });
      const result = await acceptInvite(inv, currentUser);
      if (result.ok) {
        dropInvite(inv.collabDocId);
        onAccepted?.(inv.title || "the note");
        return;
      }
      const message =
        result.reason === "sender-mismatch" || result.reason === "unverifiable"
          ? "Could not verify the sender. The invite's signing key does not match the directory record for that email, so nothing was added."
          : "Could not add this shared note. Try again in a moment.";
      setRow(inv.collabDocId, { phase: "error", message });
    },
    [currentUser, setRow, dropInvite, onAccepted],
  );

  const handleDecline = useCallback(
    async (inv: PendingInvite) => {
      setRow(inv.collabDocId, { phase: "working", label: "Declining…" });
      try {
        await dismissInvite(inv.collabDocId);
      } catch (err) {
        // A failed dismiss is non-fatal; the invite simply stays. Drop it from
        // the local list anyway so the action feels responsive.
        console.warn("[inbox] decline (dismiss) failed", err);
      }
      dropInvite(inv.collabDocId);
    },
    [setRow, dropInvite],
  );

  // External-collab chunk 5: block the sender (a local, recipient-only setting).
  // Future invites from this email are filtered out client-side on list; the
  // current row is dismissed on the relay and dropped from the view. There is no
  // server moderation backend, so blocking is purely the recipient's preference.
  const handleBlock = useCallback(
    async (inv: PendingInvite) => {
      blockSender(inv.fromEmail);
      setRow(inv.collabDocId, { phase: "working", label: "Blocking…" });
      try {
        await dismissInvite(inv.collabDocId);
      } catch (err) {
        // Non-fatal: the block-list filter hides any re-delivered invite anyway.
        console.warn("[inbox] block (dismiss) failed", err);
      }
      dropInvite(inv.collabDocId);
    },
    [setRow, dropInvite],
  );

  if (!enabled || invites.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold mb-2 px-1">
        Pending invitations
      </p>
      <ul className="space-y-2">
        {invites.map((inv) => {
          const who = inv.fromName || inv.fromEmail || "Someone";
          const title = inv.title || "Untitled note";
          const state = rowState[inv.collabDocId] ?? { phase: "idle" };
          const working = state.phase === "working";
          return (
            <li
              key={inv.collabDocId}
              className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-surface-raised"
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-meta font-semibold uppercase tracking-wide bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300">
                      Live collab
                    </span>
                  </div>
                  <p className="text-body text-foreground truncate">
                    <span className="font-medium">{who}</span> invited you to
                    collaborate on <span className="font-medium">{title}</span>
                  </p>
                  <p className="text-meta text-foreground-muted">
                    {new Date(inv.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleAccept(inv)}
                    disabled={working || !currentUser}
                    className="ros-btn-raise px-3 py-1.5 text-meta font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {working && state.label !== "Declining…"
                      ? state.label
                      : "Accept"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDecline(inv)}
                    disabled={working}
                    className="px-3 py-1.5 text-meta text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-md transition-colors disabled:opacity-40"
                  >
                    Decline
                  </button>
                  {inv.fromEmail && (
                    <button
                      type="button"
                      onClick={() => void handleBlock(inv)}
                      disabled={working}
                      title="Hide all future invites from this sender"
                      className="px-3 py-1.5 text-meta text-foreground-muted hover:bg-surface rounded-md transition-colors disabled:opacity-40"
                    >
                      Block
                    </button>
                  )}
                </div>
              </div>
              {state.phase === "error" && (
                <p className="text-meta text-red-600 dark:text-red-300">
                  {state.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Sender label ─────────────────────────────────────────────────────────────
// The only sender identifier on the wire is the hash. Show a short, stable label
// derived from it so two shares from the same sender read as the same sender,
// without ever implying a plaintext address we do not have.
function senderLabel(hash: string): string {
  const short = hash.slice(0, 10);
  return `Sender ${short}`;
}

// ── Expiry countdown copy ────────────────────────────────────────────────────
function expiryCountdown(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return "";
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `expires in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `expires in ${mins} minute${mins === 1 ? "" : "s"}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human label for a sequence molecule kind (the sequence preview). */
function seqTypeLabel(t: string): string {
  return t === "protein" ? "Protein" : t === "rna" ? "RNA" : "DNA";
}

interface SharedWithMeTabProps {
  /**
   * Notify the shell that the pending-shares count changed so the badge and tab
   * label stay in sync (the badge polls independently, but a successful import /
   * decline should reflect immediately).
   */
  onCountChange?: (count: number) => void;
}

export default function SharedWithMeTab({ onCountChange }: SharedWithMeTabProps) {
  const { currentUser } = useCurrentUser();
  const { status, email, refresh: refreshIdentity } = useSharingIdentity();
  // External-collab is gated through the ONE capability now, replacing the
  // hand-rolled `EXTERNAL_COLLAB_ENABLED && status === "ready" && !!email` that
  // diverged from UnifiedShareDialog. The status-based empty states above stay
  // as genuine identity UX. (capabilities bot, 2026-06-13)
  const { canCollabExternally } = useAccountCapabilities();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // The bundle currently open in the review modal, plus its decrypted content.
  const [reviewItem, setReviewItem] = useState<InboxItem | null>(null);

  // Real sender identity recovered from a bundle's sealed sender block, keyed by
  // bundleId. Populated when Review decrypts an item, so a reviewed row upgrades
  // from the hash label to the verified email. Pre-sender bundles never populate.
  const [resolvedSenders, setResolvedSenders] = useState<
    Record<string, BundleSender>
  >({});

  // Keep onCountChange stable across renders without making it a load dependency.
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const loadList = useCallback(async () => {
    if (status !== "ready" || !email) return;
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await listInbox({ email });
      setItems(rows);
      onCountChangeRef.current?.(rows.length);
    } catch (err) {
      console.error("[inbox] listInbox failed", err);
      setLoadError("Could not load your shared items. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, [status, email]);

  // Load when the identity becomes ready (and on email change).
  useEffect(() => {
    if (status === "ready" && email) void loadList();
  }, [status, email, loadList]);

  // Drop one row locally after a successful import or decline (the relay copy is
  // already acked). Keeps the list responsive without a full re-fetch.
  const dropRow = useCallback((bundleId: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.bundleId !== bundleId);
      onCountChangeRef.current?.(next.length);
      return next;
    });
  }, []);

  // ── Decline: ack WITHOUT importing, then remove the row. ────────────────────
  const handleDecline = useCallback(
    async (item: InboxItem) => {
      if (!email) return;
      try {
        await ackShare({ email, bundleId: item.bundleId });
        dropRow(item.bundleId);
        setReviewItem((cur) => (cur?.bundleId === item.bundleId ? null : cur));
        setToast("Declined. The sender's copy was removed.");
      } catch (err) {
        console.error("[inbox] decline failed", err);
        setToast("Could not decline this item. Try again.");
      }
    },
    [email, dropRow],
  );

  // ── Wizard completion → re-read identity, then load the list. ───────────────
  const handleWizardComplete = useCallback(async () => {
    setWizardOpen(false);
    await refreshIdentity();
    // refreshIdentity flips status to "ready"; the load effect picks it up. We
    // also call loadList directly in case the email was already known.
    await loadList();
  }, [refreshIdentity, loadList]);

  // ── Identity gate ───────────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-body text-foreground-muted text-center py-8">Loading…</p>
      </div>
    );
  }

  if (status === "none") {
    return (
      <>
        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center gap-3">
          <InboxArrowIcon className="w-8 h-8 text-foreground-muted" />
          <p className="text-body text-foreground-muted max-w-xs">
            Set up sharing to receive shared items. You claim an email-linked
            identity once, then notes, methods, sequences, and calculators other
            labs send you land here.
          </p>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="ros-btn-raise px-4 py-2 text-meta font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-md transition-colors"
          >
            Set up sharing
          </button>
        </div>
        {wizardOpen && currentUser && (
          <SharingSetupWizard
            username={currentUser}
            onComplete={() => void handleWizardComplete()}
            onClose={() => setWizardOpen(false)}
          />
        )}
      </>
    );
  }

  if (status === "needs-restore") {
    return (
      <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center gap-3">
        <KeyOutlineIcon className="w-8 h-8 text-amber-400" />
        <p className="text-body text-foreground-muted max-w-xs">
          Encrypted items may be waiting. Restore your key on this device to open
          them. The shared content stays sealed until your key is back.
        </p>
      </div>
    );
  }

  // ── status === "ready": the list ────────────────────────────────────────────
  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        <PendingCollabInvites
          enabled={canCollabExternally}
          currentUser={currentUser}
          onAccepted={(title) =>
            setToast(`Added ${title}. Open it to start collaborating.`)
          }
        />
        {loading ? (
          <p className="text-body text-foreground-muted text-center py-8">Loading…</p>
        ) : loadError ? (
          <div className="text-center py-8">
            <p className="text-body text-red-600 dark:text-red-300">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadList()}
              className="mt-2 text-meta font-medium text-blue-600 dark:text-blue-300 hover:text-blue-800"
            >
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-body text-foreground-muted italic text-center py-8">
            Nothing has been shared with you yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.bundleId}
                className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface-raised hover:border-blue-200 hover:bg-blue-50/30 dark:hover:bg-brand-action/15 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {/* The relay is blind to the entity type, it never records
                        whether a sealed item is a note or an experiment. The
                        kind is only known after Review decrypts and sniffs the
                        bundle, so the row shows a neutral "Shared item" badge
                        and the modal reveals note-vs-experiment. */}
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-meta font-semibold uppercase tracking-wide bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300">
                      <InboxArrowIcon className="w-3 h-3" />
                      Shared item
                    </span>
                    <span className="text-body font-medium text-foreground truncate">
                      Encrypted item
                    </span>
                  </div>
                  {/* Once Review decrypts a bundle (note OR experiment / method
                      / project) and recovers the embedded verified sender, show
                      the "Received from X, verified" badge. An unreviewed or
                      pre-attribution row falls back to the short relay-hash
                      label so two shares from the same sender still read alike. */}
                  {resolvedSenders[item.bundleId]?.email ? (
                    <div className="mt-0.5">
                      <ReceivedFromBadge
                        receivedFrom={resolvedSenders[item.bundleId].email}
                        fingerprint={resolvedSenders[item.bundleId].fingerprint}
                        small
                      />
                    </div>
                  ) : (
                    <p className="text-meta text-foreground-muted truncate">
                      {senderLabel(item.senderEmailHash)}
                    </p>
                  )}
                  <p className="text-meta text-foreground-muted">
                    {new Date(item.createdAt).toLocaleString()} ·{" "}
                    {formatBytes(item.sizeBytes)} ·{" "}
                    <span className="text-amber-600 dark:text-amber-300">
                      {expiryCountdown(item.expiresAt)}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setReviewItem(item)}
                    className="ros-btn-raise px-3 py-1.5 text-meta font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-md transition-colors"
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDecline(item)}
                    className="px-3 py-1.5 text-meta text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-md transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {reviewItem && email && currentUser && (
        <ReviewImportModal
          item={reviewItem}
          email={email}
          currentUser={currentUser}
          onClose={() => setReviewItem(null)}
          onResolveSender={(bundleId, sender) =>
            setResolvedSenders((prev) =>
              prev[bundleId] === sender ? prev : { ...prev, [bundleId]: sender },
            )
          }
          onImported={(bundleId, message) => {
            dropRow(bundleId);
            setReviewItem(null);
            setToast(message ?? "Imported into your workspace.");
          }}
          onDeclined={(item) => void handleDecline(item)}
        />
      )}

      {toast && (
        <div
          className="fixed z-[120] right-6 bottom-6 max-w-sm rounded-lg border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 px-4 py-3 text-body text-emerald-900 dark:text-emerald-300 shadow-lg pointer-events-none"
          role="status"
        >
          {toast}
        </div>
      )}
    </>
  );
}

// ─── Review-and-import modal ──────────────────────────────────────────────────
//
// On open it calls receiveRawShare to fetch + decrypt the sealed bytes, then
// SNIFFS the decrypted payload to decide its kind (the relay is blind, it never
// records the entity type). It then DISPATCHES BY TYPE,
//   - note       -> readBundle the bytes (the RO-Crate path), show the read-only
//                   preview, and import via importNoteBundle (unchanged path).
//   - experiment -> hand the decrypted export zip to the EXISTING import
//                   resolution flow (ImportExperimentDialog, the same project +
//                   per-method resolution UI the local file-import uses), then
//                   ack the relay only after that import resolves.
// Either way the relay ack happens ONLY after the local write resolves
// (ACK-AFTER-WRITE), so a crash mid-import leaves the bundle to retry.

interface ReviewImportModalProps {
  item: InboxItem;
  email: string;
  currentUser: string;
  onClose: () => void;
  onImported: (bundleId: string, message?: string) => void;
  onDeclined: (item: InboxItem) => void;
  /** Bubble the bundle's verified sender block up so the row can upgrade. */
  onResolveSender: (bundleId: string, sender: BundleSender) => void;
}

function ReviewImportModal({
  item,
  email,
  currentUser,
  onClose,
  onImported,
  onDeclined,
  onResolveSender,
}: ReviewImportModalProps) {
  const [received, setReceived] = useState<ReceiveShareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Escape closes this review modal (app-wide convention). The nested
  // project / experiment import dialogs share this onClose, so a single press
  // dismisses cleanly.
  useEscapeToClose(onClose);
  const [importing, setImporting] = useState(false);

  // The sniffed payload kind, and for an experiment the decrypted bytes wrapped
  // as a File for the existing import dialog. kind stays null until the decrypt
  // resolves.
  const [kind, setKind] = useState<SharePayloadKind | null>(null);
  const [experimentFile, setExperimentFile] = useState<File | null>(null);
  // A decrypted PROJECT bundle wrapped as a File for the project import dialog.
  const [projectFile, setProjectFile] = useState<File | null>(null);
  // A decrypted SEQUENCE envelope, parsed for the one-click import. A sequence is
  // self-contained (nothing to resolve), so it does NOT route through the
  // experiment/project resolution dialog, it imports in one step from the modal.
  const [sequencePayload, setSequencePayload] =
    useState<SequenceSharePayload | null>(null);
  const [sequenceBytes, setSequenceBytes] = useState<Uint8Array | null>(null);
  // RECEIVER PLACEMENT (sequence). The receiver chooses where a received sequence
  // lands: "unfiled" (default, mirrors the historical behavior) or a project id
  // from their OWN library. Mirrors ImportExperimentDialog's placement section,
  // trimmed to the two choices a lone sequence needs (no create-a-new-project).
  const [seqProjects, setSeqProjects] = useState<Project[]>([]);
  const [seqPlacement, setSeqPlacement] = useState<"unfiled" | "project">(
    "unfiled",
  );
  const [seqProjectId, setSeqProjectId] = useState<number | null>(null);
  // A decrypted CALCULATOR envelope, parsed for the one-click import. Like a
  // sequence it is self-contained, so it imports in one step from the modal with
  // no resolution dialog and no placement (a calculator is not filed in a project).
  const [calculatorPayload, setCalculatorPayload] =
    useState<CalculatorSharePayload | null>(null);
  const [calculatorBytes, setCalculatorBytes] = useState<Uint8Array | null>(null);
  // The verified sender read from the decrypted EXPERIMENT / METHOD / PROJECT
  // manifest (the note path uses `received.sender` instead). Populated once the
  // decrypt resolves, so the experiment/method/project provenance label upgrades
  // from the relay hash to the embedded verified email, mirroring the note path.
  // Null on a pre-attribution bundle, the label then falls back to the hash.
  const [manifestSender, setManifestSender] = useState<BundleSender | null>(null);

  // Keep onResolveSender out of the decrypt effect's deps so the inline parent
  // callback can't retrigger a re-fetch / re-decrypt on every render.
  const onResolveSenderRef = useRef(onResolveSender);
  onResolveSenderRef.current = onResolveSender;

  // Fetch + decrypt + sniff on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { payload } = await receiveRawShare({ email, bundleId: item.bundleId });
        const sniffed = await sniffSharePayload(payload);
        if (cancelled) return;
        setKind(sniffed);

        if (sniffed === "note") {
          // Parse + verify the RO-Crate bundle from the bytes we already have,
          // so the note preview + import path is byte-for-byte the same as
          // before (no second fetch). readBundle returns the verified entity,
          // attachments, and embedded sender block.
          const bundle = await readBundle(payload);
          if (cancelled) return;
          const result: ReceiveShareResult = {
            valid: bundle.valid,
            shareUuid: bundle.shareUuid,
            version: bundle.version,
            entityType: bundle.entityType,
            entity: bundle.entity,
            attachments: bundle.attachments,
            sender: bundle.sender,
            // Phase 6c: carry embedded objects through so the import step can
            // recreate or relink them and rewrite the note's embed hrefs.
            embeddedObjects: bundle.embeddedObjects,
          };
          setReceived(result);
          if (result.sender?.email) {
            onResolveSenderRef.current(item.bundleId, result.sender);
          }
        } else if (sniffed === "experiment") {
          // Read the embedded verified sender from the export manifest (SEND-path
          // attribution, mirrors the note bundle's sender block) so the receive
          // label + the import provenance show the real email instead of the
          // relay hash. Undefined on a pre-attribution / local-export bundle, the
          // label then falls back to the hash. Hand the decrypted export zip to
          // the existing import resolution flow.
          const sender = await readManifestSenderFromPayload(payload);
          if (cancelled) return;
          if (sender) {
            setManifestSender(sender);
            onResolveSenderRef.current(item.bundleId, sender);
          }
          setExperimentFile(experimentPayloadToFile(payload));
        } else if (sniffed === "project") {
          // A project bundle (researchos-project) drives its own thin import
          // dialog, it brings many experiments + methods and imports ALWAYS-NEW
          // (no per-method resolution), so it does not reuse the experiment
          // dialog. Wrap the decrypted bytes as a File for the project importer.
          // The embedded sender upgrades the label and the project's
          // imported_from stamp (via provenanceLabel) to the verified email.
          const sender = await readManifestSenderFromPayload(payload);
          if (cancelled) return;
          if (sender) {
            setManifestSender(sender);
            onResolveSenderRef.current(item.bundleId, sender);
          }
          setProjectFile(projectPayloadToFile(payload));
        } else if (sniffed === "method") {
          // A standalone method bundle is researchos-experiment-shaped (a
          // synthetic envelope task carrying the one method), so the SAME
          // import dialog drives it, the recipient sees one method to resolve
          // and "Don't link to a project" for the envelope project. Reuse the
          // experiment plumbing verbatim, only the wrapped File's name differs.
          // The method manifest carries the same verified sender block.
          const sender = await readManifestSenderFromPayload(payload);
          if (cancelled) return;
          if (sender) {
            setManifestSender(sender);
            onResolveSenderRef.current(item.bundleId, sender);
          }
          setExperimentFile(methodPayloadToFile(payload));
        } else if (sniffed === "sequence") {
          // A sequence is self-contained, so we parse the envelope here and show
          // a one-click import (no resolution dialog). Read the embedded verified
          // sender for the label + provenance, exactly like the other tiers.
          const parsed = parseSequencePayload(payload);
          if (cancelled) return;
          const seqSender = readSequencePayloadSender(payload);
          if (seqSender) {
            setManifestSender(seqSender);
            onResolveSenderRef.current(item.bundleId, seqSender);
          }
          setSequencePayload(parsed);
          setSequenceBytes(payload);
        } else if (sniffed === "calculator") {
          // A calculator is self-contained (just its spec), so we parse the
          // envelope here and show a one-click import (no resolution dialog).
          // Read the embedded verified sender for the label + provenance,
          // exactly like the sequence tier.
          const parsed = parseCalculatorPayload(payload);
          if (cancelled) return;
          const calcSender = readCalculatorPayloadSender(payload);
          if (calcSender) {
            setManifestSender(calcSender);
            onResolveSenderRef.current(item.bundleId, calcSender);
          }
          setCalculatorPayload(parsed);
          setCalculatorBytes(payload);
        }
      } catch (err) {
        console.error("[inbox] receiveRawShare failed", err);
        if (!cancelled) {
          setError(
            "Could not open this item. It may have expired, or it could not be decrypted with your key.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email, item.bundleId]);

  // RECEIVER PLACEMENT. Load the receiver's OWN projects once we know the item is
  // a sequence, so the placement dropdown can offer "File into a project". The
  // sender's projects never appear here (they are not in this folder). Archived
  // projects are filtered out so the picker matches the rest of the app.
  useEffect(() => {
    if (kind !== "sequence") return;
    let cancelled = false;
    (async () => {
      try {
        const all = await projectsApi.list();
        if (cancelled) return;
        setSeqProjects(all.filter((p) => !p.is_archived));
      } catch (err) {
        // A failed load is non-fatal: the user can still import as Unfiled.
        console.warn("[inbox] could not load projects for placement", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  // ── Experiment branch ──────────────────────────────────────────────────────
  // Once decrypted, drive the EXISTING import resolution dialog directly. It
  // owns its own project + per-method resolution UI and applyImportPlan call,
  // we only ack the relay after it reports a successful import and surface the
  // notCarried report (dropped links / method references) in the toast.
  const handleExperimentImported = useCallback(
    async (result: ImportResult) => {
      try {
        // ACK-AFTER-WRITE: the import is on disk now, delete the relay copy.
        await ackShare({ email, bundleId: item.bundleId });
      } catch (err) {
        // The import succeeded locally; a failed ack only means the relay copy
        // lingers until its TTL. Don't block the user, just log.
        console.warn("[inbox] ack after import failed", err);
      }
      const dropped =
        result.notCarried.dependencies.length +
        result.notCarried.methodRefs.length;
      // A method bundle carries one method and no task links, so its only
      // "not carried" surface is the method itself failing to localize; phrase
      // the toast per kind so the copy matches what the recipient received.
      const noun = kind === "method" ? "Method" : "Experiment";
      const message =
        dropped > 0
          ? `${noun} imported. Some content was not carried over, see the import summary.`
          : `${noun} imported into your workspace.`;
      onImported(item.bundleId, message);
    },
    [email, item.bundleId, onImported, kind],
  );

  // ── Project branch ─────────────────────────────────────────────────────────
  // The project import dialog materializes a fresh project on disk, then we ack
  // the relay (ack-after-write) and surface the aggregated notCarried report.
  const handleProjectImported = useCallback(
    async (result: ProjectImportResult) => {
      try {
        await ackShare({ email, bundleId: item.bundleId });
      } catch (err) {
        console.warn("[inbox] ack after project import failed", err);
      }
      const dropped =
        result.notCarried.dependencies.length + result.notCarried.methodRefs.length;
      const message =
        dropped > 0
          ? "Project imported. Some content was not carried over, see the import summary."
          : "Project imported as a new project in your folder.";
      onImported(item.bundleId, message);
    },
    [email, item.bundleId, onImported],
  );

  // ── Sequence branch (ONE-CLICK) ─────────────────────────────────────────────
  // A sequence is self-contained, nothing to resolve. Import in one step,
  // decrypt (done) -> create in the recipient's folder -> stamp provenance ->
  // ack the relay (ACK-AFTER-WRITE) -> "Saved to your library" toast. No
  // resolution dialog. RECEIVER PLACEMENT: the import lands in the receiver's
  // chosen project, or stays Unfiled (the default) when they leave it unfiled.
  const handleSequenceImport = useCallback(async () => {
    if (!sequenceBytes) return;
    setImporting(true);
    setError(null);
    try {
      // Prefer the verified identity embedded in the envelope, fall back to the
      // relay key hash for a pre-attribution bundle.
      const senderFingerprint =
        manifestSender?.fingerprint || item.senderEmailHash;
      const senderEmail =
        manifestSender?.email || senderLabel(item.senderEmailHash);

      // The receiver's placement choice. A projectId files it into that project,
      // omitted keeps the default Unfiled behavior.
      const projectId =
        seqPlacement === "project" && seqProjectId != null
          ? seqProjectId
          : undefined;

      await importSequencePayload(
        sequenceBytes,
        {
          currentUser,
          senderEmail,
          senderFingerprint,
        },
        { projectId },
      );

      // ACK-AFTER-WRITE: the sequence pair is on disk now, delete the relay copy.
      await ackShare({ email, bundleId: item.bundleId });

      const placedName =
        projectId != null
          ? seqProjects.find((p) => p.id === projectId)?.name
          : undefined;
      onImported(
        item.bundleId,
        placedName
          ? `Saved to your sequence library, filed into ${placedName}.`
          : "Saved to your sequence library.",
      );
    } catch (err) {
      console.error("[inbox] sequence import failed", err);
      setError(
        "Import failed. Nothing was acknowledged, so this item stays in your inbox to try again.",
      );
    } finally {
      setImporting(false);
    }
  }, [
    sequenceBytes,
    manifestSender,
    item,
    email,
    currentUser,
    onImported,
    seqPlacement,
    seqProjectId,
    seqProjects,
  ]);

  // ── Calculator branch (ONE-CLICK) ───────────────────────────────────────────
  // A calculator is self-contained, nothing to resolve and nothing to file into
  // a project. Import in one step, decrypt (done) -> create a copy in the
  // recipient's folder -> ack the relay (ACK-AFTER-WRITE) -> "Saved" toast. The
  // imported copy is owner-only (the transfer resets sharing), so no sender args
  // are threaded into the import (provenance lives on the inbox label only).
  const handleCalculatorImport = useCallback(async () => {
    if (!calculatorBytes) return;
    setImporting(true);
    setError(null);
    try {
      await importCalculatorPayload(calculatorBytes);
      // ACK-AFTER-WRITE: the calculator is on disk now, delete the relay copy.
      await ackShare({ email, bundleId: item.bundleId });
      onImported(item.bundleId, "Saved to your calculators.");
    } catch (err) {
      console.error("[inbox] calculator import failed", err);
      setError(
        "Import failed. Nothing was acknowledged, so this item stays in your inbox to try again.",
      );
    } finally {
      setImporting(false);
    }
  }, [calculatorBytes, item, email, onImported]);

  // Provenance label for the export-zip tiers (experiment / method / project).
  // Prefer the embedded verified sender (note path via `received.sender`,
  // export-zip path via the manifest `manifestSender`), falling back to the
  // short relay-hash label for a pre-attribution bundle.
  const experimentSenderLabel =
    received?.sender?.email ??
    manifestSender?.email ??
    senderLabel(item.senderEmailHash);

  // The sender's key fingerprint, paired with the label for the on-entity
  // provenance stamp + the badge hover. Undefined on a pre-attribution bundle
  // (the label then carries only the relay-hash sender).
  const experimentSenderFingerprint =
    received?.sender?.fingerprint ?? manifestSender?.fingerprint ?? undefined;

  // The bundle entity, projected for the read-only preview. Notes only.
  const preview = useMemo(() => {
    if (!received || received.entityType !== "note") return null;
    const entity = received.entity as {
      title?: unknown;
      entries?: unknown;
    };
    const title = typeof entity.title === "string" ? entity.title : "Untitled note";
    const rawEntries = Array.isArray(entity.entries) ? entity.entries : [];
    const entries = rawEntries.map((e) => {
      const entry = (e ?? {}) as { title?: unknown; content?: unknown };
      return {
        title: typeof entry.title === "string" ? entry.title : "",
        content: typeof entry.content === "string" ? entry.content : "",
      };
    });
    return { title, entries };
  }, [received]);

  // Per-item destination overrides and force-import overrides built by
  // EmbeddedImportPicker. destinationByHref is keyed by the original embed href
  // (value = recipient's chosen collection). forceImportHrefs is the set of
  // hrefs the recipient switched from "Link existing" to "Import a fresh copy".
  // Both are initialized empty (all items use the defaults on first render;
  // the picker calls onChange once dedup resolves and again on each change).
  const [embeddedDestinationByHref, setEmbeddedDestinationByHref] = useState<
    Map<string, { projectId: string }>
  >(new Map());
  const [embeddedForceImportHrefs, setEmbeddedForceImportHrefs] = useState<
    Set<string>
  >(new Set());

  const handleImport = useCallback(async () => {
    if (!received) return;
    setImporting(true);
    setError(null);
    try {
      // Prefer the verified identity sealed inside the bundle (the sender's own
      // email + key fingerprint). Fall back to the relay key hash for a
      // pre-sender bundle that carries no embedded identity.
      const senderFingerprint =
        received.sender?.fingerprint || item.senderEmailHash;
      const senderEmail = received.sender?.email || senderLabel(item.senderEmailHash);

      // receiveShare returns a ReceiveShareResult, which is a ReadBundleResult
      // minus the `metadata` field. importNoteBundle only reads valid /
      // entityType / entity / attachments / embeddedObjects, so supply an empty
      // metadata object to satisfy the type without inventing data.
      //
      // Phase 6c: pass the bundle's embeddedObjects through so importNoteBundle
      // can recreate or relink them in the recipient's folder and rewrite the
      // note's embed hrefs. received.embeddedObjects is always an array (empty
      // for pre-Phase-6b bundles). The per-item destination picker is STUBBED:
      // the default "Shared by <sender>" collection and auto-link dedup behavior
      // Phase 6c: the picker above builds embeddedDestinationByHref from the
      // user's per-embed choices and dedup hints. Thread it through so the
      // import layer can file each object into the right collection (or link
      // it to an existing local copy for portableId-matched items).
      const { noteId } = await importNoteBundle(
        { ...received, metadata: {} },
        {
          currentUser,
          senderEmail,
          senderFingerprint,
          embeddedObjectOpts: {
            destinationByHref: embeddedDestinationByHref,
            forceImportHrefs: embeddedForceImportHrefs,
          },
        },
      );

      // Seed the version-control baseline so the received snapshot is the base
      // version. We mirror the existing notes save-path wiring: recordNoteHistory
      // is the same flag-gated (HISTORY_ENGINE_ENABLED), best-effort wrapper the
      // live save path uses (local-api.ts), so this writes a genesis + "create"
      // delta exactly the way a freshly created note's first save would. We read
      // the just-written record back so nextState is the canonical on-disk note.
      // If history is flag-off or the write fails, recordNoteHistory is a no-op /
      // swallows, and the genesis row still forms naturally on the user's first
      // edit, so import + ack are never blocked by this.
      try {
        const notePath = `users/${currentUser}/notes/${noteId}.json`;
        const noteRecord = await fileService.readJson<Note>(notePath);
        if (noteRecord) {
          await recordNoteHistory({
            type: "create",
            id: noteId,
            owner: currentUser,
            actor: currentUser,
            prevState: null,
            nextState: noteRecord,
          });
        }
      } catch (histErr) {
        // Never block the import on a history-seed failure (PROPOSAL.md 3j).
        console.warn("[inbox] VC baseline seed failed (note imported):", histErr);
      }

      // ACK-AFTER-WRITE: only now that the note is on disk do we delete the relay
      // copy. A crash before this point leaves the bundle to retry.
      await ackShare({ email, bundleId: item.bundleId });

      onImported(item.bundleId, "Note imported into your notes.");
    } catch (err) {
      console.error("[inbox] import failed", err);
      setError(
        "Import failed. Nothing was acknowledged, so this item stays in your inbox to try again.",
      );
    } finally {
      setImporting(false);
    }
  }, [received, item, email, currentUser, onImported, embeddedDestinationByHref]);

  // Every hook above runs unconditionally on every render. Only now, after the
  // last hook, do we branch to the experiment/method/project import dialogs.
  // These returns MUST stay below the hooks, when they sat above preview +
  // handleImport, the decrypt transition (kind null -> experiment/project)
  // dropped two hooks and crashed with "rendered fewer hooks than expected".
  if (kind === "project" && projectFile) {
    return (
      <ProjectImportDialog
        initialFile={projectFile}
        provenanceLabel={experimentSenderLabel}
        onClose={onClose}
        onImported={(result) => void handleProjectImported(result)}
      />
    );
  }

  if ((kind === "experiment" || kind === "method") && experimentFile) {
    return (
      <ImportExperimentDialog
        isOpen
        initialFile={experimentFile}
        provenanceLabel={experimentSenderLabel}
        provenanceFingerprint={experimentSenderFingerprint}
        onClose={onClose}
        onImported={(result) => void handleExperimentImported(result)}
      />
    );
  }

  // Unsupported = decrypted to a kind we cannot import here. (Experiment /
  // method / project are handled by the returns just above, so by this point
  // kind is note or unknown.)
  const unsupported = kind === "unknown";

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised rounded-xl ros-popup-card-shadow w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border bg-surface-sunken flex items-center justify-between">
          <h3 className="text-title font-semibold text-foreground">Review shared item</h3>
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

        <div className="flex-1 overflow-y-auto p-5">
          {/* Provenance header. Once decrypted, shows the sender's VERIFIED email
              from the sealed bundle. Falls back to the relay key hash before
              decrypt, or for a pre-sender bundle that carries no embedded
              identity. */}
          <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3 mb-4">
            <p className="text-meta text-foreground-muted mb-1">From</p>
            <p className="text-body font-medium text-foreground break-all">
              {received?.sender?.email ?? senderLabel(item.senderEmailHash)}
            </p>
            {received?.sender?.fingerprint ? (
              <p className="text-meta text-foreground-muted break-all">
                key fingerprint {received.sender.fingerprint}
              </p>
            ) : (
              <p className="text-meta text-foreground-muted break-all">
                key hash {item.senderEmailHash.slice(0, 24)}…
              </p>
            )}
            {received?.valid && (
              <p className="text-meta text-emerald-600 dark:text-emerald-300 mt-1.5">
                {received?.sender?.email
                  ? "ResearchOS verified this bundle was sealed to your key, signed by the sender, and passed its integrity check."
                  : "ResearchOS verified this bundle opened with your key and passed its integrity check."}
              </p>
            )}
          </div>

          {loading ? (
            <p className="text-body text-foreground-muted text-center py-8">
              Opening the sealed item…
            </p>
          ) : error ? (
            <p className="text-body text-red-600 dark:text-red-300 text-center py-6">{error}</p>
          ) : unsupported ? (
            <p className="text-body text-foreground-muted text-center py-6">
              Unsupported item type. ResearchOS can import notes, experiments,
              methods, projects, sequences, and calculators here; this item is a
              different
              kind. You can decline it.
            </p>
          ) : kind === "sequence" && sequencePayload ? (
            <>
              <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold mb-1">
                Shared sequence
              </p>
              <h4 className="text-heading font-semibold text-foreground mb-1">
                {sequencePayload.display_name || "Untitled sequence"}
              </h4>
              <p className="text-body text-foreground-muted">
                {seqTypeLabel(sequencePayload.seq_type)} ·{" "}
                {sequencePayload.circular ? "Circular" : "Linear"}
              </p>
              <p className="text-meta text-foreground-muted mt-3 leading-relaxed">
                Saving adds a copy to your sequence library. It is not linked to
                any of the sender&rsquo;s projects. Your copy is yours to edit.
              </p>

              {/* RECEIVER PLACEMENT. Two choices (trimmed from the experiment
                  dialog's three): leave it unfiled, or file it into one of the
                  receiver's OWN projects. */}
              <div className="mt-4">
                <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold mb-1.5">
                  Where to save it
                </p>
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-body cursor-pointer rounded px-2 py-1 hover:bg-surface-sunken">
                    <input
                      type="radio"
                      name="seq-placement"
                      checked={seqPlacement === "unfiled"}
                      onChange={() => setSeqPlacement("unfiled")}
                      disabled={importing}
                    />
                    <span className="text-foreground">Leave unfiled</span>
                  </label>
                  <label
                    className={`flex items-center gap-2 text-body rounded px-2 py-1 ${
                      seqProjects.length === 0
                        ? "opacity-50 cursor-not-allowed"
                        : "cursor-pointer hover:bg-surface-sunken"
                    }`}
                  >
                    <input
                      type="radio"
                      name="seq-placement"
                      checked={seqPlacement === "project"}
                      onChange={() => {
                        setSeqPlacement("project");
                        if (seqProjectId == null && seqProjects[0]) {
                          setSeqProjectId(seqProjects[0].id);
                        }
                      }}
                      disabled={importing || seqProjects.length === 0}
                    />
                    <span className="text-foreground">File into a project</span>
                    {seqPlacement === "project" && seqProjects.length > 0 && (
                      <select
                        value={seqProjectId ?? ""}
                        onChange={(e) => setSeqProjectId(Number(e.target.value))}
                        disabled={importing}
                        className="ml-1 text-meta border border-border rounded px-2 py-1"
                      >
                        {seqProjects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                  {seqProjects.length === 0 && (
                    <p className="text-meta text-foreground-muted px-2">
                      You have no projects yet, so it saves unfiled.
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : kind === "calculator" && calculatorPayload ? (
            <>
              <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold mb-1">
                Shared calculator
              </p>
              <h4 className="text-heading font-semibold text-foreground mb-1">
                {calculatorPayload.name || "Untitled calculator"}
              </h4>
              {calculatorPayload.description && (
                <p className="text-body text-foreground-muted">
                  {calculatorPayload.description}
                </p>
              )}
              <p className="text-meta text-foreground-muted mt-1">
                {calculatorPayload.inputs.length} input
                {calculatorPayload.inputs.length === 1 ? "" : "s"},{" "}
                {calculatorPayload.outputs.length} output
                {calculatorPayload.outputs.length === 1 ? "" : "s"}
              </p>
              <p className="text-meta text-foreground-muted mt-3 leading-relaxed">
                Saving adds a copy to your calculators. Your copy is yours to
                edit, and it runs entirely in your browser.
              </p>
            </>
          ) : preview ? (
            <>
              <h4 className="text-heading font-semibold text-foreground mb-2">
                {preview.title || "Untitled note"}
              </h4>
              <div className="space-y-3 mb-4">
                {preview.entries.length === 0 ? (
                  <p className="text-body text-foreground-muted italic">
                    This note has no entries.
                  </p>
                ) : (
                  preview.entries.map((entry, idx) => (
                    <div
                      key={idx}
                      className="rounded-md border border-border bg-surface-raised px-3 py-2"
                    >
                      {entry.title && (
                        <p className="text-body font-medium text-foreground mb-1">
                          {entry.title}
                        </p>
                      )}
                      <p className="text-body text-foreground-muted whitespace-pre-wrap break-words">
                        {entry.content || (
                          <span className="italic text-foreground-muted">No content</span>
                        )}
                      </p>
                    </div>
                  ))
                )}
              </div>

              {received && received.attachments.length > 0 && (
                <div>
                  <p className="text-meta font-semibold uppercase tracking-wide text-foreground-muted mb-1.5">
                    Attachments
                  </p>
                  <ul className="space-y-1">
                    {received.attachments.map((att) => (
                      <li
                        key={att.name}
                        className="flex items-center justify-between text-meta text-foreground-muted px-2 py-1 rounded bg-surface-sunken"
                      >
                        <span className="truncate">{att.name}</span>
                        <span className="text-foreground-muted flex-shrink-0 ml-2">
                          {formatBytes(att.bytes.byteLength)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Phase 6c: per-item destination picker for embedded objects.
                  Shown only when the bundle carries objects to import or link.
                  When embeddedObjects is empty (pre-Phase-6b bundles or plain
                  notes with no embeds), the picker is omitted and import
                  behavior is identical to before Phase 6c. */}
              {received && received.embeddedObjects.length > 0 && (
                <EmbeddedImportPicker
                  embeddedObjects={received.embeddedObjects}
                  currentUser={currentUser}
                  senderLabel={
                    received.sender?.email ?? senderLabel(item.senderEmailHash)
                  }
                  onChange={({ destinationByHref, forceImportHrefs }) => {
                    setEmbeddedDestinationByHref(destinationByHref);
                    setEmbeddedForceImportHrefs(forceImportHrefs);
                  }}
                />
              )}
            </>
          ) : null}
        </div>

        <div className="px-5 py-3 border-t border-border bg-surface-sunken flex items-center justify-end gap-2">
          {/* Decline: ack without importing. Available regardless of preview
              state so an unsupported / unreadable item can still be cleared. */}
          <button
            type="button"
            onClick={() => onDeclined(item)}
            disabled={importing}
            className="px-3 py-1.5 text-meta text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-md transition-colors disabled:opacity-40"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="px-3 py-1.5 text-meta text-foreground-muted hover:bg-surface-sunken rounded-md transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          {/* Import. A note imports as a standalone note (handleImport); a
              sequence imports in ONE CLICK (handleSequenceImport), decrypt ->
              create -> stamp -> ack, no resolution dialog. Experiment / method /
              project never reach this footer (they render their own dialog
              above). Enabled for a readable note OR a parsed sequence. */}
          <button
            type="button"
            onClick={() =>
              kind === "sequence"
                ? void handleSequenceImport()
                : kind === "calculator"
                  ? void handleCalculatorImport()
                  : void handleImport()
            }
            disabled={
              importing ||
              loading ||
              !!error ||
              unsupported ||
              (kind === "sequence"
                ? !sequencePayload
                : kind === "calculator"
                  ? !calculatorPayload
                  : !preview)
            }
            className="ros-btn-raise px-4 py-1.5 text-meta font-medium text-white bg-brand-action hover:bg-brand-action/90 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {importing
              ? kind === "sequence" || kind === "calculator"
                ? "Saving…"
                : "Importing…"
              : kind === "sequence" || kind === "calculator"
                ? "Save to my library"
                : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline SVG icons (project rule: no emoji / no icon-font deps) ────────────

function InboxArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M4 13l3 5h10l3-5" />
      <path d="M4 13l2.5-8h11L20 13" />
      <path d="M12 4v6m0 0 2.5-2.5M12 10 9.5 7.5" />
    </svg>
  );
}

function KeyOutlineIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <circle cx="8" cy="8" r="4" />
      <path d="M11 11l8 8M16 16l2-2M18 18l2-2" />
    </svg>
  );
}
