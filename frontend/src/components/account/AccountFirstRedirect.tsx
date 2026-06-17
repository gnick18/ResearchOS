"use client";

// Cloud-accounts Phase 1 (Chunk C): account-first entry helpers.
//
// useHasCloudSession reads the NextAuth session once (the app mounts no
// SessionProvider, so getSession is imperative, matching the rest of the app).
// AccountFirstRedirect sends a signed-in, folderless visitor to their home. Both
// are only consulted when NEXT_PUBLIC_ACCOUNT_FIRST is on.
//
// Post-login type-routing (require-account pivot, 2026-06-16): instead of always
// landing on the generic /account hub, an org admin goes straight to their portal
// (department or institution), which is folderless and is their home. The admin
// status is resolved from the server (keyed to the OAuth email), so it works
// before any folder is connected. The lookups are fail-safe (a network error
// resolves to "not an admin"), and a timeout falls back to the hub, so a slow or
// down roster API never strands the visitor on the loader. Lab-head routing needs
// the in-folder settings, so it happens after folder-connect, not here.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "next-auth/react";

import { DEPT_TIER_ENABLED } from "@/lib/dept/config";
import { INSTITUTION_TIER_ENABLED } from "@/lib/institution/config";
import { loadDeptRoster } from "@/lib/dept/dept-admin-membership";
import { loadInstitutionRoster } from "@/lib/institution/institution-admin-membership";
import { resolvePostLoginDestination } from "@/lib/account/post-login-routing";

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

/** How long to wait for the org-admin lookups before falling back to the hub. */
const ORG_LOOKUP_TIMEOUT_MS = 2500;

type AdminStatus = { isDeptAdmin: boolean; isInstitutionAdmin: boolean };
const NOT_ADMIN: AdminStatus = { isDeptAdmin: false, isInstitutionAdmin: false };

export default function AccountFirstRedirect() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    // Carry the route they were trying to reach so /account can explain that it
    // needs a data folder (a folder-requiring surface bounced them here).
    const from = window.location.pathname;

    let timer: ReturnType<typeof setTimeout> | undefined;
    // Resolve org-admin status folderless. Both loaders already swallow errors
    // and return a null record, so the remaining risk is a hang, which the
    // timeout covers by resolving to "not an admin" (falls through to the hub).
    const adminCheck: Promise<AdminStatus> = Promise.all([
      loadDeptRoster(),
      loadInstitutionRoster(),
    ])
      .then(([dept, inst]) => ({
        isDeptAdmin: dept.department !== null,
        isInstitutionAdmin: inst.institution !== null,
      }))
      .catch(() => NOT_ADMIN);
    const timeout = new Promise<AdminStatus>((resolve) => {
      timer = setTimeout(() => resolve(NOT_ADMIN), ORG_LOOKUP_TIMEOUT_MS);
    });

    void Promise.race([adminCheck, timeout]).then((resolved) => {
      if (timer) clearTimeout(timer);
      if (cancelled) return;
      const dest = resolvePostLoginDestination({
        isDeptAdmin: resolved.isDeptAdmin,
        isInstitutionAdmin: resolved.isInstitutionAdmin,
        deptEnabled: DEPT_TIER_ENABLED,
        institutionEnabled: INSTITUTION_TIER_ENABLED,
        fromRoute: from,
      });
      router.replace(dest);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center text-meta text-foreground-muted">
      Taking you to your account&hellip;
    </div>
  );
}
