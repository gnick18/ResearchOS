"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, type ReactNode } from "react";
import { FileSystemProvider, useFileSystem, isFileSystemAccessSupported } from "@/lib/file-system/file-system-context";
import ResearchFolderSetupNew from "@/components/ResearchFolderSetupNew";
import StagedLoadingScreen from "@/components/StagedLoadingScreen";

function AppContent({ children }: { children: ReactNode }) {
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
          <p className="text-slate-300">
            ResearchOS requires the File System Access API, which is only supported in
            Chromium-based browsers (Chrome, Edge, Brave). Please switch to a supported browser.
          </p>
        </div>
      </div>
    );
  }

  if (showSetup || !isConnected || !currentUser) {
    console.log("AppContent: rendering ResearchFolderSetupNew because:", { showSetup, isConnected, currentUser });
    return (
      <ResearchFolderSetupNew
        onComplete={() => {
          console.log("onComplete callback called in AppContent");
          setShowSetup(false);
          queryClient.invalidateQueries();
        }}
      />
    );
  }

  console.log("AppContent: rendering main app with QueryClientProvider");
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <FileSystemProvider>
      <AppContent>{children}</AppContent>
    </FileSystemProvider>
  );
}
