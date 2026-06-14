"use client";

// Global lab-create resume mount (account-setup revamp Phase B2).
//
// When the user picks "Lab -> Create a lab" in AccountTierChooser, we:
//   1. Store sessionStorage "researchos:lab-create" = "1".
//   2. Navigate to /?connect=1&signIn=<provider>, which drives the full
//      OAuth -> folder-connect -> user-create flow exactly like the Free path.
//   3. After setup completes, AppShell mounts. This component is mounted next to
//      SharingClaimResume in AppShell and self-gates on:
//        a. sessionStorage "researchos:lab-create" = "1"
//        b. A live OAuth session with an email (getSession().user.email)
//        c. A connected currentUser
//        d. An unlocked identity (getSessionIdentity())
//      When all conditions are met it calls createLabForCurrentUser, writes
//      account_type "lab_head" + lab_id to settings.json, clears the marker,
//      and lets the existing LabSessionMount engage. Idempotent: if the user
//      already has a lab_id, we skip creation and only ensure account_type is
//      set.
//
// ORCID has NO email (the openid scope never yields one), so a head who signed
// in with ORCID would otherwise stall here forever: createLabForCurrentUser
// hard-requires an OAuth-verified email to bind the head membership. When we
// detect an email-less ORCID session we mirror the Free path's recovery
// (SharingSetupWizard email-OTP) by opening the wizard on its "email-enter"
// step. The wizard proves an email via OTP, binds the existing identity to it
// in the directory, and records the orcid_id -> email link server-side; we then
// feed that verified email straight into createLabForCurrentUser.
//
// Mirrors the SharingClaimResume self-gating pattern.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useRef, useState } from "react";
import { getSession } from "next-auth/react";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { createLabLocal } from "@/lib/lab/lab-create";
import {
  publishPendingGenesis,
  readPendingGenesis,
} from "@/lib/lab/lab-genesis-pending";
import {
  patchUserSettings,
  readUserSettings,
} from "@/lib/settings/user-settings";
import { appQueryClient } from "@/lib/query-client";
import type { StoredIdentity } from "@/lib/sharing/identity/storage";
import SharingSetupWizard from "@/components/sharing/SharingSetupWizard";

const LAB_CREATE_MARKER = "researchos:lab-create";

