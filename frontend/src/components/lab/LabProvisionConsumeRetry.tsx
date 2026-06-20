"use client";

// Lab tier: background catch-up that COMPLETES a dropped provision consume
// (staged-pi-provisioning lane).
//
// LabProvisionResume runs the staged lab genesis on the PI's device, persists
// account_type + lab_id, publishes the relay genesis, then POSTs
// /api/directory/labs/provision/consume to bind the reserved slug, flip the
// listing visible, and mark the staging consumed. The genesis persists lab_id
// BEFORE that consume POST. So if the consume is dropped (a UI hang plus a page
// reload after lab_id lands but before consume completes), nothing re-invokes it.
// LabProvisionResume itself bails on the next boot because settings.lab_id is
// already set, so the staging would stay pending forever with no lab_sites row.
// The symptom is the lab-site dashboard showing the empty "claim your lab slug"
// state for a lab that already exists, and the per-subdomain cert never fires.
//
// This worker is the catch-up. On boot, when a lab_id is set, it asks the server
// once whether a staging is still pending for this PI (the pending lookup returns
// null the moment consume has marked it consumed). If one is still pending, the
// genesis ran but the consume was dropped, so it re-POSTs the idempotent consume
// until it succeeds, retrying on reconnect, on settings writes (the relay publish
// landing), and on a bounded interval. It NEVER re-runs the genesis; the lab
// already exists locally. The consume route is server-side idempotent (it verifies
// the directory_labs row ownership, binds the slug, flips listed, marks consumed),
// so a repeat call is safe and a 409 (already consumed) is treated as done.
//
// Silent by design: LabGenesisPublishRetry already shows the "lab sync pending"
// banner for the publish leg, so this finalize leg adds no second banner.
//
// Self-gates on LAB_TIER_ENABLED + a connected currentUser with a persisted
// lab_id. Mounted once globally in AppShell next to LabGenesisPublishRetry.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useRef } from "react";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";
import { appQueryClient } from "@/lib/query-client";

// How often to re-attempt the consume while it is still outstanding. Matches the
// publish-retry cadence so the two finalize legs settle on the same rhythm.
const RETRY_INTERVAL_MS = 15_000;

export default function LabProvisionConsumeRetry() {
  const { currentUser } = useFileSystem();
  // Stops all work for this session once the consume is confirmed complete (or
  // there was never a pending staging to finish). A fully provisioned lab head
  // checks once, sets this, and then goes inert.
  const done = useRef(false);
  // Ensures the pending lookup runs at most once per session. After it confirms a
  // staging is still pending we only re-POST the idempotent consume on retries,
  // never re-poll the lookup.
  const checked = useRef(false);
  // Guards against overlapping attempts (mount + online + settings-write can
  // fire close together).
  const inFlight = useRef(false);

  // One attempt: confirm a lab_id is persisted, then (once per session) confirm a
  // staging is still pending, then re-POST the idempotent consume. Leaves itself
  // retryable on any transient failure; marks done on success or when there is
  // nothing to finish.
  const attempt = useCallback(async (): Promise<void> => {
    if (!LAB_TIER_ENABLED || !currentUser) return;
    if (done.current || inFlight.current) return;
    inFlight.current = true;
    try {
      // The genesis persists lab_id before the consume POST. No lab_id means
      // either a brand-new PI (LabProvisionResume drives the first consume) or a
      // non-lab user; nothing for this catch-up worker to do yet.
      let labId: string | undefined;
      try {
        const settings = await readUserSettings(currentUser);
        labId = settings.lab_id;
      } catch {
        return; // settings unreadable; try again on the next tick.
      }
      if (!labId) return;

      // One server lookup per session: is a staging still pending for this PI?
      // The pending endpoint returns null once consume has marked it consumed, so
      // a fully provisioned lab head checks once here and then goes inert.
      if (!checked.current) {
        let stillPending = false;
        try {
          const res = await fetch("/api/directory/labs/provision/pending");
          if (!res.ok) return; // transient; re-check next tick (checked stays false).
          const data = (await res.json()) as { pending: unknown };
          stillPending = Boolean(data.pending);
        } catch {
          return; // network hiccup; re-check next tick.
        }
        checked.current = true;
        if (!stillPending) {
          // The consume already completed, or nothing was ever staged for this
          // PI. Nothing to finish.
          done.current = true;
          return;
        }
      }

      // A staging is still pending but lab_id is set, so the genesis ran and the
      // consume was dropped. Re-POST the idempotent consume. It binds the slug,
      // flips the listing visible, and marks the staging consumed. A 200 (consumed
      // now) or a 409 (already consumed) both mean we are finished.
      try {
        const res = await fetch("/api/directory/labs/provision/consume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labId }),
        });
        if (res.ok || res.status === 409) {
          done.current = true;
          appQueryClient.invalidateQueries();
        }
        // A 404 means the relay genesis publish has not landed yet (no
        // directory_labs row to bind). LabGenesisPublishRetry is retrying that
        // publish; this consume retries on the next online / settings-write /
        // interval and succeeds once the row exists. Other statuses also fall
        // through to retry.
      } catch {
        // Network fault; retry on the next tick.
      }
    } finally {
      inFlight.current = false;
    }
  }, [currentUser]);

  // Drive attempts on mount, on reconnect, on settings writes for this user (the
  // relay publish landing flips lab_pending_genesis), and on a bounded interval
  // while still outstanding. When the tier is off or no user is connected we wire
  // up nothing.
  useEffect(() => {
    if (!LAB_TIER_ENABLED || !currentUser) return;
    // Reset the per-session guards when the connected user changes so a different
    // PI is re-checked from scratch.
    done.current = false;
    checked.current = false;

    void attempt();

    const onOnline = () => void attempt();
    window.addEventListener("online", onOnline);

    const unsub = onUserSettingsWritten((event) => {
      if (event.username !== currentUser) return;
      void attempt();
    });

    const interval = window.setInterval(() => {
      void attempt();
    }, RETRY_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", onOnline);
      unsub();
      window.clearInterval(interval);
    };
  }, [currentUser, attempt]);

  return null;
}
