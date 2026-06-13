"use client";

// Cross-boundary sharing, the INVITE accept page (invite-a-non-user loop).
//
// A person who is NOT on ResearchOS receives a branded but KEYLESS email linking
// to https://research-os.app/accept/<inviteId> (no fragment). The sender delivers
// the one-time key OUT OF BAND (P1-A), either as a full private link
// (.../accept/<inviteId>#k=<one-time-key>) or a bare unlock code the recipient
// pastes here. This page is where both land. The flow,
//   1. Read the inviteId from the path and the one-time key from the URL
//      FRAGMENT (after #) when the sender's private link was used. The fragment
//      is read ONLY in the browser, it is never sent to our server (browsers do
//      not transmit fragments). If there is no fragment (the keyless email link),
//      we show a "paste the unlock code the sender sent you" field instead of a
//      dead end, and the pasted code stays client-side exactly like the fragment.
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
import BeakerBot from "@/components/BeakerBot";
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
import {
  parseSequencePayload,
  readSequencePayloadSender,
  importSequencePayload,
  type SequenceSharePayload,
} from "@/lib/sharing/sequence-transfer";
import {
  parseCalculatorPayload,
  readCalculatorPayloadSender,
  importCalculatorPayload,
  type CalculatorSharePayload,
} from "@/lib/sharing/calculator-transfer";
import { readManifestSenderFromPayload } from "@/lib/sharing/sender-stamp";
import { readFragmentKey, parseUnlockCode } from "@/lib/sharing/accept-code";
import ImportExperimentDialog from "@/components/ImportExperimentDialog";
import ProjectImportDialog from "@/components/sharing/ProjectImportDialog";
import { recordNoteHistory } from "@/lib/history";
import { fileService } from "@/lib/file-system/file-service";
import { projectsApi } from "@/lib/local-api";
import type { Note, Project } from "@/lib/types";
import { EmbeddedImportPicker } from "@/components/sharing/EmbeddedImportPicker";

// Fragment / unlock-code parsing lives in lib/sharing/accept-code.ts (pure, unit
// tested). readFragmentKey recovers the key from a sender-delivered private
// link's URL fragment, parseUnlockCode recovers it from what the recipient pastes
// when they arrived via the keyless email link. Both stay client-side (P1-A).

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
    case "sequence":
      return { article: "a", noun: "sequence" };
    case "calculator":
      return { article: "a", noun: "calculator" };
    case "note":
    default:
      return { article: "a", noun: "note" };
  }
}

