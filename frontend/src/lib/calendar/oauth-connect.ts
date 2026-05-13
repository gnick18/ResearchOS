"use client";

import { writeTokens, type OAuthTokens } from "./oauth-tokens-store";
import { ensureGitignoreEntries } from "@/lib/file-system/gitignore";

/**
 * Browser-side helper that opens the provider's OAuth popup, waits for the
 * callback page to `postMessage` back, and persists the resulting tokens
 * into the user's FSA folder.
 *
 * Returns the connected account email (when the OIDC id_token carried
 * one) on success, or throws an Error with a user-friendly message on
 * failure / cancellation.
 */

interface CallbackPayload {
  provider: "google" | "outlook";
  accessToken?: string;
  refreshToken?: string | null;
  expiresIn?: number;
  scope?: string;
  accountEmail?: string | null;
  error?: string;
}

const POPUP_WIDTH = 520;
const POPUP_HEIGHT = 640;

export async function connectProvider(
  username: string,
  provider: "google" | "outlook",
): Promise<OAuthTokens> {
  if (typeof window === "undefined") {
    throw new Error("OAuth connect can only run in the browser.");
  }

  // Center the popup over the current window. Some browsers (Safari) ignore
  // the size and position and open a full tab — that's fine, the dance
  // still works.
  const left = Math.max(0, window.screenX + (window.outerWidth - POPUP_WIDTH) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2);
  const features = `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`;
  const popup = window.open(`/api/auth/${provider}/login`, "researchos-oauth", features);
  if (!popup) {
    throw new Error(
      "Couldn't open the sign-in window. Please allow popups for ResearchOS and try again.",
    );
  }

  const expectedOrigin = window.location.origin;
  return new Promise<OAuthTokens>((resolve, reject) => {
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
      if (p.provider !== provider) return;
      cleanup();
      if (p.error) {
        reject(new Error(p.error));
        return;
      }
      if (!p.accessToken || typeof p.expiresIn !== "number") {
        reject(new Error("Sign-in returned an incomplete response."));
        return;
      }
      const tokens: OAuthTokens = {
        accessToken: p.accessToken,
        refreshToken: p.refreshToken ?? null,
        expiresAt: new Date(Date.now() + p.expiresIn * 1000).toISOString(),
        accountEmail: p.accountEmail ?? null,
        connectedAt: new Date().toISOString(),
        scopes: p.scope ? p.scope.split(" ") : [],
      };
      try {
        await writeTokens(username, provider, tokens);
      } catch (err) {
        reject(
          new Error(
            err instanceof Error
              ? `Failed to save tokens: ${err.message}`
              : "Failed to save tokens",
          ),
        );
        return;
      }
      // Make sure the OAuth tokens file is gitignored in case the user's
      // data folder is a git working tree (matches the telegram/feeds
      // approach). Best-effort; never fatal.
      try {
        await ensureGitignoreEntries([
          "_calendar-oauth.json",
          "users/*/_calendar-oauth.json",
        ]);
      } catch {
        /* ignore */
      }
      resolve(tokens);
    };

    // Detect the user closing the popup before the dance finishes.
    const closedInterval = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error("Sign-in window was closed."));
      }
    }, 500);

    window.addEventListener("message", onMessage);
  });
}
