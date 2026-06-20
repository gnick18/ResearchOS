"use client";

// Cloud-accounts Phase 1 (Chunk A): the folderless account home route.
//
// A standalone, sign-in-gated, branded surface (PortalShell) that a signed-in
// user reaches with NO data folder. It is in the folderless bypass set in
// providers.tsx, so it renders off the NextAuth session in any browser, the data
// folder being an optional post-login attachment.
//
// When NEXT_PUBLIC_ACCOUNT_HUB is on, renders the new AccountHub (identity +
// billing summary + lab-head switch). When off, renders AccountHome (today's
// bare surface). The flag defaults OFF so this is safe to merge.

import PortalShell from "@/components/portal/PortalShell";
import AccountHome from "@/components/account/AccountHome";
import { ACCOUNT_HUB_ENABLED } from "@/lib/account/account-hub-config";

// Lazy import AccountHub only when the flag is on, keeping the flag-off bundle
// identical to today. Dynamic import avoids a top-level import that would
// bundle AccountHub (and its billing hooks) unconditionally.
import dynamic from "next/dynamic";

const AccountHub = ACCOUNT_HUB_ENABLED
  ? dynamic(() => import("@/components/account/AccountHub"), { ssr: false })
  : null;

export default function AccountRoute() {
  return (
    <PortalShell
      title="Account"
      gateHeading="Sign in to your ResearchOS account"
      tagline="Your account is the cloud part: profile, billing, and settings, available on any device. Your research data stays local on your own computer."
    >
      {AccountHub ? <AccountHub /> : <AccountHome />}
    </PortalShell>
  );
}
