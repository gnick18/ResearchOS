"use client";

// Cross-boundary sharing, the INVITE accept page (invite-a-non-user loop).
//
// A person who is NOT on ResearchOS receives a branded email with a link of the
// form https://research-os.app/accept/<inviteId>#k=<one-time-key>. This page is
// where that link lands. The flow,
//   1. Read the inviteId from the path and the one-time key from the URL
//      FRAGMENT (after #). The fragment is read ONLY in the browser, it is never
//      sent to our server (browsers do not transmit fragments), which is the
//      whole point of carrying the key there.
//   2. Fetch the parked sealed bytes by the bearer inviteId, decrypt them with
//      the fragment key, and show a read-only PREVIEW (who shared what). This
//      needs no account, the key alone opens the data.
//   3. To KEEP it, the visitor connects a data folder and claims THIS email via
//      the existing SharingSetupWizard (the free signup), then we file the note
//      into their folder with the existing review-then-import path
//      (importNoteBundle) and ack the invite (delete-on-pickup).
//
// EXPIRED / ALREADY-CLAIMED. A missing, expired, or already-accepted invite is
// handled gracefully, the fetch returns 404/410 and we show a clear "this invite
// is no longer available" state rather than an error.
//
// TRUST BOUNDARY. The fragment key is the capability. Anyone with the link can
// open the data, which is inherent to inviting someone who has no key yet (the
// email is the trust channel). We never send the fragment to our server.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import {
  fetchInviteBundle,
  ackInvite,
  RelayError,
  type ReceiveShareResult,
} from "@/lib/sharing/relay/client";
import { importNoteBundle } from "@/lib/sharing/note-transfer";
import { recordNoteHistory } from "@/lib/history";
import { fileService } from "@/lib/file-system/file-service";
import type { Note } from "@/lib/types";

// ── Fragment key parsing ─────────────────────────────────────────────────────
// The key arrives as the URL fragment "#k=<hex>". We read window.location.hash
// in an effect (it is client-only). A valid key is 64 lowercase hex chars (32
// bytes). Anything else is treated as a malformed link.
const KEY_HEX_RE = /^[0-9a-f]{64}$/;