/** Read (and optionally clear) the lab-create sessionStorage marker. */
function consumeLabCreateMarker(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = sessionStorage.getItem(LAB_CREATE_MARKER);
    if (v === "1") {
      sessionStorage.removeItem(LAB_CREATE_MARKER);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export default function LabCreateResume() {
  const { currentUser } = useFileSystem();
  // Track whether the marker was present at mount time. We read-and-clear
  // exactly once so a later reload (after creation) does not re-run the flow.
  const [markerPresent, setMarkerPresent] = useState(false);
  // Whether the creation flow is complete (success or skipped).
  const [done, setDone] = useState(false);
  // Bumped to re-run the effect when a prerequisite (unlocked identity / live
  // OAuth session) is not ready yet at the moment the effect first fires, so
  // creation self-heals without needing a manual page reload.
  const [retry, setRetry] = useState(0);
  // Set when an email-less ORCID session is detected: we open the email-OTP
  // wizard to prove an email before the lab can be created.
  const [needEmail, setNeedEmail] = useState(false);
  // Guards the create attempt so a re-render cannot double-create.
  const ran = useRef(false);

  // Read the marker once on mount (client only).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = sessionStorage.getItem(LAB_CREATE_MARKER);
      if (v === "1") setMarkerPresent(true);
    } catch {
      // sessionStorage unavailable
    }
  }, []);

  // The one place lab creation actually happens, shared by the normal
  // OAuth-email path and the ORCID email-OTP path. Persists the lab_id and
  // promotes the account_type, then clears the marker.
  const provisionLab = useCallback(
    async (identity: StoredIdentity, oauthEmail: string) => {
      if (!currentUser) return;

      // Idempotency: if the user already has a lab_id, do not create a second
      // lab. Just ensure account_type reflects lab_head and finish. If a prior
      // genesis publish never landed (lab_pending_genesis is still set), kick
      // off a best-effort background publish so the relay catches up.
      const current = await readUserSettings(currentUser);
      if (current.lab_id) {
        if (current.account_type !== "lab_head") {
          await patchUserSettings(currentUser, { account_type: "lab_head" });
          appQueryClient.invalidateQueries();
        }
        const pending = await readPendingGenesis(currentUser);
        if (pending) {
          void publishPendingGenesis(currentUser, pending);
        }
        consumeLabCreateMarker();
        ran.current = true;
        setDone(true);
        console.log("[LabCreateResume] user already has lab_id, skipping create");
        return;
      }

      // Mark ran before the async call so a concurrent effect-re-fire does not
      // double-create.
      ran.current = true;

      // Build the lab LOCALLY and promote the user to lab_head IMMEDIATELY,
      // before any relay round-trip. Being a PI is a local account-type
      // property, so the PI UI lens must render whether or not the relay is
      // reachable. createLabLocal is pure (it only throws on a missing OAuth
      // email, which we have already validated upstream), so this cannot leave
      // the user un-promoted on a network failure.
      const { labId, created } = createLabLocal({
        username: currentUser,
        identity,
        oauthEmail,
      });

      // Persist lab_id + account_type AND the genesis artifacts in one write.
      // The persisted record + envelope let LabGenesisPublishRetry retry the
      // publish across reloads, and let openLabKey re-derive the lab key offline
      // so the head is never locked out.
      await patchUserSettings(currentUser, {
        account_type: "lab_head",
        lab_id: labId,
        lab_pending_genesis: {
          labId,
          record: created.record,
          envelope: created.envelope,
        },
      });

      // Invalidate queries so LabSessionMount re-reads settings and engages.
      appQueryClient.invalidateQueries();

      console.log("[LabCreateResume] lab created locally:", labId);

      // Fire-and-forget the relay publish. A failure here does NOT un-promote
      // the user: LabGenesisPublishRetry + a reload retry from the persisted
      // pending genesis handle the eventual publish.
      void publishPendingGenesis(currentUser, {
        labId,
        record: created.record,
        envelope: created.envelope,
      });

      consumeLabCreateMarker();
      setNeedEmail(false);
      setDone(true);
    },
    [currentUser],
  );

  useEffect(() => {
    if (!LAB_TIER_ENABLED) return;
    if (!markerPresent) return;
    if (done) return;
    if (!currentUser) return;
    if (needEmail) return; // waiting on the email-OTP wizard
    if (ran.current) return;

    // Bounded retry: the identity unlock and the OAuth session can land a
    // moment after currentUser is set. Rather than bail forever (the deps would
    // not change again), re-check a few times before giving up. A reload still
    // retries via the marker as the final fallback.
    const MAX_RETRIES = 20; // ~10s at 500ms

    void (async () => {
      // Check identity + session are ready before attempting creation.
      const identity = getSessionIdentity();
      const session = await getSession();
      const oauthEmail = session?.user?.email ?? "";

      if (!identity) {
        if (retry < MAX_RETRIES) {
          window.setTimeout(() => setRetry((r) => r + 1), 500);
        } else {
          console.warn(
            "[LabCreateResume] identity not ready after retries; will retry on next load",
          );
        }
        return;
      }

      // ORCID returns no email. If the session is ORCID-linked but carries no
      // email, route through the email-OTP wizard to prove one rather than
      // retrying forever against an email that will never arrive.
      if (!oauthEmail) {
        if (session?.orcidId) {
          setNeedEmail(true);
          return;
        }
        // No email and no ORCID: the session is still settling, keep retrying.
        if (retry < MAX_RETRIES) {
          window.setTimeout(() => setRetry((r) => r + 1), 500);
        } else {
          console.warn(
            "[LabCreateResume] session email not ready after retries; will retry on next load",
          );
        }
        return;
      }

      await provisionLab(identity, oauthEmail);
    })();
  }, [markerPresent, currentUser, done, retry, needEmail, provisionLab]);

  // The email-OTP wizard completed with a verified email. Feed it straight into
  // lab creation, binding the head membership to the ORCID-proven email.
  const handleEmailVerified = useCallback(
    (result: { fingerprint: string; email?: string }) => {
      const identity = getSessionIdentity();
      if (!identity || !result.email) {
        // Without an unlocked identity or a verified email we cannot create the
        // lab. Leave the wizard closed; a reload re-runs the resume flow.
        setNeedEmail(false);
        return;
      }
      void provisionLab(identity, result.email);
    },
    [provisionLab],
  );

  // Closing the wizard without proving an email leaves the marker in place, so
  // the user can try again (a reload re-opens it). We just drop out of the
  // waiting state so the headless effect does not spin.
  const handleWizardClose = useCallback(() => {
    setNeedEmail(false);
    consumeLabCreateMarker();
  }, []);

  if (needEmail && currentUser) {
    return (
      <SharingSetupWizard
        username={currentUser}
        initialStep="email-enter"
        onComplete={handleEmailVerified}
        onClose={handleWizardClose}
      />
    );
  }

  // Otherwise headless; it never renders anything visible.
  return null;
}
