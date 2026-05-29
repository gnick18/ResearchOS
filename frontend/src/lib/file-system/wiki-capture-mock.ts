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
import {
  storeCurrentUser,
  storeMainUser,
  storeDirectoryHandle,
  backupRealHandleForDemo,
} from "./indexeddb-store";
import { buildWikiFixtures } from "./wiki-capture-fixture";
import { rebaseDemoDates, isDemoLab } from "../demo/rebase";

/** Watermarked fake PNGs that ship inside `frontend/public/demo-data/`.
 *  At fixture install time we fetch each one and seed it into the mock's
 *  blob map keyed by the same relative path the app reads with
 *  (`fileService.readFileAsBlob("users/.../Images/foo.png")`). Without this
 *  step, fixture-mode screenshots of the Results gallery, the experiment
 *  image strip, and the Telegram inbox come out empty even though the
 *  Demo Lab puts real watermarked images on disk.
 *
 *  Experiment-attached PNGs under `users/<user>/results/task-<n>/Images/`
 *  are NOT listed here — they're discovered dynamically by scanning the
 *  fetched notes.md / results.md bodies for `![alt](Images/<file>.png)`
 *  refs (see the `DEMO_RESULTS_USERS` loop below). Only entries here are
 *  PNGs that aren't markdown-referenced (e.g. the Telegram inbox photo). */
const DEMO_PNG_PATHS = [
  "users/alex/inbox/Images/photo-2026-05-12.png",
  "users/alex/inbox/Images/photo-2026-05-13a.png",
  "users/alex/inbox/Images/photo-2026-05-13b.png",
  "users/alex/inbox/Images/photo-2026-05-13c.png",
];

/** Markdown method bodies. The JSON fixtures point at these via `source_path`
 *  (e.g. `users/public/methods/1.md`), but the bodies themselves live as
 *  separate `.md` files on disk under `frontend/public/demo-data/`. The
 *  wiki-capture fixture seeds method *metadata* into `files`; without
 *  fetching the `.md` siblings into `blobs` here, `filesApi.readFile`
 *  (which goes through `readFileAsBlob`) returns null and the method
 *  viewer modal renders "Method file not found." for every markdown
 *  method. Mirrors the `DEMO_PNG_PATHS` pattern below. */
const DEMO_METHOD_MD_PATHS = [
  "users/public/methods/1.md",
  "users/alex/methods/1.md",
  "users/alex/methods/2.md",
  "users/alex/methods/3.md",
  "users/alex/methods/4.md",
  "users/morgan/methods/1.md",
  "users/morgan/methods/2.md",
];

/** JSON sidecars that live alongside the inbox PNGs (caption / sender /
 *  timestamp). Loaded into the `files` map so the inbox panel renders the
 *  metadata next to each card. One per inbox photo above — each is a real
 *  on-disk file written by `scripts/generate-demo-images.mjs`, so the four
 *  inbox rows show four distinct images (bench notes, patch plate, gel,
 *  microscope) with their own captions + timestamps. (No more reusing a
 *  single PNG for every row — fixed 2026-05-29.) */
const DEMO_JSON_SIDECAR_PATHS = [
  "users/alex/inbox/Images/photo-2026-05-12.png.json",
  "users/alex/inbox/Images/photo-2026-05-13a.png.json",
  "users/alex/inbox/Images/photo-2026-05-13b.png.json",
  "users/alex/inbox/Images/photo-2026-05-13c.png.json",
];

/** Demo users whose `users/<user>/results/task-<n>/notes.md` +
 *  `results.md` + `Images/*.png` get pulled from `frontend/public/demo-data/`
 *  at fixture install time. The task count comes from each user's
 *  `_counters.json` (already in the static fixture via `wiki-capture-fixture.ts`),
 *  so this only needs the usernames. Adding a new demo user with experiment
 *  writeups means appending here, not maintaining a path table.
 *
 *  Why dynamic fetch: `scripts/generate-demo-data.mjs` writes lab-recipe
 *  notes + figures under `public/demo-data/...`, but those files were
 *  previously invisible to the wiki-capture mock — it only saw the
 *  hardcoded stub bodies in `DEMO_MD_SEEDS`, which shadowed the real
 *  content. The fetch loop below mirrors the existing PNG / method-md
 *  pattern so a single source of truth (the on-disk demo bundle) drives
 *  every channel: the connected Lab Mode viewer, the `/demo` route, and
 *  the wiki-capture screenshots. */
