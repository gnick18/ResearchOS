"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import WhatsNewModal from "./WhatsNewModal";
import { useOptionalTourController } from "@/components/onboarding/v4/TourController";
import { useLastSeenAnnouncementVersion } from "@/hooks/useLastSeenAnnouncementVersion";
import { isDemoOrWikiCapture } from "@/lib/file-system/wiki-capture-mock";
import { patchUserSettings } from "@/lib/settings/user-settings";
import {
  computeAnnouncementsToShow,
  latestReleaseVersion,
  type ReleaseNote,
} from "@/lib/release-notes";

/**
 * <WhatsNewManager /> (whats-new bot)
 *
 * Owns the trigger + suppression logic for the developer-announcement /
 * "What's New" popup. Mounted as a peer of CelebrationManager inside the
 * TourControllerProvider tree (providers.tsx), so it only ever runs for a
 * logged-in, connected user (the folder picker and pre-login surfaces are
 * structurally above this mount) and `useOptionalTourController` resolves
 * to the live controller.
 *
 * Trigger / suppression rules:
 *   - Gated on a real signed-in user (`username` present). When null, the
 *     manager renders nothing and does nothing.
 *   - SUPPRESSED while the v4 onboarding tour is active (the popup must
 *     never fight the tour's BeakerBot), gated on
 *     `tourController?.tourMode == null` like the other corner surfaces.
 *   - SUPPRESSED in demo / wiki-capture fixture mode (screenshots must
 *     never catch a stray popup).
 *   - Waits for the per-account last-seen read to resolve (`loading`) so a
 *     slow disk read never flash-fires.
 *
 * Catch-up + per-account tracking:
 *   - `lastSeen == null` (brand-new account, or a pre-feature account on
 *     its first load): SILENTLY record the current APP_VERSION as
 *     last-seen and do NOT show the popup. Only a genuine future upgrade
 *     then triggers it.
 *   - `lastSeen` present: compute `missed` = every release newer than
 *     last-seen (capped at APP_VERSION). If 0, show nothing. Otherwise
 *     open the modal on the LATEST release, with a "View all N updates"
 *     expander when more than one was missed.
 *   - Dismiss records last-seen = the latest release version regardless of
 *     how many were caught up, via `patchUserSettings` (per-account).
 *
 * One open at a time, one record per mount: a `recordedOrShown` lock
 * prevents the seed effect from re-firing after the initial decision for a
 * given username.
 */

interface Props {
  username: string | null;
}

type Phase =
  /** Haven't decided yet (read in flight, suppressed, or no user). */
  | { kind: "idle" }
  /** The catch-up modal is open with these missed releases (newest first). */
  | { kind: "showing"; missed: ReleaseNote[] };

export default function WhatsNewManager({ username }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // One decision per username per mount. Flips true the moment we either
  // open the modal OR silently record a first-load version, so the seed
  // effect can't double-fire (StrictMode, re-renders). Reset on username
  // change via the effect's own guard below.
  const [decidedFor, setDecidedFor] = useState<string | null>(null);

  const tour = useOptionalTourController();
  const tourActive = tour !== null && tour.tourMode !== null;
  const captureMode = isDemoOrWikiCapture();

  const seen = useLastSeenAnnouncementVersion(username);

  // ------- Seed: decide whether to show, record, or stay quiet --------
  useEffect(() => {
    if (!username) return;
    if (tourActive) return;
    if (captureMode) return;
    if (seen.status !== "ready") return;
    // Already decided for this username on this mount; don't re-run.
    if (decidedFor === username) return;

    // Brand-new / pre-feature account: silently record the current version
    // and stay quiet, so only a genuine upgrade ever triggers the popup.
    if (seen.lastSeen == null) {
      setDecidedFor(username);
      const latest = latestReleaseVersion();
      if (latest) {
        void patchUserSettings(username, {
          lastSeenAnnouncementVersion: latest,
        }).catch((err) => {
          console.warn(
            "[WhatsNewManager] failed to record first-load version",
            err,
          );
        });
      }
      return;
    }

    // Returning account: compute the catch-up set.
    const missed = computeAnnouncementsToShow({ lastSeen: seen.lastSeen });
    setDecidedFor(username);
    if (missed.length === 0) return;
    setPhase({ kind: "showing", missed });
  }, [username, tourActive, captureMode, seen, decidedFor]);

  // Reset the per-mount decision lock when the active user changes, so a
  // user switch re-evaluates the new account's catch-up state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- username-change reset, mirrors useBeakerBotAnimations/useAccountType reset pattern.
    setDecidedFor((prev) => (prev === username ? prev : null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close any open modal belonging to the previous user.
    setPhase({ kind: "idle" });
  }, [username]);

  // ------- Dismiss: record last-seen = latest, close the modal --------
  const handleDismiss = useCallback(() => {
    setPhase({ kind: "idle" });
    if (!username) return;
    const latest = latestReleaseVersion();
    if (!latest) return;
    void patchUserSettings(username, {
      lastSeenAnnouncementVersion: latest,
    }).catch((err) => {
      console.warn(
        "[WhatsNewManager] failed to record dismissed version",
        err,
      );
    });
  }, [username]);

  // ------- Start account: record-seen, THEN kick off the OAuth claim ----
  // The v0.5 accounts popup's "Sign in to share" buttons land here. We record
  // the announcement as seen BEFORE redirecting (awaited, so the write lands
  // first) so the popup does not pop again on the return trip, then start the
  // claim flow with ?sharingClaim=1 so the global SharingClaimResume mount
  // finishes real account creation when the user comes back.
  const handleStartAccount = useCallback(
    async (provider: "google" | "github" | "linkedin") => {
      setPhase({ kind: "idle" });
      if (username) {
        const latest = latestReleaseVersion();
        if (latest) {
          try {
            await patchUserSettings(username, {
              lastSeenAnnouncementVersion: latest,
            });
          } catch (err) {
            console.warn(
              "[WhatsNewManager] failed to record version before sign-in",
              err,
            );
          }
        }
      }
      void signIn(provider, { callbackUrl: "/?sharingClaim=1" });
    },
    [username],
  );

  if (!username) return null;
  if (phase.kind !== "showing") return null;

  return (
    <WhatsNewModal
      releases={phase.missed}
      onDismiss={handleDismiss}
      onStartAccount={handleStartAccount}
    />
  );
}
