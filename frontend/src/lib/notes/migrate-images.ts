import { fileService } from "../file-system/file-service";
import { discoverUsers } from "../file-system/user-discovery";

export interface MigrationManifestEntry {
  originalPath: string;
  newPath: string;
}

export interface MigrationManifest {
  /** Numeric task id, slug, or any other label identifying the markdown owner. Informational only. */
  target: string | number;
  migratedAt: string;
  entries: MigrationManifestEntry[];
}

export interface MigrateResult {
  content: string;
  didMigrate: boolean;
  manifest: MigrationManifest;
}

const IMAGE_MD_REGEX = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g;
const IMAGE_HTML_REGEX = /<img\s+([^>]*?)src=["']([^"']+)["']([^>]*?)\/?>/gi;

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function splitNameExt(filename: string): { stem: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return { stem: filename, ext: "" };
  return { stem: filename.slice(0, dot), ext: filename.slice(dot) };
}

/**
 * Try to locate a legacy image on disk. Returns the resolved path that exists,
 * or null if the file can't be found.
 *
 * Tried locations, in order:
 *   - users/{owner}/Images/{rest}            (post-migration per-user layout)
 *   - users/{otherUser}/Images/{rest}        (fallback — older notes may have no recorded owner)
 *   - Images/{rest}                          (pre-migration global layout)
 *   - Same scheme for Files/ (non-image attachments)
 */
async function findLegacySource(src: string, candidateOwners: string[]): Promise<string | null> {
  const candidates: string[] = [];
  let rest = "";
  let isFiles = false;

  if (src.startsWith("../../Images/")) {
    rest = src.slice("../../Images/".length);
  } else if (src.startsWith("../../Files/")) {
    rest = src.slice("../../Files/".length);
    isFiles = true;
  } else if (src.startsWith("Images/")) {
    rest = src.slice("Images/".length);
  } else if (src.startsWith("Files/")) {
    rest = src.slice("Files/".length);
    isFiles = true;
  } else if (src.startsWith("users/")) {
    if (await fileService.fileExists(src)) return src;
    return null;
  } else {
    return null;
  }

  const subdir = isFiles ? "Files" : "Images";
  for (const owner of candidateOwners) {
    if (!owner) continue;
    candidates.push(`users/${owner}/${subdir}/${rest}`);
  }
  candidates.push(`${subdir}/${rest}`); // legacy global root

  for (const candidate of candidates) {
    if (await fileService.fileExists(candidate)) return candidate;
  }
  return null;
}

/**
 * Pick a non-colliding filename inside `${basePath}/${subdir}/`.
 * If `desired` already exists, suffixes a counter before the extension.
 */
async function pickNonCollidingName(basePath: string, subdir: string, desired: string): Promise<string> {
  const { stem, ext } = splitNameExt(desired);
  let candidate = desired;
  let n = 1;
  while (await fileService.fileExists(`${basePath}/${subdir}/${candidate}`)) {
    candidate = `${stem}-${n}${ext}`;
    n += 1;
  }
  return candidate;
}

async function copyFile(fromPath: string, toPath: string): Promise<void> {
  const blob = await fileService.readFileAsBlob(fromPath);
  if (!blob) throw new Error(`Source not found: ${fromPath}`);
  await fileService.writeFileFromBlob(toPath, blob);
}

/**
 * Walk the markdown for image references that point at the old layout
 * (`../../Images/...`, `Images/{folder}/{file}`, etc.), copy each into
 * `${basePath}/Images/` (or `${basePath}/Files/` for non-images),
 * and rewrite the markdown to use the new canonical relative path.
 *
 * Originals are left in place. A per-task manifest lists what was migrated
 * so a separate cleanup script can remove the originals once verified.
 *
 * Returns the rewritten markdown plus a manifest. If nothing needed migrating,
 * `didMigrate` is false and the input content is returned unchanged.
 */
