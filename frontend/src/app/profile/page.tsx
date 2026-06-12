"use client";

// /profile, kept as a deep-link so old links never 404. Profile editing folded
// fully into the unified Settings shell (settings-build bot, 2026-06-11), so this
// route now lands on the "Profile & appearance" section of /settings, which
// renders the very same ProfileSettingsContent body (appearance, researcher
// profile, public-profile card, account and keys). One place to edit yourself.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import AppShell from "@/components/AppShell";

export default function ProfilePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/settings?section=profile");
  }, [router]);

  return (
    <AppShell>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
      </div>
    </AppShell>
  );
}
