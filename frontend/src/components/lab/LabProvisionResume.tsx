"use client";

// Global staged-PI-provisioning resume mount (staged-pi-provisioning lane).
//
// An operator can STAGE a lab for a PI before that PI ever signs in (name,
// institution, slug, comp tier + months, bound to the PI peppered email hash via
// /api/admin/lab-provision/stage). When the PI signs in the FIRST time, this
// component:
//   1. Confirms the user has no lab yet, an unlocked identity, and an OAuth email.
//   2. GETs /api/directory/labs/provision/pending. The server hashes the SESSION
//      email and returns the staging only for that hash (a user can never see
//      another user's staging).
//   3. If a pending staging exists, runs the REAL lab genesis ON DEVICE via
//      createLabForCurrentUser (signed by the PI ed25519 key, lab key sealed to
//      their x25519 key; the server never sees private keys), inheriting the
//      staged branding.
//   4. Persists account_type "lab_head" + lab_id + the pending-genesis exactly
//      like LabCreateResume, so a partial relay publish is retryable across boots.
//   5. POSTs /api/directory/labs/provision/consume with the labId, which binds the
//      reserved slug to the real lab, flips the listing visible, and marks the
//      staging consumed.
//
// This collapses PI onboarding to a single sign-in while keeping the E2E model
// intact. A pure server-side "convert account to lab" is impossible (it would
// produce a listed-but-dead lab with no openable team key), which is why the
// genesis runs here on the client.
//
// Mirrors the LabCreateResume self-gating + persistence pattern. The trigger here
// is the server lookup (no sessionStorage marker). Headless and best-effort: on
// any error it does nothing and retries on the next boot (the staging stays
// pending until consume lands). Once-per-session guard prevents double-create.
//
// Defensive no-ops: does nothing if the user already has a lab, if the identity
// is locked, or if there is no OAuth email (e.g. an ORCID-only session, which
// yields no email and so cannot anchor the head membership).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";
import { getSession } from "next-auth/react";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { createLabLocal } from "@/lib/lab/lab-create";
import { publishPendingGenesis } from "@/lib/lab/lab-genesis-pending";
import {
  patchUserSettings,
  readUserSettings,
} from "@/lib/settings/user-settings";
import { appQueryClient } from "@/lib/query-client";

/** The cosmetic branding the pending endpoint returns for the genesis. */
interface PendingStaging {
  labName: string;
  institution: string | null;
  slug: string;
  piTitle: string | null;
  piDisplay: string | null;
}

