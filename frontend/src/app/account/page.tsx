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

import AccountHome from "@/components/account/AccountHome";
import { ACCOUNT_HUB_ENABLED } from "@/lib/account/account-hub-config";
import PortalShell from "@/components/portal/PortalShell";

// When the flag is on, the hub manages its own full-width layout via
// PortalShell wide=true + AccountHubShell. When off, AccountHome stays inside
// the standard narrow PortalShell unchanged (byte-identical to the old render).
import dynamic from "next/dynamic";

const AccountHubShell = ACCOUNT_HUB_ENABLED
  ? dynamic(
      () => import("@/components/account/AccountHubShell"),
      { ssr: false },
    )
  : null;

export default function AccountRoute() {
  if (AccountHubShell) {
    // Full-width hub: PortalShell supplies the auth gate + header; the hub
    // shell supplies its own max-w-6xl two-pane layout inside the wide frame.
    return (
      <PortalShell
        title="Account"
        wide
        gateHeading="Sign in to your ResearchOS account"
        tagline="Your account is the cloud part: profile, billing, and settings, available on any device. Your research data stays local on your own computer."
      >
        <AccountHubShell />
      </PortalShell>
    );
  }

  // Flag off: identical to today.
  return (
    <PortalShell
      title="Account"
      gateHeading="Sign in to your ResearchOS account"
      tagline="Your account is the cloud part: profile, billing, and settings, available on any device. Your research data stays local on your own computer."
    >
      <AccountHome />
    </PortalShell>
  );
}
