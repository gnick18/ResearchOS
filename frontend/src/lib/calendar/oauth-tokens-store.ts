import { fileService } from "@/lib/file-system/file-service";

/**
 * OAuth-token persistence for Google + Microsoft calendar integrations.
 *
 * Stored as `users/{username}/_calendar-oauth.json`. The file is sensitive
 * (refresh tokens last indefinitely until the user explicitly revokes
 * access on the provider side), so callers should make sure the data
 * folder's `.gitignore` covers it — `ensureGitignoreEntries` is wired up
 * from the connect-account UI just like the existing telegram/feeds files.
 *
 * Per provider we hold one account's tokens — the UI prompts the user to
 * pick which calendars from that account become feeds. That keeps the
 * shape simple; multi-account-per-provider can grow in here later
 * without breaking callers.
 */

const SCHEMA_VERSION = 1;

export type OAuthProvider = "google" | "outlook";

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** ISO datetime when the access token expires. Past this point, callers
   *  should refresh via `/api/auth/<provider>/refresh` before reusing. */
  expiresAt: string;
  /** Best-effort sign-in identity for display ("Connected as alice@…"). */
  accountEmail: string | null;
  connectedAt: string;
  /** Provider scopes that were actually granted; surfaced in the UI so
   *  the user can tell whether write is enabled. */
  scopes: string[];
}

interface OAuthFile {
  version: number;
  google?: OAuthTokens;
  outlook?: OAuthTokens;
}

function tokensPath(username: string): string {
  return `users/${username}/_calendar-oauth.json`;
}

async function readFile(username: string): Promise<OAuthFile> {
  const data = await fileService.readJson<OAuthFile>(tokensPath(username));
  if (!data) return { version: SCHEMA_VERSION };
  return {
    version: SCHEMA_VERSION,
    google: data.google,
    outlook: data.outlook,
  };
}

async function writeFile(username: string, data: OAuthFile): Promise<void> {
  await fileService.writeJson(tokensPath(username), data);
}

export async function readTokens(
  username: string,
  provider: OAuthProvider,
): Promise<OAuthTokens | null> {
  const file = await readFile(username);
  return file[provider] ?? null;
}

export async function writeTokens(
  username: string,
  provider: OAuthProvider,
  tokens: OAuthTokens,
): Promise<void> {
  const file = await readFile(username);
  file[provider] = tokens;
  await writeFile(username, file);
}

export async function clearTokens(
  username: string,
  provider: OAuthProvider,
): Promise<void> {
  const file = await readFile(username);
  delete file[provider];
  await writeFile(username, file);
}

/** Quick check used by the UI to decide which "Connected" vs "Connect"
 *  state to render. */
export async function isConnected(
  username: string,
  provider: OAuthProvider,
): Promise<boolean> {
  return (await readTokens(username, provider)) !== null;
}