export default function LabProvisionResume() {
  const { currentUser } = useFileSystem();
  // Once-per-session guard: a successful (or attempted) provision flips this so a
  // re-render or a settings invalidation cannot double-create.
  const ran = useRef(false);
  // Bumped to re-check when a prerequisite (unlocked identity / live session)
  // lands a moment after currentUser is set, so provisioning self-heals without a
  // manual reload, mirroring LabCreateResume.
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!LAB_TIER_ENABLED) return;
    if (!currentUser) return;
    if (ran.current) return;

    const MAX_RETRIES = 20; // ~10s at 500ms, matching LabCreateResume.

    void (async () => {
      // Defensive: never provision a second lab. If the user already has one, do
      // nothing (the operator staging is for first-time PIs only).
      let settings;
      try {
        settings = await readUserSettings(currentUser);
      } catch {
        return; // settings unreadable; retry on next boot.
      }
      if (settings.lab_id) {
        ran.current = true;
        return;
      }

      // Identity must be unlocked to sign the genesis. The session must carry an
      // OAuth email to anchor the head membership. An ORCID-only session has no
      // email, so we simply do nothing (the staged lab waits for a future sign-in
      // that carries an email); we do not retry forever against an email that will
      // never arrive.
      const identity = getSessionIdentity();
      const session = await getSession();
      const oauthEmail = session?.user?.email ?? "";

      if (!identity || !oauthEmail) {
        // ORCID-only (no email, has orcidId): give up quietly for this session.
        if (!oauthEmail && session?.orcidId) {
          ran.current = true;
          return;
        }
        if (retry < MAX_RETRIES) {
          window.setTimeout(() => setRetry((r) => r + 1), 500);
        }
        return;
      }

      // Ask the server whether a pending staging exists for THIS session's email.
      // The hash is derived server-side, so the response is scoped to this user.
      let pending: PendingStaging | null = null;
      try {
        const res = await fetch("/api/directory/labs/provision/pending");
        if (res.ok) {
          const data = (await res.json()) as { pending: PendingStaging | null };
          pending = data.pending ?? null;
        }
      } catch {
        // Network hiccup; retry on next boot.
        return;
      }
      if (!pending) {
        // No staged lab for this user. Mark ran so we do not poll again this
        // session (a fresh staging would be picked up on the next sign-in).
        ran.current = true;
        return;
      }

      // Commit: from here we provision exactly once.
      ran.current = true;

      // Build the REAL genesis ON DEVICE, inheriting the staged branding. This
      // signs the genesis with the PI ed25519 key and seals the lab key to their
      // x25519 key locally; the server never sees the private keys. createLabLocal
      // is pure (it only throws on a missing OAuth email, which we validated
      // above), so this cannot leave the user half-provisioned on a network fault.
      let labId: string;
      let created: ReturnType<typeof createLabLocal>["created"];
      try {
        const local = createLabLocal({
          username: currentUser,
          identity,
          oauthEmail,
        });
        labId = local.labId;
        created = local.created;
      } catch (err) {
        // Genesis build failed locally (no email, or a crypto fault). The staging
        // stays pending server-side, so the next boot retries from a clean state.
        console.warn(
          "[LabProvisionResume] lab genesis failed; staging stays pending for next boot:",
          err instanceof Error ? err.message : err,
        );
        ran.current = false;
        return;
      }

      // Carry the staged cosmetic branding into the relay create body via the
      // pending genesis. It is NOT in the signed log. Mirrors LabCreateResume.
      const brandingMeta =
        pending.labName || pending.piTitle || pending.piDisplay
          ? {
              labName: pending.labName || undefined,
              piTitle: pending.piTitle || undefined,
              piDisplay: pending.piDisplay || undefined,
            }
          : undefined;
      const pendingGenesis = {
        labId,
        record: created.record,
        envelope: created.envelope,
        ...(brandingMeta ? { branding: brandingMeta } : {}),
      };

      // Persist lab_id + account_type AND the genesis artifacts in one write, the
      // SAME persistence as LabCreateResume. The persisted record + envelope let
      // LabGenesisPublishRetry retry the relay publish across reloads, and let
      // openLabKey re-derive the lab key offline, so the head is never locked out.
      try {
        await patchUserSettings(currentUser, {
          account_type: "lab_head",
          lab_id: labId,
          lab_pending_genesis: pendingGenesis,
        });
        appQueryClient.invalidateQueries();
      } catch {
        // The lab exists locally; a failed settings write self-heals on the next
        // boot via the lab_id idempotency check. Do not block the consume.
      }

      console.log("[LabProvisionResume] staged lab provisioned locally:", labId);

      // Publish the relay genesis + directory row from the persisted pending
      // genesis. The consume route checks the directory_labs row (written by this
      // publish), so we AWAIT the publish before calling consume to avoid a race
      // where consume 404s on a not-yet-written row. A publish failure does NOT
      // un-provision the head; LabGenesisPublishRetry + a reload retry handle the
      // eventual publish, and the staging stays pending so consume re-runs next
      // boot. publishPendingGenesis clears the pending genesis only when relay AND
      // directory both land.
      let published = false;
      try {
        published = await publishPendingGenesis(currentUser, pendingGenesis);
      } catch {
        published = false;
      }
      if (!published) {
        // The directory row did not land, so consume would 404. Leave the staging
        // pending; the next boot retries the publish then the consume. The head is
        // already a fully provisioned lab head locally.
        return;
      }

      // Finalize server-side: bind the reserved slug to the real lab, flip the
      // listing visible, and mark the staging consumed. Best-effort; a failure
      // leaves the staging pending and the next boot retries the idempotent consume.
      try {
        await fetch("/api/directory/labs/provision/consume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labId }),
        });
      } catch {
        // The lab is already provisioned locally; the consume is idempotent and
        // re-runs next boot.
      }
    })();
  }, [currentUser, retry]);

  // Headless: the provisioning is a background, best-effort flow. The lab head
  // lands straight in the app; no blocking UI is needed.
  return null;
}
