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
//      the fragment key, and SNIFF the decrypted payload to learn its kind (the
//      relay is blind, it never records the entity type). This needs no account,
//      the key alone opens the data.
//   3. To KEEP it, the visitor connects a data folder and claims THIS email via
//      the existing SharingSetupWizard (the free signup), then we file the item
//      into their folder. A note files through importNoteBundle (with a read-only
//      preview here first); an experiment / method / project drives the SAME
//      import dialog the inbox uses (ImportExperimentDialog / ProjectImportDialog),
//      which owns its own review-then-apply UI. Either way we ack the invite
//      (delete-on-pickup) only AFTER the local write resolves.
//
// EXPIRED / ALREADY-CLAIMED. A missing, expired, or already-accepted invite is
// handled gracefully, the fetch returns 404/410 and we show a clear "this invite
// is no longer available" state rather than an error.
//
// TRUST BOUNDARY. The fragment key is the capability. Anyone with the link can
// open the data, which is inherent to inviting someone who has no key yet (the
// email is the trust channel). We never send the fragment to our server.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import {
  fetchInviteRawBundle,
  ackInvite,
  RelayError,
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
import { readManifestSenderFromPayload } from "@/lib/sharing/sender-stamp";
import ImportExperimentDialog from "@/components/ImportExperimentDialog";
import ProjectImportDialog from "@/components/sharing/ProjectImportDialog";
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

// ── Item-kind copy ───────────────────────────────────────────────────────────
// The four importable kinds, with the article + noun the page copy reads with.
// "unknown" is an item we cannot file here (an unsupported / malformed payload).
function kindNoun(kind: SharePayloadKind): { article: string; noun: string } {
  switch (kind) {
    case "experiment":
      return { article: "an", noun: "experiment" };
    case "method":
      return { article: "a", noun: "method" };
    case "project":
      return { article: "a", noun: "project" };
    case "note":
    default:
      return { article: "a", noun: "note" };
  }
}

