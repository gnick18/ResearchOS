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

import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import type { LabSessionController } from "@/lib/lab/lab-session";
import SharingProviderButtons from "@/components/sharing/SharingProviderButtons";

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

  // Boot the controller for a lab account. The reducer is a no-op if already
  // started, so calling this on every mount is safe.
  useEffect(() => {
    controller.start("lab");
  }, [controller]);

  // Session live (or defensive solo pass-through): reveal the app.
  if (state.kind === "live" || state.kind === "solo") {
    return <>{children}</>;
  }

  // In-progress states: show a non-interactive progress card.
  if (state.kind === "authenticating" || state.kind === "unlocking") {
    const message =
      state.kind === "authenticating" ? "Signing in..." : "Unlocking your lab...";
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-surface z-50">
        <div className="flex flex-col items-center gap-4 p-8 rounded-xl bg-surface-raised border border-border shadow-lg max-w-sm w-full mx-4">
          {/* Simple spinner via Tailwind animate-spin */}
          <div className="w-8 h-8 rounded-full border-4 border-border border-t-accent animate-spin" />
          <p className="text-body text-foreground text-center">{message}</p>
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
    <div className="fixed inset-0 flex items-center justify-center bg-surface z-50">
      <div className="flex flex-col gap-5 p-8 rounded-xl bg-surface-raised border border-border shadow-lg max-w-sm w-full mx-4">
        <div className="flex flex-col gap-1">
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
      </div>
    </div>
  );
}