function readFragmentKey(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash; // e.g. "#k=abcd..."
  const m = /(?:^#|&)k=([0-9a-fA-F]+)/.exec(hash);
  if (!m) return null;
  const hex = m[1].toLowerCase();
  return KEY_HEX_RE.test(hex) ? hex : null;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "bad-link" }
  | { phase: "unavailable"; reason: string }
  | { phase: "ready"; received: ReceiveShareResult };

type ImportPhase =
  | { phase: "idle" }
  | { phase: "importing" }
  | { phase: "done" }
  | { phase: "error"; message: string };

export default function AcceptInvitePage() {
  const params = useParams<{ inviteId: string }>();
  const inviteId = typeof params?.inviteId === "string" ? params.inviteId : "";

  const { isConnected, currentUser } = useFileSystem();
  const identity = useSharingIdentity();

  const [keyHex, setKeyHex] = useState<string | null | undefined>(undefined);
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [imp, setImp] = useState<ImportPhase>({ phase: "idle" });

  // Read the fragment key once on mount (client only).
  useEffect(() => {
    setKeyHex(readFragmentKey());
  }, []);

  // Fetch + decrypt the bundle once we have both the id and the fragment key.
  // This shows the preview without requiring any account, the key opens the data.
  useEffect(() => {
    if (keyHex === undefined) return; // still reading the fragment
    if (!inviteId || !keyHex) {
      setLoad({ phase: "bad-link" });
      return;
    }
    let cancelled = false;
    (async () => {
      setLoad({ phase: "loading" });
      try {
        const received = await fetchInviteBundle({
          inviteId,
          oneTimeKeyHex: keyHex,
        });
        if (cancelled) return;
        setLoad({ phase: "ready", received });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof RelayError && err.status === 410) {
          setLoad({
            phase: "unavailable",
            reason: "This invite has expired. Ask the sender to share it again.",
          });
          return;
        }
        if (err instanceof RelayError && err.status === 404) {
          setLoad({
            phase: "unavailable",
            reason:
              "This invite is no longer available. It may have already been opened, or the link is incomplete.",
          });
          return;
        }
        // A decrypt failure (wrong / tampered key) or any other error.
        setLoad({
          phase: "unavailable",
          reason:
            "We could not open this invite. The link may be incomplete or it may have already been opened.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteId, keyHex]);

  const preview = useMemo(() => {
    if (load.phase !== "ready") return null;
    const r = load.received;
    if (r.entityType !== "note") return null;
    const entity = r.entity as { title?: unknown; entries?: unknown };
    const title =
      typeof entity.title === "string" && entity.title
        ? entity.title
        : "Untitled note";
    const rawEntries = Array.isArray(entity.entries) ? entity.entries : [];
    const entries = rawEntries.map((e) => {
      const entry = (e ?? {}) as { title?: unknown; content?: unknown };
      return {
        title: typeof entry.title === "string" ? entry.title : "",
        content: typeof entry.content === "string" ? entry.content : "",
      };
    });
    return { title, entries, sender: r.sender };
  }, [load]);

  const handleWizardComplete = useCallback(async () => {
    setWizardOpen(false);
    await identity.refresh();
  }, [identity]);

  // File the decrypted note into the new user's folder, then ack the invite.
  // Mirrors the SharedWithMeTab import path (importNoteBundle + VC baseline seed
  // + ACK-AFTER-FILE), but acks via the keyless ackInvite (the user just claimed
  // their identity, the inviteId is the capability we hold).
  const handleImport = useCallback(async () => {
    if (load.phase !== "ready" || !currentUser) return;
    const received = load.received;
    setImp({ phase: "importing" });
    try {
      const senderFingerprint = received.sender?.fingerprint || "";
      const senderEmail = received.sender?.email || "an invited share";
      const { noteId } = await importNoteBundle(
        { ...received, metadata: {} },
        { currentUser, senderEmail, senderFingerprint },
      );

      // Seed the VC baseline the same best-effort, flag-gated way the inbox does.
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
        console.warn("[accept] VC baseline seed failed (note imported):", histErr);
      }

      // ACK-AFTER-FILE, the note is on disk now, delete the relay copy.
      try {
        await ackInvite(inviteId);
      } catch (ackErr) {
        // The note is imported, a failed ack only leaves the relay copy until its
        // TTL. Do not block the user.
        console.warn("[accept] ack after import failed", ackErr);
      }
      setImp({ phase: "done" });
    } catch (err) {
      console.error("[accept] import failed", err);
      setImp({
        phase: "error",
        message:
          "Import failed. Nothing was acknowledged, so this invite stays available to try again.",
      });
    }
  }, [load, currentUser, inviteId]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <Header />
        <div className="px-6 py-6">
          {load.phase === "loading" && <LoadingBody />}

          {load.phase === "bad-link" && (
            <NoticeBody
              title="This invite link is incomplete"
              body="The link is missing the part that unlocks the shared note (the bit after the # in the address). Open the original link from your email exactly as it was sent, without trimming the end."
            />
          )}

          {load.phase === "unavailable" && (
            <NoticeBody title="This invite is no longer available" body={load.reason} />
          )}

          {load.phase === "ready" && preview && (
            <ReadyBody
              preview={preview}
              valid={load.received.valid}
              attachmentCount={load.received.attachments.length}
              isConnected={isConnected}
              currentUser={currentUser}
              identityReady={identity.status === "ready"}
              imp={imp}
              onSetUpSharing={() => setWizardOpen(true)}
              onImport={() => void handleImport()}
            />
          )}

          {load.phase === "ready" && !preview && (
            <NoticeBody
              title="Unsupported item"
              body="This invite contains an item ResearchOS cannot open here yet. Notes are supported."
            />
          )}
        </div>
      </div>

      {wizardOpen && currentUser && (
        <SharingSetupWizard
          username={currentUser}
          onComplete={() => void handleWizardComplete()}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

// ── Sub-views ─────────────────────────────────────────────────────────────────

function Header() {
  return (
    <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center gap-3">
      <BeakerBotMark className="w-10 h-10 text-sky-500" />
      <div>
        <p className="text-meta uppercase tracking-wide text-blue-600 font-semibold">
          ResearchOS
        </p>
        <h1 className="text-title font-semibold text-gray-900">
          Someone shared a note with you
        </h1>
      </div>
    </div>
  );
}

function LoadingBody() {
  return (
    <div className="py-10 flex flex-col items-center text-center">
      <div className="w-9 h-9 rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin" />
      <p className="text-body text-gray-500 mt-4">Opening the shared note</p>
    </div>
  );
}

function NoticeBody({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-6 text-center">
      <h2 className="text-title font-semibold text-gray-900">{title}</h2>
      <p className="text-body text-gray-600 mt-2 leading-relaxed">{body}</p>
    </div>
  );
}

interface PreviewShape {
  title: string;
  entries: Array<{ title: string; content: string }>;
  sender?: { email: string; fingerprint: string };
}

function ReadyBody({
  preview,
  valid,
  attachmentCount,
  isConnected,
  currentUser,
  identityReady,
  imp,
  onSetUpSharing,
  onImport,
}: {
  preview: PreviewShape;
  valid: boolean;
  attachmentCount: number;
  isConnected: boolean;
  currentUser: string | null;
  identityReady: boolean;
  imp: ImportPhase;
  onSetUpSharing: () => void;
  onImport: () => void;
}) {
  if (imp.phase === "done") {
    return (
      <div className="py-6 text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
          <CheckGlyph className="w-6 h-6" />
        </div>
        <h2 className="text-title font-semibold text-gray-900 mt-3">
          Saved to your notes
        </h2>
        <p className="text-body text-gray-600 mt-1 leading-relaxed">
          &ldquo;{preview.title}&rdquo; is now in your folder. You can edit it
          like any other note, your copy is yours.
        </p>
      </div>
    );
  }

  const senderLabel = preview.sender?.email ?? "Someone on ResearchOS";
  // The folder + identity gate. Both halves are needed before we can file the
  // note into the visitor's own folder.
  const canFile = isConnected && !!currentUser && identityReady;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
        <p className="text-meta text-gray-500">From</p>
        <p className="text-body font-medium text-gray-800 break-all">
          {senderLabel}
        </p>
        {valid && (
          <p className="text-meta text-emerald-600 mt-1.5">
            ResearchOS verified this note opened with the invite key and passed
            its integrity check.
          </p>
        )}
      </div>

      <div>
        <p className="text-meta uppercase tracking-wide text-gray-500 font-semibold mb-1">
          Shared note
        </p>
        <h2 className="text-heading font-semibold text-gray-900 break-words">
          {preview.title}
        </h2>
        <div className="space-y-2 mt-2 max-h-56 overflow-y-auto">
          {preview.entries.length === 0 ? (
            <p className="text-body text-gray-400 italic">This note has no entries.</p>
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
          {attachmentCount > 0 && (
            <p className="text-meta text-gray-500">
              {attachmentCount} attachment{attachmentCount === 1 ? "" : "s"}{" "}
              included.
            </p>
          )}
        </div>
      </div>

      {imp.phase === "error" && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-meta text-red-700 leading-relaxed">{imp.message}</p>
        </div>
      )}

      {/* The keep-it gate. */}
      {!isConnected || !currentUser ? (
        <NoticeBody
          title="Open ResearchOS to keep this note"
          body="To save this note you first connect a data folder in ResearchOS (it is free and stays on your own computer). Open the app, connect or create your folder, then return to this link."
        />
      ) : !identityReady ? (
        <div className="space-y-3">
          <p className="text-body text-gray-600 leading-relaxed">
            Set up sharing once to claim this email and save the note. It proves
            your address and generates your keypair, so future shares with you
            stay private end to end.
          </p>
          <button
            type="button"
            onClick={onSetUpSharing}
            className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            Set up sharing and save the note
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onImport}
          disabled={imp.phase === "importing" || !canFile}
          className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {imp.phase === "importing" ? "Saving…" : "Save to my notes"}
        </button>
      )}
    </div>
  );
}

// ── Inline SVG (no emoji, no icon-font deps). BeakerBot mark + check glyph. ────

function BeakerBotMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="BeakerBot"
      className={className ?? "w-10 h-10 text-sky-500"}
    >
      <path
        d="M 12 12 L 12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L 28 12 Z"
        fill="white"
        stroke="none"
      />
      <path
        d="M 12 19 Q 14 17.8, 16 19 T 20 19 T 24 19 T 28 19 L 28 24 C 28 30, 24 32, 20 32 C 16 32, 12 30, 12 24 L 12 19 Z"
        fill="#A6D2F4"
        stroke="none"
      />
      <path d="M22 8 C 22 6, 24 4, 26 6" />
      <path d="M12 12 L12 24 C 12 30, 16 32, 20 32 C 24 32, 28 30, 28 24 L28 12" />
      <path d="M11 12 L29 12" />
      <circle cx="17" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="23" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <path d="M18 22 Q 20 24, 22 22" />
      <path d="M14 26 L15.5 26" />
      <path d="M24.5 26 L26 26" />
    </svg>
  );
}

function CheckGlyph({ className }: { className?: string }) {
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
