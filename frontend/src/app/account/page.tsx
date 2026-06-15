"use client";

// Cloud-accounts Phase 1 (Chunk A): the folderless account home route.
//
// A standalone, sign-in-gated, branded surface (PortalShell) that a signed-in
// user reaches with NO data folder. It is in the folderless bypass set in
// providers.tsx, so it renders off the NextAuth session in any browser, the data
// folder being an optional post-login attachment.

import PortalShell from "@/components/portal/PortalShell";
import AccountHome from "@/components/account/AccountHome";

export default function AccountRoute() {
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
