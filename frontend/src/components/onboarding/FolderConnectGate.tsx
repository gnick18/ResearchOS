"use client";

// Folder-connect gate (onboarding redundancy removal, 2026-06-10). This is the
// slim surface that handles the "no folder connected yet" states after the
// start screen. It replaces the old ResearchFolderSetupNew landing card, whose
// own "Link Folder" button was a redundant second click: the start screen's
// "Open a folder" now triggers the OS picker directly (connect() is called
// inside that click, which is already a user gesture).
//
// So this gate is the FALLBACK / RESUME surface, shown only when the picker was
// not auto-triggered:
//   - after the user cancels the OS picker (retry here),
//   - on the sign-in-with-provider path (the provider button did a router.push,
//     so no folder is connected yet and we prompt for one before the OAuth
//     claim),
//   - when an empty folder needs initializing.
//
// The demo entry + the fake yeast-lab starter folder live on the welcome page
// (the scroll-down section of EntrySnapSurface), not here, so they are not
// duplicated. The Chrome-blocks-system-folders guidance is shown only in the
// post-abort recovery modal (Grant 2026-06-10: do not pre-warn, surface it when
// they actually hit the block), since Chrome owns the picker and reports both a
// real cancel and a blocked-folder pick as the same AbortError.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useState, useRef, useCallback } from "react";
import {
  useFileSystem,
  isFileSystemAccessSupported,
} from "@/lib/file-system/file-system-context";
import BrowserNotSupported from "@/components/BrowserNotSupported";
import { ONBOARDING_WIZARD_ENABLED } from "@/lib/onboarding/config";
import FolderSwitcher from "@/components/file-system/FolderSwitcher";
import BetaDonationButton from "@/components/BetaDonationButton";
import FeedbackModal from "@/components/FeedbackModal";
import BeakerBot from "@/components/BeakerBot";
import LandingBackdrop from "@/components/onboarding/oauth-first/LandingBackdrop";
import { IntroBubbleBot } from "@/components/onboarding/oauth-first/IntroBubbleBot";
import { Icon } from "@/components/icons";
import PickerWalkthroughModal from "@/components/picker-walkthrough/PickerWalkthroughModal";
import RiseCredentialsStamp from "@/components/RiseCredentialsStamp";
import VersionBadge from "@/components/VersionBadge";
import { useErrorReporting } from "@/hooks/useErrorReporting";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import {
  extractDirectoryHandleFromDrop,
  describeDropExtractionError,
  type DropExtractionResult,
} from "@/lib/file-system/drop-folder";

interface FolderConnectGateProps {
  /**
   * The OAuth provider the visitor is mid-sign-in with, if any (the `?signIn=`
   * intent). Only used to adapt the heading copy so the resume path reads as
   * "connect your folder to finish signing in" rather than a cold "link a
   * folder". The actual OAuth redirect after folder + user selection is owned
   * by lib/providers.tsx, not this component.
   */
  pendingSignInProvider: string | null;
  /**
   * OAuth-first (entry-flow redesign change 4): true when the visitor has just
   * returned from a provider (verified email in the session, ?sharingClaim=1)
   * and still needs to pick a folder. Reframes the connect step as "Save your
   * account on your disk", the expected next step after sign-in rather than a
   * cold connect. The three identity cases (brand-new empty folder, the folder
   * already holds this account, or a different user) are all handled downstream
   * by the account picker (UserLoginScreen) and the global SharingClaimResume
   * mount, which only mints once a folder-local user is connected. Default
   * false, so the legacy flow's copy is unchanged.
   */
  accountSaveFraming?: boolean;
  /** Return to the start screen (resets the entry action). */
  onBack: () => void;
}