export async function migrateNoteImages(
  content: string,
  target: string | number,
  basePath: string,
  ownerUsername?: string
): Promise<MigrateResult> {
  const manifest: MigrationManifest = {
    target,
    migratedAt: new Date().toISOString(),
    entries: [],
  };

  // Build a prioritized list of candidate owners to probe for legacy sources.
  // Older tasks may have no recorded owner, so we fall back to every known user.
  const candidateOwners: string[] = [];
  if (ownerUsername) candidateOwners.push(ownerUsername);
  try {
    const allUsers = await discoverUsers();
    for (const u of allUsers) {
      if (!candidateOwners.includes(u)) candidateOwners.push(u);
    }
  } catch {
    // discoverUsers can fail if the users/ dir is missing — fall back to whatever we have
  }

  const seen = new Map<string, string>(); // originalPath -> newRelativeRef
  let out = content;
  // Tracks whether ANY ref was rewritten this pass (copy OR middle-state
  // recovery). The manifest only records copies, but the rewrite-only case
  // still needs to mark the note dirty so the caller writes the canonical
  // markdown back to disk.
  let didRewriteAny = false;

  async function rewriteOne(src: string): Promise<string | null> {
    // Already in canonical form
    if (/^Images\/[^/]+$/.test(src) || /^Files\/[^/]+$/.test(src)) return null;
    if (!src.startsWith("../../") && !src.startsWith("Images/") && !src.startsWith("Files/") && !src.startsWith("users/")) {
      return null;
    }

    // Determine whether this is an image or non-image attachment so we can
    // probe the canonical destination by basename below.
    const wantsFiles = src.startsWith("../../Files/") || src.startsWith("Files/") || (src.startsWith("users/") && src.includes("/Files/"));
    const subdir = wantsFiles ? "Files" : "Images";
    const desired = basename(src);

    const sourcePath = await findLegacySource(src, candidateOwners);
    if (!sourcePath) {
      // Recover middle-state refs: if a previous migration copied the file
      // into the canonical destination but didn't rewrite the markdown (or the
      // ref had a folder segment like `Images/{folder}/{file}`), the source
      // is gone from `users/{owner}/Images/` but `${basePath}/${subdir}/{file}`
      // already holds the canonical copy. Just rewrite the ref to point there.
      if (await fileService.fileExists(`${basePath}/${subdir}/${desired}`)) {
        didRewriteAny = true;
        return `${subdir}/${desired}`;
      }
      return null;
    }

    if (seen.has(sourcePath)) return seen.get(sourcePath)!;

    const isImage = sourcePath.includes("/Images/") || sourcePath.startsWith("Images/");
    const finalSubdir = isImage ? "Images" : "Files";
    const finalName = await pickNonCollidingName(basePath, finalSubdir, basename(sourcePath));
    const destPath = `${basePath}/${finalSubdir}/${finalName}`;
    await copyFile(sourcePath, destPath);

    const newRef = `${finalSubdir}/${finalName}`;
    seen.set(sourcePath, newRef);
    manifest.entries.push({ originalPath: sourcePath, newPath: destPath });
    didRewriteAny = true;
    return newRef;
  }

  const mdMatches = [...content.matchAll(IMAGE_MD_REGEX)];
  for (const m of mdMatches) {
    const src = m[2];
    const replacement = await rewriteOne(src);
    if (replacement) {
      const before = m[0];
      const title = m[3] ?? "";
      const after = `![${m[1]}](${replacement}${title})`;
      out = out.split(before).join(after);
    }
  }

  const htmlMatches = [...content.matchAll(IMAGE_HTML_REGEX)];
  for (const m of htmlMatches) {
    const src = m[2];
    const replacement = await rewriteOne(src);
    if (replacement) {
      const before = m[0];
      const after = before.replace(src, replacement);
      out = out.split(before).join(after);
    }
  }

  const didCopyAny = manifest.entries.length > 0;
  if (didCopyAny) {
    await writeManifest(basePath, manifest);
  }

  // Surface `didMigrate=true` whenever any rewrite happened — caller uses
  // this to know it should write the canonical markdown back to disk.
  return { content: out, didMigrate: didRewriteAny, manifest };
}

async function writeManifest(basePath: string, fresh: MigrationManifest): Promise<void> {
  const manifestPath = `${basePath}/.migrated-images.json`;
  let merged: MigrationManifest = fresh;
  const existing = await fileService.readJson<MigrationManifest>(manifestPath);
  if (existing && Array.isArray(existing.entries)) {
    const byOriginal = new Map<string, MigrationManifestEntry>();
    for (const e of existing.entries) byOriginal.set(e.originalPath, e);
    for (const e of fresh.entries) byOriginal.set(e.originalPath, e);
    merged = {
      target: fresh.target,
      migratedAt: fresh.migratedAt,
      entries: [...byOriginal.values()],
    };
  }
  await fileService.writeJson(manifestPath, merged);
}
