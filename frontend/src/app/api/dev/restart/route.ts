// DEV-ONLY. Restart the local dev server from the app, so a frequent
// `./start.sh` rerun does not mean switching to the terminal.
//
// POST spawns the repo's start.sh fully DETACHED (its own session, stdio
// ignored, unref'd) so it survives THIS server being killed. start.sh first
// kills whatever holds port 3000 (this process) and then starts a fresh
// `npm run dev`, so the detached child must outlive us. GET is a lightweight
// ping the client polls to detect when the new server is back up.
//
// Hard-gated to development (404 in production); the route does not exist for a
// real deploy. House style: no em-dashes, no emojis, no mid-sentence colons.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Find start.sh by walking up from the server's cwd. start.sh lives at the
 * ResearchOS repo root, and the dev server can be launched with its cwd at the
 * repo root OR at frontend/ (next dev), so we check the cwd and a few parents
 * rather than assuming one layout. Returns the absolute path or null.
 */
function findStartScript(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, "start.sh");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Lightweight ping. The restart button polls this until the fresh server
 *  answers, then reloads the page. */
export async function GET(): Promise<Response> {
  if (!isDev()) return new Response("not found", { status: 404 });
  return Response.json({ ok: true });
}

export async function POST(): Promise<Response> {
  if (!isDev()) return new Response("not found", { status: 404 });

  const startScript = findStartScript();
  if (!startScript) {
    return Response.json(
      { error: `start.sh not found walking up from ${process.cwd()}` },
      { status: 500 },
    );
  }
  // Run start.sh from the repo root (the dir it lives in), so its internal
  // `cd "$DIR/frontend"` and port handling resolve correctly.
  const repoRoot = path.dirname(startScript);

  // The short sleep lets this response flush to the browser before start.sh
  // kills port 3000 (us). detached + ignored stdio + unref fully cut the child
  // loose so our death does not take it down.
  const child = spawn("bash", ["-c", `sleep 1; exec bash '${startScript}'`], {
    detached: true,
    stdio: "ignore",
    cwd: repoRoot,
  });
  child.unref();

  return Response.json({ ok: true, restarting: true });
}
