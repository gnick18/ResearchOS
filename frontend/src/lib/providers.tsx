"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FileSystemProvider, useFileSystem, isFileSystemAccessSupported } from "@/lib/file-system/file-system-context";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import ResearchFolderSetupNew from "@/components/ResearchFolderSetupNew";
import UserLoginScreen from "@/components/UserLoginScreen";
import StagedLoadingScreen from "@/components/StagedLoadingScreen";
import ErrorBoundary from "@/components/ErrorBoundary";
import GlobalDropGuard from "@/components/GlobalDropGuard";
import FloatingLeaveDemoButton from "@/components/FloatingLeaveDemoButton";
import OpenDocsButton from "@/components/OpenDocsButton";
import { OnboardingProvider } from "@/lib/onboarding/orchestrator";
import { initializeErrorHandlers } from "@/lib/error-reporting";

function AppContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The wiki must render before sign-in so new users can read the setup
  // guide and the browser-requirements page on their first visit. Skip
  // every gate below — loading, browser-support, folder-connect — when
  // the user is on a /wiki/* route. Query client is still provided so
  // any future client-rendered queries inside the wiki work.
  const isWikiRoute = pathname?.startsWith("/wiki");

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const { isConnected, isLoading, currentUser, loadingStage } = useFileSystem();
  const [showSetup, setShowSetup] = useState(false);

  console.log("AppContent render:", { isConnected, isLoading, currentUser, showSetup });

  useEffect(() => {
    console.log("AppContent useEffect:", { isLoading, isConnected, currentUser });
    if (!isLoading && !isConnected) {
      console.log("AppContent: showing setup (not connected)");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- state machine: setup gate flips based on external fs-connection state transitions
      setShowSetup(true);
    } else if (isConnected && currentUser) {
      console.log("AppContent: hiding setup (connected with user)");
      setShowSetup(false);
    }
  }, [isLoading, isConnected, currentUser]);

  useEffect(() => {
    if (currentUser) {
      queryClient.invalidateQueries();
    }
  }, [currentUser, queryClient]);

  if (isWikiRoute) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  // Fixture-backed modes (wiki-capture signed-in variant on localhost, or
  // the public /demo route in any environment): FileSystemProvider has
  // seeded the in-memory fixture and set state to connected. Skip every
  // gate. The wiki-capture "picker" variant leaves currentUser empty on
  // purpose, so it falls through to render UserLoginScreen below (the
  // !currentUser branch). Note (2026-05-14): this used to fall through
  // to ResearchFolderSetupNew; that gate was split so the post-exit-Lab-
  // Mode and any "folder-connected-but-no-user-picked" state renders
  // the cleaner UserLoginScreen with its proper Lab Mode CTA. Wiki
  // screenshots that captured the picker UI in this mode may need
  // recapturing — flagged in §8 for the wiki manager.
  if (isDemoOrWikiCapture() && currentUser) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  if (isLoading) {
    console.log("AppContent: rendering loading screen");
    return <StagedLoadingScreen stage={loadingStage} />;
  }

  if (!isFileSystemAccessSupported()) {
    console.log("AppContent: rendering browser not supported");
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-lg mx-4 p-6 bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20">
          <h2 className="text-xl font-bold text-white mb-4">Browser Not Supported</h2>
          <p className="text-slate-300 mb-4">
            ResearchOS requires the File System Access API, which is only supported in
            Chromium-based browsers (Chrome, Edge, Brave). Please switch to a supported browser.
          </p>
          <a
            href="/wiki/getting-started/browser-requirements"
            className="inline-block text-sm font-medium text-blue-300 hover:text-blue-200 underline"
          >
            Read the browser requirements guide →
          </a>
        </div>
      </div>
    );
  }

  if (showSetup || !isConnected) {
    console.log("AppContent: rendering ResearchFolderSetupNew because:", { showSetup, isConnected, currentUser });
    // Wrapped in QueryClientProvider because the user-picker renders
    // <UserAvatar> which calls useUserColor() → useQuery(). Without the
    // provider, the picker throws "No QueryClient set" the moment there
    // are existing users to choose from (notably in wiki-capture picker
    // mode, where the fixture exposes two users).
    //
    // Note (2026-05-14): the !currentUser branch was split out below so
    // exit-Lab-Mode (and any other "folder is connected but no user is
    // picked" state) routes to the cleaner UserLoginScreen — same user-
    // picker UI Grant sees on a fresh app open, with the Lab Mode CTA in
    // its proper place. ResearchFolderSetupNew now only fires when the
    // user genuinely needs folder setup (showSetup=true) or hasn't
    // connected a folder yet (!isConnected).
    return (
      <QueryClientProvider client={queryClient}>
        <ResearchFolderSetupNew
          onComplete={() => {
            console.log("onComplete callback called in AppContent");
            setShowSetup(false);
            queryClient.invalidateQueries();
          }}
        />
      </QueryClientProvider>
    );
  }

  // Folder is connected but no user is picked — show the clean account
  // picker (UserLoginScreen). This is the post-exit-Lab-Mode flow as well
  // as any other "need to choose an account" state on an already-connected
  // folder. UserLoginScreen has the proper Lab Mode CTA + footer affordances
  // (User & password help, shared lab setup, Report Bug, Support) that
  // ResearchFolderSetupNew's "Select Account" sub-step doesn't carry.
  // QueryClientProvider needed for the same useUserColor() useQuery() reason
  // as the ResearchFolderSetupNew branch above.
  if (!currentUser) {
    console.log("AppContent: rendering UserLoginScreen (connected, no user)");
    return (
      <QueryClientProvider client={queryClient}>
        <UserLoginScreen
          onLogin={() => {
            queryClient.invalidateQueries();
          }}
        />
      </QueryClientProvider>
    );
  }

  console.log("AppContent: rendering main app with QueryClientProvider");
  // Onboarding tips orchestrator. Wrapped inside the QueryClientProvider
  // and only on the non-demo, signed-in code path. Demo + wiki-capture
  // are exempt by design (they short-circuit the previous branch); the
  // provider itself also asserts the exemption via isDemoOrWikiCapture()
  // so a stray mount can't fire tips during a screenshot run.
  return (
    <QueryClientProvider client={queryClient}>
      <OnboardingProvider currentUser={currentUser}>{children}</OnboardingProvider>
    </QueryClientProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  // Wire global error handlers on client mount. The module-level flag
  // pattern this replaced ran during render — fine in practice but a side
  // effect during render. Returning the cleanup lets React strict-mode
  // double-mounts unwind correctly so we never end up with chained
  // handlers.
  useEffect(() => initializeErrorHandlers(), []);

  return (
    <ErrorBoundary>
      <FileSystemProvider>
        <GlobalDropGuard />
        <FloatingLeaveDemoButton />
        <OpenDocsButton />
        <AppContent>{children}</AppContent>
      </FileSystemProvider>
    </ErrorBoundary>
  );
}
