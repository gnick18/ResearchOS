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
//   3. If a pending staging exists, OFFERS a one-tap confirm card ("Your lab is
//      ready, set it up"). The lab is never created silently; the PI taps once so
//      a lab does not just appear without them initiating it.
//   4. On tap, runs the REAL lab genesis ON DEVICE via createLabLocal (signed by
//      the PI ed25519 key, lab key sealed to their x25519 key; the server never
//      sees private keys), inheriting the staged branding.
//   5. Persists account_type "lab_head" + lab_id + the pending-genesis exactly
//      like LabCreateResume, so a partial relay publish is retryable across boots.
//   6. POSTs /api/directory/labs/provision/consume with the labId, which binds the
//      reserved slug to the real lab, flips the listing visible, and marks the
//      staging consumed.
//
// This collapses PI onboarding to a single sign-in plus one tap while keeping the
// E2E model intact. A pure server-side "convert account to lab" is impossible (it
// would produce a listed-but-dead lab with no openable team key), which is why the
// genesis runs here on the client.
//
// Mirrors the LabCreateResume self-gating + persistence pattern. The trigger here
// is the server lookup (no sessionStorage marker). Best-effort: on any error the
// staging stays pending server-side and the offer returns on the next boot. A
// "Maybe later" escape means the card is never a soft-lock, the offer simply
// re-appears next sign-in. Once-per-session detection guard prevents re-polling.
//
// Defensive no-ops: does nothing if the user already has a lab, if the identity
// is locked, or if there is no OAuth email (e.g. an ORCID-only session, which
// yields no email and so cannot anchor the head membership).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useRef, useState } from "react";
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
import LivingPopup from "@/components/ui/LivingPopup";
import BeakerBot from "@/components/BeakerBot";

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
  // Once-per-session detection guard: flips after the pending lookup so a
  // re-render or a settings invalidation cannot re-poll or re-offer.
  const detected = useRef(false);
  // Bumped to re-check when a prerequisite (unlocked identity / live session)
  // lands a moment after currentUser is set, so the offer self-heals without a
  // manual reload, mirroring LabCreateResume.
  const [retry, setRetry] = useState(0);
  // The detected staged lab. Non-null renders the one-tap confirm card.
  const [pending, setPending] = useState<PendingStaging | null>(null);
  const [phase, setPhase] = useState<"idle" | "busy" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // DETECTION: prerequisites + the server lookup. This never provisions; it only
  // decides whether to OFFER the card. The genesis runs on the PI's tap below.
  useEffect(() => {
    if (!LAB_TIER_ENABLED) return;
    if (!currentUser) return;
    if (detected.current) return;

    const MAX_RETRIES = 20; // ~10s at 500ms, matching LabCreateResume.

    void (async () => {
      // Defensive: never offer a second lab. If the user already has one, do
      // nothing (the operator staging is for first-time PIs only).
      let settings;
      try {
        settings = await readUserSettings(currentUser);
      } catch {
        return; // settings unreadable; retry on next boot.
      }
      if (settings.lab_id) {
        detected.current = true;
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
          detected.current = true;
          return;
        }
        if (retry < MAX_RETRIES) {
          window.setTimeout(() => setRetry((r) => r + 1), 500);
        }
        return;
      }

      // Ask the server whether a pending staging exists for THIS session's email.
      // The hash is derived server-side, so the response is scoped to this user.
      let found: PendingStaging | null = null;
      try {
        const res = await fetch("/api/directory/labs/provision/pending");
        if (res.ok) {
          const data = (await res.json()) as { pending: PendingStaging | null };
          found = data.pending ?? null;
        }
      } catch {
        // Network hiccup; retry on next boot.
        return;
      }

      // Detected (whether or not a staging exists). Do not poll again this
      // session; a fresh staging is picked up on the next sign-in.
      detected.current = true;
      if (found) setPending(found);
    })();
  }, [currentUser, retry]);

  // The PI tapped "Set up my lab". Run the real genesis ON DEVICE, persist like
  // LabCreateResume, publish, then finalize the staging. All the crypto is local;
  // the server only wires the staged public metadata to the lab the client made.
  const runProvision = useCallback(async () => {
    if (!currentUser || !pending) return;
    setPhase("busy");
    setErrorMsg("");

    const identity = getSessionIdentity();
    const session = await getSession();
    const oauthEmail = session?.user?.email ?? "";
    if (!identity || !oauthEmail) {
      setPhase("error");
      setErrorMsg("Your identity is locked. Reload the page and try again.");
      return;
    }

    // Build the REAL genesis ON DEVICE, inheriting the staged branding. This signs
    // the genesis with the PI ed25519 key and seals the lab key to their x25519
    // key locally; the server never sees the private keys. createLabLocal is pure
    // (it only throws on a missing OAuth email, validated above), so a network
    // fault cannot leave the user half-provisioned.
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
      setPhase("error");
      setErrorMsg("Could not set up your lab. Reload the page and try again.");
      console.warn(
        "[LabProvisionResume] lab genesis failed; staging stays pending:",
        err instanceof Error ? err.message : err,
      );
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

    // Publish the relay genesis + directory row from the persisted pending
    // genesis. The consume route checks the directory_labs row (written by this
    // publish), so we AWAIT the publish before calling consume to avoid a race
    // where consume 404s on a not-yet-written row. publishPendingGenesis clears
    // the pending genesis only when relay AND directory both land.
    let published = false;
    try {
      published = await publishPendingGenesis(currentUser, pendingGenesis);
    } catch {
      published = false;
    }
    if (!published) {
      // The directory row did not land, so consume would 404. The PI is already a
      // fully provisioned lab head locally; LabGenesisPublishRetry + a reload
      // retry the publish, and the staging stays pending so consume re-runs next
      // boot. Dismiss the card; the app re-renders as a lab head.
      setPending(null);
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

    // Success: dismiss the card. The settings invalidation re-renders the app as a
    // lab head.
    setPending(null);
  }, [currentUser, pending]);

  // Dismiss without provisioning. Never a soft-lock: the staging stays pending and
  // the offer returns on the next sign-in.
  const dismiss = useCallback(() => {
    if (phase === "busy") return;
    setPending(null);
  }, [phase]);

  if (!pending) return null;

  return (
    <LivingPopup
      open
      onClose={dismiss}
      label="Your lab is ready"
      widthClassName="max-w-md"
      card
      padded
    >
      <div className="flex flex-col items-center text-center">
        <BeakerBot
          pose="cheering"
          animated
          className="h-16 w-16 shrink-0 text-sky-500"
          ariaLabel="BeakerBot, the ResearchOS assistant"
        />
        <h2 className="mt-3 text-heading font-semibold text-foreground">
          Your lab is ready to set up
        </h2>
        <p className="mt-2 text-meta leading-relaxed text-foreground-muted">
          {pending.labName ? `${pending.labName} has been` : "Your lab has been"}{" "}
          prepared for you. Setting it up creates your lab on this device so you
          can invite members and start working.
        </p>
        {phase === "error" && (
          <p className="mt-3 text-meta text-rose-600">{errorMsg}</p>
        )}
        <button
          type="button"
          className="btn-brand mt-5 w-full"
          disabled={phase === "busy"}
          onClick={() => {
            void runProvision();
          }}
        >
          {phase === "busy" ? "Setting up your lab..." : "Set up my lab"}
        </button>
        <button
          type="button"
          className="mt-2 text-meta text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50"
          disabled={phase === "busy"}
          onClick={dismiss}
        >
          Maybe later
        </button>
      </div>
    </LivingPopup>
  );
}
