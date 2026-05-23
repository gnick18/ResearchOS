import { useEffect, useState } from "react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import { discoverUsers } from "@/lib/file-system/user-discovery";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { initialFeaturePicks } from "./feature-picks-init";
import RadioCard from "./RadioCard";
import type { SetupStepProps } from "./types";

/**
 * Q1: solo or lab? Single-select radio. Writes
 * `feature_picks.account_type` on pick. Q1 is the first step that
 * persists a pick, so it constructs the initial FeaturePicks object via
 * {@link initialFeaturePicks} when the sidecar's feature_picks is still
 * null. Subsequent Q steps spread + override on the existing object.
 *
 * v4 port: same shape + persistence contract as v3's Q1, mounted under
 * the v4 TourController's modal-setup surface (L9).
 *
 * setup-q1c lab head manager 2026-05-23: on mount, the step probes the
 * folder for other (live, non-pseudo) users. When one or more are found,
 * we auto-fill the radio with "Lab" and surface a small inline banner
 * explaining the pre-selection so the user isn't surprised. We do NOT
 * programmatically click Next — Grant's "no surprise state changes" UX
 * rule. The user still sees the question, sees the pre-fill, and clicks
 * Next themselves; the step-machine then advances to setup-q1c which
 * asks if they're the lab head. Falling back to manual pick is one
 * click away if the auto-detect is wrong (the radio is fully editable).
 */
export default function Q1AccountTypeStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: SetupStepProps) {
  const picks = sidecar?.feature_picks ?? null;
  const current = picks?.account_type ?? null;
  const { currentUser } = useCurrentUser();
  const [autoDetected, setAutoDetected] = useState(false);

  useEffect(() => {
    setNextDisabled(current === null);
  }, [current, setNextDisabled]);

  // setup-q1c lab head manager 2026-05-23 — auto-detect "shared folder"
  // case. When other live users exist in the folder, this account is
  // joining an existing lab; the question is rhetorical. Pre-fill "Lab"
  // and show a banner explaining the pre-selection.
  //
  // Filter contract:
  //   - `discoverUsers()` already strips the `lab` pseudo-user, the
  //     `_no_user_` directory, the public bucket, and any users with a
  //     `deleted_at` tombstone (see lib/file-system/user-discovery.ts).
  //   - We additionally exclude the current user so the user does not
  //     count themselves.
  //
  // Guard: only auto-fill when the sidecar has no existing
  // `account_type` answer. If the user already explicitly picked
  // anything (including Solo on a prior session), we leave it alone —
  // back-stepping into Q1 shouldn't overwrite a real answer with the
  // auto-detect.
  useEffect(() => {
    if (current !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await discoverUsers();
        const others = all.filter((u) => u !== currentUser);
        if (cancelled) return;
        if (others.length > 0) {
          setAutoDetected(true);
          await patchSidecar((cur) => {
            const base = cur.feature_picks ?? initialFeaturePicks("lab");
            return {
              ...cur,
              feature_picks: { ...base, account_type: "lab" },
            };
          });
        }
      } catch {
        // discoverUsers swallows errors and returns []; an exception
        // here would mean fileService is wedged. Leaving the step
        // un-prefilled lets the user pick manually instead of locking
        // the modal on the auto-detect path.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally run once per mount. `current` is a guard above; if
    // it changes underneath us (a parallel write), we don't want to
    // re-fire the auto-fill and clobber the new value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = async (next: FeaturePicks["account_type"]) => {
    await patchSidecar((cur) => {
      const base = cur.feature_picks ?? initialFeaturePicks(next);
      return {
        ...cur,
        feature_picks: { ...base, account_type: next },
      };
    });
  };

  return (
    <div data-step-id="setup-q1" className="space-y-4">
      <p className="text-sm text-gray-700 leading-relaxed">
        First call: are you flying solo, or is this for a whole lab? No
        wrong answer, and you can flip it later in Settings.
      </p>
      {autoDetected && current === "lab" && (
        <div
          data-testid="q1-auto-detected-banner"
          className="text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-md px-3 py-2 leading-relaxed"
        >
          We noticed other users in this folder, so we set this to Lab.
          Change it if needed.
        </div>
      )}
      <div className="flex flex-col gap-2">
        <RadioCard
          name="account-type"
          value="solo"
          selected={current === "solo"}
          onChange={(v) => void handleChange(v)}
          label="Solo"
          description="Just me on my account. Could be a startup, an independent project, or a personal research bench."
        />
        <RadioCard
          name="account-type"
          value="lab"
          selected={current === "lab"}
          onChange={(v) => void handleChange(v)}
          label="Lab"
          description="Multiple people working together in a shared data folder."
        />
      </div>
    </div>
  );
}