const DEMO_RESULTS_USERS = ["alex", "morgan"];

/** Capture-mode variants. The default `"signed-in"` corresponds to
 *  `?wikiCapture=1` (the most common case) and gives you a fully signed-in
 *  session as user `alex` (the demo lab's PI). The `"picker"` variant
 *  (`?wikiCapture=picker`) installs the fixture but leaves `currentUser`
 *  empty so the user-picker screen renders — used to capture
 *  `user-login.png`. */
export type WikiCaptureVariant = "signed-in" | "picker";

/** Usernames seeded into the wiki-capture fixture (see
 *  `wiki-capture-fixture.ts`). Used to validate the `?fixtureUser=` URL
 *  override so callers can't pin currentUser to a username with no
 *  seeded data. `lab` and `public` are namespace folders (lab-shared
 *  content, public counters) and are intentionally excluded — they're
 *  not selectable as a current user in any other UI either. */
export const WIKI_CAPTURE_FIXTURE_USERS = [
  "alex",
  "morgan",
  "mira",
  "sam",
] as const;

/** Resolves the `?fixtureUser=<name>` URL override against the seeded
 *  fixture user list. Returns `"alex"` (the default demo PI) when the
 *  query string is absent, the requested name isn't seeded, or when
 *  called outside the browser. Emits a `console.warn` on an invalid
 *  request so a verifier driving `?wikiCapture=1&fixtureUser=…` notices
 *  the typo instead of silently getting alex. */
export function resolveFixtureUser(): (typeof WIKI_CAPTURE_FIXTURE_USERS)[number] {
  if (typeof window === "undefined") return "alex";
  let requested: string | null = null;
  try {
    const params = new URLSearchParams(window.location.search);
    requested = params.get("fixtureUser");
  } catch {
    return "alex";
  }
  if (requested === null) return "alex";
  const match = WIKI_CAPTURE_FIXTURE_USERS.find((u) => u === requested);
  if (!match) {
    console.warn(
      `[wiki-capture-mock] ?fixtureUser=${requested} not in fixture (` +
        WIKI_CAPTURE_FIXTURE_USERS.join(", ") +
        "); falling back to alex.",
    );
    return "alex";
  }
  return match;
}

/** Returns the capture variant for the current URL, or null if the page
 *  hasn't opted in. Allowed in dev and on localhost in prod; hard-blocked
 *  on non-local hostnames in production. SSR-safe: returns null on the
 *  server. */
export function getWikiCaptureVariant(): WikiCaptureVariant | null {
  if (typeof window === "undefined") return null;
  try {
    // Sticky session flag, set once the URL match is seen so subsequent
    // in-app `router.push` calls that strip the query string don't drop
    // us out of fixture mode (live-test R3 cascade fix 2026-05-21).
    // The closing tab clears sessionStorage, so this can't bleed across
    // browser sessions.
    const params = new URLSearchParams(window.location.search);
    const urlValue = params.get("wikiCapture");
    if (urlValue !== null) {
      if (process.env.NODE_ENV === "production") {
        const host = window.location.hostname;
        const ok =
          host === "localhost" || host === "127.0.0.1" || host === "[::1]";
        if (!ok) return null;
      }
      const variant: WikiCaptureVariant =
        urlValue === "picker" ? "picker" : "signed-in";
      try {
        sessionStorage.setItem(WIKI_CAPTURE_STICKY_KEY, variant);
      } catch {
        // sessionStorage can throw in private-mode browsers; ignore.
      }
      return variant;
    }
    // No URL flag — fall back to the sticky session value if we set it
    // on a prior page. Same production-host gate applies on read.
    let sticky: string | null = null;
    try {
      sticky = sessionStorage.getItem(WIKI_CAPTURE_STICKY_KEY);
    } catch {
      // Ignore sessionStorage failures.
    }
    if (sticky === null) return null;
    if (process.env.NODE_ENV === "production") {
      const host = window.location.hostname;
      const ok =
        host === "localhost" || host === "127.0.0.1" || host === "[::1]";
      if (!ok) return null;
    }
    return sticky === "picker" ? "picker" : "signed-in";
  } catch {
    return null;
  }
}

