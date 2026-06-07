"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useFileSystem, isFileSystemAccessSupported } from "@/lib/file-system/file-system-context";
import BrowserNotSupported from "@/components/BrowserNotSupported";
import BetaDonationButton from "@/components/BetaDonationButton";
import FeedbackModal from "@/components/FeedbackModal";
import ImportELNDialog from "@/components/import-eln/ImportELNDialog";
import PickUserBeforeImportModal, {
  ELN_IMPORT_PENDING_KEY,
} from "@/components/import-eln/PickUserBeforeImportModal";
import UserAvatar from "@/components/UserAvatar";
import BeakerBot from "@/components/BeakerBot";
import PickerWalkthroughModal from "@/components/picker-walkthrough/PickerWalkthroughModal";
import RiseCredentialsStamp from "@/components/RiseCredentialsStamp";
import VersionBadge from "@/components/VersionBadge";
import { useErrorReporting } from "@/hooks/useErrorReporting";
import {
  extractDirectoryHandleFromDrop,
  describeDropExtractionError,
  type DropExtractionResult,
} from "@/lib/file-system/drop-folder";
import { usersApi } from "@/lib/local-api";

interface ResearchFolderSetupProps {
  onComplete: () => void;
}

export default function ResearchFolderSetup({ onComplete }: ResearchFolderSetupProps) {
  const searchParams = useSearchParams();

  // When the user arrived via "Sign in with ORCID/Google/GitHub/LinkedIn" on
  // the landing, the `signIn` query param carries their OAuth intent through
  // folder setup. After onComplete() we trigger the OAuth redirect so they land
  // in the app already signed in for sharing. The callbackUrl carries
  // ?sharingClaim=1 so the user returns into the global SharingClaimResume
  // mount (now with their freshly selected user connected) and a real sharing
  // identity gets created, not just an OAuth session. ORCID rides this exact
  // path; the resume mount routes ORCID to an email-OTP step on return. The
  // special value "email" does NOT redirect: it reloads into the SAME global
  // mount via ?sharingEmail=1, which opens the wizard on its email step. That
  // keeps the wizard on a durable surface, so it survives this setup screen
  // unmounting when an existing account is selected. If the param is absent we
  // call onComplete() as today.
  const pendingSignInProvider = searchParams?.get("signIn") as
    | "orcid"
    | "google"
    | "github"
    | "linkedin"
    | "email"
    | null;

  const handleComplete = (_selectedUser?: string) => {
    if (pendingSignInProvider === "email") {
      // Email skips OAuth. The folder + user are already connected (this runs
      // after an awaited setCurrentUser), so reload into the global mount which
      // opens the wizard at its email step with the now-connected user. Do not
      // call onComplete here, the reload supersedes that transition.
      if (typeof window !== "undefined") {
        window.location.assign("/?sharingEmail=1");
      }
      return;
    }
    onComplete();
    if (
      pendingSignInProvider === "orcid" ||
      pendingSignInProvider === "google" ||
      pendingSignInProvider === "github" ||
      pendingSignInProvider === "linkedin"
    ) {
      void signIn(pendingSignInProvider, { callbackUrl: "/?sharingClaim=1" });
    }
  };

  const {
    connect,
    connectWithHandle,
    reconnectWithStoredHandle,
    isLoading,
    error,
    isConnected,
    availableUsers,
    currentUser,
    setCurrentUser,
    createUser,
    directoryName,
    needsInitialization,
    initializeFolder,
    lastConnectedFolder,
    mainUser,
  } = useFileSystem();

  // Local override so a star-click reflects instantly. The context's
  // mainUser is read from _user_metadata.json at connect time; the file
  // write in handleSetMainUser is authoritative, but the context value
  // doesn't refresh until the next connect, so we mirror the choice here
  // for immediate (Main) badge feedback on this screen.
  const [mainUserOverride, setMainUserOverride] = useState<string | null>(null);
  const effectiveMainUser = mainUserOverride ?? mainUser;

  const [showUserSelection, setShowUserSelection] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [elnImportOpen, setElnImportOpen] = useState(false);
  // Inline user-picker modal for the "Import from LabArchives" CTA. When
  // no `currentUser` is set, clicking the CTA opens this picker rather
  // than the ImportELNDialog directly: the user picks an existing
  // account or creates one, the picker sets a sticky-intent flag in
  // sessionStorage, fires the sign-in, and the post-sign-in surface
  // (lib/providers.tsx) re-mounts ImportELNDialog automatically.
  const [pickUserForImportOpen, setPickUserForImportOpen] = useState(false);
  const { showBugReport, currentError, openBugReport, closeBugReport } = useErrorReporting();


  // Drag-and-drop state for the "Link Existing Folder" card. `isDragOver` is
  // a ref-counted boolean (incremented on dragenter, decremented on
  // dragleave) so nested children don't flicker the visual treatment off
  // when the pointer crosses an internal element boundary. `dropError`
  // surfaces file-not-folder / multi-item validation errors next to the
  // existing folder-system error.
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragCounterRef = useRef(0);

  // Opt-in walkthrough modal (the resurrected 4-beat tour that used
  // to fire automatically pre-75c6107b). Now triggered only by the
  // explicit CTA below the welcome bubble. Returning users skip past.
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);

  // Chrome's File System Access API throws an `AbortError` when the
  // user cancels the OS picker AND when Chrome refuses a system-adjacent
  // folder (Desktop / Documents root / Downloads / home) via its native
  // "Can't open this folder ... contains system files" dialog. Both
  // paths look identical to JS, so after any aborted picker call we
  // surface a gentle inline hint that doubles as recovery copy for the
  // blocked-folder case AND as a no-op for users who simply changed
  // their mind. The hint is dismissable so it never feels nagging.
  const [showSystemFolderHint, setShowSystemFolderHint] = useState(false);
  const [systemFolderHintDismissed, setSystemFolderHintDismissed] = useState(false);

  console.log("ResearchFolderSetupNew render:", { 
    isConnected, 
    currentUser, 
    availableUsers: availableUsers.length, 
    showUserSelection,
    needsInitialization 
  });

  useEffect(() => {
    console.log("useEffect triggered:", { isConnected, currentUser, availableUsers: availableUsers.length });
    if (isConnected && currentUser) {
      console.log("Calling onComplete - should navigate to app");
      onComplete();
    } else if (isConnected && availableUsers.length > 0) {
      console.log("Setting showUserSelection to true - multiple users");
      setShowUserSelection(true);
    } else if (isConnected && availableUsers.length === 0) {
      console.log("Setting showUserSelection to true - no users");
      setShowUserSelection(true);
    }
  }, [isConnected, currentUser, availableUsers, onComplete]);

  const handleConnect = async () => {
    const ok = await connect();
    // connect() resolves `false` on both AbortError (user cancel or
    // Chrome system-folder block) and on hard errors (permission denied,
    // FSA unsupported). The hard-error branch sets `error` in context,
    // which renders below the cards. The silent AbortError branch sets
    // nothing, so that's the gap we close here.
    if (!ok && !systemFolderHintDismissed) {
      setShowSystemFolderHint(true);
    }
  };

  // Drag-and-drop handlers for the "Link a folder" card. Browser
  // support note: `DataTransferItem.getAsFileSystemHandle()` and
  // `showDirectoryPicker()` ship together in Chromium (Chrome / Edge) and
  // are absent in Safari + Firefox + Brave alike. We already gate the
  // entire setup screen on `isFileSystemAccessSupported()` above, so if
  // the click-the-button path works in this browser the drop path works
  // too. `webkitGetAsEntry()` is kept as a defensive fallback.
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragCounterRef.current += 1;
    setIsDragOver(true);
    setDropError(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    // Must preventDefault on dragover for the browser to treat the element
    // as a valid drop target. Without this, the drop event never fires.
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

    const result: DropExtractionResult = await extractDirectoryHandleFromDrop(items);
    if (result.kind === "ok") {
      setDropError(null);
      await connectWithHandle(result.handle);
      return;
    }
    setDropError(describeDropExtractionError(result.kind));
  };

  const handleSelectUser = async (username: string) => {
    await setCurrentUser(username);
    handleComplete(username);
  };

  // Explicit "set as Main" star, mirroring UserLoginScreen. Main is the
  // owner account on this machine; the data layer never auto-promotes on
  // connect (so folder switches don't silently re-pin Main), so the only
  // way to designate it in a multi-user folder is this control.
  const handleSetMainUser = async (username: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await usersApi.setMainUser(username);
      setMainUserOverride(username);
    } catch (err) {
      console.error("Failed to set main user:", err);
    }
  };

  const handleCreateUser = async () => {
    if (!newUsername.trim()) {
      setCreateError("Please enter a username");
      return;
    }

    const sanitized = newUsername.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    if (sanitized !== newUsername.trim()) {
      setCreateError("Username can only contain letters, numbers, underscores, and hyphens");
      return;
    }

    // Capture before createUser mutates availableUsers: the first account
    // on a fresh folder is unambiguously the owner, so auto-promote it to
    // Main. Multi-user folders never auto-promote (use the star instead).
    const isFirstAccount = availableUsers.length === 0;

    setIsCreating(true);
    setCreateError(null);

    try {
      const success = await createUser(sanitized);
      if (success) {
        if (isFirstAccount) {
          try {
            await usersApi.setMainUser(sanitized);
            setMainUserOverride(sanitized);
          } catch {
            // Best-effort; the star remains available to set it later.
          }
        }
        await setCurrentUser(sanitized);
        handleComplete(sanitized);
      } else {
        setCreateError("Failed to create user. Please try again.");
      }
    } catch {
      setCreateError("Failed to create user. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  if (!isFileSystemAccessSupported()) {
    return <BrowserNotSupported />;
  }

  if (showUserSelection) {
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto flex items-start sm:items-center justify-center bg-gradient-to-br from-surface-sunken via-surface to-surface-sunken py-8">
        <VersionBadge tone="onDark" className="fixed top-3 left-4 z-[110]" />
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-[-12%] h-[60vh] w-[85vw] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-sky/30 via-brand-purple/15 to-transparent opacity-70 blur-3xl dark:opacity-40" />
          <div
            className="absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23475569' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
        </div>

        <div className="relative z-10 w-full max-w-md mx-4">
          <div className="text-center mb-8">
            {/* Brand mark: BeakerBot in the gradient pill, matching
                UserLoginScreen. Static, no liquid (white wireframe
                reads cleanly on the blue→purple gradient). */}
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-sky to-brand-purple shadow-lg mb-4">
              <BeakerBot
                pose="idle"
                noLiquid
                ariaLabel="ResearchOS BeakerBot logo"
                className="w-8 h-8 text-white"
              />
            </div>
            <h1 className="text-display font-extrabold tracking-tight text-foreground">ResearchOS</h1>
            <p className="text-foreground-muted mt-2">Connected to: {directoryName}</p>
          </div>

          <div className="bg-surface-raised backdrop-blur-xl rounded-2xl shadow-2xl border border-border overflow-hidden">
            <div className="p-6">
              {availableUsers.length > 0 ? (
                <>
                  <h2 className="text-heading font-bold text-foreground mb-4">Select Account</h2>
                  <p className="text-foreground-muted mb-6">
                    Choose an existing account or create a new one to continue.
                  </p>

                  <div className="space-y-2 mb-6">
                    {availableUsers.map((user) => (
                      <div
                        key={user}
                        className="group flex items-center gap-1 bg-surface-sunken hover:bg-surface-sunken/70 border border-border hover:border-blue-500/50 rounded-lg transition-all"
                      >
                        <button
                          onClick={() => handleSelectUser(user)}
                          className="flex-1 min-w-0 p-4 text-left flex items-center gap-2"
                        >
                          <UserAvatar username={user} size="md" />
                          <span className="text-foreground font-medium truncate">{user}</span>
                          {effectiveMainUser === user && (
                            <span className="shrink-0 text-meta text-amber-400 font-normal">
                              (Main)
                            </span>
                          )}
                        </button>
                        {effectiveMainUser !== user && (
                          <div className="relative group/icon pr-2">
                            <button
                              onClick={(e) => handleSetMainUser(user, e)}
                              className="p-2 opacity-0 group-hover:opacity-100 hover:bg-amber-500/20 rounded-lg text-foreground-muted hover:text-amber-400 transition-all"
                              aria-label="Set as main account"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                                />
                              </svg>
                            </button>
                            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap px-2 py-1 text-meta font-medium rounded bg-slate-900/95 text-slate-100 border border-white/10 opacity-0 group-hover/icon:opacity-100 transition-opacity z-10">
                              Set as main
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-heading font-bold text-foreground mb-4">Create Your First Account</h2>
                  <p className="text-foreground-muted mb-6">
                    This folder has no accounts yet. Create one to continue.
                  </p>
                </>
              )}

              <div className={availableUsers.length > 0 ? "border-t border-border pt-6" : ""}>
                {availableUsers.length > 0 && (
                  <h3 className="text-body font-medium text-foreground-muted mb-3">Create New Account</h3>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="Enter username"
                    className="flex-1 px-4 py-2 bg-surface-sunken border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                    onKeyDown={(e) => e.key === "Enter" && handleCreateUser()}
                  />
                  <button
                    onClick={handleCreateUser}
                    disabled={isCreating}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isCreating ? "Creating..." : "Create"}
                  </button>
                </div>
                {createError && (
                  <p className="text-red-600 dark:text-red-400 text-body mt-2">{createError}</p>
                )}
              </div>

              <div className="border-t border-border pt-4 mt-6">
                <h3 className="text-body font-medium text-foreground-muted mb-2">
                  Coming from LabArchives?
                </h3>
                <p className="text-meta text-foreground-muted mb-3">
                  Import a LabArchives Offline Notebook ZIP into your
                  workspace. Pages become tasks, folders can become projects.
                  Other ELNs (Benchling, Notion, paper notebooks) coming later.
                </p>
                <ImportFromELNButton
                  onOpen={() => {
                    // Branch on `currentUser`: with a user we already
                    // have a sign-in to attach the import to, so jump
                    // straight to the dialog. Without one we open the
                    // inline user-picker; it'll set the sticky-intent
                    // flag before sign-in so the dialog re-mounts on
                    // the post-sign-in surface.
                    if (currentUser) {
                      setElnImportOpen(true);
                    } else {
                      setPickUserForImportOpen(true);
                    }
                  }}
                />
                <a
                  href="/wiki/getting-started/labarchives-export"
                  className="mt-2 inline-flex items-center gap-1 text-meta text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline"
                >
                  How to export from LabArchives →
                </a>
              </div>
            </div>
          </div>

          <div className="text-center mt-6 flex items-center justify-center gap-4">
            <button
              onClick={openBugReport}
              className="text-foreground-muted hover:text-foreground text-meta transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Report Bug
            </button>
            <BetaDonationButton variant="link" />
          </div>
        </div>

        <FeedbackModal
          isOpen={showBugReport}
          onClose={closeBugReport}
          prefilledError={currentError}
        />
        {elnImportOpen && (
          <ImportELNDialog
            isOpen={elnImportOpen}
            onClose={() => setElnImportOpen(false)}
          />
        )}
        <PickUserBeforeImportModal
          isOpen={pickUserForImportOpen}
          availableUsers={availableUsers}
          onPickUser={async (username) => {
            // Set the sticky-intent flag BEFORE sign-in: setCurrentUser
            // triggers the AppContent re-render that unmounts this
            // screen, so any post-state work has to be queued up to
            // run on the next surface. providers.tsx reads + clears
            // this flag on the signed-in branch.
            try {
              sessionStorage.setItem(ELN_IMPORT_PENDING_KEY, "1");
            } catch {
              // sessionStorage can throw in private-mode Safari. The
              // picker still closes; the import just won't re-open
              // automatically.
            }
            setPickUserForImportOpen(false);
            await setCurrentUser(username);
            handleComplete();
          }}
          onCreateUser={async (username) => {
            // Same sticky-intent flow as onPickUser. We set the flag
            // before the createUser->setCurrentUser pair so it's in
            // place when AppContent re-renders us out.
            try {
              sessionStorage.setItem(ELN_IMPORT_PENDING_KEY, "1");
            } catch {
              // See onPickUser.
            }
            const ok = await createUser(username);
            if (!ok) {
              // Sign-in didn't happen — clear the flag so a stray
              // re-render doesn't open the dialog on a stale state.
              try {
                sessionStorage.removeItem(ELN_IMPORT_PENDING_KEY);
              } catch {
                // intentionally swallowed
              }
              return false;
            }
            setPickUserForImportOpen(false);
            await setCurrentUser(username);
            handleComplete();
            return true;
          }}
          onClose={() => setPickUserForImportOpen(false)}
        />
      </div>
    );
  }

  if (needsInitialization) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-surface-sunken via-surface to-surface-sunken">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-[-12%] h-[60vh] w-[85vw] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-sky/30 via-brand-purple/15 to-transparent opacity-70 blur-3xl dark:opacity-40" />
          <div
            className="absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23475569' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
        </div>

        <div className="relative z-10 w-full max-w-lg mx-4">
          <div className="text-center mb-8">
            {/* Brand mark: BeakerBot in the gradient pill, matching
                UserLoginScreen. Static, no liquid (white wireframe
                reads cleanly on the blue→purple gradient). */}
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-sky to-brand-purple shadow-lg mb-4">
              <BeakerBot
                pose="idle"
                noLiquid
                ariaLabel="ResearchOS BeakerBot logo"
                className="w-8 h-8 text-white"
              />
            </div>
            <h1 className="text-display font-extrabold tracking-tight text-foreground">ResearchOS</h1>
            <p className="text-foreground-muted mt-2">Connected to: {directoryName}</p>
          </div>

          <div className="bg-surface-raised backdrop-blur-xl rounded-2xl shadow-2xl border border-border overflow-hidden">
            <div className="p-6">
              <h2 className="text-heading font-bold text-foreground mb-4 text-center">
                Initialize New Folder
              </h2>
              <p className="text-foreground-muted mb-6 text-center">
                This folder doesn&apos;t have the required structure. Would you like to initialize it as a ResearchOS folder?
              </p>

              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    const success = await initializeFolder();
                    if (success) {
                      setShowUserSelection(true);
                    }
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
                  onClick={() => window.location.reload()}
                  className="px-4 py-3 bg-surface-sunken hover:bg-surface-sunken/70 text-foreground font-medium rounded-lg transition-all"
                >
                  Cancel
                </button>
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
                  <p className="text-body text-red-700 dark:text-red-300">{error}</p>
                </div>
              )}
            </div>
          </div>

          <div className="text-center mt-6 flex items-center justify-center gap-4">
            <button
              onClick={openBugReport}
              className="text-foreground-muted hover:text-foreground text-meta transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Report Bug
            </button>
            <BetaDonationButton variant="link" />
          </div>
        </div>

        <FeedbackModal
          isOpen={showBugReport}
          onClose={closeBugReport}
          prefilledError={currentError}
        />
      </div>
    );
  }

  if (lastConnectedFolder) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-surface-sunken via-surface to-surface-sunken">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-[-12%] h-[60vh] w-[85vw] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-sky/30 via-brand-purple/15 to-transparent opacity-70 blur-3xl dark:opacity-40" />
          <div
            className="absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23475569' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
        </div>

        <div className="relative z-10 w-full max-w-lg mx-4">
          <div className="text-center mb-8">
            {/* Brand mark: BeakerBot in the gradient pill, matching
                UserLoginScreen. Static, no liquid (white wireframe
                reads cleanly on the blue→purple gradient). */}
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-sky to-brand-purple shadow-lg mb-4">
              <BeakerBot
                pose="idle"
                noLiquid
                ariaLabel="ResearchOS BeakerBot logo"
                className="w-8 h-8 text-white"
              />
            </div>
            <h1 className="text-display font-extrabold tracking-tight text-foreground">ResearchOS</h1>
            <p className="text-foreground-muted mt-2">Local-first research data management</p>
          </div>

          <div className="bg-surface-raised backdrop-blur-xl rounded-2xl shadow-2xl border border-border overflow-hidden">
            <div className="p-6">
              <h2 className="text-heading font-bold text-foreground mb-4 text-center">
                Reconnect to <span className="text-blue-600 dark:text-blue-400">{lastConnectedFolder}</span>
              </h2>
              <p className="text-foreground-muted mb-6 text-center">
                We remember the folder you picked last time. Continue to re-attach without going through the OS picker.
              </p>

              <button
                onClick={() => reconnectWithStoredHandle()}
                disabled={isLoading}
                className="w-full py-3 btn-brand text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                ) : (
                  <>
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Continue
                  </>
                )}
              </button>

              <button
                onClick={handleConnect}
                disabled={isLoading}
                className="w-full mt-3 py-2 text-body text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50"
              >
                Pick a different folder
              </button>

              {error && (
                <div className="mt-4 p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg">
                  <p className="text-body text-red-700 dark:text-red-300">{error}</p>
                </div>
              )}
            </div>
          </div>

          <div className="text-center mt-6 flex items-center justify-center gap-4">
            <button
              onClick={openBugReport}
              className="text-foreground-muted hover:text-foreground text-meta transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Report Bug
            </button>
            <BetaDonationButton variant="link" />
          </div>
        </div>

        <FeedbackModal
          isOpen={showBugReport}
          onClose={closeBugReport}
          prefilledError={currentError}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-surface-sunken via-surface to-surface-sunken">
      <VersionBadge tone="onDark" className="fixed top-3 left-4 z-[110]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-12%] h-[60vh] w-[85vw] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-sky/30 via-brand-purple/15 to-transparent opacity-70 blur-3xl dark:opacity-40" />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23475569' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-3xl mx-4">
        {/* Page title, centered. */}
        <h1 className="mb-8 text-center text-display font-extrabold tracking-tight text-foreground">
          Welcome to ResearchOS
        </h1>

        {/* BeakerBot side column. Grant 2026-05-25: must NOT shift the
            folder cards out of the page center. On lg+ this floats
            absolutely in the left margin (right-full + mr-6 anchors it
            outside the wrapper). On sm/md the absolute positioning
            classes drop, so it stacks vertically above the cards in
            normal flow. The proximity-wave hook means the cursor
            moving toward the cards passes near BeakerBot, triggering
            the wave + surfacing the walkthrough CTA. */}
        <div className="mb-6 flex flex-col items-center lg:fixed lg:top-6 lg:right-6 lg:left-auto lg:ml-0 lg:mb-0 lg:w-64 lg:z-40">
          <div
            className="mb-2 flex h-28 w-28 items-center justify-center"
            data-testid="picker-beakerbot"
          >
            <BeakerBot
              pose="idle"
              alive
              className="h-full w-full text-sky-300"
              ariaLabel="BeakerBot"
            />
          </div>
          {/* Square-ish speech bubble pointing up at BeakerBot. Capped
              at max-w-xs so it reads as a chat bubble, not a banner. */}
          <div className="relative w-full max-w-xs">
            <div
              aria-hidden
              className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 bg-white"
            />
            <div
              className="relative rounded-2xl bg-white px-3 py-3 text-center shadow-lg"
              data-testid="picker-welcome-bubble"
            >
              <p
                className="text-title font-medium leading-snug text-slate-800"
                data-testid="picker-welcome-copy"
              >
                New here? It is strongly recommended to take a short
                onboarding walkthrough (3 minutes). Returning? Just
                take it from here.
              </p>
            </div>
          </div>
          {/* Opt-in walkthrough CTA. Author + funding credit lives in
              the modal's first slide + the RISE stamp, not here. */}
          <button
            type="button"
            onClick={() => setWalkthroughOpen(true)}
            data-testid="picker-walkthrough-open"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-sky-500/15 px-4 py-2 text-body font-semibold text-sky-100 border border-sky-300/40 transition-colors hover:bg-sky-500/25 hover:text-white hover:border-sky-300/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          >
            <svg
              aria-hidden="true"
              className="h-3.5 w-3.5"
              viewBox="0 0 12 12"
              fill="currentColor"
            >
              <path d="M3 1.5v9l8-4.5-8-4.5z" />
            </svg>
            Take the 3-minute walkthrough
          </button>
        </div>

        {/* Folder picker cards: always in the natural centered flow
            of the max-w-3xl wrapper, unaffected by BeakerBot's
            absolute positioning. */}
        <div>
        {/* Chrome's system-folder block (Desktop / Documents-root /
            Downloads / home throw a native "contains system files"
            dialog JS can't suppress) is now explained inline in the
            make-a-folder steps below, so the separate amber pre-warn
            banner that used to sit here was dropped to declutter the
            screen (Grant 2026-05-28). */}
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
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-blue-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                    />
                  </svg>
                </div>
                <h2 className="text-heading font-bold text-foreground">Link a folder</h2>
              </div>
              <p className="text-foreground-muted text-body mb-4">
                Point ResearchOS at a folder on your computer. It can be an
                existing ResearchOS folder (with your projects and data, maybe
                synced via OneDrive or iCloud), or a brand-new empty folder. We
                set up an empty folder automatically the first time you link it.
              </p>
              {/* Make-a-blank-folder instructions (Grant 2026-05-28). Chrome
                  cannot create a folder for you (the OS picker blocks the
                  parent locations we would need, even Documents root), so the
                  reliable path is: you make an empty folder, then link it. */}
              <div className="mb-4 rounded-lg bg-surface-sunken border border-border p-3">
                <p className="text-meta font-medium text-foreground-muted mb-1">
                  Starting fresh? Make an empty folder first:
                </p>
                <ol
                  data-testid="picker-make-folder-steps"
                  className="text-meta text-foreground-muted leading-relaxed list-decimal list-inside space-y-0.5"
                >
                  <li>
                    Open your file manager and make a <strong>new</strong>{" "}
                    folder anywhere you like (Documents/ResearchOS works well).{" "}
                    <span className="text-amber-700 dark:text-amber-300 font-medium">
                      <strong>IMPORTANT</strong>: Chrome blocks Desktop,
                      Documents, and Downloads themselves, but a folder you make
                      INSIDE any of them works fine.
                    </span>
                  </li>
                  <li>Name it something like ResearchOS.</li>
                  <li>
                    Click Link Folder below and select the folder you just made,
                    not its top-level parent.
                  </li>
                </ol>
              </div>
              <p
                className={`text-meta mb-4 transition-colors ${
                  isDragOver ? "text-blue-600 dark:text-blue-200 font-medium" : "text-foreground-muted"
                }`}
              >
                {isDragOver
                  ? "Release to link this folder"
                  : "Drop your folder here, or click below to pick"}
              </p>
              <button
                onClick={handleConnect}
                disabled={isLoading}
                className="w-full py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    Link Folder
                  </>
                )}
              </button>
              {dropError && (
                <p
                  role="alert"
                  data-testid="link-folder-drop-error"
                  className="mt-3 text-meta text-red-600 dark:text-red-300"
                >
                  {dropError}
                </p>
              )}
            </div>
          </div>
        </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-lg max-w-3xl mx-auto">
            <p className="text-body text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Recovery popup shown after an aborted picker call. Chrome wraps
            both legitimate user cancels and its system-folder block in the
            same `AbortError`, so we can't tell with certainty which fired
            (the OS owns the picker; JS never sees the blocked selection).
            Grant 2026-05-28: promoted from an easy-to-miss inline banner to
            a centered modal so the guidance is impossible to overlook after
            a failed pick. Copy is framed to cover both cases (block OR plain
            cancel) without claiming "Chrome blocked your folder". The retry
            button re-opens the link picker (startIn:"documents"); dismiss
            closes it. Create-New-Folder was removed 2026-05-28 (Chrome can't
            create a folder for us: the picker blocks the parent locations we
            would need, even Documents root), so the only flow is link. */}
        {showSystemFolderHint && !systemFolderHintDismissed && (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="picker-system-folder-recovery-title"
          >
            <div
              data-testid="picker-system-folder-recovery"
              className="w-full max-w-md rounded-2xl bg-surface-raised border border-amber-300/30 shadow-2xl p-6"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/20">
                  <svg
                    aria-hidden
                    className="h-5 w-5 text-amber-300"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                </span>
                <div className="flex-1">
                  <h3
                    id="picker-system-folder-recovery-title"
                    className="text-title font-semibold text-foreground"
                  >
                    That folder can&apos;t be used. Pick a different spot.
                  </h3>
                  <p className="mt-2 text-body text-amber-700 dark:text-amber-100/90 leading-relaxed">
                    If Chrome just told you a folder &quot;contains system
                    files&quot;, that is its block on sensitive locations. Chrome
                    blocks the top-level Desktop, Documents, Downloads, and home
                    folders themselves, but a subfolder you make inside any of
                    them works fine.
                  </p>
                  <p className="mt-2 text-body text-amber-700 dark:text-amber-100/90 leading-relaxed">
                    Make an empty folder with your file manager (like
                    Documents/ResearchOS, or even one on your Desktop), then link
                    that folder here, not its top-level parent. We set up an
                    empty folder automatically the first time you link it.
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
                  data-testid="picker-system-folder-recovery-dismiss"
                >
                  Got it
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Re-open the link picker (startIn:"documents"). Clear the
                    // hint first so a fresh abort can re-trigger it.
                    setShowSystemFolderHint(false);
                    void handleConnect();
                  }}
                  className="px-4 py-2 text-body font-medium rounded-lg bg-amber-500/90 text-slate-900 hover:bg-amber-400 transition-colors"
                  data-testid="picker-system-folder-recovery-retry"
                >
                  Link a folder in Documents
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col items-center gap-2">
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 text-amber-800 hover:text-amber-900 dark:text-amber-100 dark:hover:text-white border border-amber-300/60 hover:border-amber-400 dark:border-amber-300/40 dark:hover:border-amber-300/70 rounded-lg text-body font-semibold transition-colors"
          >
            <svg
              aria-hidden
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
            Explore demo in browser
          </Link>
          <a
            href="/demo-lab.zip"
            className="text-meta text-foreground-muted hover:text-amber-600 dark:hover:text-amber-200 underline-offset-2 hover:underline transition-colors"
          >
            Or download as a starter folder
          </a>
          <p className="text-meta text-foreground-muted">
            An entirely fake yeast-lab dataset to explore the app with.
          </p>
        </div>

        <div className="text-center mt-6 flex items-center justify-center gap-4 flex-wrap">
          <a
            href="/wiki/getting-started/connecting-your-folder"
            className="text-foreground-muted hover:text-foreground text-meta transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            New here? Read the setup guide
          </a>
          <a
            href="/wiki/shared-lab-accounts"
            className="text-foreground-muted hover:text-foreground text-meta transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-5.13a4 4 0 11-8 0 4 4 0 018 0zm6 0a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Sharing a folder with your lab?
          </a>
          <button
            onClick={openBugReport}
            className="text-foreground-muted hover:text-foreground text-meta transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Report Bug
          </button>
          <BetaDonationButton variant="link" />
        </div>
      </div>

      <FeedbackModal
        isOpen={showBugReport}
        onClose={closeBugReport}
        prefilledError={currentError}
      />

      {/* Persistent RISE credentials stamp in the bottom-right corner.
          Authority signal: "real academic project, not a data-harvesting
          scheme." Rehomed from the retired pre-onboarding modal
          2026-05-25. */}
      <RiseCredentialsStamp />

      {/* Opt-in walkthrough modal (controlled). Renders nothing while
          closed, so the picker stays as the persistent landing. The
          modal does not link a folder; on close the user returns to
          this picker. */}
      <PickerWalkthroughModal
        open={walkthroughOpen}
        onClose={() => setWalkthroughOpen(false)}
      />
    </div>
  );
}

function ImportFromELNButton({ onOpen }: { onOpen: () => void }) {
  // No-user gating used to wrap this in a `Sign in to a user first.`
  // Tooltip + disabled state. That dead-ended the user: signing in
  // navigated away from this screen so the button was never reachable
  // in its enabled form. The click handler now branches on currentUser
  // upstream — without a user it opens the inline picker modal, with
  // one it opens the import dialog directly.
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="import-eln-cta"
      className="w-full px-4 py-2 bg-surface-sunken hover:bg-surface-sunken/70 border border-border hover:border-blue-500/50 rounded-lg text-foreground text-body font-medium transition-all"
    >
      Import from LabArchives
    </button>
  );
}
