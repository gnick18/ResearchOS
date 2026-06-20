// Cross-folder COPY / MOVE for the HEAVY object types (method / experiment /
// project), the destination-scoped twins that mirror the light-type seam
// (note-transfer.ts materializeNoteToDestination, sequence/calculator twins).
//
// WHY a dedicated twin instead of reusing import/apply.ts. The import-apply
// layer localizes a heavy export bundle into the CURRENT user through the fat
// singleton APIs (methodsApi / tasksApi / projectsApi / the protocol APIs), each
// of which calls getCurrentUserCached and runs singleton-bound cleanup
// (hosted-manifest, shared_with, dependency rebuild). Threading a destination
// `ctx` through all of them is invasive and risks that cleanup. So these twins
// READ the source records straight off the SOURCE folder's disk via the module
// singleton fileService (raw JSON / blob reads, no fat API), and WRITE them into
// the DESTINATION folder via an injected FileService + an EXPLICIT destination
// username, allocating fresh ids from the destination's OWN counters. The source
// is never mutated (COPY); MOVE trashes the source separately via the per-entity
// delete APIs in local-folder-transfer.ts.
//
// NO NEW ON-DISK DATA SHAPE. Every record written here is an EXISTING record
// shape (Method, Task, Project, Dependency, the protocol records) copied into a
// second folder. Only ids (and the localized source_path / method links) are
// rewritten so they resolve in the destination's id-space. A cross-folder copy
// is owner-only on arrival, mirroring the light types: owner is reset to the
// destination user, is_public -> false, shared_with -> [], and cross-boundary
// provenance (received_from / source_uuid) is dropped so a fresh copy starts a
// fresh identity.
//
// COUNTERS. Methods + their structured protocol records are PUBLIC_ENTITIES in
// json-store.ts, so even a PRIVATE method draws its id from the GLOBAL counter
// (`users/_global_counters.json`), not the per-user counter. Tasks / projects /
// dependencies draw from the per-user counter (`users/<user>/_counters.json`).
// We allocate from the DESTINATION folder's matching counter directly so a new
// id never collides with a source-folder id.

import { fileService, type FileService } from "@/lib/file-system/file-service";
import type { TargetContext } from "@/lib/storage/json-store";
import type {
  Method,
  Task,
  Project,
  Dependency,
  TaskMethodAttachment,
} from "@/lib/types";
import { taskNotesBase, taskResultsBase, taskResultsTabBase } from "@/lib/tasks/results-paths";

// ── Counter allocation against an explicit FileService ─────────────────────────

/** Allocate the next per-user id for `entity` from a specific user's counters,
 *  via the supplied FileService. Mirrors json-store nextIdForUser but bound to a
 *  caller-chosen service so it can target either the SOURCE singleton or the
 *  DESTINATION instance. Used for tasks / projects / dependencies. */
async function nextUserId(
  fs: FileService,
  username: string,
  entity: string,
): Promise<number> {
  const path = `users/${username}/_counters.json`;
  const counters = (await fs.readJson<Record<string, number>>(path)) ?? {};
  const next = (counters[entity] || 0) + 1;
  counters[entity] = next;
  await fs.writeJson(path, counters);
  return next;
}

/** Allocate the next GLOBAL id for `entity` from a folder's
 *  `users/_global_counters.json`, via the supplied FileService. Methods and the
 *  structured protocol records use the global counter even when private (they
 *  are PUBLIC_ENTITIES in json-store), so a cross-folder method copy must bump
 *  the DESTINATION folder's global counter, not its per-user one. */
async function nextGlobalId(fs: FileService, entity: string): Promise<number> {
  const path = `users/_global_counters.json`;
  const counters = (await fs.readJson<Record<string, number>>(path)) ?? {};
  const next = (counters[entity] || 0) + 1;
  counters[entity] = next;
  await fs.writeJson(path, counters);
  return next;
}

// ── source_path protocol routing ───────────────────────────────────────────────

/** The structured protocol method types and the `<scheme>://protocol/{id}`
 *  source_path scheme + on-disk entity directory each uses. cell_culture stores
 *  under `cell_culture_schedules`; the rest mirror their scheme name. Centralized
 *  here so the method twin localizes every structured type the same way. */
const PROTOCOL_ROUTING: Record<
  string,
  { scheme: string; entity: string }
> = {
  pcr: { scheme: "pcr", entity: "pcr_protocols" },
  lc_gradient: { scheme: "lc_gradient", entity: "lc_gradients" },
  plate: { scheme: "plate", entity: "plate_layouts" },
  cell_culture: { scheme: "cell_culture", entity: "cell_culture_schedules" },
  mass_spec: { scheme: "mass_spec", entity: "mass_spec_methods" },
  coding_workflow: { scheme: "coding_workflow", entity: "coding_workflows" },
  qpcr_analysis: { scheme: "qpcr_analysis", entity: "qpcr_analyses" },
};

