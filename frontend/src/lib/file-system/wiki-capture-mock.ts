/**
 * Dev-only wiki-screenshot capture mode.
 *
 * When the URL has `?wikiCapture=1` AND we're not in production, this module
 * swaps the real `fileService` for an in-memory backing store seeded with
 * fixture data (`wiki-capture-fixture.ts`). The rest of the app keeps using
 * the same singleton import and has no idea anything is different — projects,
 * tasks, methods, etc. all "load" from the fixture as if a real folder were
 * connected.
 *
 * Why this exists: capturing screenshots of every feature page (Home, Gantt,
 * Methods, etc.) needs realistic data. The File System Access API picker
 * can't be automated headlessly, so instead we mock the storage layer when
 * Playwright passes `?wikiCapture=1`.
 *
 * Never imported from production code. Guarded by NODE_ENV checks both here
 * and at the call site in FileSystemProvider.
 */

import { fileService } from "./file-service";
import { storeCurrentUser, storeMainUser, storeDirectoryHandle } from "./indexeddb-store";
import { buildWikiFixtures } from "./wiki-capture-fixture";

/** Capture-mode variants. The default `"signed-in"` corresponds to
 *  `?wikiCapture=1` (the most common case) and gives you a fully signed-in
 *  session as user `alex` (the demo lab's PI). The `"picker"` variant
 *  (`?wikiCapture=picker`) installs the fixture but leaves `currentUser`
 *  empty so the user-picker screen renders — used to capture
 *  `user-login.png`. */
export type WikiCaptureVariant = "signed-in" | "picker";

/** Returns the capture variant for the current URL, or null if the page
 *  hasn't opted in. Allowed in dev and on localhost in prod; hard-blocked
 *  on non-local hostnames in production. SSR-safe: returns null on the
 *  server. */
export function getWikiCaptureVariant(): WikiCaptureVariant | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("wikiCapture");
    if (value === null) return null;
    if (process.env.NODE_ENV === "production") {
      const host = window.location.hostname;
      const ok = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
      if (!ok) return null;
    }
    return value === "picker" ? "picker" : "signed-in";
  } catch {
    return null;
  }
}

/** True if any wiki-capture flag is set on the URL. */
export function isWikiCaptureMode(): boolean {
  return getWikiCaptureVariant() !== null;
}

let installed = false;

interface InstallOptions {
  /** When true, skip writing the IndexedDB current-user entry, so the
   *  app sees the folder as connected but no user signed in. Used to
   *  capture `user-login.png` (the user-picker screen). Default: false. */
  signIn?: boolean;
}

/** Idempotent. Swaps fileService methods for an in-memory store seeded with
 *  fixture data. By default, also writes the fixture user to IndexedDB so
 *  the rest of the app sees them as signed in. Pass `signIn: false` to
 *  stop at the user-picker. */
export async function installWikiCaptureFixture(
  options: InstallOptions = {},
): Promise<void> {
  const { signIn = true } = options;
  if (installed) return;
  installed = true;

  const fixtures = buildWikiFixtures();
  const files = new Map<string, unknown>();
  const dirs = new Set<string>();
  const blobs = new Map<string, Blob>();

  for (const [path, content] of fixtures) {
    const norm = normalizePath(path);
    files.set(norm, content);
    addParentDirs(norm, dirs);
  }

  // A truthy stand-in so methods that bail when `directoryHandle` is null
  // continue past their early-return. Never actually read by our overrides.
  const fakeHandle = {
    name: "wiki-capture-fixture",
    kind: "directory",
  } as unknown as FileSystemDirectoryHandle;

  // Patch methods on the singleton in-place. We can't replace the singleton
  // itself because every consumer imports it by reference.
  const svc = fileService as unknown as Record<string, unknown>;

  svc.isConnected = () => true;
  svc.verifyPermission = async () => true;
  svc.setDirectoryHandle = () => {};
  svc.clearDirectoryHandle = () => {};
  svc.getDirectoryHandle = () => fakeHandle;

  svc.readJson = async <T>(path: string): Promise<T | null> => {
    const key = normalizePath(path);
    return files.has(key) ? (files.get(key) as T) : null;
  };

  svc.writeJson = async <T>(path: string, data: T): Promise<void> => {
    const key = normalizePath(path);
    files.set(key, data);
    addParentDirs(key, dirs);
  };

  svc.fileExists = async (path: string): Promise<boolean> => {
    return files.has(normalizePath(path));
  };

  svc.ensureDir = async (path: string) => {
    dirs.add(normalizePath(path));
    return fakeHandle;
  };

  svc.listFiles = async (dirPath: string): Promise<string[]> => {
    const prefix = normalizePath(dirPath);
    const out: string[] = [];
    const target = prefix ? prefix + "/" : "";
    for (const key of files.keys()) {
      if (!key.startsWith(target)) continue;
      const rest = key.slice(target.length);
      if (!rest.includes("/")) out.push(rest);
    }
    return out.sort();
  };

  svc.listDirectories = async (dirPath: string): Promise<string[]> => {
    const prefix = normalizePath(dirPath);
    const target = prefix ? prefix + "/" : "";
    const out = new Set<string>();
    for (const d of dirs) {
      if (!d.startsWith(target)) continue;
      const rest = d.slice(target.length);
      if (!rest) continue;
      const head = rest.split("/")[0];
      if (head) out.add(head);
    }
    // Also include directory-shaped paths derived from files.
    for (const key of files.keys()) {
      if (!key.startsWith(target)) continue;
      const rest = key.slice(target.length);
      const parts = rest.split("/");
      if (parts.length > 1) out.add(parts[0]);
    }
    return Array.from(out).sort();
  };

  svc.deleteFile = async (path: string): Promise<boolean> => {
    return files.delete(normalizePath(path));
  };

  svc.readFileAsBlob = async (path: string): Promise<Blob | null> => {
    return blobs.get(normalizePath(path)) ?? null;
  };

  svc.writeFileFromBlob = async (path: string, blob: Blob): Promise<void> => {
    blobs.set(normalizePath(path), blob);
  };

  svc.getDirectory = async () => fakeHandle;

  svc.createWritable = async () => null;

  // Seed IndexedDB so getCurrentUser / getMainUser / reconnectWithStoredHandle
  // see "alex" without needing the OS folder picker. Skipped in picker
  // mode so the app stays on the user-selection screen.
  try {
    if (signIn) {
      await storeCurrentUser("alex");
      await storeMainUser("alex");
    }
    // A directory handle that survives in IndexedDB so reconnect attempts
    // resolve, even though our overrides never actually touch it.
    await storeDirectoryHandle(fakeHandle);
  } catch (err) {
    console.warn("[wiki-capture-mock] IndexedDB seed failed:", err);
  }

  console.log(`[wiki-capture-mock] Installed. Seeded ${files.size} files across ${dirs.size} dirs.`);
}

function normalizePath(p: string): string {
  return p.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
}

function addParentDirs(path: string, dirs: Set<string>): void {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    dirs.add(parts.slice(0, i).join("/"));
  }
}
