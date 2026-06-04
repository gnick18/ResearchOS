// Cross-boundary sharing, standalone METHOD transfer adapter.
//
// The lighter sibling of experiment-transfer.ts. Where the experiment adapter
// wraps the full single-task export, this one carries exactly ONE method, its
// record, body markdown / PDF, the per-type structured protocol record it
// points at, and its bundled source PDF. The genuinely hard parts (packing the
// per-method `methods/method-<id>-*` layout, and re-materializing it with full
// id-remap, fresh protocol records, rewritten source_path) already exist in the
// experiment export/import pipeline. This adapter REUSES that pipeline verbatim,
//
//   - extract.ts `buildStandaloneMethodPackage` turns a Method into the same
//     MethodPayload the experiment export produces (task-less, canonical
//     stored protocol, no per-task override).
//   - raw.ts `buildRawZip` serializes it to the SAME researchos-experiment
//     envelope (a synthetic envelope task carrying the one method), so the
//     recipient's existing parse + apply read it with zero new format work.
//
// The one wire difference from an experiment bundle is a single manifest field,
// `kind: "method"`. The bundle is structurally an experiment bundle (it has to
// be, so the unchanged importer can read it), so the inbox sniff cannot tell
// method-from-experiment by file shape alone. We stamp `kind: "method"` on the
// manifest after serialization and the sniff reads it. See sniffSharePayload.
//
// COMPOUND methods are deferred (design doc §Compound, methods tier). A compound
// references child methods that would each have to ride along and be id-remapped
// on import; that walk-and-rewrite is not built yet. buildMethodSendPayload
// throws CompoundMethodNotSupportedError for a compound so the dialog can show a
// clear "cannot be shared yet" notice rather than send a bundle whose children
// dangle on the other side.

import JSZip from "jszip";

import { buildStandaloneMethodPackage } from "@/lib/export/extract";
import { buildRawZip } from "@/lib/export/raw";
import { buildSourceInstance } from "@/lib/export/types";
import type {
  ExperimentExportPayload,
  ManifestSender,
  RawManifest,
} from "@/lib/export/types";
import { projectsApi, methodsApi, filesApi, dependenciesApi } from "@/lib/local-api";
import { readManifestSender } from "@/lib/sharing/sender-stamp";
import type { Method, Project, Task } from "@/lib/types";

/**
 * Thrown by buildMethodSendPayload when the method is `compound`. Compound
 * sharing is deferred (children would need to ride along + id-remap on import,
 * which is not built). The send dialog catches this and shows a clear notice
 * instead of relaying a bundle whose component references would dangle.
 */
export class CompoundMethodNotSupportedError extends Error {
  constructor() {
    super("Compound methods cannot be shared yet.");
    this.name = "CompoundMethodNotSupportedError";
  }
}

/** A synthetic project for the export envelope. A standalone method has no
 *  project; the importer offers "Don't link to a project" so this is never
 *  forced on the recipient. The placeholder only satisfies the envelope shape. */
function envelopeProject(method: Method): Project {
  return {
    id: 0,
    name: "(method share)",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: "",
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: method.owner,
    shared_with: [],
  };
}

/** The synthetic envelope task that carries the one method through the
 *  experiment-shaped bundle. Mirrors the task buildStandaloneMethodPackage
 *  uses; its only load-bearing fields are `owner`, `method_ids`, and `name`. */
function envelopeTask(method: Method): Task {
  return {
    id: 0,
    project_id: 0,
    name: method.name,
    start_date: "",
    duration_days: 1,
    end_date: "",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment",
    weekend_override: null,
    method_ids: [method.id],
    deviation_log: null,
    tags: null,
    sort_order: 0,
    experiment_color: null,
    sub_tasks: null,
    method_attachments: [],
    owner: method.owner,
    shared_with: [],
    is_shared_with_me: method.is_shared_with_me,
  };
}

/**
 * Build the payload bytes for sharing one standalone method. Produces the same
 * researchos-experiment zip the import pipeline reads (a synthetic envelope task
 * carrying the one method), with the manifest stamped `kind: "method"` so the
 * inbox sniff routes it to the method receive path.
 *
 * @param method      the method to share. Read via `method.owner`, so a public
 *                    or shared-with-me method the sender does not own still
 *                    packages correctly (it localizes to the recipient on
 *                    import). Compound methods throw CompoundMethodNotSupportedError.
 * @param currentUser the folder-local user driving the share. Used to read the
 *                    sender's identity sidecar for the verified-sender stamp on
 *                    the manifest (the method content read still keys on
 *                    method.owner, so a shared-with-me method still packages).
 * @returns the bundle as raw bytes, ready for sendRawShare to seal.
 */
