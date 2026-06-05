"use client";

// Global OAuth-claim resume mount (account-creation-flow bot).
//
// The v0.5 What's New popup and the welcome-page sign-in cards start account
// creation by calling signIn(provider, { callbackUrl: "/?sharingClaim=1" }).
// signIn() only establishes an OAuth session; it does NOT create the user's
// sharing identity (keypair, directory entry, recovery kit). The real account
// is created by SharingSetupWizard.
//
// This component closes that gap. It is mounted once, globally, in AppShell so
// it is present on every signed-in surface (including the home route the OAuth
// flow returns to). When it sees ?sharingClaim in the URL and a connected
// folder-local user, it mounts the wizard. The wizard's OWN resume effect
// (gated on the same ?sharingClaim flag) reads the verified email from the
// session, jumps straight to the generate step, publishes the keys, offers the
// recovery kit, and strips the ?sharingClaim param on success. No in-memory
// state survives the redirect, so a freshly mounted wizard auto-completes the
// claim.

import { useEffect, useState } from "react";

import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useSharingIdentity } from "@/hooks/useSharingIdentity";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";

export default function SharingClaimResume() {
  const { currentUser } = useFileSystem();
  const { refresh } = useSharingIdentity();

  // Two URL flags both open this global wizard, read client-side via an effect
  // so SSR and the first client render agree (no hydration mismatch):
  //   ?sharingClaim=1  the OAuth-return resume (the wizard's own effect reads
  //                    the session email and jumps to the generate step).
  //   ?sharingEmail=1  the email-OTP path, opened straight on the email step.
  //                    Used by the welcome-page "verify with email" link so the
  //                    wizard lives here (a durable global surface) rather than
  //                    inside the folder-setup screen, which unmounts the moment
  //                    an existing account is selected.
  const [claimPresent, setClaimPresent] = useState(false);
  const [emailPresent, setEmailPresent] = useState(false);
  // Local open-state so onClose / onComplete can unmount the wizard even while
  // the URL param is still being stripped.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const claim = url.searchParams.has("sharingClaim");
    const email = url.searchParams.has("sharingEmail");
    setClaimPresent(claim);
    setEmailPresent(email);
    if (claim || email) setOpen(true);
    // Strip the email flag immediately so a manual refresh does not re-open the
    // wizard. The claim flag is stripped by the wizard's own success path.
    if (email) {
      url.searchParams.delete("sharingEmail");
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      );
    }
  }, []);

  // Never fire during screenshots / demo recordings. The wizard would publish
  // real keys and overlay a modal on top of fixture captures otherwise.
  if (isDemoOrWikiCapture()) return null;
  if ((!claimPresent && !emailPresent) || !open) return null;
  // The wizard claims the identity for the connected folder-local user, so we
  // need one before we can mount. If a flag is present but no folder is
  // connected yet, we wait (this re-renders as currentUser resolves).
  if (!currentUser) return null;

  const close = () => setOpen(false);

  return (
    <SharingSetupWizard
      username={currentUser}
      // The claim path lets the wizard's resume effect drive (choose, then
      // generate). The email path opens straight on email entry.
      initialStep={!claimPresent && emailPresent ? "email-enter" : "choose"}
      onComplete={() => {
        // Re-read the identity so any badge / status surface picks up the
        // freshly published keys, then unmount.
        void refresh();
        close();
      }}
      onClose={close}
    />
  );
}