/** sessionStorage key for the sticky wiki-capture-mode flag. Lifecycle
 *  mirrors `DEMO_MODE_KEY` above — set once a URL match is observed,
 *  carried across in-tab navigation, cleared on tab close. */
const WIKI_CAPTURE_STICKY_KEY = "researchos:wiki-capture-mode";

/** sessionStorage key for the sticky v4-preview / seed-step flag. Set
 *  once `?wizard-preview=1` or `?wizardSeedStep=…` is observed; read by
 *  `wantsV4Mount()` in `providers.tsx` so the v4 tour stays mounted
 *  across in-tab navigations whose hrefs strip the query string. */
export const V4_PREVIEW_STICKY_KEY = "researchos:v4-preview-active";

/** True when the URL has the v4 preview opt-in flags OR a prior page in
 *  this tab observed them. Mirrors `getWikiCaptureVariant`'s sticky
 *  pattern so navigation away (cursor click on a project card,
 *  router.push from a step body, etc.) doesn't drop V4MountForUser. */
export function isV4PreviewMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("wizard-preview") === "1" || params.has("wizardSeedStep")) {
      try {
        sessionStorage.setItem(V4_PREVIEW_STICKY_KEY, "1");
      } catch {
        // sessionStorage can throw in private-mode browsers; ignore.
      }
      return true;
    }
    try {
      return sessionStorage.getItem(V4_PREVIEW_STICKY_KEY) === "1";
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/** True if any wiki-capture flag is set on the URL. */
export function isWikiCaptureMode(): boolean {
  return getWikiCaptureVariant() !== null;
}

/** sessionStorage key for the sticky demo-mode flag. Set once on first
 *  successful fixture install (see `markDemoMode()`); cleared by
 *  `<LeaveDemoModal>` on the way out. Survives in-tab navigation so demo
 *  mode persists when the user clicks off `/demo` into `/methods`, etc. */
const DEMO_MODE_KEY = "researchos:demo-mode";

/** All sessionStorage keys whose presence makes the tab behave as if it's
 *  in some flavor of demo / preview / fixture mode. The list exists so
 *  future sticky flags (wiki-capture stickiness, v4 onboarding preview,
 *  etc.) get added in one place and `<LeaveDemoModal>` clears them
 *  automatically without having to grow a new `sessionStorage.removeItem`
 *  line.
 *
 *  Anything appended here is wiped by `clearAllStickyDemoFlags()` on the
 *  leave-demo confirm path, so a confirmed-leave never leaves the user
 *  stuck in fixture / preview mode until tab close. The wiki-capture
 *  fixture flags (forceControls + unlockSession) are appended later in
 *  this file once their keys are declared; they're guarded by
 *  `isWikiCaptureMode()` internally, so leaving fixture mode also
 *  effectively disables them, but explicit cleanup keeps the
 *  sessionStorage tidy. */
const STICKY_DEMO_MODE_KEYS: readonly string[] = [DEMO_MODE_KEY] as const;

/** Public in-browser demo mode. True when:
 *  - the sticky `sessionStorage` flag is set (continuation across in-tab
 *    navigation, set by `markDemoMode()` after a successful fixture install), OR
 *  - an entry trigger is active on the current URL: pathname is exactly
 *    `/demo`, starts with `/demo/`, or has `?demo=1`.
 *
 *  Pure read — never writes. Writes happen in `markDemoMode()` from a
 *  `useEffect`, so render passes stay side-effect-free. SSR-safe:
 *  returns false on the server.
 *
 *  Unlike the wiki-capture flag, this has **no** production / localhost
 *  guard — the whole point is to let a public Vercel visitor explore
 *  ResearchOS at `researchos.app/demo`. */
export function getDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.sessionStorage.getItem(DEMO_MODE_KEY) === "1") return true;
  } catch {
    // sessionStorage can throw in privacy modes; fall through to URL detection.
  }
  try {
    const path = window.location.pathname;
    if (path === "/demo" || path.startsWith("/demo/")) return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") return true;
    return false;
  } catch {
    return false;
  }
}

