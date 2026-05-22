import { useEffect, useState } from "react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import RadioCard from "./RadioCard";
import type { SetupStepProps } from "./types";

/**
 * Q7: want a page to store important links to other sites?
 * Yes / No / Maybe later. Persists `feature_picks.links`.
 *
 * Lab Links manager 2026-05-22: the surface was previously shown
 * unconditionally for lab accounts and never explained in the tour,
 * which the R7 audit flagged as unexplained surface + solo-irrelevant.
 * Q7 gates the tab visibility for everyone (solo + lab); the surface
 * name itself is account-type-conditional ("Links" for solo, "Lab
 * Links" for lab) — see AppShell + /links/page.tsx for the rendering
 * side. The question copy intentionally avoids the word "lab" so the
 * radio reads naturally for both account types; the brief explicitly
 * called this out.
 *
 * Shape mirrors Q5TelegramStep — local-pick state to avoid the
 * sidecar-write-latency flicker (see Q2 docstring), P12 hydration so
 * Resume / back-step lands on the saved answer.
 */
export default function Q7LinksStep({
  sidecar,
  setNextDisabled,
  patchSidecar,
}: SetupStepProps) {
  const [pick, setPick] = useState<FeaturePicks["links"] | null>(
    () => sidecar?.feature_picks?.links ?? null,
  );

  useEffect(() => {
    setNextDisabled(pick === null);
  }, [pick, setNextDisabled]);

  const handleChange = (next: FeaturePicks["links"]) => {
    setPick(next);
    void patchSidecar((cur) => {
      if (!cur.feature_picks) return cur;
      return {
        ...cur,
        feature_picks: { ...cur.feature_picks, links: next },
      };
    });
  };

  return (
    <div data-step-id="setup-q7" className="space-y-4">
      <p className="text-sm text-gray-700 leading-relaxed">
        Want a page to store important links to other sites? Stuff like
        your university VPN, the lab calendar, the freezer inventory
        spreadsheet, your manuscript drafts. Each card holds a URL plus
        a label so you can jump straight to the resource.
      </p>
      <div className="flex flex-col gap-2">
        <RadioCard
          name="q7-links"
          value="yes"
          selected={pick === "yes"}
          onChange={handleChange}
          label="Yes"
          description="I want a tab for saving bookmarks (VPN, calendars, spreadsheets, etc.)."
        />
        <RadioCard
          name="q7-links"
          value="no"
          selected={pick === "no"}
          onChange={handleChange}
          label="No"
          description="Hide it. I keep my links in a browser folder."
        />
        <RadioCard
          name="q7-links"
          value="maybe"
          selected={pick === "maybe"}
          onChange={handleChange}
          label="Maybe later"
          description="Hide for now, I'll turn it on in Settings."
        />
      </div>
    </div>
  );
}
