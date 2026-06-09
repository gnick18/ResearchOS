"use client";

import { useState } from "react";

/**
 * DEV-ONLY floating button that restarts the local dev server (reruns
 * `./start.sh`) so a frequent restart does not mean switching to the terminal.
 * POSTs to the dev-only `/api/dev/restart` route, which spawns a detached
 * start.sh that kills port 3000 and starts a fresh `npm run dev`. The button
 * then polls until the new server answers and reloads the page.
 *
 * Renders nothing in production (Next inlines the "development" literal and
 * drops this as dead code).
 */
export default function DevRestartServerButton() {
  if (process.env.NODE_ENV !== "development") return null;
  return <DevRestartServerInner />;
}

function DevRestartServerInner() {
  const [restarting, setRestarting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const restart = async () => {
    if (restarting) return;
    if (
      !window.confirm(
        "Restart the dev server? The page will reload once it is back up.",
      )
    ) {
      return;
    }
    setRestarting(true);
    setMsg("Restarting the dev server...");
    // Fire the restart. The response may not arrive (start.sh kills this server
    // a second later), so a failure here is expected and ignored.
    try {
      await fetch("/api/dev/restart", { method: "POST" });
    } catch {
      // expected: the server is going down
    }
    // Poll the ping endpoint until the fresh server answers, then reload so the
    // browser reconnects to it. Give start.sh a head start before polling.
    const deadline = Date.now() + 60_000;
    const poll = async () => {
      if (Date.now() > deadline) {
        setMsg("Timed out waiting for the server. Check the terminal.");
        setRestarting(false);
        return;
      }
      try {
        const res = await fetch("/api/dev/restart", { cache: "no-store" });
        if (res.ok) {
          window.location.reload();
          return;
        }
      } catch {
        // still down, keep polling
      }
      window.setTimeout(poll, 1000);
    };
    window.setTimeout(poll, 4000);
  };

  return (
    <div className="fixed bottom-36 left-4 z-[500] flex max-w-xs flex-col items-start gap-1.5">
      {msg && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-meta text-amber-800 shadow-lg">
          {msg}
        </div>
      )}
      <button
        type="button"
        onClick={restart}
        disabled={restarting}
        title="Rerun ./start.sh to restart the dev server, then reload"
        className="pointer-events-auto rounded-full bg-purple-600 px-4 py-2 text-meta font-semibold text-white shadow-lg transition-all hover:scale-[1.03] hover:bg-purple-700 disabled:opacity-60"
      >
        {restarting ? "Restarting server..." : "Dev: restart server"}
      </button>
    </div>
  );
}