export async function buildMethodSendPayload(
  method: Method,
  currentUser: string | null,
): Promise<Uint8Array> {
  if (method.method_type === "compound") {
    throw new CompoundMethodNotSupportedError();
  }

  const deps = { projectsApi, methodsApi, filesApi, dependenciesApi };
  const pkg = await buildStandaloneMethodPackage(method, deps);
  if (!pkg) {
    throw new Error(
      `Could not read method ${method.id} for sharing — its record was not found.`,
    );
  }

  const task = envelopeTask(method);
  const project = envelopeProject(method);
  const exportedAt = new Date().toISOString();
  const ownerLabel = method.owner || "—";

  const payload: ExperimentExportPayload = {
    task,
    project,
    resolvedBase: "",
    notesMarkdown: null,
    resultsMarkdown: null,
    methods: [pkg.payload],
    // The PDF body (for a PDF method, or a PDF stashed at a markdown path)
    // rides as a method-origin attachment so raw.ts writes it to the same
    // `methods/method-<id>-<filename>` slot the experiment export uses.
    attachments: pkg.pdfAttachment ? [pkg.pdfAttachment] : [],
    dependencies: [],
    meta: {
      ownerLabel,
      durationDays: 1,
      statusLabel: "In Progress",
      methodNames: [pkg.payload.method.name],
      exportedAt,
    },
  };

  // Verified-sender attribution, read from the signed-in user driving the
  // share (NOT method.owner, a shared-with-me method may be owned elsewhere).
  // SEND-ONLY and additive, undefined when the user has not claimed a sharing
  // identity, in which case the recipient falls back to the relay hash.
  const sender = await readManifestSender(currentUser);

  const result = await buildRawZip(payload);
  const buf = await result.blob.arrayBuffer();
  return stampMethodKind(new Uint8Array(buf), {
    exportedAt,
    ownerLabel,
    method,
    sender,
  });
}

/**
 * Re-stamp a freshly built researchos-experiment zip's manifest with
 * `kind: "method"`. raw.ts builds the manifest without the marker (it is
 * experiment-shaped by construction); we rewrite the one entry so the inbox
 * sniff can classify the bundle without touching raw.ts. Everything else in
 * the zip is left byte-for-byte intact. The same single re-stamp pass also
 * folds in the optional verified-sender block (SEND-ONLY attribution), so a
 * method bundle never round-trips the zip twice.
 */
async function stampMethodKind(
  bytes: Uint8Array,
  ctx: {
    exportedAt: string;
    ownerLabel: string;
    method: Method;
    sender?: ManifestSender;
  },
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file("_export-manifest.json");
  if (!entry) {
    // Should never happen (raw.ts always writes it), but never lose the bundle
    // over a missing marker, return the unmarked bytes and let the sniff fall
    // back. The bundle is still a valid experiment-shaped zip.
    return bytes;
  }
  const raw = await entry.async("string");
  const manifest = JSON.parse(raw) as RawManifest;
  manifest.kind = "method";
  manifest.source_instance = buildSourceInstance(ctx.ownerLabel, ctx.exportedAt);
  // Additive, omitted when the sender has no claimed identity (backward-compatible).
  if (ctx.sender) manifest.sender = ctx.sender;
  zip.file("_export-manifest.json", JSON.stringify(manifest, null, 2));
  // Preserve deterministic entry mtimes (raw.ts stamps every entry with the
  // export date; keep the rewritten manifest consistent).
  const exportDate = new Date(ctx.exportedAt);
  for (const e of Object.values(zip.files)) {
    e.date = exportDate;
  }
  const out = await zip.generateAsync({ type: "uint8array" });
  return out;
}

/**
 * Wraps decrypted method-bundle bytes as a File so the existing
 * ImportExperimentDialog (a file-picker-driven parse + resolve + apply
 * pipeline) can drive them unchanged, exactly as experimentPayloadToFile does
 * for an experiment. The bundle is researchos-experiment-shaped, so the dialog
 * reads it with no method-specific code, it sees one method to resolve and the
 * "Don't link to a project" option for the synthetic envelope project.
 */
export function methodPayloadToFile(
  bytes: Uint8Array,
  baseName = "shared-method",
): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], `${baseName}-raw.zip`, { type: "application/zip" });
}
