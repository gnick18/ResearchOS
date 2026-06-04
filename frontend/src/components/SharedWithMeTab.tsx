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
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import {
  listInbox,
  receiveShare,
  ackShare,
  type InboxItem,
  type ReceiveShareResult,
} from "@/lib/sharing/relay/client";
import type { BundleSender } from "@/lib/sharing/bundle";
import { importNoteBundle } from "@/lib/sharing/note-transfer";
import { recordNoteHistory } from "@/lib/history";
import { fileService } from "@/lib/file-system/file-service";
import type { Note } from "@/lib/types";

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
        <p className="text-body text-gray-500 text-center py-8">Loading…</p>
      </div>
    );
  }

  if (status === "none") {
    return (
      <>
        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center gap-3">
          <InboxArrowIcon className="w-8 h-8 text-gray-300" />
          <p className="text-body text-gray-600 max-w-xs">
            Set up sharing to receive shared items. You claim an email-linked
            identity once, then notes and methods other labs send you land here.
          </p>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="px-4 py-2 text-meta font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
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
        <p className="text-body text-gray-600 max-w-xs">
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
        {loading ? (
          <p className="text-body text-gray-500 text-center py-8">Loading…</p>
        ) : loadError ? (
          <div className="text-center py-8">
            <p className="text-body text-red-600">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadList()}
              className="mt-2 text-meta font-medium text-blue-600 hover:text-blue-800"
            >
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-body text-gray-400 italic text-center py-8">
            Nothing has been shared with you yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.bundleId}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-white hover:border-blue-200 hover:bg-blue-50/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-meta font-semibold uppercase tracking-wide bg-violet-100 text-violet-700">
                      <NoteIcon className="w-3 h-3" />
                      Note
                    </span>
                    <span className="text-body font-medium text-gray-800 truncate">
                      {/* The title lives inside the encrypted bundle; it is only
                          known after Review decrypts it. Show a neutral
                          placeholder until then. */}
                      Encrypted note
                    </span>
                  </div>
                  <p className="text-meta text-gray-500 truncate">
                    {resolvedSenders[item.bundleId]?.email ??
                      senderLabel(item.senderEmailHash)}
                  </p>
                  <p className="text-meta text-gray-400">
                    {new Date(item.createdAt).toLocaleString()} ·{" "}
                    {formatBytes(item.sizeBytes)} ·{" "}
                    <span className="text-amber-600">
                      {expiryCountdown(item.expiresAt)}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setReviewItem(item)}
                    className="px-3 py-1.5 text-meta font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                  >
                    Review
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDecline(item)}
                    className="px-3 py-1.5 text-meta text-red-600 hover:bg-red-50 rounded-md transition-colors"
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
          onImported={(bundleId) => {
            dropRow(bundleId);
            setReviewItem(null);
            setToast("Imported into your notes.");
          }}
          onDeclined={(item) => void handleDecline(item)}
        />
      )}

      {toast && (
        <div
          className="fixed z-[120] right-6 bottom-6 max-w-sm rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-body text-emerald-900 shadow-lg pointer-events-none"
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
// On open it calls receiveShare to fetch + decrypt + parse the bundle, then
// shows a provenance header, a read-only preview, and the attachment list.
// Import writes the note (importNoteBundle), seeds the version-control baseline,
// then acks the relay (ONLY after the import resolves), then removes the row.

interface ReviewImportModalProps {
  item: InboxItem;
  email: string;
  currentUser: string;
  onClose: () => void;
  onImported: (bundleId: string) => void;
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
  const [importing, setImporting] = useState(false);

  // Keep onResolveSender out of the decrypt effect's deps so the inline parent
  // callback can't retrigger a re-fetch / re-decrypt on every render.
  const onResolveSenderRef = useRef(onResolveSender);
  onResolveSenderRef.current = onResolveSender;

  // Fetch + decrypt on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await receiveShare({ email, bundleId: item.bundleId });
        if (!cancelled) {
          setReceived(result);
          // Upgrade the row to the verified email once we have decrypted the
          // sender block (a pre-sender bundle leaves result.sender undefined).
          if (result.sender?.email) {
            onResolveSenderRef.current(item.bundleId, result.sender);
          }
        }
      } catch (err) {
        console.error("[inbox] receiveShare failed", err);
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
      // entityType / entity / attachments, so supply an empty metadata object to
      // satisfy the type without inventing data.
      const { noteId } = await importNoteBundle(
        { ...received, metadata: {} },
        { currentUser, senderEmail, senderFingerprint },
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

      onImported(item.bundleId);
    } catch (err) {
      console.error("[inbox] import failed", err);
      setError(
        "Import failed. Nothing was acknowledged, so this item stays in your inbox to try again.",
      );
    } finally {
      setImporting(false);
    }
  }, [received, item, email, currentUser, onImported]);

  const unsupported = received != null && received.entityType !== "note";

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h3 className="text-title font-semibold text-gray-900">Review shared item</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-heading leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Provenance header. Once decrypted, shows the sender's VERIFIED email
              from the sealed bundle. Falls back to the relay key hash before
              decrypt, or for a pre-sender bundle that carries no embedded
              identity. */}
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 mb-4">
            <p className="text-meta text-gray-500 mb-1">From</p>
            <p className="text-body font-medium text-gray-800 break-all">
              {received?.sender?.email ?? senderLabel(item.senderEmailHash)}
            </p>
            {received?.sender?.fingerprint ? (
              <p className="text-meta text-gray-400 break-all">
                key fingerprint {received.sender.fingerprint}
              </p>
            ) : (
              <p className="text-meta text-gray-400 break-all">
                key hash {item.senderEmailHash.slice(0, 24)}…
              </p>
            )}
            {received?.valid && (
              <p className="text-meta text-emerald-600 mt-1.5">
                {received?.sender?.email
                  ? "ResearchOS verified this bundle was sealed to your key, signed by the sender, and passed its integrity check."
                  : "ResearchOS verified this bundle opened with your key and passed its integrity check."}
              </p>
            )}
          </div>

          {loading ? (
            <p className="text-body text-gray-500 text-center py-8">
              Opening the sealed item…
            </p>
          ) : error ? (
            <p className="text-body text-red-600 text-center py-6">{error}</p>
          ) : unsupported ? (
            <p className="text-body text-gray-600 text-center py-6">
              Unsupported item type. ResearchOS can import notes here; this item
              is a different kind. You can decline it.
            </p>
          ) : preview ? (
            <>
              <h4 className="text-heading font-semibold text-gray-900 mb-2">
                {preview.title || "Untitled note"}
              </h4>
              <div className="space-y-3 mb-4">
                {preview.entries.length === 0 ? (
                  <p className="text-body text-gray-400 italic">
                    This note has no entries.
                  </p>
                ) : (
                  preview.entries.map((entry, idx) => (
                    <div
                      key={idx}
                      className="rounded-md border border-gray-100 bg-white px-3 py-2"
                    >
                      {entry.title && (
                        <p className="text-body font-medium text-gray-800 mb-1">
                          {entry.title}
                        </p>
                      )}
                      <p className="text-body text-gray-600 whitespace-pre-wrap break-words">
                        {entry.content || (
                          <span className="italic text-gray-400">No content</span>
                        )}
                      </p>
                    </div>
                  ))
                )}
              </div>

              {received && received.attachments.length > 0 && (
                <div>
                  <p className="text-meta font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                    Attachments
                  </p>
                  <ul className="space-y-1">
                    {received.attachments.map((att) => (
                      <li
                        key={att.name}
                        className="flex items-center justify-between text-meta text-gray-600 px-2 py-1 rounded bg-gray-50"
                      >
                        <span className="truncate">{att.name}</span>
                        <span className="text-gray-400 flex-shrink-0 ml-2">
                          {formatBytes(att.bytes.byteLength)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2">
          {/* Decline: ack without importing. Available regardless of preview
              state so an unsupported / unreadable item can still be cleared. */}
          <button
            type="button"
            onClick={() => onDeclined(item)}
            disabled={importing}
            className="px-3 py-1.5 text-meta text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-40"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            className="px-3 py-1.5 text-meta text-gray-600 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          {/* Import is enabled only for a readable, verified note bundle. For
              v1 this imports as a standalone note; a project target picker is a
              later enhancement. */}
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={importing || loading || !!error || !preview || unsupported}
            className="px-4 py-1.5 text-meta font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline SVG icons (project rule: no emoji / no icon-font deps) ────────────

function NoteIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M4 2.5h6l2.5 2.5v8.5H4z" />
      <path d="M6 6.5h4M6 9h4M6 11.5h2.5" />
    </svg>
  );
}

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
