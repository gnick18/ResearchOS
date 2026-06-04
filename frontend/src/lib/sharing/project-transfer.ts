// Cross-boundary PROJECT sharing (v1), the project transfer adapter.
//
// The project sibling of experiment-transfer.ts / method-transfer.ts. A project
// shares as ONE sealed `researchos-project` bundle (export/project-bundle.ts) over
// the existing byte-agnostic relay transport (sendRawShare / receiveRawShare),
// exactly as an experiment shares as one sealed export zip. v1 deliberately
// REUSES that single-sealed-blob transport, fine for small/medium projects. The
// sealed-manifest + per-file-DEK + chunked-streaming transport for LARGE projects
// is a Phase B follow-up (design §3, P2) and is NOT built here.
//
//   SEND     -> buildProjectSendPayload
//     Reads the project's NATIVE tasks off disk and builds the project bundle.
//     The caller seals + relays the bytes with sendRawShare.
//   RECEIVE  -> the inbox sniffs `kind: "project"` (sniffSharePayload), then
//     drives the project import flow (parseProjectBundle + applyProjectImportPlan),
//     acking the relay only AFTER the import resolves on disk (ack-after-write).
//
// QUOTA (design §7, Q2). The recipient's relay budget is FREE_STORAGE_BYTES (a
// transit budget, not local storage). The sender enforces fits-or-rejects UP
// FRONT, a project bundle whose sealed size alone exceeds the whole budget is
// rejected before any upload, with a clear message. The relay route is the
// authoritative backstop (it also sums the recipient's existing pending bytes,
// which the blind sender cannot see), but checking the bundle's own size here
// gives an honest early rejection rather than a doomed upload.

import { tasksApi } from "@/lib/local-api";
import { FREE_STORAGE_BYTES } from "@/lib/sharing/relay/limits";
import {
  buildProjectBundle,
  projectBundleSlug,
} from "@/lib/export/project-bundle";
import {
  readManifestSender,
  stampProjectSender,
} from "@/lib/sharing/sender-stamp";
import type { Project, Task } from "@/lib/types";

/**
 * Thrown by buildProjectSendPayload when the project's own sealed bundle would
 * exceed the recipient's entire relay budget. The send dialog catches this and
 * shows the friendly over-budget message instead of attempting a doomed upload.
 */
// Fixed overhead sealToRecipient adds to a payload: ephemeral X25519 public key
// (32) + XChaCha20-Poly1305 nonce (24) + Poly1305 auth tag (16) = 72 bytes
// (encryption.ts: output = epk || nonce || ct, ct = plaintext + 16-byte tag).
// The relay bills the sealed size, so the fits-or-rejects check uses it.
const SEAL_OVERHEAD_BYTES = 32 + 24 + 16;

export class ProjectTooLargeError extends Error {
  constructor(
    public readonly sealedBytes: number,
    public readonly budgetBytes: number,
  ) {
    super(
      `This project is too large to share. Its encrypted size would exceed the recipient's available relay space.`,
    );
    this.name = "ProjectTooLargeError";
  }
}

/** Read the project's NATIVE tasks (task.project_id === project.id, owned by the
 *  sender). A hosted-foreign task (owned elsewhere, only hosted into the project)
 *  is not the sender's to share, listByProject returns the sender's own task list
 *  for the project, which is exactly the native set. */
async function readNativeTasks(project: Project): Promise<Task[]> {
  const tasks = await tasksApi.listByProject(project.id, project.owner);
  // Defensive, keep only experiment-type tasks owned by the project owner. The
  // bundle carries experiments; purchase/list rows are out of scope.
  return tasks.filter(
    (t) => t.project_id === project.id && t.task_type !== "purchase",
  );
}

/**
 * Build the sealed-ready bytes for sharing a whole project. Reads the project's
 * native tasks off disk, builds the `researchos-project` bundle, and rejects up
 * front if the bundle's sealed size alone would exceed FREE_STORAGE_BYTES.
 *
 * The project manifest is re-stamped with the sender's verified PUBLIC identity
 * (email + fingerprint) read from their sharing identity sidecar, SEND-ONLY and
 * additive, so the recipient's inbox attributes the share to a real person and
 * the imported project's `imported_from` records the verified email instead of
 * the relay key hash. The stamp happens BEFORE the fits-or-rejects size check
 * since it (slightly) grows the bundle the relay bills. When the sender has not
 * claimed a sharing identity the stamp is skipped and the recipient falls back
 * to the hash exactly as for a pre-attribution bundle.
 *
 * @param project     the project to share.
 * @param currentUser the folder-local owner, threaded into the per-experiment
 *                    export so it reads each task's content off disk, and used
 *                    to read the sender's identity sidecar for the stamp.
 * @returns the project-bundle zip as raw bytes, ready for sendRawShare to seal.
 */
export async function buildProjectSendPayload(
  project: Project,
  currentUser: string | null,
): Promise<Uint8Array> {
  const tasks = await readNativeTasks(project);
  const built = await buildProjectBundle(project, tasks, currentUser);
  const sender = await readManifestSender(currentUser);
  const bytes = await stampProjectSender(built, sender);

  // Fits-or-rejects against the recipient's whole budget. We compare the SEALED
  // size (what the relay stores + bills) using the fixed seal overhead.
  const sealed = bytes.byteLength + SEAL_OVERHEAD_BYTES;
  if (sealed > FREE_STORAGE_BYTES) {
    throw new ProjectTooLargeError(sealed, FREE_STORAGE_BYTES);
  }
  return bytes;
}

/** How many native experiments a project would carry, for a pre-send summary
 *  line in the dialog ("Sending this project, N experiments"). */
export async function countProjectExperiments(project: Project): Promise<number> {
  const tasks = await readNativeTasks(project);
  return tasks.length;
}

/**
 * Wraps decrypted project-bundle bytes as a File so a file-driven import entry
 * point can read them, mirroring experimentPayloadToFile / methodPayloadToFile.
 * The name is cosmetic, the importer reads the manifest inside.
 */
export function projectPayloadToFile(
  bytes: Uint8Array,
  baseName = "shared-project",
): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], `${baseName}.zip`, { type: "application/zip" });
}

export { projectBundleSlug };
