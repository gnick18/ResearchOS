"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FileSystemProvider, useFileSystem, isFileSystemAccessSupported } from "@/lib/file-system/file-system-context";
import { isWikiCaptureMode } from "@/lib/file-system/wiki-capture-mock";
import ResearchFolderSetupNew from "@/components/ResearchFolderSetupNew";
import StagedLoadingScreen from "@/components/StagedLoadingScreen";
import ErrorBoundary from "@/components/ErrorBoundary";
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

  // Capture mode (signed-in variant): FileSystemProvider has seeded fixture
  // data and set state to connected/grant. Skip every gate. The "picker"
  // variant leaves currentUser empty on purpose, so fall through to render
  // the user-picker via ResearchFolderSetupNew below.
  if (isWikiCaptureMode() && currentUser) {
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

  if (showSetup || !isConnected || !currentUser) {
    console.log("AppContent: rendering ResearchFolderSetupNew because:", { showSetup, isConnected, currentUser });
    // Wrapped in QueryClientProvider because the user-picker renders
    // <UserAvatar> which calls useUserColor() → useQuery(). Without the
    // provider, the picker throws "No QueryClient set" the moment there
    // are existing users to choose from (notably in wiki-capture picker
    // mode, where the fixture exposes two users).
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

  console.log("AppContent: rendering main app with QueryClientProvider");
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

let errorHandlersInitialized = false;

export function Providers({ children }: { children: ReactNode }) {
  if (!errorHandlersInitialized && typeof window !== "undefined") {
    initializeErrorHandlers();
    errorHandlersInitialized = true;
  }

  return (
    <ErrorBoundary>
      <FileSystemProvider>
        <AppContent>{children}</AppContent>
      </FileSystemProvider>
    </ErrorBoundary>
  );
}