/** Parse a `<scheme>://protocol/{id}` source_path into its numeric protocol id,
 *  or null when it does not match (a markdown / pdf method, or a malformed ref).
 *  Mirrors the per-scheme extractors in export/extract.ts. */
function extractProtocolId(scheme: string, sourcePath: string | null): number | null {
  if (!sourcePath) return null;
  const m = sourcePath.match(new RegExp(`^${scheme}://protocol/(\\d+)$`));
  return m ? parseInt(m[1], 10) : null;
}

/** Slugify a method name into the `methods/<slug>/...` body-file directory the
 *  app uses (matches export/slug.ts + apply.ts slugifyForPath). */
function slugifyForPath(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "method"
  );
}

// ── Source disk reads (singleton, source folder) ───────────────────────────────

/**
 * Read a method record straight off the SOURCE folder's disk. A method lives at
 * `users/<owner>/methods/{id}.json` (private) or `users/public/methods/{id}.json`
 * (whole-lab). We try the named owner first, then private-then-public fallbacks,
 * mirroring methodsApi.get's routing but as raw reads so this never depends on
 * the fat (and, in tests, mocked) local-api singleton.
 */
async function readSourceMethod(
  id: number,
  owner: string | null | undefined,
): Promise<Method | null> {
  if (owner && owner !== "public") {
    const rec = await fileService.readJson<Method>(`users/${owner}/methods/${id}.json`);
    if (rec) return rec;
  }
  if (owner === "public") {
    const rec = await fileService.readJson<Method>(`users/public/methods/${id}.json`);
    if (rec) return rec;
  }
  // Fallback: caller did not know the namespace. Try public last (a private
  // record under an unknown user cannot be located by id alone).
  const pub = await fileService.readJson<Method>(`users/public/methods/${id}.json`);
  return pub ?? null;
}

/** Read a structured protocol record off the SOURCE disk for a given method,
 *  trying the method's owner namespace then public. The record is returned
 *  verbatim (we only rewrite its id on write), so its shape is preserved exactly
 *  regardless of protocol type. */
async function readSourceProtocol(
  entity: string,
  protoId: number,
  owner: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  if (owner && owner !== "public") {
    const rec = await fileService.readJson<Record<string, unknown>>(
      `users/${owner}/${entity}/${protoId}.json`,
    );
    if (rec) return rec;
  }
  const pub = await fileService.readJson<Record<string, unknown>>(
    `users/public/${entity}/${protoId}.json`,
  );
  return pub ?? null;
}

// ── METHOD materialize (Stage 1) ───────────────────────────────────────────────

/**
 * MATERIALIZE A METHOD INTO A DESTINATION FOLDER. The cross-folder twin of the
 * import-apply method-localize path, but writing into a SECOND folder via `dest`.
 *
 * Reads the source method (record + its structured protocol record OR its
 * markdown/pdf body file) off the SOURCE disk, then writes a fresh private copy
 * into the destination:
 *   - The new method id comes from the DESTINATION's GLOBAL counter.
 *   - A structured protocol is re-created in the destination's id-space (fresh
 *     protocol id from the destination global counter) and the new method's
 *     source_path is rewritten to point at it.
 *   - A markdown / pdf body file is copied to `methods/<destSlug>/<file>` in the
 *     destination and source_path / source_pdf_path are rewritten to the new path.
 *   - owner is reset to the destination user, is_public -> false, shared_with ->
 *     [], and provenance / portable identity (received_from*, source_uuid) is
 *     dropped (a fresh copy starts a fresh identity, mirroring the light types).
 *
 * COMPOUND methods are refused before this is reached (their child references
 * would each have to ride along + id-remap, which is not built, exactly as the
 * relay method-share refuses compounds). The caller's unsupportedReason handles
 * that.
 *
 * @param method the source method record (as the caller already has it loaded,
 *               e.g. from the methods page). Its `id`, `owner`, `source_path`,
 *               and `method_type` drive the disk reads. We re-read the canonical
 *               record off disk to be robust to a stale in-memory copy.
 * @param dest   the destination FileService + username.
 * @returns the fresh method id allocated in the destination.
 */