export default function FolderConnectGate({
  pendingSignInProvider,
  accountSaveFraming = false,
  onBack,
}: FolderConnectGateProps) {
  const {
    connect,
    connectWithHandle,
    reconnectWithStoredHandle,
    lastConnectedFolder,
    disconnect,
    isLoading,
    error,
    needsInitialization,
    initializeFolder,
    directoryName,
    rememberedFolders,
  } = useFileSystem();

  const { showBugReport, currentError, openBugReport, closeBugReport } =
    useErrorReporting();

  // Opt-in walkthrough modal (the resurrected 4-beat tour). Triggered only by
  // the explicit CTA below the bubble; returning users skip past.
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);

  // Drag-and-drop state for the connect card. `isDragOver` is ref-counted so
  // nested children don't flicker the visual treatment off when the pointer
  // crosses an internal element boundary.
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragCounterRef = useRef(0);

  // Chrome wraps both a real picker cancel AND its system-folder block (Desktop
  // / Documents root / Downloads / home) in the same AbortError, so after any
  // aborted picker call we surface the recovery modal that doubles as the
  // blocked-folder explainer and a no-op for users who simply changed their
  // mind. Dismissable so it never nags.
  const [showSystemFolderHint, setShowSystemFolderHint] = useState(false);
  const [systemFolderHintDismissed, setSystemFolderHintDismissed] =
    useState(false);
  useEscapeToClose(
    useCallback(() => {
      setShowSystemFolderHint(false);
      setSystemFolderHintDismissed(true);
    }, []),
    showSystemFolderHint && !systemFolderHintDismissed,
  );

  const handleConnect = async () => {
    const ok = await connect();
    // connect() resolves false on AbortError (cancel or Chrome system-folder
    // block) and on hard errors (which set `error` in context). The silent
    // AbortError branch sets nothing, so we surface the recovery modal here.
    if (!ok && !systemFolderHintDismissed) {
      setShowSystemFolderHint(true);
    }
  };

  // One-click reconnect to the last folder. Chrome drops the readwrite grant on
  // a page reload (it reverts to "prompt"), so the silent queryPermission path
  // in FileSystemProvider.initialize cannot re-attach and the gate falls back to
  // here. This button re-permissions the STORED handle with a single user
  // gesture (requestPermission needs a gesture, which the click supplies) so the
  // user reconnects their remembered folder without re-picking it from the OS
  // picker. Falls through to the normal browse path on any failure.
  const handleReconnect = async () => {
    await reconnectWithStoredHandle();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragCounterRef.current += 1;
    setIsDragOver(true);
    setDropError(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const items = e.dataTransfer?.items;
    if (!items || items.length === 0) return;

    const result: DropExtractionResult =
      await extractDirectoryHandleFromDrop(items);
    if (result.kind === "ok") {
      setDropError(null);
      await connectWithHandle(result.handle);
      return;
    }
    setDropError(describeDropExtractionError(result.kind));
  };

  if (!isFileSystemAccessSupported()) {
    return <BrowserNotSupported />;
  }

  // Initialize-an-empty-folder prompt. After connect() on a folder that lacks
  // the ResearchOS structure, finishConnect leaves the handle attached and
  // flips needsInitialization. The handle stays set so initializeFolder() can
  // write the structure; on success isConnected flips and providers routes to
  // the account picker (UserLoginScreen).
  if (needsInitialization) {
    return (
      <div className="light-scope fixed inset-0 z-[100] flex items-center justify-center bg-white">
        <BackdropTexture />
        <div className="relative z-10 w-full max-w-lg mx-4">
          <BrandHeader subtitle={`Connected to: ${directoryName}`} />

          <div className="bg-surface-raised backdrop-blur-xl rounded-2xl shadow-2xl border border-border overflow-hidden">
            <div className="p-6">
              <h2 className="text-heading font-bold text-foreground mb-4 text-center">
                Initialize New Folder
              </h2>
              <p className="text-foreground-muted mb-6 text-center">
                This folder doesn&apos;t have the required structure. Would you
                like to initialize it as a ResearchOS folder?
              </p>

              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    await initializeFolder();
                  }}
                  disabled={isLoading}
                  className="flex-1 py-3 btn-brand text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isLoading ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                  ) : (
                    "Initialize Folder"
                  )}
                </button>
                <button
                  onClick={async () => {
                    // Drop the still-attached empty folder so needsInitialization
                    // clears, then back out to the entry start. onBack alone left
                    // this screen up because the handle stayed connected.
                    await disconnect();
                    onBack();
                  }}
                  disabled={isLoading}
                  className="ros-btn-neutral px-4 py-3 font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
                  <p className="text-body text-red-700 dark:text-red-300">
                    {error}
                  </p>
                </div>
              )}
            </div>
          </div>

          <GateFooter onBugReport={openBugReport} />
        </div>

        <FeedbackModal
          isOpen={showBugReport}
          onClose={closeBugReport}
          prefilledError={currentError}
        />
      </div>
    );
  }

  // The connect surface. Shown when no folder is attached: after a cancelled
  // picker (retry here), or on the sign-in-with-provider resume path.
  return (
    <div className="light-scope fixed inset-0 z-[100] flex items-center justify-center bg-white">
      <VersionBadge tone="surface" className="fixed top-3 left-4 z-[110]" />
      <BackdropTexture />

      <div className="relative z-10 w-full max-w-2xl mx-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1 text-meta font-semibold text-foreground-muted hover:text-brand-action transition-colors"
        >
          <span aria-hidden>&larr;</span> Back
        </button>

        <h1 className="mb-6 text-center text-display font-extrabold tracking-tight text-foreground">
          {accountSaveFraming
            ? "Save your account on your disk"
            : pendingSignInProvider
              ? "Connect your folder to finish signing in"
              : "Connect your folder"}
        </h1>
        {accountSaveFraming && (
          <p className="-mt-3 mb-6 text-center text-body text-foreground-muted max-w-xl mx-auto">
            You are signed in. Pick a folder to keep your notebook and account.
            Everything stays local, this folder is your account. A brand-new
            folder starts a fresh account, and if the folder already holds this
            account we just unlock it.
          </p>
        )}

        {/* BeakerBot side column with the opt-in walkthrough CTA. On lg+ this
            floats in the right margin; on smaller screens it stacks above. */}
        <div className="mb-6 flex flex-col items-center lg:fixed lg:top-6 lg:right-6 lg:left-auto lg:mb-0 lg:w-64 lg:z-40">
          <div
            className="mb-2 flex h-24 w-24 items-center justify-center"
            data-testid="gate-beakerbot"
          >
            <BeakerBot
              pose="idle"
              alive
              className="h-full w-full text-sky-300"
              ariaLabel="BeakerBot"
            />
          </div>
          <div className="relative w-full max-w-xs">
            <div
              aria-hidden
              className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 bg-surface-raised border-l border-t border-border"
            />
            <div className="relative rounded-2xl bg-surface-raised border border-border px-3 py-3 text-center shadow-lg dark:shadow-black/40">
              <p className="text-title font-medium leading-snug text-foreground">
                New here? It is strongly recommended to take a short onboarding
                walkthrough (3 minutes). Returning? Just take it from here.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setWalkthroughOpen(true)}
            data-testid="gate-walkthrough-open"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-action/10 dark:bg-brand-action/15 px-4 py-2 text-body font-semibold text-sky-700 dark:text-sky-100 border border-sky-400/40 dark:border-sky-300/40 transition-colors hover:bg-brand-action/20 dark:hover:bg-brand-action/25 hover:text-sky-800 dark:hover:text-white hover:border-sky-400/70 dark:hover:border-sky-300/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:focus-visible:outline-sky-300"
          >
            Take the 3-minute walkthrough
          </button>
        </div>

        {/* One-click reconnect to the remembered folder. Shown when a previous
            folder is on record (e.g. after a reload, where Chrome drops the
            readwrite grant so the silent reconnect cannot re-attach). The click
            is a user gesture, which is what requestPermission needs, so this
            re-permissions the stored handle without the OS picker. The
            drag/browse card below stays as the path to a different folder. */}
        {lastConnectedFolder && (
          <div className="max-w-xl mx-auto mb-5">
            <div className="rounded-2xl border border-blue-400/40 bg-blue-500/10 dark:bg-blue-500/15 px-5 py-4 text-center">
              <p className="text-body text-foreground">
                You were last connected to{" "}
                <span className="font-semibold">{lastConnectedFolder}</span>.
              </p>
              <button
                onClick={handleReconnect}
                disabled={isLoading}
                data-testid="gate-reconnect-folder"
                className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg btn-brand px-5 py-2.5 text-body font-semibold text-white transition-all disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  <>
                    <Icon name="folder" className="h-4 w-4" />
                    Reconnect {lastConnectedFolder}
                  </>
                )}
              </button>
              <p className="mt-2 text-meta text-foreground-muted">
                Chrome asks you to allow access again after a reload. No need to
                find the folder, just choose Allow.
              </p>
            </div>
          </div>
        )}

        {/* Remembered folders (Phase A, multi-folder). Lists every folder the
            app remembers so the user can one-click switch without the OS
            picker. Renders nothing unless NEXT_PUBLIC_MULTI_FOLDER is on and
            more than one folder is remembered, so single-folder users see only
            the reconnect card above and the browse card below, unchanged. */}
        {rememberedFolders.length > 1 && (
          <div className="max-w-xl mx-auto mb-5">
            <p className="mb-2 text-meta font-medium text-foreground-muted">
              Your folders
            </p>
            <FolderSwitcher variant="panel" />
          </div>
        )}

        <div className="max-w-xl mx-auto">
          <div
            data-testid="link-folder-drop-zone"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative bg-surface-raised backdrop-blur-xl rounded-2xl shadow-2xl overflow-hidden transition-all ${
              isDragOver
                ? "border-2 border-dashed border-blue-400 bg-blue-500/15 ring-4 ring-blue-400/30"
                : "border-2 border-dashed border-border hover:border-foreground-muted"
            }`}
          >
            <div className="px-6 py-9 text-center">
              <div
                className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
                  isDragOver ? "bg-blue-500/25" : "bg-blue-500/15"
                }`}
              >
                <Icon
                  name="folder"
                  className={`h-7 w-7 transition-transform ${
                    isDragOver
                      ? "scale-110 text-blue-500 dark:text-blue-300"
                      : "text-blue-400"
                  }`}
                />
              </div>
              <h2
                className={`text-heading font-bold transition-colors ${
                  isDragOver
                    ? "text-blue-700 dark:text-blue-100"
                    : "text-foreground"
                }`}
              >
                {isDragOver
                  ? "Release to connect this folder"
                  : "Drag your data folder here"}
              </h2>
              {!isDragOver && (
                <>
                  <p className="mt-1.5 text-body text-foreground-muted">
                    Drop it anywhere in this box to connect.
                  </p>
                  <div className="mt-5 flex items-center justify-center gap-3 text-meta text-foreground-muted">
                    <span className="h-px w-10 bg-border" />
                    or
                    <span className="h-px w-10 bg-border" />
                  </div>
                  <button
                    onClick={handleConnect}
                    disabled={isLoading}
                    data-testid="gate-choose-folder"
                    className="ros-btn-neutral mt-3 inline-flex items-center justify-center gap-2 px-4 py-2 text-body font-medium text-foreground disabled:opacity-50"
                  >
                    {isLoading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      "Browse for a folder"
                    )}
                  </button>
                  <p className="mx-auto mt-5 max-w-sm text-meta text-foreground-muted leading-relaxed">
                    An existing ResearchOS folder or a new empty one. Dragging
                    skips the file picker, which can stall while a cloud sync
                    wakes up. Chrome and Edge only.
                  </p>
                </>
              )}
              {dropError && (
                <p
                  role="alert"
                  data-testid="link-folder-drop-error"
                  className="mt-4 text-meta text-red-600 dark:text-red-300"
                >
                  {dropError}
                </p>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg max-w-xl mx-auto">
            <p className="text-body text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/*
          Go-live (gated by NEXT_PUBLIC_ONBOARDING_WIZARD): a permanent escape off
          the folder gate to the read-only /demo workspace, so a user who is not
          ready to connect a folder is never trapped here (no soft-locks). Hidden
          while the flag is off so the merge changes nothing until launch.
        */}
        {ONBOARDING_WIZARD_ENABLED && (
          <p className="mt-6 text-center text-meta text-foreground-muted">
            Not ready to pick a folder?{" "}
            <a
              href="/demo"
              data-testid="gate-try-demo"
              className="font-semibold text-[#1283c9] hover:underline"
            >
              Try the demo instead
            </a>
          </p>
        )}

        <GateFooter onBugReport={openBugReport} />
      </div>

      {/* Post-abort recovery modal. Chrome wraps a user cancel and a blocked
          system-folder pick in the same AbortError, so this is framed to cover
          both without claiming "Chrome blocked your folder". This is the only
          place the Desktop/Documents/Downloads guidance appears (Grant
          2026-06-10): surface it when they actually hit the block, not as a
          pre-warning. */}
      {showSystemFolderHint && !systemFolderHintDismissed && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gate-system-folder-recovery-title"
        >
          <div
            data-testid="gate-system-folder-recovery"
            className="w-full max-w-md rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-300/50 dark:border-amber-300/30 shadow-2xl p-6"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/20">
                <Icon name="alert" className="h-5 w-5 text-amber-300" />
              </span>
              <div className="flex-1">
                <h3
                  id="gate-system-folder-recovery-title"
                  className="text-title font-semibold text-foreground"
                >
                  That folder can&apos;t be used. Pick a different spot.
                </h3>
                <p className="mt-2 text-body text-amber-700 dark:text-amber-100/90 leading-relaxed">
                  If Chrome just told you a folder &quot;contains system
                  files&quot;, that is its block on sensitive locations. Chrome
                  blocks the top-level Desktop, Documents, Downloads, and home
                  folders themselves, but a subfolder you make inside any of them
                  works fine.
                </p>
                <p className="mt-2 text-body text-amber-700 dark:text-amber-100/90 leading-relaxed">
                  Make an empty folder with your file manager (like
                  Documents/ResearchOS, or even one on your Desktop), then link
                  that folder here, not its top-level parent. We set up an empty
                  folder automatically the first time you link it.
                </p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowSystemFolderHint(false);
                  setSystemFolderHintDismissed(true);
                }}
                className="px-3 py-2 text-body rounded-lg text-amber-700 dark:text-amber-100/80 hover:text-foreground hover:bg-surface-sunken transition-colors"
                data-testid="gate-system-folder-recovery-dismiss"
              >
                Got it
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSystemFolderHint(false);
                  void handleConnect();
                }}
                className="px-4 py-2 text-body font-medium rounded-lg bg-amber-500/90 text-slate-900 hover:bg-amber-400 transition-colors"
                data-testid="gate-system-folder-recovery-retry"
              >
                Link a folder in Documents
              </button>
            </div>
          </div>
        </div>
      )}

      <FeedbackModal
        isOpen={showBugReport}
        onClose={closeBugReport}
        prefilledError={currentError}
      />

      {/* RISE credentials authority stamp, bottom-right. */}
      <RiseCredentialsStamp />

      {/* Opt-in walkthrough modal (controlled). Renders nothing while closed. */}
      <PickerWalkthroughModal
        open={walkthroughOpen}
        onClose={() => setWalkthroughOpen(false)}
      />
    </div>
  );
}