type LoadState =
  | { phase: "loading" }
  | { phase: "bad-link" }
  | { phase: "unavailable"; reason: string }
  | {
      phase: "ready";
      kind: SharePayloadKind;
      // The parsed RO-Crate bundle, NOTE path only. Null for the export-zip kinds.
      received: ReceiveShareResult | null;
      // The decrypted bytes, export-zip kinds only (experiment / method / project).
      // Null for the note path (received carries everything it needs).
      payload: Uint8Array | null;
      // The verified sender read from the export manifest (export-zip kinds). The
      // note path reads it from received.sender instead.
      manifestSender: BundleSender | null;
    };

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
  // True once the visitor clicks "Save" for an export-zip kind, which mounts the
  // existing import dialog (ImportExperimentDialog / ProjectImportDialog) on top.
  const [launchImport, setLaunchImport] = useState(false);

  // Read the fragment key once on mount (client only).
  useEffect(() => {
    setKeyHex(readFragmentKey());
  }, []);

  // Fetch + decrypt + sniff the payload once we have both the id and the fragment
  // key. This shows the preview / kind without requiring any account, the key
  // opens the data. The note path parses the RO-Crate bundle here; the export-zip
  // kinds keep the raw bytes for the import dialog and read the manifest sender.
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
        const { payload } = await fetchInviteRawBundle({
          inviteId,
          oneTimeKeyHex: keyHex,
        });
        const kind = await sniffSharePayload(payload);
        if (cancelled) return;

        if (kind === "note") {
          // Parse + verify the RO-Crate bundle (the note preview + import path).
          const bundle = await readBundle(payload);
          if (cancelled) return;
          const received: ReceiveShareResult = {
            valid: bundle.valid,
            shareUuid: bundle.shareUuid,
            version: bundle.version,
            entityType: bundle.entityType,
            entity: bundle.entity,
            attachments: bundle.attachments,
            sender: bundle.sender,
          };
          setLoad({
            phase: "ready",
            kind,
            received,
            payload: null,
            manifestSender: null,
          });
          return;
        }

        if (kind === "experiment" || kind === "method" || kind === "project") {
          // Keep the decrypted export-zip bytes for the import dialog, and read
          // the embedded verified sender from the manifest (mirrors the inbox).
          const sender = await readManifestSenderFromPayload(payload);
          if (cancelled) return;
          setLoad({
            phase: "ready",
            kind,
            received: null,
            payload,
            manifestSender: sender ?? null,
          });
          return;
        }

        // Decrypted to a kind we cannot import here.
        setLoad({
          phase: "ready",
          kind: "unknown",
          received: null,
          payload: null,
          manifestSender: null,
        });
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

  // The note preview projection (note path only).
  const preview = useMemo(() => {
    if (load.phase !== "ready" || load.kind !== "note" || !load.received) {
      return null;
    }
    const r = load.received;
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

  // The decrypted export-zip bytes wrapped as a File for the import dialog, built
  // ONCE per ready payload so the dialog's parse effect does not re-fire. Null
  // for the note / unknown / not-yet-ready states.
  const importFile = useMemo(() => {
    if (load.phase !== "ready" || !load.payload) return null;
    if (load.kind === "experiment") return experimentPayloadToFile(load.payload);
    if (load.kind === "method") return methodPayloadToFile(load.payload);
    if (load.kind === "project") return projectPayloadToFile(load.payload);
    return null;
  }, [load]);

  const handleWizardComplete = useCallback(async () => {
    setWizardOpen(false);
    await identity.refresh();
  }, [identity]);

  // File the decrypted NOTE into the new user's folder, then ack the invite.
  // Mirrors the SharedWithMeTab import path (importNoteBundle + VC baseline seed
  // + ACK-AFTER-FILE), but acks via the keyless ackInvite (the user just claimed
  // their identity, the inviteId is the capability we hold).
  const handleImport = useCallback(async () => {
    if (load.phase !== "ready" || load.kind !== "note" || !load.received) return;
    if (!currentUser) return;
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

  // The import dialog (experiment / method / project) reports a successful
  // on-disk import. ACK-AFTER-FILE: ack the keyless invite now, then unmount the
  // dialog and show the done state. A failed ack only leaves the relay copy until
  // its TTL, so it never blocks the user.
  const handleDialogImported = useCallback(async () => {
    setLaunchImport(false);
    try {
      await ackInvite(inviteId);
    } catch (ackErr) {
      console.warn("[accept] ack after import failed", ackErr);
    }
    setImp({ phase: "done" });
  }, [inviteId]);

  const kindLabel =
    load.phase === "ready" ? kindNoun(load.kind) : { article: "a", noun: "item" };

  // Provenance label for the export-zip import dialogs.
  const provenanceLabel =
    load.phase === "ready"
      ? load.manifestSender?.email ?? "an invited share"
      : "an invited share";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <Header headline={headlineFor(load)} />
        <div className="px-6 py-6">
          {load.phase === "loading" && <LoadingBody />}

          {load.phase === "bad-link" && (
            <NoticeBody
              title="This invite link is incomplete"
              body="The link is missing the part that unlocks the shared item (the bit after the # in the address). Open the original link from your email exactly as it was sent, without trimming the end."
            />
          )}

          {load.phase === "unavailable" && (
            <NoticeBody title="This invite is no longer available" body={load.reason} />
          )}

          {load.phase === "ready" && load.kind === "note" && preview && (
            <ReadyBody
              preview={preview}
              valid={load.received?.valid ?? false}
              attachmentCount={load.received?.attachments.length ?? 0}
              isConnected={isConnected}
              currentUser={currentUser}
              identityReady={identity.status === "ready"}
              imp={imp}
              onSetUpSharing={() => setWizardOpen(true)}
              onImport={() => void handleImport()}
            />
          )}

          {load.phase === "ready" &&
            (load.kind === "experiment" ||
              load.kind === "method" ||
              load.kind === "project") && (
              <ImportItemBody
                noun={kindLabel.noun}
                article={kindLabel.article}
                senderEmail={load.manifestSender?.email ?? null}
                isConnected={isConnected}
                currentUser={currentUser}
                identityReady={identity.status === "ready"}
                imp={imp}
                onSetUpSharing={() => setWizardOpen(true)}
                onSave={() => setLaunchImport(true)}
              />
            )}

          {load.phase === "ready" && load.kind === "unknown" && (
            <NoticeBody
              title="Unsupported item"
              body="This invite contains an item ResearchOS cannot open here yet. Notes, experiments, methods, and projects are supported."
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

      {/* The export-zip import dialogs (experiment / method / project) reuse the
          inbox's exact import resolution UI. They resolve the target folder from
          the connected user internally, so we only mount them once the visitor is
          connected + has claimed their identity (the same gate the body enforces). */}
      {launchImport &&
        load.phase === "ready" &&
        importFile &&
        (load.kind === "experiment" || load.kind === "method") && (
          <ImportExperimentDialog
            isOpen
            initialFile={importFile}
            provenanceLabel={provenanceLabel}
            onClose={() => setLaunchImport(false)}
            onImported={() => void handleDialogImported()}
          />
        )}

      {launchImport &&
        load.phase === "ready" &&
        importFile &&
        load.kind === "project" && (
          <ProjectImportDialog
            initialFile={importFile}
            provenanceLabel={provenanceLabel}
            onClose={() => setLaunchImport(false)}
            onImported={() => void handleDialogImported()}
          />
        )}
    </div>
  );
}

// ── Sub-views ─────────────────────────────────────────────────────────────────

/** The headline copy, kind-aware once the payload is sniffed. */
function headlineFor(load: LoadState): string {
  if (load.phase === "ready" && load.kind !== "unknown") {
    const { article, noun } = kindNoun(load.kind);
    return `Someone shared ${article} ${noun} with you`;
  }
  return "Someone shared an item with you";
}

function Header({ headline }: { headline: string }) {
  return (
    <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center gap-3">
      <BeakerBotMark className="w-10 h-10 text-sky-500" />
      <div>
        <p className="text-meta uppercase tracking-wide text-blue-600 font-semibold">
          ResearchOS
        </p>
        <h1 className="text-title font-semibold text-gray-900">{headline}</h1>
      </div>
    </div>
  );
}

function LoadingBody() {
  return (
    <div className="py-10 flex flex-col items-center text-center">
      <div className="w-9 h-9 rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin" />
      <p className="text-body text-gray-500 mt-4">Opening the shared item</p>
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

// The export-zip kinds (experiment / method / project). Unlike a note we do not
// render the content inline, the import dialog the visitor launches shows a full
// review of everything before anything is written. This body shows the kind +
// verified sender and the same connect-folder / claim-identity gate the note path
// uses, then hands off to that dialog.
function ImportItemBody({
  noun,
  article,
  senderEmail,
  isConnected,
  currentUser,
  identityReady,
  imp,
  onSetUpSharing,
  onSave,
}: {
  noun: string;
  article: string;
  senderEmail: string | null;
  isConnected: boolean;
  currentUser: string | null;
  identityReady: boolean;
  imp: ImportPhase;
  onSetUpSharing: () => void;
  onSave: () => void;
}) {
  if (imp.phase === "done") {
    return (
      <div className="py-6 text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
          <CheckGlyph className="w-6 h-6" />
        </div>
        <h2 className="text-title font-semibold text-gray-900 mt-3">
          Saved to your workspace
        </h2>
        <p className="text-body text-gray-600 mt-1 leading-relaxed">
          This {noun} is now in your folder. You can edit it like anything else,
          your copy is yours.
        </p>
      </div>
    );
  }

  const senderLabel = senderEmail ?? "Someone on ResearchOS";

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
        <p className="text-meta text-gray-500">From</p>
        <p className="text-body font-medium text-gray-800 break-all">
          {senderLabel}
        </p>
        <p className="text-meta text-emerald-600 mt-1.5">
          ResearchOS opened this {noun} with the invite key and passed its
          integrity check.
        </p>
      </div>

      <div>
        <p className="text-meta uppercase tracking-wide text-gray-500 font-semibold mb-1">
          Shared {noun}
        </p>
        <p className="text-body text-gray-600 leading-relaxed">
          Someone shared {article} {noun} with you. Saving it opens a review where
          you can see everything it brings (its content, files, and any methods)
          before it lands in your folder as your own copy.
        </p>
      </div>

      {imp.phase === "error" && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-meta text-red-700 leading-relaxed">{imp.message}</p>
        </div>
      )}

      {/* The keep-it gate, identical to the note path. */}
      {!isConnected || !currentUser ? (
        <NoticeBody
          title={`Open ResearchOS to keep this ${noun}`}
          body={`To save this ${noun} you first connect a data folder in ResearchOS (it is free and stays on your own computer). Open the app, connect or create your folder, then return to this link.`}
        />
      ) : !identityReady ? (
        <div className="space-y-3">
          <p className="text-body text-gray-600 leading-relaxed">
            Set up sharing once to claim this email and save the {noun}. It proves
            your address and generates your keypair, so future shares with you
            stay private end to end.
          </p>
          <button
            type="button"
            onClick={onSetUpSharing}
            className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            Set up sharing and save the {noun}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onSave}
          className="w-full py-2 text-body rounded-lg font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          Review and save this {noun}
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