export async function materializeMethodToDestination(
  method: Method,
  dest: TargetContext,
): Promise<{ methodId: number }> {
  // Re-read the canonical source record off disk (the passed object may be a
  // read-time overlay with is_shared_with_me / shared_permission set). Fall back
  // to the passed record if the disk read misses (e.g. an in-memory-only record
  // in a test), so the copy still proceeds with what the caller holds.
  const source = (await readSourceMethod(method.id, method.owner)) ?? method;

  const methodType = source.method_type ?? null;

  // 1. Localize the body: a structured protocol record, or a markdown/pdf file.
  let newSourcePath: string | null = source.source_path ?? null;
  let newSourcePdfPath: string | null = source.source_pdf_path ?? null;

  const routing = methodType ? PROTOCOL_ROUTING[methodType] : undefined;
  if (routing) {
    const protoId = extractProtocolId(routing.scheme, source.source_path ?? null);
    if (protoId != null) {
      const proto = await readSourceProtocol(routing.entity, protoId, source.owner);
      if (proto) {
        // Re-create the protocol in the destination's id-space. The record is
        // copied verbatim (shape preserved); only the id is reassigned and the
        // copy lands private (is_public:false) under the destination user.
        const newProtoId = await nextGlobalId(dest.fileService, routing.entity);
        const protoDir = `users/${dest.username}/${routing.entity}`;
        await dest.fileService.ensureDir(protoDir);
        await dest.fileService.writeJson(`${protoDir}/${newProtoId}.json`, {
          ...proto,
          id: newProtoId,
          is_public: false,
        });
        newSourcePath = `${routing.scheme}://protocol/${newProtoId}`;
      } else {
        // The protocol record could not be read (missing on the source disk).
        // Keep the method record but null its dangling protocol ref rather than
        // point at a protocol id that does not exist in the destination.
        newSourcePath = null;
      }
    }
  } else if (
    (methodType === "markdown" || methodType === "pdf") &&
    source.source_path
  ) {
    // Copy the body file to a fresh slug dir in the destination. Read the bytes
    // off the SOURCE root (body files live at the FOLDER root, not under
    // users/<u>/), write them to the destination root under the new slug.
    const filename = source.source_path.split("/").pop() ?? `method-${source.id}`;
    const newSlug = slugifyForPath(source.name);
    const destBodyPath = `methods/${newSlug}/${filename}`;
    const blob = await fileService.readFileAsBlob(source.source_path);
    if (blob) {
      await dest.fileService.writeFileFromBlob(destBodyPath, blob);
      newSourcePath = destBodyPath;
    } else {
      // Body bytes missing on the source disk: keep the record, drop the path.
      newSourcePath = null;
    }
  }

  // A bundled source PDF (kit methods) rides alongside a structured method; copy
  // it to the destination too so the pdf viewer still resolves it.
  if (source.source_pdf_path) {
    const pdfName = source.source_pdf_path.split("/").pop() ?? `source-${source.id}.pdf`;
    const newSlug = slugifyForPath(source.name);
    const destPdfPath = `methods/${newSlug}/${pdfName}`;
    const pdfBlob = await fileService.readFileAsBlob(source.source_pdf_path);
    if (pdfBlob) {
      await dest.fileService.writeFileFromBlob(destPdfPath, pdfBlob);
      newSourcePdfPath = destPdfPath;
    } else {
      newSourcePdfPath = null;
    }
  }

  // 2. Write the method record into the destination's private namespace with a
  // fresh GLOBAL id, owner-only on arrival.
  const newId = await nextGlobalId(dest.fileService, "methods");
  const methodDir = `users/${dest.username}/methods`;
  await dest.fileService.ensureDir(methodDir);

  const newMethod: Method = {
    ...source,
    id: newId,
    source_path: newSourcePath,
    source_pdf_path: newSourcePdfPath,
    // A copy is owner-only on arrival (mirrors the calculator twin).
    owner: dest.username,
    is_public: false,
    shared_with: [],
    created_by: null,
    // Drop read-time overlays + cross-boundary provenance + portable identity so
    // the fresh copy starts clean (no foreign badge, no inherited uuid).
    is_shared_with_me: undefined,
    shared_permission: undefined,
    received_from: undefined,
    received_from_fingerprint: undefined,
    received_at: undefined,
    source_uuid: undefined,
  };
  // Strip the undefined keys so they are not serialized as explicit nulls.
  for (const k of [
    "is_shared_with_me",
    "shared_permission",
    "received_from",
    "received_from_fingerprint",
    "received_at",
    "source_uuid",
  ] as const) {
    delete (newMethod as unknown as Record<string, unknown>)[k];
  }

  await dest.fileService.writeJson(`${methodDir}/${newId}.json`, newMethod);
  return { methodId: newId };
}

// ── Helpers reused by experiment + project twins (Stage 2 / 3) ─────────────────
// Exported so the experiment / project twins (built in later stages) can localize
// methods + write task subtrees through the same destination-scoped seam. Stage 1
// ships the method twin only; the helpers below are the shared primitives.

export {
  nextUserId,
  nextGlobalId,
  readSourceMethod,
  readSourceProtocol,
  PROTOCOL_ROUTING,
  extractProtocolId,
  slugifyForPath,
};
export type { Task, Project, Dependency, TaskMethodAttachment };
export { taskNotesBase, taskResultsBase, taskResultsTabBase };