/** Shared dotted backdrop texture used by both gate surfaces. */
function BackdropTexture() {
  // Unified with the OAuth-first landing: the shared deck backdrop (radial wash,
  // masked dot grid, drifting auroras + floating beakers, rainbow bars).
  return <LandingBackdrop />;
}

/** BeakerBot-in-gradient-pill brand header used by the init surface. */
function BrandHeader({ subtitle }: { subtitle: string }) {
  return (
    <div className="text-center mb-8">
      <div className="mb-4 flex justify-center">
        <IntroBubbleBot size="sm" />
      </div>
      <h1 className="text-display font-extrabold tracking-tight text-brand-ink">
        ResearchOS
      </h1>
      <p className="text-foreground-muted mt-2">{subtitle}</p>
    </div>
  );
}

/** Lean footer for the gate surfaces. The full footer-link set (setup guide,
 *  sharing, support) lives on the start screen; here we keep just the setup
 *  guide and a bug-report affordance, since this is a fallback surface. */
function GateFooter({ onBugReport }: { onBugReport: () => void }) {
  return (
    <div className="text-center mt-6 flex items-center justify-center gap-4 flex-wrap">
      <a
        href="/wiki/getting-started/connecting-your-folder"
        className="text-foreground-muted hover:text-foreground text-meta transition-colors"
      >
        New here? Read the setup guide
      </a>
      <button
        onClick={onBugReport}
        className="text-foreground-muted hover:text-foreground text-meta transition-colors"
      >
        Report Bug
      </button>
      <BetaDonationButton variant="link" />
    </div>
  );
}
