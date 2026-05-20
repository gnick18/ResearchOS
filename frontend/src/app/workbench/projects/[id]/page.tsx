"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import ProjectRoute from "@/components/project-surface/ProjectRoute";

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
          <p className="text-base text-gray-700 font-medium">Project not found</p>
          <p className="text-sm text-gray-400">That URL doesn&apos;t look right.</p>
          <Link
            href="/"
            className="mt-2 text-sm text-blue-600 hover:text-blue-700 hover:underline"
          >
            ← Back to projects
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ProjectRoute projectId={parsedId} ownerHint={ownerHint} />
    </AppShell>
  );
}
