"use client";

// Researcher directory browse page: /researchers.
//
// An in-app discovery surface (rendered inside AppShell) for searching the
// opt-in researcher directory by name or institution. Search requires an OAuth
// session server-side (the locked "logged-in researchers only" rule), so this
// lives behind the normal app gate alongside the other sharing features. Each
// result links to the standalone, shareable profile page.

import AppShell from "@/components/AppShell";
import { PageContainer } from "@/components/layout/PageContainer";
import ResearcherSearch from "@/components/sharing/ResearcherSearch";
import { useFileSystem } from "@/lib/file-system/file-system-context";

export default function ResearchersPage() {
  return (
    <AppShell>
      <ResearchersBody />
    </AppShell>
  );
}

function ResearchersBody() {
  const { currentUser, isConnected } = useFileSystem();

  if (!isConnected || !currentUser) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-3">
          <h2 className="text-heading font-semibold text-foreground">
            Researcher directory
          </h2>
          <p className="text-body text-foreground-muted">
            Connect to a research folder and pick a user to search the
            directory.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageContainer width="wide" className="py-10">
        <div className="mb-6">
          <h1 className="text-display font-bold tracking-tight text-foreground">
            Find researchers
          </h1>
          <p className="mt-1 text-body text-foreground-muted leading-relaxed">
            Search for other ResearchOS users by name or institution. Results
            show their verified identity and key fingerprint, never an email.
            Open a profile to see more.
          </p>
        </div>
        <ResearcherSearch />
      </PageContainer>
    </div>
  );
}