/** Set the sticky demo-mode flag. Only call from a `useEffect` (never
 *  during render). After this fires, `getDemoMode()` returns true across
 *  all future in-tab navigation until `clearDemoMode()` runs. */
export function markDemoMode(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DEMO_MODE_KEY, "1");
  } catch {
    // best-effort
  }
}

/** Clear the sticky demo-mode flag. Called from `<LeaveDemoModal>` so
 *  the next page load lands on the folder picker instead of silently
 *  re-entering demo mode. */
export function clearDemoMode(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DEMO_MODE_KEY);
  } catch {
    // best-effort
  }
}

/** Clear EVERY sticky sessionStorage flag the demo / preview / fixture
 *  modes use to persist across in-tab navigation. Called from
 *  `<LeaveDemoModal>` on confirmed leave so a user who said "yes, get me
 *  out" exits cleanly: no fixture mode, no preview mode, no half-state
 *  that survives until they close the tab.
 *
 *  Clears `DEMO_MODE_KEY` plus the wiki-capture fixture flags
 *  (`FORCE_CONTROLS_STICKY_KEY`, `UNLOCK_SESSION_STICKY_KEY`). The
 *  wiki-capture sticky itself is cleared via its own helper path;
 *  the fixture-only flags ride along here since they're guarded by
 *  `isWikiCaptureMode()` and only meaningful while it's active. */
export function clearAllStickyDemoFlags(): void {
  if (typeof window === "undefined") return;
  const keys: readonly string[] = [
    ...STICKY_DEMO_MODE_KEYS,
    FORCE_CONTROLS_STICKY_KEY,
    UNLOCK_SESSION_STICKY_KEY,
  ];
  for (const key of keys) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // best-effort, one bad key shouldn't block the others
    }
  }
}

/** True for either the localhost screenshot fixture (`?wikiCapture=…`) or
 *  the production-allowed public demo (`/demo`). Both seed the same
 *  in-memory fixture, so callers that want "is the fixture active?" use
 *  this. */
export function isDemoOrWikiCapture(): boolean {
  return isWikiCaptureMode() || getDemoMode();
}

/** sessionStorage key for the sticky force-controls fixture flag. Set
 *  whenever the URL carries `?forceControls=1` while wikiCapture is
 *  active, cleared on tab close. Stickiness mirrors the wiki-capture
 *  pattern so in-tab navigations that strip the query string don't
 *  drop the flag mid-route. */
const FORCE_CONTROLS_STICKY_KEY = "researchos:wiki-capture-force-controls";

/** sessionStorage key for the sticky unlock-session fixture flag. Set
 *  whenever the URL carries `?unlockSession=1` while wikiCapture is
 *  active. Mirrors the wiki-capture pattern. */
const UNLOCK_SESSION_STICKY_KEY = "researchos:wiki-capture-unlock-session";

/** True when `?forceControls=1` is set AND wiki-capture mode is active.
 *  Gates the `.force-hover-controls` body class that makes hover-only
 *  controls visible in static screenshot capture (puppeteer / playwright
 *  can't fire CSS `:hover` without a real cursor).
 *
 *  Strictly gated to wiki-capture mode (no broader demo / production
 *  exposure) so real users can never hit this code path. SSR-safe.
 *
 *  Stickiness mirrors `getWikiCaptureVariant()`: once observed on a
 *  URL we remember it for the session so router.push calls that strip
 *  the query string keep the flag alive. */
