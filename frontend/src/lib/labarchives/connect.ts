"use client";

import { ensureGitignoreEntries } from "@/lib/file-system/gitignore";
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
