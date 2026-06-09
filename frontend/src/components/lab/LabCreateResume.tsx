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
// Mirrors the SharingClaimResume self-gating pattern.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";
import { getSession } from "next-auth/react";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { createLabForCurrentUser } from "@/lib/lab/lab-create";
import {
  patchUserSettings,
  readUserSettings,
} from "@/lib/settings/user-settings";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import { appQueryClient } from "@/lib/query-client";

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
  // Human-readable status for dev visibility (not shown in UI).
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

  useEffect(() => {
    if (!LAB_TIER_ENABLED) return;
    if (!markerPresent) return;
    if (done) return;
    if (!currentUser) return;
    if (ran.current) return;

    void (async () => {
      // Check identity + session are ready before attempting creation.
      const identity = getSessionIdentity();
      if (!identity) return;

      const session = await getSession();
      const oauthEmail = session?.user?.email ?? "";
      if (!oauthEmail) return;

      // Idempotency: if the user already has a lab_id, do not create a second
      // lab. Just ensure account_type reflects lab_head and finish.
      const current = await readUserSettings(currentUser);
      if (current.lab_id) {
        if (current.account_type !== "lab_head") {
          await patchUserSettings(currentUser, { account_type: "lab_head" });
          appQueryClient.invalidateQueries();
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

      try {
        const { labId } = await createLabForCurrentUser({
          username: currentUser,
          identity,
          oauthEmail,
        });

        // Persist the lab_id and promote the account_type.
        await patchUserSettings(currentUser, {
          account_type: "lab_head",
          lab_id: labId,
        });

        // Invalidate queries so LabSessionMount re-reads settings and engages.
        appQueryClient.invalidateQueries();

        console.log("[LabCreateResume] lab created:", labId);
      } catch (err) {
        console.error("[LabCreateResume] lab creation failed:", err);
        // On failure, clear ran so the user can retry after resolving the
        // issue (e.g. network unavailable). We do NOT clear the marker so the
        // next page load retries.
        ran.current = false;
        return;
      }

      consumeLabCreateMarker();
      setDone(true);
    })();
  }, [markerPresent, currentUser, done]);

  // This component is headless; it never renders anything visible.
  return null;
}
