"use client";

// Standalone, shareable researcher profile route: /researchers/[fingerprint].
//
// The [fingerprint] segment is the compact (space-free) fingerprint. This is a
// client component so it can read the dynamic segment with useParams and fetch
// the profile from the public /api/directory/researcher route. Like /privacy it
// renders without the AppShell or a connected folder, so the URL is shareable
// to anyone, and it is excluded from the wiki-coverage map.

import { useParams } from "next/navigation";

import ResearcherProfile from "@/components/researchers/ResearcherProfile";

export default function ResearcherProfilePage() {
  const params = useParams<{ fingerprint: string }>();
  const fingerprint = Array.isArray(params.fingerprint)
    ? params.fingerprint[0]
    : params.fingerprint;

  return <ResearcherProfile compactFingerprint={fingerprint ?? ""} />;
}
