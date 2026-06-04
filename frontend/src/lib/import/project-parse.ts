// Cross-boundary PROJECT sharing (v1), the project-bundle parser.
//
// Reads a `researchos-project` zip (export/project-bundle.ts) into an in-memory
// ProjectImportPayload, the stripped project record + every per-experiment
// ImportPayload (parsed by the EXISTING single-experiment parseImportBundle, so
// each inner bundle reads with zero new format work) + the project-scoped,
// deduped task-to-task dependency union.
//
// Does NOT touch the receiver's disk, materialization happens in
// project-apply.ts. The single-experiment parse + apply path is untouched: this
// module only WRAPS parseImportBundle, calling it once per inner experiment zip.

import JSZip from "jszip";

import type { Dependency, Project } from "@/lib/types";
import {
  PROJECT_BUNDLE_FORMAT,
  PROJECT_MANIFEST_FILE,
  type ProjectBundleManifest,
} from "@/lib/export/project-bundle";
import { ImportParseError, parseImportBundle } from "./parse";
import type { ImportPayload } from "./types";

const INNER_EXPERIMENT_RE = /^experiments\/.+\.zip$/;

export interface ProjectImportPayload {
  manifest: ProjectBundleManifest;
  /** The stripped project record carried in the bundle (source id-space). */
  project: Project;
  /** One parsed payload per carried experiment, in manifest order where
   *  possible. Each is exactly what the single-experiment parser produces. */
  experiments: ImportPayload[];
  /** The deduped, project-scoped dependency union (source id-space). The
   *  importer remaps these once it has the full multi-task id map. Empty when
   *  the project had no in-project links. */
  dependencies: Dependency[];
}

function isProjectManifestShape(v: unknown): v is ProjectBundleManifest {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    m.format === PROJECT_BUNDLE_FORMAT &&
    m.version === 1 &&
    m.kind === "project" &&
    typeof m.project_id === "number" &&
    Array.isArray(m.experiments)
  );
}

function isDependencyShape(v: unknown): v is Dependency {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.id === "number" &&
    typeof d.parent_id === "number" &&
    typeof d.child_id === "number" &&
    (d.dep_type === "FS" || d.dep_type === "SS" || d.dep_type === "SF")
  );
}

function synthesizeProject(manifest: ProjectBundleManifest): Project {
  return {
    id: manifest.project_id,
    name: manifest.project_name || "(Imported project)",
    weekend_active: false,
    tags: null,
    color: null,
    created_at: manifest.exported_at,
    sort_order: 0,
    is_archived: false,
    archived_at: null,
    owner: manifest.source_owner,
    shared_with: [],
  };
}

/**
 * Parse a `researchos-project` bundle into a ProjectImportPayload. Validates the
 * project manifest, then parses each inner `experiments/{slug}-raw.zip` with the
 * unchanged single-experiment parser. A single inner bundle that fails to parse
 * is dropped with a warning rather than failing the whole project import, the
 * other experiments still come over (the manifest records what was meant to be
 * present so a future UI can surface the gap).
 */
export async function parseProjectBundle(file: Blob): Promise<ProjectImportPayload> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new ImportParseError(
      `Failed to open the .zip file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const manifestEntry = zip.file(PROJECT_MANIFEST_FILE);
  if (!manifestEntry) {
    throw new ImportParseError(
      `This zip is missing ${PROJECT_MANIFEST_FILE} — it doesn't look like a ResearchOS project bundle.`,
    );
  }

  let manifest: ProjectBundleManifest;
  try {
    const parsed = JSON.parse(await manifestEntry.async("string")) as unknown;
    if (!isProjectManifestShape(parsed)) {
      throw new ImportParseError(
        "The manifest is not a valid ResearchOS project manifest (wrong format or version).",
      );
    }
    manifest = parsed;
  } catch (err) {
    if (err instanceof ImportParseError) throw err;
    throw new ImportParseError(
      `Failed to read the project manifest: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // The project record. Lenient like the single-experiment parser, fall back to
  // a synthetic record built from the manifest if project.json is missing /
  // malformed so the import still proceeds.
  let project: Project;
  const projectEntry = zip.file("project.json");
  if (projectEntry) {
    try {
      project = JSON.parse(await projectEntry.async("string")) as Project;
    } catch {
      project = synthesizeProject(manifest);
    }
  } else {
    project = synthesizeProject(manifest);
  }

  // Project-scoped dependency union. Optional sidecar; missing = no in-project
  // links. Each record is shape-checked; malformed entries are dropped + warned
  // rather than poisoning the import.
  const dependencies: Dependency[] = [];
  const depsEntry = zip.file("dependencies.json");
  if (depsEntry) {
    try {
      const parsed = JSON.parse(await depsEntry.async("string")) as unknown;
      if (Array.isArray(parsed)) {
        for (const rec of parsed) {
          if (isDependencyShape(rec)) {
            dependencies.push(rec);
          } else {
            console.warn("[project.parse] dropping malformed dependency record:", rec);
          }
        }
      } else {
        console.warn("[project.parse] dependencies.json is not an array; ignoring.");
      }
    } catch (err) {
      console.warn("[project.parse] failed to parse dependencies.json:", err);
    }
  }

  // Parse each inner experiment bundle with the unchanged single-experiment
  // parser. Walk by manifest order first (so the receive inventory matches the
  // sender's intent), then sweep any inner zips the manifest did not list.
  const innerByPath = new Map<string, JSZip.JSZipObject>();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (INNER_EXPERIMENT_RE.test(path)) innerByPath.set(path, entry);
  }

  const experiments: ImportPayload[] = [];
  const consumed = new Set<string>();

  const parseInner = async (path: string, entry: JSZip.JSZipObject) => {
    try {
      // Use arraybuffer (not blob) so the inner bundle loads in both the browser
      // and a Node/vitest env (where Blob's FileReader is absent). JSZip.loadAsync
      // accepts an ArrayBuffer; parseImportBundle threads it straight in.
      const innerBytes = await entry.async("arraybuffer");
      const payload = await parseImportBundle(innerBytes as unknown as Blob);
      experiments.push(payload);
    } catch (err) {
      console.warn(`[project.parse] failed to parse inner experiment ${path}:`, err);
    }
  };

  for (const indexed of manifest.experiments) {
    const entry = innerByPath.get(indexed.path);
    if (entry) {
      consumed.add(indexed.path);
      await parseInner(indexed.path, entry);
    } else {
      console.warn(
        `[project.parse] manifest references ${indexed.path} but no such entry was found.`,
      );
    }
  }
  for (const [path, entry] of innerByPath) {
    if (consumed.has(path)) continue;
    await parseInner(path, entry);
  }

  if (experiments.length === 0) {
    throw new ImportParseError(
      "This project bundle had no readable experiments. Nothing was imported.",
    );
  }

  return { manifest, project, experiments, dependencies };
}
