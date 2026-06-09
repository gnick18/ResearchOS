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

/** Lightweight ping. The restart button polls this until the fresh server
 *  answers, then reloads the page. */
export async function GET(): Promise<Response> {
  if (!isDev()) return new Response("not found", { status: 404 });
  return Response.json({ ok: true });
}

export async function POST(): Promise<Response> {
  if (!isDev()) return new Response("not found", { status: 404 });

  // next dev runs with cwd = frontend/; start.sh sits at the repo root.
  const repoRoot = path.join(process.cwd(), "..");
  const startScript = path.join(repoRoot, "start.sh");
  if (!existsSync(startScript)) {
    return Response.json(
      { error: `start.sh not found at ${startScript}` },
      { status: 500 },
    );
  }

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
