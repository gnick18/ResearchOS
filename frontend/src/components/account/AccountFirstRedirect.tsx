"use client";

// Cloud-accounts Phase 1 (Chunk C): account-first entry helpers.
//
// useHasCloudSession reads the NextAuth session once (the app mounts no
// SessionProvider, so getSession is imperative, matching the rest of the app).
// AccountFirstRedirect sends a signed-in, folderless visitor to /account. Both
// are only consulted when NEXT_PUBLIC_ACCOUNT_FIRST is on.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "next-auth/react";

/** Whether a NextAuth (cloud) session exists. null while the check is in flight. */
export function useHasCloudSession(): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void getSession().then((s) => {
      if (alive) setHas(Boolean(s?.user?.email));
    });
    return () => {
      alive = false;
    };
  }, []);
  return has;
}

export default function AccountFirstRedirect() {
  const router = useRouter();
  useEffect(() => {
    // Carry the route they were trying to reach so /account can explain that it
    // needs a data folder (a folder-requiring surface bounced them here).
    const from = window.location.pathname;
    const target =
      from && from !== "/account"
        ? `/account?from=${encodeURIComponent(from)}`
        : "/account";
    router.replace(target);
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center text-meta text-foreground-muted">
      Taking you to your account&hellip;
    </div>
  );
}
