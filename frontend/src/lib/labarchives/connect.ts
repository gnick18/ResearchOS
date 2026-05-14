"use client";

import { ensureGitignoreEntries } from "@/lib/file-system/gitignore";
import { readDeployerCreds } from "./deployer-store";
import {
  writeConnection,
  type LabArchivesConnection,
} from "./tokens-store";

/**
 * Browser-side helper that opens the LabArchives sign-in popup and waits
 * for the callback page to `postMessage` back with the UID.
 *
 * Shape mirrors `connectProvider` in `lib/calendar/oauth-connect.ts` so the
 * wizard step can treat all three integrations the same way. Throws an
 * Error with a user-friendly message on failure / cancellation.
 *
 * Sidecar-mode handshake (Phase 3 of LabArchives local-first config): the
 * popup posts back asking for deployer creds shortly after load. We listen
 * for that request, read the sidecar via FSA, and reply with the creds (or
 * with `null` if there's no sidecar — env-var deployments just shrug it
 * off). The popup then includes the creds in its `/login` POST body. The
 * sync-style protocol means we don't have to plumb async state into the
 * popup URL.
 */

interface CallbackPayload {
  provider: "labarchives";
  uid?: string;
  fullname?: string | null;
  email?: string | null;
  error?: string;
}

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 560;

export async function connectLabArchives(
  username: string,
): Promise<LabArchivesConnection> {
  if (typeof window === "undefined") {
    throw new Error("LabArchives connect can only run in the browser.");
  }

  const left = Math.max(0, window.screenX + (window.outerWidth - POPUP_WIDTH) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2);
  const features = `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`;
  const popup = window.open(
    "/api/auth/labarchives/callback",
    "researchos-labarchives",
    features,
  );
  if (!popup) {
    throw new Error(
      "Couldn't open the sign-in window. Please allow popups for ResearchOS and try again.",
    );
  }

  const expectedOrigin = window.location.origin;
  return new Promise<LabArchivesConnection>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(closedInterval);
    };

    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== expectedOrigin) return;
      // Sidecar-mode handshake: the popup asks us for deployer creds; we
      // read the FSA sidecar (returns null when absent) and reply. The
      // popup uses the reply to populate `body.deployerCreds` in its
      // /login POST. Listener stays installed until the auth payload
      // arrives (in case the popup races and asks again).
      const msg = event.data as
        | { source?: string; type?: string }
        | undefined;
      if (msg && msg.source === "researchos-labarchives-popup" && msg.type === "request-deployer-creds") {
        try {
          const creds = await readDeployerCreds();
          if (popup && !popup.closed) {
            popup.postMessage(
              {
                source: "researchos-labarchives-opener",
                type: "deployer-creds",
                creds: creds, // null when no sidecar (env-var mode)
              },
              expectedOrigin,
            );
          }
        } catch {
          // Best-effort. If the sidecar read fails, reply with null so
          // the popup doesn't hang past its 1.5s timeout.
          if (popup && !popup.closed) {
            popup.postMessage(
              {
                source: "researchos-labarchives-opener",
                type: "deployer-creds",
                creds: null,
              },
              expectedOrigin,
            );
          }
        }
        return;
      }
      const data = event.data as
        | { source?: string; payload?: CallbackPayload }
        | undefined;
      if (!data || data.source !== "researchos-oauth" || !data.payload) return;
      const p = data.payload;
      if (p.provider !== "labarchives") return;
      cleanup();
      if (p.error) {
        reject(new Error(p.error));
        return;
      }
      if (!p.uid) {
        reject(new Error("LabArchives sign-in returned an incomplete response."));
        return;
      }
      const connection: LabArchivesConnection = {
        uid: p.uid,
        fullname: p.fullname ?? null,
        email: p.email ?? null,
        connectedAt: new Date().toISOString(),
      };
      try {
        await writeConnection(username, connection);
      } catch (err) {
        reject(
          new Error(
            err instanceof Error
              ? `Failed to save connection: ${err.message}`
              : "Failed to save connection",
          ),
        );
        return;
      }
      try {
        await ensureGitignoreEntries([
          "_labarchives.json",
          "users/*/_labarchives.json",
        ]);
      } catch {
        /* best-effort */
      }
      resolve(connection);
    };

    const closedInterval = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error("Sign-in window was closed."));
      }
    }, 500);

    window.addEventListener("message", onMessage);
  });
}