export function isForceControlsMode(): boolean {
  if (typeof window === "undefined") return false;
  if (!isWikiCaptureMode()) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("forceControls") === "1") {
      try {
        window.sessionStorage.setItem(FORCE_CONTROLS_STICKY_KEY, "1");
      } catch {
        // sessionStorage can throw in private-mode browsers; ignore.
      }
      return true;
    }
    try {
      return (
        window.sessionStorage.getItem(FORCE_CONTROLS_STICKY_KEY) === "1"
      );
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/** True when `?unlockSession=1` is set AND wiki-capture mode is active.
 *  Synthesizes an unlocked lab-head edit session for the active fixture
 *  user so the announcements composer + LabRoster archive controls
 *  render in their post-unlock state for screenshot capture.
 *
 *  Strictly gated to wiki-capture mode (no real-data leak). SSR-safe.
 *  Stickiness mirrors `isForceControlsMode()`. */
export function isUnlockSessionMode(): boolean {
  if (typeof window === "undefined") return false;
  if (!isWikiCaptureMode()) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("unlockSession") === "1") {
      try {
        window.sessionStorage.setItem(UNLOCK_SESSION_STICKY_KEY, "1");
      } catch {
        // sessionStorage can throw in private-mode browsers; ignore.
      }
      return true;
    }
    try {
      return (
        window.sessionStorage.getItem(UNLOCK_SESSION_STICKY_KEY) === "1"
      );
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/** Tutorial-mode probe.
 *
 *  After the V3 rip (Phase B 2026-05-22) there is no tutorial overlay
 *  on the demo route at all: v4 is the only walkthrough and only fires
 *  for real new-user signups. The previous `?tutorial=1` (full V3
 *  tour) and `?tutorial=telegram` (standalone Telegram walkthrough)
 *  query params no longer mount anything; the helper is kept as a
 *  permanent `false` so legacy callers in `LeaveDemoModal`,
 *  `FloatingLeaveDemoButton`, and `DemoLabBanner` continue to compile
 *  without churning their copy. Those callers can be simplified in a
 *  follow-up. SSR-safe: returns false on the server. */
export function isTutorialMode(): boolean {
  return false;
}

let installed = false;

/** Hoisted to module scope so `getFixtureSnapshot()` can read them after
 *  install. The mock initializes these on first install and patches
 *  fileService methods to read/write through them. */
const fixtureFiles = new Map<string, unknown>();
const fixtureDirs = new Set<string>();
const fixtureBlobs = new Map<string, Blob>();

/** Read-only snapshot of the fixture's in-memory storage. Returned by
 *  reference (not a clone) so the demo ZIP exporter sees live state,
 *  including the user's in-session edits. Only meaningful after
 *  `installWikiCaptureFixture()` has resolved. */
export function getFixtureSnapshot(): {
  files: ReadonlyMap<string, unknown>;
  blobs: ReadonlyMap<string, Blob>;
} {
  return { files: fixtureFiles, blobs: fixtureBlobs };
}

interface InstallOptions {
  /** When true, skip writing the IndexedDB current-user entry, so the
   *  app sees the folder as connected but no user signed in. Used to
   *  capture `user-login.png` (the user-picker screen). Default: false. */
  signIn?: boolean;
  /** Username to pin as the active fixture user when `signIn` is true.
   *  Must be one of `WIKI_CAPTURE_FIXTURE_USERS`. Defaults to `"alex"`
   *  (the demo lab's PI archetype). Supplied by `?fixtureUser=…` URL
   *  override so verifiers / capture scripts can drive the fixture as
   *  a different seeded user (e.g. mira to inspect PI-archetype
   *  widgets seeded against her events / tasks). */
  fixtureUser?: (typeof WIKI_CAPTURE_FIXTURE_USERS)[number];
}

/** Idempotent. Swaps fileService methods for an in-memory store seeded with
 *  fixture data. By default, also writes the fixture user to IndexedDB so
 *  the rest of the app sees them as signed in. Pass `signIn: false` to
 *  stop at the user-picker. */
export async function installWikiCaptureFixture(
  options: InstallOptions = {},
): Promise<void> {
  const { signIn = true, fixtureUser = "alex" } = options;
  if (installed) return;
  installed = true;

  const fixtures = buildWikiFixtures();
  const files = fixtureFiles;
  const dirs = fixtureDirs;
  const blobs = fixtureBlobs;

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
    const key = normalizePath(path);
    // Blobs are real files too (seeded PNGs, markdown bodies). Without
    // this, the editor's broken-image scan calls `fileExists` for inline
    // `Images/foo.png` refs, sees `false`, and queues a bogus "Image Not
    // Found" popup even though `readFileAsBlob` would resolve. Matches
    // the symmetry already in `listFiles` / `listDirectories` below.
    return files.has(key) || blobs.has(key);
  };

  svc.ensureDir = async (path: string) => {
    dirs.add(normalizePath(path));
    return fakeHandle;
  };

  svc.listFiles = async (dirPath: string): Promise<string[]> => {
    const prefix = normalizePath(dirPath);
    const out = new Set<string>();
    const target = prefix ? prefix + "/" : "";
    const collect = (key: string) => {
      if (!key.startsWith(target)) return;
      const rest = key.slice(target.length);
      if (!rest.includes("/")) out.add(rest);
    };
    for (const key of files.keys()) collect(key);
    // Seeded PNG blobs are real files too (Results gallery and image strip
    // call this to count attachments). Without this loop, the Results page
    // shows "No results yet" for tasks whose only attachments are blobs.
    for (const key of blobs.keys()) collect(key);
    return Array.from(out).sort();
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
    // Also include directory-shaped paths derived from files and blobs.
    const collectFromKey = (key: string) => {
      if (!key.startsWith(target)) return;
      const rest = key.slice(target.length);
      const parts = rest.split("/");
      if (parts.length > 1) out.add(parts[0]);
    };
    for (const key of files.keys()) collectFromKey(key);
    for (const key of blobs.keys()) collectFromKey(key);
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
  // see the chosen fixture user (default "alex") without needing the OS
  // folder picker. Skipped in picker mode so the app stays on the
  // user-selection screen.
  //
  // BUT first, if a real folder is currently connected (the user navigated
  // to /demo from inside their connected app, or opened /demo in another
  // tab on the same origin), back up the real handle + current/main user
  // into the pre-demo keys so LeaveDemoModal can restore them. Without
  // this, our seed below silently overwrites the real folder grant.
  // Idempotent across repeated demo entries via a fixture-handle sentinel
  // check inside `backupRealHandleForDemo`.
  try {
    await backupRealHandleForDemo();
    if (signIn) {
      await storeCurrentUser(fixtureUser);
      await storeMainUser(fixtureUser);
    }
    // A directory handle that survives in IndexedDB so reconnect attempts
    // resolve, even though our overrides never actually touch it.
    await storeDirectoryHandle(fakeHandle);
  } catch (err) {
    console.warn("[wiki-capture-mock] IndexedDB seed failed:", err);
  }

  // Fetch the demo-lab PNGs from `public/demo-data/` and seed them into
  // the blob map so `readFileAsBlob` resolves. Best-effort: failures are
  // logged and individual missing PNGs just leave that path unresolved
  // (renders as a broken-image placeholder, same as a real folder with
  // a missing file).
  await Promise.all(
    DEMO_PNG_PATHS.map(async (relPath) => {
      try {
        const res = await fetch(`/demo-data/${relPath}`);
        if (!res.ok) {
          console.warn(`[wiki-capture-mock] PNG fetch ${res.status}: ${relPath}`);
          return;
        }
        const blob = await res.blob();
        blobs.set(normalizePath(relPath), blob);
        addParentDirs(normalizePath(relPath), dirs);
      } catch (err) {
        console.warn(`[wiki-capture-mock] PNG fetch failed for ${relPath}:`, err);
      }
    }),
  );

  // Method markdown bodies. Symmetric with the PNG fetch above — these
  // exist on disk under `frontend/public/demo-data/users/.../methods/*.md`
  // but only the JSON sibling is seeded into the `files` map by the
  // static fixture, so the viewer's `filesApi.readFile(source_path)` 404s
  // without this loop.
  await Promise.all(
    DEMO_METHOD_MD_PATHS.map(async (relPath) => {
      try {
        const res = await fetch(`/demo-data/${relPath}`);
        if (!res.ok) {
          console.warn(`[wiki-capture-mock] method md fetch ${res.status}: ${relPath}`);
          return;
        }
        const blob = await res.blob();
        blobs.set(normalizePath(relPath), blob);
        addParentDirs(normalizePath(relPath), dirs);
      } catch (err) {
        console.warn(`[wiki-capture-mock] method md fetch failed for ${relPath}:`, err);
      }
    }),
  );

  // Load the JSON sidecars that pair with the inbox PNGs (caption,
  // sender, timestamp). The static fixture array can't carry these
  // inline because they live next to the binary asset; pulling them
  // alongside the PNG keeps the inbox panel's caption + timestamp
  // visible in capture mode.
  await Promise.all(
    DEMO_JSON_SIDECAR_PATHS.map(async (relPath) => {
      try {
        const res = await fetch(`/demo-data/${relPath}`);
        if (!res.ok) return;
        const data = await res.json();
        const norm = normalizePath(relPath);
        files.set(norm, data);
        addParentDirs(norm, dirs);
      } catch (err) {
        console.warn(`[wiki-capture-mock] sidecar fetch failed for ${relPath}:`, err);
      }
    }),
  );

  // (The four inbox rows are now four real on-disk photos fetched via
  // DEMO_PNG_PATHS + DEMO_JSON_SIDECAR_PATHS above, so there is no alias
  // cloning to do here anymore.)

  // Pull the on-disk experiment writeups + their inline images for each
  // demo user. Two-phase per user:
  //
  //   1. For every task id `1..N` (N = the user's `_counters.json` task
  //      count, already seeded by the static fixture above), try to fetch
  //      `notes.md` and `results.md`. 404s are normal — many tasks have
  //      no writeup yet.
  //   2. For each fetched markdown body, parse `![alt](Images/<name>.png)`
  //      refs and fetch each referenced PNG into the sibling `Images/`
  //      folder. `/demo-data/` isn't directory-listable from the browser,
  //      so the markdown body is the index — anything not referenced
  //      stays unfetched (acceptable: those PNGs aren't rendered anywhere
  //      either).
  //
  // Replaces the previous `DEMO_MD_SEEDS` + experiment-PNG entries in
  // `DEMO_PNG_PATHS`, which were hardcoded and silently shadowed the
  // real on-disk content whenever the demo bundle grew.
  const IMG_REF_RE = /!\[[^\]]*\]\(Images\/([^)]+)\)/g;
  await Promise.all(
    DEMO_RESULTS_USERS.flatMap((user) => {
      const counters = files.get(normalizePath(`users/${user}/_counters.json`)) as
        | { tasks?: number }
        | undefined;
      const taskCount = counters?.tasks ?? 0;
      const taskIds = Array.from({ length: taskCount }, (_, i) => i + 1);
      return taskIds.map(async (taskId) => {
        const taskBase = `users/${user}/results/task-${taskId}`;
        const mdNames = ["notes.md", "results.md"];
        const fetchedTexts: string[] = [];
        await Promise.all(
          mdNames.map(async (name) => {
            const relPath = `${taskBase}/${name}`;
            try {
              const res = await fetch(`/demo-data/${relPath}`);
              if (!res.ok) return; // 404 is normal for tasks without writeup
              const text = await res.text();
              blobs.set(
                normalizePath(relPath),
                new Blob([text], { type: "text/markdown" }),
              );
              addParentDirs(normalizePath(relPath), dirs);
              fetchedTexts.push(text);
            } catch (err) {
              console.warn(
                `[wiki-capture-mock] results md fetch failed for ${relPath}:`,
                err,
              );
            }
          }),
        );
        // Parse all the markdown we just pulled for inline image refs and
        // fetch each referenced PNG into the sibling Images/ folder.
        const imageNames = new Set<string>();
        for (const text of fetchedTexts) {
          IMG_REF_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = IMG_REF_RE.exec(text)) !== null) {
            imageNames.add(m[1]);
          }
        }
        await Promise.all(
          Array.from(imageNames).map(async (imgName) => {
            const relPath = `${taskBase}/Images/${imgName}`;
            try {
              const res = await fetch(`/demo-data/${relPath}`);
              if (!res.ok) {
                console.warn(
                  `[wiki-capture-mock] results img fetch ${res.status}: ${relPath}`,
                );
                return;
              }
              const blob = await res.blob();
              blobs.set(normalizePath(relPath), blob);
              addParentDirs(normalizePath(relPath), dirs);
            } catch (err) {
              console.warn(
                `[wiki-capture-mock] results img fetch failed for ${relPath}:`,
                err,
              );
            }
          }),
        );
      });
    }),
  );

  // Optional URL-driven sidecar seed for the wizard-screenshot capture
  // path. `?wizardSeedStep=<step>` (combined with `?wikiCapture=1` and
  // `?wizard-preview=1`) plants an `_onboarding.json` on the alex user
  // with `wizard_force_show: true` plus a `wizard_resume_state` pointing
  // at the requested step. Under v4, TourBootstrap reads `wizardSeedStep`
  // from the URL and calls `controller.start(seedStep)` directly, so the
  // V4ResumePrompt is bypassed. To capture the resume modal itself, the
  // capture script uses the alias `wizardSeedResumeStep=<step>` instead:
  // the mock still plants the sidecar (so a valid v4 resume_state
  // exists), but TourBootstrap does NOT read this param, so it falls
  // through to the resume_state branch and surfaces V4ResumePrompt.
  // Lab-account feature_picks are seeded so the L-series steps mount.
  // Dev-only by construction (the wikiCapture flag itself is hard-gated
  // to dev / localhost).
  try {
    const params = new URLSearchParams(window.location.search);
    const seedStep =
      params.get("wizardSeedStep") ?? params.get("wizardSeedResumeStep");
    if (seedStep && signIn) {
      // The Phase 4 cleanup grid (retired 2026-05-22) used to render
      // rows only when `artifacts_created` was non-empty. The same
      // artifact spread is now consumed by the `tour-goodbye` outro's
      // auto-cleanup pass, so the gate accepts both step ids. We seed
      // a representative spread (project / method / experiment /
      // purchase / goal / calendar / lab teammate + lab task) so the
      // captured screenshot reflects the category structure the wiki
      // copy describes. One method row is marked auto-created to
      // demonstrate the discard-by-default contract. Earlier seeded
      // steps just get an empty list so the resume modal's "no
      // artifacts" copy reads honestly.
      const seedArtifacts =
        seedStep === "phase4-cleanup" || seedStep === "tour-goodbye"
          ? [
              { type: "project", id: "proj-1", cleanup_default: "keep" },
              {
                type: "method",
                id: "method-auto-1",
                cleanup_default: "discard",
              },
              {
                type: "experiment",
                id: "task-1",
                cleanup_default: "keep",
              },
              {
                type: "purchase",
                id: "purchase-1",
                cleanup_default: "keep",
              },
              { type: "goal", id: "goal-1", cleanup_default: "keep" },
              {
                type: "calendar_feed",
                id: "feed-1",
                cleanup_default: "keep",
              },
              {
                type: "lab_user",
                id: "BeakerBot",
                cleanup_default: "keep",
              },
              {
                type: "lab_task",
                id: "lab-task-1",
                cleanup_default: "keep",
              },
            ]
          : [];
      const sidecarKey = normalizePath("users/alex/_onboarding.json");
      files.set(sidecarKey, {
        version: 4,
        first_seen_at: new Date().toISOString(),
        active_seconds: 0,
        feature_picks: {
          account_type: "lab",
          lab_storage: "local",
          purchases: "yes",
          calendar: "yes",
          goals: "yes",
          telegram: "yes",
          ai_helper: "full",
        },
        wizard_completed_at: null,
        wizard_skipped_at: null,
        wizard_force_show: true,
        wizard_resume_state: {
          current_step: seedStep,
          skipped_steps: [],
          artifacts_created: seedArtifacts,
        },
        lab_tour_pending: false,
        lab_tour_dismissed_at: null,
      });
      addParentDirs(sidecarKey, dirs);
    }
  } catch {
    // best-effort; the capture script falls back to a Screenshot-pending
    // placeholder for any step that fails to seed.
  }

  // Rebase demo dates against today's date. Same logic as the on-disk
  // path — when the fixture's `last_rebased_at` is older than today,
  // shift every task/goal/event/project/shared date forward so the
  // fixture's "now" aligns with real "now." The static fixture .ts file
  // is regenerated by the build; this only mutates the in-memory map.
  try {
    if (await isDemoLab(fileService)) {
      const result = await rebaseDemoDates(fileService);
      if (result.delta !== 0) {
        console.log(
          `[wiki-capture-mock] Rebased demo dates by ${result.delta} day(s); ${result.filesWritten} file(s) shifted.`,
        );
      }
    }
  } catch (err) {
    console.warn("[wiki-capture-mock] demo rebase failed:", err);
  }

  console.log(
    `[wiki-capture-mock] Installed. Seeded ${files.size} files, ${blobs.size} blobs, ${dirs.size} dirs.`,
  );
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