type LoadState =
  | { phase: "loading" }
  | { phase: "bad-link" }
  // No fragment key was present (the recipient came via the keyless email link),
  // so we ask them to paste the unlock code the sender sent out of band (P1-A).
  | { phase: "need-code" }
  | { phase: "unavailable"; reason: string }
  | {
      phase: "ready";
      kind: SharePayloadKind;
      // The parsed RO-Crate bundle, NOTE path only. Null for the export-zip kinds.
      received: ReceiveShareResult | null;
      // The decrypted bytes, export-zip kinds AND sequence. Null for the note
      // path (received carries everything it needs). For a sequence these are the
      // envelope bytes the one-click import re-uses.
      payload: Uint8Array | null;
      // The verified sender read from the export manifest (export-zip kinds) or
      // the sequence envelope. The note path reads it from received.sender instead.
      manifestSender: BundleSender | null;
      // The parsed sequence envelope, SEQUENCE kind only (null otherwise). A
      // sequence imports in one click from the bytes, no dialog.
      sequence: SequenceSharePayload | null;
      // The parsed calculator envelope, CALCULATOR kind only (null otherwise). A
      // calculator imports in one click from the bytes, no dialog, no placement.
      calculator: CalculatorSharePayload | null;
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

  // RECEIVER PLACEMENT (sequence). The visitor chooses where a received sequence
  // lands: "unfiled" (default) or one of their OWN projects. A fresh invite-only
  // signup usually has no projects, so the picker self-hides to Unfiled. Mirrors
  // the inbox placement, trimmed to the two choices a lone sequence needs.
  const [seqProjects, setSeqProjects] = useState<Project[]>([]);
  const [seqPlacement, setSeqPlacement] = useState<"unfiled" | "project">(
    "unfiled",
  );
  const [seqProjectId, setSeqProjectId] = useState<number | null>(null);

  // Phase 6c: per-item destination overrides and force-import overrides built
  // by EmbeddedImportPicker for note bundles that carry embedded objects.
  // destinationByHref: per-href collection choice (omit = default "Shared by <sender>").
  // forceImportHrefs: hrefs the recipient switched from "Link existing" to
  // "Import a fresh copy". Both initialized empty on first render.
  const [embeddedDestinationByHref, setEmbeddedDestinationByHref] = useState<
    Map<string, { projectId: string }>
  >(new Map());
  const [embeddedForceImportHrefs, setEmbeddedForceImportHrefs] = useState<
    Set<string>
  >(new Set());

  // The unlock code the recipient pastes when they arrived via the keyless email
  // link (no fragment). Setting keyHex from a valid code re-runs the fetch effect
  // exactly as a fragment would, the code never leaves the browser.
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState(false);

  // Read the fragment key once on mount (client only).
  useEffect(() => {
    setKeyHex(
      typeof window === "undefined"
        ? null
        : readFragmentKey(window.location.hash),
    );
  }, []);

  // Submit a pasted unlock code. A valid 64-hex code (or a full pasted private
  // link) reconstructs the key client-side and drops into the same fetch path; an
  // invalid one shows an inline error and stays put.
  const handleSubmitCode = useCallback(() => {
    const recovered = parseUnlockCode(codeInput);
    if (!recovered) {
      setCodeError(true);
      return;
    }
    setCodeError(false);
    setKeyHex(recovered);
  }, [codeInput]);

  // RECEIVER PLACEMENT. Load the visitor's OWN projects once they have connected
  // a folder and the loaded item is a sequence, so the placement dropdown can
  // offer "File into a project". Archived projects are filtered out. A failed or
  // empty load is non-fatal, the import simply lands Unfiled.
  const loadedSequence = load.phase === "ready" && load.kind === "sequence";
  useEffect(() => {
    if (!isConnected || !currentUser || !loadedSequence) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await projectsApi.list();
        if (cancelled) return;
        setSeqProjects(all.filter((p) => !p.is_archived));
      } catch (err) {
        console.warn("[accept] could not load projects for placement", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected, currentUser, loadedSequence]);

  // Fetch + decrypt + sniff the payload once we have both the id and the fragment
  // key. This shows the preview / kind without requiring any account, the key
  // opens the data. The note path parses the RO-Crate bundle here; the export-zip
  // kinds keep the raw bytes for the import dialog and read the manifest sender.
  useEffect(() => {
    if (keyHex === undefined) return; // still reading the fragment
    if (!inviteId) {
      setLoad({ phase: "bad-link" });
      return;
    }
    if (!keyHex) {
      // No key yet (the keyless email link). Ask for the unlock code instead of
      // a dead end. Pasting a valid code sets keyHex and re-enters this effect.
      setLoad({ phase: "need-code" });
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
            // Phase 6c: carry embedded objects through so importNoteBundle can
            // recreate or relink them and rewrite the note's embed hrefs.
            embeddedObjects: bundle.embeddedObjects,
          };
          setLoad({
            phase: "ready",
            kind,
            received,
            payload: null,
            manifestSender: null,
            sequence: null,
            calculator: null,
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
            sequence: null,
            calculator: null,
          });
          return;
        }

        if (kind === "sequence") {
          // A sequence is self-contained, parse the envelope here and keep the
          // bytes for the one-click import (no dialog). Read the embedded
          // verified sender for the provenance label.
          const parsed = parseSequencePayload(payload);
          const sender = readSequencePayloadSender(payload);
          if (cancelled) return;
          setLoad({
            phase: "ready",
            kind,
            received: null,
            payload,
            manifestSender: sender ?? null,
            sequence: parsed,
            calculator: null,
          });
          return;
        }

        if (kind === "calculator") {
          // A calculator is self-contained, parse the envelope here and keep the
          // bytes for the one-click import (no dialog, no placement). Read the
          // embedded verified sender for the provenance label.
          const parsed = parseCalculatorPayload(payload);
          const sender = readCalculatorPayloadSender(payload);
          if (cancelled) return;
          setLoad({
            phase: "ready",
            kind,
            received: null,
            payload,
            manifestSender: sender ?? null,
            sequence: null,
            calculator: parsed,
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
          sequence: null,
          calculator: null,
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
      // Phase 6c: thread the per-item destination map built by
      // EmbeddedImportPicker so each embedded object lands in the collection the
      // recipient chose (or links to their existing copy for matched portableIds).
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
  }, [load, currentUser, inviteId, embeddedDestinationByHref]);

  // File the decrypted SEQUENCE into the new user's folder in ONE step (no
  // dialog), then ack the keyless invite. A sequence has nothing to resolve, so
  // this mirrors the inbox one-click flow, decrypt (done) -> create -> stamp
  // provenance -> ACK-AFTER-FILE. project_ids are dropped (lands Unfiled).
  const handleSequenceImport = useCallback(async () => {
    if (load.phase !== "ready" || load.kind !== "sequence" || !load.payload) {
      return;
    }
    if (!currentUser) return;
    setImp({ phase: "importing" });
    try {
      const senderFingerprint = load.manifestSender?.fingerprint || "";
      const senderEmail = load.manifestSender?.email || "an invited share";
      // The visitor's placement choice. A projectId files it into that project,
      // omitted keeps the default Unfiled behavior.
      const projectId =
        seqPlacement === "project" && seqProjectId != null
          ? seqProjectId
          : undefined;
      await importSequencePayload(
        load.payload,
        {
          currentUser,
          senderEmail,
          senderFingerprint,
        },
        { projectId },
      );
      try {
        await ackInvite(inviteId);
      } catch (ackErr) {
        console.warn("[accept] ack after sequence import failed", ackErr);
      }
      setImp({ phase: "done" });
    } catch (err) {
      console.error("[accept] sequence import failed", err);
      setImp({
        phase: "error",
        message:
          "Import failed. Nothing was acknowledged, so this invite stays available to try again.",
      });
    }
  }, [load, currentUser, inviteId, seqPlacement, seqProjectId]);

  // File the decrypted CALCULATOR into the new user's folder in ONE step (no
  // dialog, no placement), then ack the keyless invite. A calculator has nothing
  // to resolve, so this mirrors the inbox one-click flow, decrypt (done) ->
  // create a copy -> ACK-AFTER-FILE. The copy is owner-only on arrival.
  const handleCalculatorImport = useCallback(async () => {
    if (load.phase !== "ready" || load.kind !== "calculator" || !load.payload) {
      return;
    }
    if (!currentUser) return;
    setImp({ phase: "importing" });
    try {
      await importCalculatorPayload(load.payload);
      try {
        await ackInvite(inviteId);
      } catch (ackErr) {
        console.warn("[accept] ack after calculator import failed", ackErr);
      }
      setImp({ phase: "done" });
    } catch (err) {
      console.error("[accept] calculator import failed", err);
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
  // The sender's key fingerprint, paired with the label for the on-entity
  // provenance stamp + the badge hover. Undefined when the bundle carried no
  // verified sender block.
  const provenanceFingerprint =
    load.phase === "ready"
      ? load.manifestSender?.fingerprint ?? undefined
      : undefined;

  return (
    <div className="min-h-screen bg-surface-sunken flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-surface-raised rounded-2xl shadow-sm border border-border overflow-hidden">
        <Header headline={headlineFor(load)} />
        <div className="px-6 py-6">
          {load.phase === "loading" && <LoadingBody />}

          {load.phase === "bad-link" && (
            <NoticeBody
              title="This invite link is incomplete"
              body="The address is missing the invite id. Open the original link from your email exactly as it was sent, without trimming it."
            />
          )}

          {load.phase === "need-code" && (
            <CodeEntryBody
              value={codeInput}
              error={codeError}
              onChange={(next) => {
                setCodeInput(next);
                if (codeError) setCodeError(false);
              }}
              onSubmit={handleSubmitCode}
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
              embeddedObjects={load.received?.embeddedObjects ?? []}
              senderIdentity={
                load.received?.sender?.email ?? "Someone on ResearchOS"
              }
              isConnected={isConnected}
              currentUser={currentUser}
              identityReady={identity.status === "ready"}
              imp={imp}
              onSetUpSharing={() => setWizardOpen(true)}
              onImport={() => void handleImport()}
              onEmbeddedChange={({ destinationByHref, forceImportHrefs }) => {
                setEmbeddedDestinationByHref(destinationByHref);
                setEmbeddedForceImportHrefs(forceImportHrefs);
              }}
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

          {load.phase === "ready" && load.kind === "sequence" && (
            <SequenceBody
              sequence={load.sequence}
              senderEmail={load.manifestSender?.email ?? null}
              isConnected={isConnected}
              currentUser={currentUser}
              identityReady={identity.status === "ready"}
              imp={imp}
              projects={seqProjects}
              placement={seqPlacement}
              projectId={seqProjectId}
              onPlacementChange={(next, id) => {
                setSeqPlacement(next);
                if (id !== undefined) setSeqProjectId(id);
              }}
              onSetUpSharing={() => setWizardOpen(true)}
              onSave={() => void handleSequenceImport()}
            />
          )}

          {load.phase === "ready" && load.kind === "calculator" && (
            <CalculatorBody
              calculator={load.calculator}
              senderEmail={load.manifestSender?.email ?? null}
              isConnected={isConnected}
              currentUser={currentUser}
              identityReady={identity.status === "ready"}
              imp={imp}
              onSetUpSharing={() => setWizardOpen(true)}
              onSave={() => void handleCalculatorImport()}
            />
          )}

          {load.phase === "ready" && load.kind === "unknown" && (
            <NoticeBody
              title="Unsupported item"
              body="This invite contains an item ResearchOS cannot open here yet. Notes, experiments, methods, projects, sequences, and calculators are supported."
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
            provenanceFingerprint={provenanceFingerprint}
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
    <div className="px-6 pt-6 pb-4 border-b border-border flex items-center gap-3">
      <BeakerBot pose="idle" alive className="w-10 h-10 text-sky-500" />
      <div>
        <p className="text-meta uppercase tracking-wide text-blue-600 dark:text-blue-300 font-semibold">
          ResearchOS
        </p>
        <h1 className="text-title font-semibold text-foreground">{headline}</h1>
      </div>
    </div>
  );
}

function LoadingBody() {
  return (
    <div className="py-10 flex flex-col items-center text-center">
      <div className="w-9 h-9 rounded-full border-2 border-border border-t-blue-500 animate-spin" />
      <p className="text-body text-foreground-muted mt-4">Opening the shared item</p>
    </div>
  );
}

function NoticeBody({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-6 text-center">
      <h2 className="text-title font-semibold text-foreground">{title}</h2>
      <p className="text-body text-foreground-muted mt-2 leading-relaxed">{body}</p>
    </div>
  );
}

// The keyless-email landing. The email link carries no key (P1-A), so the sender
// sends the unlock code separately. The recipient pastes it here, and it is used
// only in the browser to decrypt, exactly like the private link's fragment, it is
// never sent to our server.
function CodeEntryBody({
  value,
  error,
  onChange,
  onSubmit,
}: {
  value: string;
  error: boolean;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-4 py-2">
      <div>
        <h2 className="text-title font-semibold text-foreground">
          Enter your unlock code
        </h2>
        <p className="text-body text-foreground-muted mt-2 leading-relaxed">
          The sender is sending you a private link or a short unlock code over a
          separate channel (a message, a text, in person). Paste that code here to
          open the shared item. The code stays on this device, it is never sent to
          ResearchOS.
        </p>
      </div>
      <div>
        <label
          htmlFor="accept-unlock-code"
          className="block text-meta font-medium text-foreground mb-1"
        >
          Unlock code
        </label>
        <input
          id="accept-unlock-code"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
          placeholder="Paste the code or the private link the sender sent you"
          autoComplete="off"
          spellCheck={false}
          className="w-full px-3 py-2 border border-border rounded-lg text-body text-foreground placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono break-all"
        />
        {error && (
          <p className="text-meta text-red-700 dark:text-red-300 mt-1.5 leading-relaxed">
            That does not look like a valid unlock code. Paste the full code (or
            the whole private link) exactly as the sender sent it.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={value.trim().length === 0}
        className="w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Open the shared item
      </button>
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
  embeddedObjects,
  senderIdentity,
  isConnected,
  currentUser,
  identityReady,
  imp,
  onSetUpSharing,
  onImport,
  onEmbeddedChange,
}: {
  preview: PreviewShape;
  valid: boolean;
  attachmentCount: number;
  embeddedObjects: import("@/lib/sharing/bundle").BundleEmbeddedObject[];
  senderIdentity: string;
  isConnected: boolean;
  currentUser: string | null;
  identityReady: boolean;
  imp: ImportPhase;
  onSetUpSharing: () => void;
  onImport: () => void;
  onEmbeddedChange: (result: import("@/components/sharing/EmbeddedImportPicker").EmbeddedImportPickerResult) => void;
}) {
  if (imp.phase === "done") {
    return (
      <div className="py-6 text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-300">
          <CheckGlyph className="w-6 h-6" />
        </div>
        <h2 className="text-title font-semibold text-foreground mt-3">
          Saved to your notes
        </h2>
        <p className="text-body text-foreground-muted mt-1 leading-relaxed">
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
      <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3">
        <p className="text-meta text-foreground-muted">From</p>
        <p className="text-body font-medium text-foreground break-all">
          {senderLabel}
        </p>
        {valid && (
          <p className="text-meta text-emerald-600 dark:text-emerald-300 mt-1.5">
            ResearchOS verified this note opened with the invite key and passed
            its integrity check.
          </p>
        )}
      </div>

      <div>
        <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold mb-1">
          Shared note
        </p>
        <h2 className="text-heading font-semibold text-foreground break-words">
          {preview.title}
        </h2>
        <div className="space-y-2 mt-2 max-h-56 overflow-y-auto">
          {preview.entries.length === 0 ? (
            <p className="text-body text-foreground-muted italic">This note has no entries.</p>
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
          {attachmentCount > 0 && (
            <p className="text-meta text-foreground-muted">
              {attachmentCount} attachment{attachmentCount === 1 ? "" : "s"}{" "}
              included.
            </p>
          )}
        </div>
      </div>

      {/* Phase 6c: per-item destination picker for embedded objects. Shown only
          when the bundle carries objects to import or link. When embeddedObjects
          is empty (pre-Phase-6b bundles or plain notes), this renders nothing. */}
      {embeddedObjects.length > 0 && currentUser && (
        <EmbeddedImportPicker
          embeddedObjects={embeddedObjects}
          currentUser={currentUser}
          senderLabel={senderIdentity}
          onChange={onEmbeddedChange}
        />
      )}

      {imp.phase === "error" && (
        <div className="p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
          <p className="text-meta text-red-700 dark:text-red-300 leading-relaxed">{imp.message}</p>
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
          <p className="text-body text-foreground-muted leading-relaxed">
            Set up sharing once to claim this email and save the note. It proves
            your address and generates your keypair, so future shares with you
            stay private end to end.
          </p>
          <button
            type="button"
            onClick={onSetUpSharing}
            className="w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors"
          >
            Set up sharing and save the note
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onImport}
          disabled={imp.phase === "importing" || !canFile}
          className="w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-300">
          <CheckGlyph className="w-6 h-6" />
        </div>
        <h2 className="text-title font-semibold text-foreground mt-3">
          Saved to your workspace
        </h2>
        <p className="text-body text-foreground-muted mt-1 leading-relaxed">
          This {noun} is now in your folder. You can edit it like anything else,
          your copy is yours.
        </p>
      </div>
    );
  }

  const senderLabel = senderEmail ?? "Someone on ResearchOS";

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3">
        <p className="text-meta text-foreground-muted">From</p>
        <p className="text-body font-medium text-foreground break-all">
          {senderLabel}
        </p>
        <p className="text-meta text-emerald-600 dark:text-emerald-300 mt-1.5">
          ResearchOS opened this {noun} with the invite key and passed its
          integrity check.
        </p>
      </div>

      <div>
        <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold mb-1">
          Shared {noun}
        </p>
        <p className="text-body text-foreground-muted leading-relaxed">
          Someone shared {article} {noun} with you. Saving it opens a review where
          you can see everything it brings (its content, files, and any methods)
          before it lands in your folder as your own copy.
        </p>
      </div>

      {imp.phase === "error" && (
        <div className="p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
          <p className="text-meta text-red-700 dark:text-red-300 leading-relaxed">{imp.message}</p>
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
          <p className="text-body text-foreground-muted leading-relaxed">
            Set up sharing once to claim this email and save the {noun}. It proves
            your address and generates your keypair, so future shares with you
            stay private end to end.
          </p>
          <button
            type="button"
            onClick={onSetUpSharing}
            className="w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors"
          >
            Set up sharing and save the {noun}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onSave}
          className="w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors"
        >
          Review and save this {noun}
        </button>
      )}
    </div>
  );
}

// The SEQUENCE kind. Self-contained, so unlike the export-zip kinds there is no
// import dialog, the visitor saves it in one click straight into their library.
// Shows the sequence summary + verified sender + the same connect-folder /
// claim-identity gate, then the one-click "Save to my library" action.
function SequenceBody({
  sequence,
  senderEmail,
  isConnected,
  currentUser,
  identityReady,
  imp,
  projects,
  placement,
  projectId,
  onPlacementChange,
  onSetUpSharing,
  onSave,
}: {
  sequence: SequenceSharePayload | null;
  senderEmail: string | null;
  isConnected: boolean;
  currentUser: string | null;
  identityReady: boolean;
  imp: ImportPhase;
  projects: Project[];
  placement: "unfiled" | "project";
  projectId: number | null;
  onPlacementChange: (next: "unfiled" | "project", projectId?: number) => void;
  onSetUpSharing: () => void;
  onSave: () => void;
}) {
  if (imp.phase === "done") {
    return (
      <div className="py-6 text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-300">
          <CheckGlyph className="w-6 h-6" />
        </div>
        <h2 className="text-title font-semibold text-foreground mt-3">
          Saved to your library
        </h2>
        <p className="text-body text-foreground-muted mt-1 leading-relaxed">
          This sequence is now in your library. You can open, edit, and file it
          like any other, your copy is yours.
        </p>
      </div>
    );
  }

  const senderLabel = senderEmail ?? "Someone on ResearchOS";
  const name = sequence?.display_name || "Untitled sequence";
  const typeLabel =
    sequence?.seq_type === "protein"
      ? "Protein"
      : sequence?.seq_type === "rna"
        ? "RNA"
        : "DNA";

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3">
        <p className="text-meta text-foreground-muted">From</p>
        <p className="text-body font-medium text-foreground break-all">
          {senderLabel}
        </p>
        <p className="text-meta text-emerald-600 dark:text-emerald-300 mt-1.5">
          ResearchOS opened this sequence with the invite key and passed its
          integrity check.
        </p>
      </div>

      <div>
        <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold mb-1">
          Shared sequence
        </p>
        <h2 className="text-heading font-semibold text-foreground break-words">
          {name}
        </h2>
        <p className="text-body text-foreground-muted mt-1">
          {typeLabel} · {sequence?.circular ? "Circular" : "Linear"}
        </p>
        <p className="text-meta text-foreground-muted mt-2 leading-relaxed">
          Saving adds a copy to your sequence library. It is not linked to any of
          the sender&rsquo;s projects.
        </p>
      </div>

      {imp.phase === "error" && (
        <div className="p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
          <p className="text-meta text-red-700 dark:text-red-300 leading-relaxed">{imp.message}</p>
        </div>
      )}

      {/* The keep-it gate, identical to the note / export-zip paths. */}
      {!isConnected || !currentUser ? (
        <NoticeBody
          title="Open ResearchOS to keep this sequence"
          body="To save this sequence you first connect a data folder in ResearchOS (it is free and stays on your own computer). Open the app, connect or create your folder, then return to this link."
        />
      ) : !identityReady ? (
        <div className="space-y-3">
          <p className="text-body text-foreground-muted leading-relaxed">
            Set up sharing once to claim this email and save the sequence. It
            proves your address and generates your keypair, so future shares with
            you stay private end to end.
          </p>
          <button
            type="button"
            onClick={onSetUpSharing}
            className="w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors"
          >
            Set up sharing and save the sequence
          </button>
        </div>
      ) : (
        <>
          {/* RECEIVER PLACEMENT. Two choices (trimmed from the experiment
              dialog's three): leave it unfiled, or file it into one of the
              visitor's OWN projects. Only meaningful once they have a project,
              otherwise it stays at the Unfiled default. */}
          {projects.length > 0 && (
            <div>
              <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold mb-1.5">
                Where to save it
              </p>
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-body cursor-pointer rounded px-2 py-1 hover:bg-surface-sunken">
                  <input
                    type="radio"
                    name="accept-seq-placement"
                    checked={placement === "unfiled"}
                    onChange={() => onPlacementChange("unfiled")}
                    disabled={imp.phase === "importing"}
                  />
                  <span className="text-foreground">Leave unfiled</span>
                </label>
                <label className="flex items-center gap-2 text-body cursor-pointer rounded px-2 py-1 hover:bg-surface-sunken">
                  <input
                    type="radio"
                    name="accept-seq-placement"
                    checked={placement === "project"}
                    onChange={() =>
                      onPlacementChange(
                        "project",
                        projectId ?? projects[0]?.id,
                      )
                    }
                    disabled={imp.phase === "importing"}
                  />
                  <span className="text-foreground">File into a project</span>
                  {placement === "project" && (
                    <select
                      value={projectId ?? ""}
                      onChange={(e) =>
                        onPlacementChange("project", Number(e.target.value))
                      }
                      disabled={imp.phase === "importing"}
                      className="ml-1 text-meta border border-border rounded px-2 py-1"
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onSave}
            disabled={imp.phase === "importing" || !sequence}
            className="w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {imp.phase === "importing" ? "Saving…" : "Save to my library"}
          </button>
        </>
      )}
    </div>
  );
}

// The CALCULATOR kind. Self-contained like a sequence, so there is no import
// dialog and no placement (a calculator is not filed in a project), the visitor
// saves it in one click straight into their calculators. Shows the calculator
// summary + verified sender + the same connect-folder / claim-identity gate.
function CalculatorBody({
  calculator,
  senderEmail,
  isConnected,
  currentUser,
  identityReady,
  imp,
  onSetUpSharing,
  onSave,
}: {
  calculator: CalculatorSharePayload | null;
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
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-300">
          <CheckGlyph className="w-6 h-6" />
        </div>
        <h2 className="text-title font-semibold text-foreground mt-3">
          Saved to your calculators
        </h2>
        <p className="text-body text-foreground-muted mt-1 leading-relaxed">
          This calculator is now in your calculators. You can open, run, and edit
          it like any other, your copy is yours.
        </p>
      </div>
    );
  }

  const senderLabel = senderEmail ?? "Someone on ResearchOS";
  const name = calculator?.name || "Untitled calculator";
  const inputCount = calculator?.inputs.length ?? 0;
  const outputCount = calculator?.outputs.length ?? 0;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3">
        <p className="text-meta text-foreground-muted">From</p>
        <p className="text-body font-medium text-foreground break-all">
          {senderLabel}
        </p>
        <p className="text-meta text-emerald-600 dark:text-emerald-300 mt-1.5">
          ResearchOS opened this calculator with the invite key and passed its
          integrity check.
        </p>
      </div>

      <div>
        <p className="text-meta uppercase tracking-wide text-foreground-muted font-semibold mb-1">
          Shared calculator
        </p>
        <h2 className="text-heading font-semibold text-foreground break-words">
          {name}
        </h2>
        {calculator?.description && (
          <p className="text-body text-foreground-muted mt-1">
            {calculator.description}
          </p>
        )}
        <p className="text-meta text-foreground-muted mt-1">
          {inputCount} input{inputCount === 1 ? "" : "s"}, {outputCount} output
          {outputCount === 1 ? "" : "s"}
        </p>
        <p className="text-meta text-foreground-muted mt-2 leading-relaxed">
          Saving adds a copy to your calculators. Your copy is yours to edit, and
          it runs entirely in your browser.
        </p>
      </div>

      {imp.phase === "error" && (
        <div className="p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
          <p className="text-meta text-red-700 dark:text-red-300 leading-relaxed">{imp.message}</p>
        </div>
      )}

      {/* The keep-it gate, identical to the note / sequence / export-zip paths. */}
      {!isConnected || !currentUser ? (
        <NoticeBody
          title="Open ResearchOS to keep this calculator"
          body="To save this calculator you first connect a data folder in ResearchOS (it is free and stays on your own computer). Open the app, connect or create your folder, then return to this link."
        />
      ) : !identityReady ? (
        <div className="space-y-3">
          <p className="text-body text-foreground-muted leading-relaxed">
            Set up sharing once to claim this email and save the calculator. It
            proves your address and generates your keypair, so future shares with
            you stay private end to end.
          </p>
          <button
            type="button"
            onClick={onSetUpSharing}
            className="w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors"
          >
            Set up sharing and save the calculator
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onSave}
          disabled={imp.phase === "importing" || !calculator}
          className="w-full py-2 text-body rounded-lg font-medium bg-brand-action hover:bg-brand-action/90 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {imp.phase === "importing" ? "Saving…" : "Save to my calculators"}
        </button>
      )}
    </div>
  );
}

// ── Inline SVG (no emoji, no icon-font deps). Check glyph. The header mascot is
// the real <BeakerBot/> component (pastel-rainbow liquid), not a hand-rolled mark.

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
