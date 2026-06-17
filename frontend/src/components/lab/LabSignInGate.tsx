"use client";

// LabSignInGate — drives the LabSessionController through
// OAuth -> keypair-unlock -> openLabKey and reveals children once live.
//
// Mount this around the app shell for any lab-account user. It subscribes to
// the controller and re-renders on every state transition. While locked or
// expired it shows a full-screen sign-in overlay with provider buttons.
// While authenticating / unlocking it shows a centered progress card.
// Once live (or solo, defensively) it renders children.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import type { LabSessionController } from "@/lib/lab/lab-session";
import SharingProviderButtons from "@/components/sharing/SharingProviderButtons";
import LandingBackdrop from "@/components/onboarding/oauth-first/LandingBackdrop";
import { IntroBubbleBot } from "@/components/onboarding/oauth-first/IntroBubbleBot";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useLabWorkMirror } from "@/hooks/useLabWorkMirror";

export function LabSignInGate({
  controller,
  children,
}: {
  controller: LabSessionController;
  children?: React.ReactNode;
}) {
  // useSyncExternalStore keeps React's concurrent-mode rendering safe: the
  // third argument (getServerSnapshot) returns an initial state for SSR; the
  // real controller has no server equivalent, so we return the same snapshot.
  const state = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState(),
    () => controller.getState(),
  );

  // Wire the four production sync triggers (on-live, periodic, focus,
  // on-write). Best-effort: errors are caught and logged, never surfaced here.
  useLabWorkMirror(controller);

  // Escape hatch so the sign-in overlay can never soft-lock a user. If they
  // cannot or do not want to complete the lab OAuth (wrong folder, wrong
  // account), disconnecting returns them to the folder picker.
  const { disconnect } = useFileSystem();

  // Boot the controller for a lab account, then attempt a SILENT resume so a
  // returning user with a live OAuth cookie + persisted keypair goes straight to
  // "live" without re-clicking sign-in every refresh. resume() stays "locked"
  // (showing the buttons) when there is no live session, so it is safe to always
  // call. The reducer no-ops if already started.
  useEffect(() => {
    controller.start("lab");
    void controller.resume();
  }, [controller]);

  // No-soft-lock guard for the in-progress card: a hung OAuth or a stalled
  // keypair unlock must never trap the user with no exit. Surface the same
  // "Use a different folder" escape after 8s (matching StagedLoadingScreen's
  // hatch) so a fast sign-in never shows it but a stuck one always recovers.
  const inProgress =
    state.kind === "authenticating" || state.kind === "unlocking";
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!inProgress) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), 8000);
    return () => clearTimeout(timer);
  }, [inProgress]);

  // Session live (or defensive solo pass-through): reveal the app.
  if (state.kind === "live" || state.kind === "solo") {
    return <>{children}</>;
  }

  // In-progress states: show a non-interactive progress card.
  if (state.kind === "authenticating" || state.kind === "unlocking") {
    const message =
      state.kind === "authenticating" ? "Signing in..." : "Unlocking your lab...";
    return (
      <div className="light-scope fixed inset-0 flex items-center justify-center bg-white z-50">
        <LandingBackdrop />
        <div className="relative z-10 flex flex-col items-center gap-4 p-8 rounded-xl bg-surface-raised border border-border shadow-lg max-w-sm w-full mx-4">
          <IntroBubbleBot size="sm" />
          <p className="text-body text-foreground text-center">{message}</p>
          {stalled && (
            <div className="border-t border-border pt-3 mt-1 w-full text-center">
              <p className="text-meta text-foreground-muted mb-2">
                Taking longer than expected?
              </p>
              <button
                type="button"
                onClick={() => void disconnect()}
                className="text-meta text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
              >
                Use a different folder
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Locked or expired: show the sign-in gate.
  const error = controller.getError();
  const subtitle =
    state.kind === "expired"
      ? "Your session has expired. Sign in again to continue."
      : "Your lab data is end-to-end encrypted; sign in to unlock it.";

  return (
    <div className="light-scope fixed inset-0 flex items-center justify-center bg-white z-50">
      <LandingBackdrop />
      <div className="relative z-10 flex flex-col gap-5 p-8 rounded-xl bg-surface-raised border border-border shadow-lg max-w-sm w-full mx-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <IntroBubbleBot size="sm" />
          <h1 className="text-heading font-semibold text-foreground">
            Sign in to your lab
          </h1>
          <p className="text-body text-foreground-muted">{subtitle}</p>
        </div>

        <SharingProviderButtons
          onProvider={(p) => {
            void controller.signIn(p);
          }}
        />

        {error != null && (
          <p className="text-meta text-red-600 dark:text-red-400" role="alert">
            {error.message}
          </p>
        )}

        <div className="border-t border-border pt-3 text-center">
          <button
            type="button"
            onClick={() => void disconnect()}
            className="text-meta text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
          >
            Use a different folder
          </button>
        </div>
      </div>
    </div>
  );
}
