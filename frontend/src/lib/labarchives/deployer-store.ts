"use client";

/**
 * Deployer-tier LabArchives credentials, stored as a sidecar JSON at the
 * root of the user's data folder.
 *
 * Path: `_labarchives-deployer.json` — alongside `users/`, NOT inside any
 * specific user's folder. The institutional `akid` + `access_password` are
 * deployment-tier secrets shared across every signed-in user of this data
 * folder (the deployer set them once when wiring the integration to their
 * institution).
 *
 * ## Trust model
 *
 * The institutional `access_password` lives **plaintext on disk** in the
 * user's data folder. This is equivalent to plaintext env vars on disk in
 * `.env.local` — not WORSE, but not better. Anyone with read access to the
 * data folder has the institutional secret.
 *
 * For ResearchOS's primary use case (single-user, local-first, self-host
 * where the deployer and the user are the same person) this trade-off is
 * fine: there's no second person to leak it to, and being able to configure
 * the integration via the UI instead of hand-editing `.env.local` is real
 * friction relief. For a multi-tenant deployment, env vars are still the
 * correct path — which is why `readLabArchivesCredsFromRequest` consults
 * env vars first and only falls back to the sidecar.
 *
 * The sidecar must NEVER be consulted in demo / wiki-capture mode —
 * callers gate via `isDemoOrWikiCapture()` before checking.
 *
 * See also: `tokens-store.ts` for the per-user UID file
 * (`users/{username}/_labarchives.json`).
 */

import { fileService } from "@/lib/file-system/file-service";
import { ensureGitignoreEntries } from "@/lib/file-system/gitignore";

const SCHEMA_VERSION = 1;
const SIDECAR_PATH = "_labarchives-deployer.json";

export interface DeployerCreds {
  accessKeyId: string;
  accessPassword: string;
  /** Region-specific REST endpoint. Defaults to the US base when absent. */
  baseUrl?: string;
}

interface DeployerFile {
  version: number;
  accessKeyId: string;
  accessPassword: string;
  baseUrl?: string;
  updatedAt: string;
}

/**
 * Read the sidecar from the connected data folder, returning null when:
 *  - no folder is connected (file-service has no directoryHandle),
 *  - the file doesn't exist,
 *  - or the file is malformed / missing required fields.
 *
 * Caller-side responsibility: gate on `isDemoOrWikiCapture()` first so the
 * fixture-mode mock folder isn't probed for real credentials.
 *
 * On malformed JSON, emits a `console.warn` carrying the parse error
 * before returning null — pure debugger signal so a deployer who
 * hand-edited the file and corrupted it can see a breadcrumb in the
 * console. Caller still sees `null` → "not configured", matching the
 * file-not-found path so nothing else breaks. Mirrors the same pattern
 * used in `tokens-store.ts` for `_labarchives.json`.
 */
export async function readDeployerCreds(): Promise<DeployerCreds | null> {
  // Read raw bytes first so we can distinguish "no file" (normal —
  // sidecar not configured yet) from "file exists but JSON is malformed"
  // (deserves a console.warn). The plain `fileService.readJson` swallows
  // both into a single `null` return, which is what we want for the
  // happy path but loses the debug signal we want here.
  const blob = await fileService.readFileAsBlob(SIDECAR_PATH);
  if (!blob) return null;
  let text: string;
  try {
    text = await blob.text();
  } catch (err) {
    console.warn(
      `[labarchives] _labarchives-deployer.json could not be read: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
  let data: DeployerFile;
  try {
    data = JSON.parse(text) as DeployerFile;
  } catch (err) {
    console.warn(
      `[labarchives] _labarchives-deployer.json is malformed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
  if (typeof data.accessKeyId !== "string" || data.accessKeyId.trim() === "") return null;
  if (typeof data.accessPassword !== "string" || data.accessPassword.trim() === "") return null;
  const out: DeployerCreds = {
    accessKeyId: data.accessKeyId,
    accessPassword: data.accessPassword,
  };
  if (typeof data.baseUrl === "string" && data.baseUrl.trim() !== "") {
    out.baseUrl = data.baseUrl;
  }
  return out;
}

/**
 * Write (or replace) the sidecar. Also appends `_labarchives-deployer.json`
 * to the data folder's `.gitignore` so the file doesn't accidentally land
 * in a shared git repository.
 *
 * Validates that the inputs are non-empty strings of reasonable length.
 * Returns nothing; throws on FSA errors.
 */
export async function writeDeployerCreds(creds: DeployerCreds): Promise<void> {
  const akid = creds.accessKeyId.trim();
  const password = creds.accessPassword.trim();
  if (akid === "") throw new Error("Access key id is required.");
  if (password === "") throw new Error("Access password is required.");
  if (akid.length > 1024) throw new Error("Access key id is too long.");
  if (password.length > 1024) throw new Error("Access password is too long.");
  const baseUrl = creds.baseUrl?.trim();
  if (baseUrl && baseUrl.length > 1024) throw new Error("Base URL is too long.");

  const file: DeployerFile = {
    version: SCHEMA_VERSION,
    accessKeyId: akid,
    accessPassword: password,
    updatedAt: new Date().toISOString(),
  };
  if (baseUrl) file.baseUrl = baseUrl;
  await fileService.writeJson(SIDECAR_PATH, file);
  try {
    await ensureGitignoreEntries(["_labarchives-deployer.json"]);
  } catch {
    // Best-effort. The data folder may not have a .gitignore; that's fine.
  }
}

/** Remove the sidecar entirely. No-op when the file doesn't exist. */
export async function clearDeployerCreds(): Promise<void> {
  await fileService.deleteFile(SIDECAR_PATH);
}

/** Quick "do we have a sidecar?" probe. Returns false in SSR / before
 *  folder-connect, and never throws. */
export async function hasDeployerCreds(): Promise<boolean> {
  try {
    if (!(await fileService.fileExists(SIDECAR_PATH))) return false;
    return (await readDeployerCreds()) !== null;
  } catch {
    return false;
  }
}
