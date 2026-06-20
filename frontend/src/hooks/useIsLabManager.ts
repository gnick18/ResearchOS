"use client";

import { useEffect, useState } from "react";
import {
  onUserSettingsWritten,
  readUserSettings,
} from "@/lib/settings/user-settings";
import { useIsLabHead } from "./useIsLabHead";

/**
 * Lab Manager delegation (Phase 1, docs/proposals/2026-06-20-lab-admin-delegation-
 * and-co-pi.md). The canonical "is the active user a Lab Manager" hook.
 *
 * A Lab Manager is a member the head delegated APP-LEVEL operational powers to
 * (approve purchases, view audit / ops, manage companion-site content, propose
 * member changes for the head to ratify). It is NOT a second cryptographic signer
 * and NOT a lab_head: a manager stays account_type "member" with an additive
 * `lab_manager` capability flag, materialized from the head-signed roster's `admin`
 * field by materializeLabRoster.
 *
 * Mirrors useAccountType's read + live-subscription shape so a promote/demote that
 * re-materializes settings.json propagates without a route change. Returns:
 *   - `undefined` while the settings read is in flight (suppress manager chrome to
 *     avoid flicker), matching useAccountType's loading state.
 *   - `false` when signed out or a plain member / head.
 *   - `true` once the read resolves to a member with lab_manager true.
 */
export function useIsLabManager(
  username: string | null,
): boolean | undefined {
  const [isManager, setIsManager] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!username) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sign-out transition: previous user's capability must clear immediately, no I/O, so the synchronous setState is correct here.
      setIsManager(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await readUserSettings(username);
        if (!cancelled) setIsManager(settings.lab_manager === true);
      } catch (err) {
        // Never elevate on a failed read: default to not-a-manager (the safe
        // posture, same as useAccountType defaults to member).
        console.warn("[useIsLabManager] readUserSettings failed", err);
        if (!cancelled) setIsManager(false);
      }
    })();

    const unsubscribe = onUserSettingsWritten((event) => {
      if (cancelled) return;
      if (event.username !== username) return;
      setIsManager(event.next.lab_manager === true);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [username]);

  return isManager;
}

/**
 * The delegated-powers gate: true when the active user is EITHER the lab head OR a
 * Lab Manager. PI surfaces that are safe to delegate (purchase approval, audit /
 * ops views, companion-site content) switch their check from `useIsLabHead(u)` to
 * `useHasPiPowers(u)`. Surfaces that must stay head-only (signing roster changes,
 * key rotation, billing) keep `useIsLabHead`.
 *
 * Returns `undefined` while EITHER underlying read is in flight so callers can
 * suppress the chrome until both settle, then the OR of the two booleans.
 */
export function useHasPiPowers(
  username: string | null,
): boolean | undefined {
  const isHead = useIsLabHead(username);
  const isManager = useIsLabManager(username);
  if (isHead === undefined || isManager === undefined) return undefined;
  return isHead || isManager;
}
