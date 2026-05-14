import { fileService } from "@/lib/file-system/file-service";

/**
 * Per-user LabArchives connection state.
 *
 * Stored as `users/{username}/_labarchives.json`. Unlike the calendar OAuth
 * tokens, this file holds NO secrets — the institutional `akid` +
 * `access_password` live in env vars, and per-user authentication is just
 * the UID returned by `users/user_access_info`. That means it's safe to
 * leave around: anyone with the UID still has to make API calls through
 * our signed endpoints.
 *
 * We still surface it to `ensureGitignoreEntries` because it's user-private
 * (a stranger with the UID could enumerate that user's notebooks).
 */

const SCHEMA_VERSION = 1;

export interface LabArchivesConnection {
  uid: string;
  /** Display name pulled from the LabArchives user record. */
  fullname: string | null;
  /** Account email, when LabArchives returned one. */
  email: string | null;
  connectedAt: string;
}

interface LabArchivesFile {
  version: number;
  connection?: LabArchivesConnection;
}

function path(username: string): string {
  return `users/${username}/_labarchives.json`;
}

async function readFile(username: string): Promise<LabArchivesFile> {
  // Read raw bytes first so we can distinguish "no file" (which is the
  // normal not-connected state) from "file exists but the JSON is
  // malformed" (which a debugger bot deserves a log line for). The default
  // `fileService.readJson` swallows both into a single `null` return.
  const blob = await fileService.readFileAsBlob(path(username));
  if (!blob) return { version: SCHEMA_VERSION };
  let text: string;
  try {
    text = await blob.text();
  } catch (err) {
    console.warn(
      `[labarchives] _labarchives.json for ${username} could not be read: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { version: SCHEMA_VERSION };
  }
  try {
    const data = JSON.parse(text) as LabArchivesFile;
    return { version: SCHEMA_VERSION, connection: data.connection };
  } catch (err) {
    // Differentiating signal — `null` would be silent. Callers still see
    // "not connected" so nothing breaks; this is purely a debug breadcrumb.
    console.warn(
      `[labarchives] _labarchives.json for ${username} is malformed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { version: SCHEMA_VERSION };
  }
}

async function writeFile(username: string, data: LabArchivesFile): Promise<void> {
  await fileService.writeJson(path(username), data);
}

export async function readConnection(
  username: string,
): Promise<LabArchivesConnection | null> {
  const file = await readFile(username);
  return file.connection ?? null;
}

export async function writeConnection(
  username: string,
  connection: LabArchivesConnection,
): Promise<void> {
  await writeFile(username, { version: SCHEMA_VERSION, connection });
}

export async function clearConnection(username: string): Promise<void> {
  await writeFile(username, { version: SCHEMA_VERSION });
}

export async function isConnected(username: string): Promise<boolean> {
  return (await readConnection(username)) !== null;
}
