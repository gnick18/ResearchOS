"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "@/components/FixtureLink";
import AppShell from "@/components/AppShell";
import WorkbenchProjectsPanel from "@/components/workbench/WorkbenchProjectsPanel";

// Deep-link entry to a project. The full-page ProjectRoute layout retired in
// the popup redesign (docs/proposals/PROJECT_POPUP_REDESIGN.md): every entry
// point (BeakerSearch hrefs, ?openProject=, shared links) now lands on the same
// ProjectDetailPopup. This route renders the Workbench Projects browse view and
// AUTO-OPENS the popup for the id (+ ?owner= for shared projects) carried in the
// URL, so a bookmarked / shared project link opens exactly as a card click does.
export default function ProjectSurfacePage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const rawId = params?.id;
  const parsedId = rawId ? Number(rawId) : NaN;
  const ownerHint = searchParams?.get("owner") || null;

  if (!Number.isFinite(parsedId)) {
    return (
      <AppShell>
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3">
          <p className="text-title text-foreground font-medium">Project not found</p>
          <p className="text-body text-foreground-muted">That URL doesn&apos;t look right.</p>
          <Link
            href="/"
            className="mt-2 text-body text-blue-600 hover:text-blue-700 hover:underline"
          >
            ← Back to projects
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4">
          <h2 className="text-heading font-semibold text-foreground">Workbench</h2>
          <p className="text-body text-foreground-muted mt-0.5">Projects</p>
        </div>
        <WorkbenchProjectsPanel
          autoOpenProjectId={parsedId}
          autoOpenOwner={ownerHint}
        />
      </div>
    </AppShell>
  );
}
