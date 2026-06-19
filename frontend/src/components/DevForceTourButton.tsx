"use client";

// Dev-only one-click "start the onboarding tour" button. The live coupled tour
// normally mounts only for a brand-new account with a pristine empty folder
// (isFreshUserForWizard), which is fiddly to reproduce while iterating. This
// button arms the dev force-live flag, clears any prior done/progress markers,
// and hard-reloads to root so TourHost remounts the tour clean at welcome over
// the real app, regardless of freshness. The normal welcome -> picker -> demo
// path runs from there, so it exercises the REAL coupled flow.
//
// Hard-gated on process.env.NODE_ENV === "development" so the body becomes dead
// code in production builds (same pattern as DevDemoToggleButton).
//
// No emojis, no em-dashes, no mid-sentence colons.

import {
  armForceLiveTour,
  resetOnboardingTutor,
} from "@/lib/onboarding/tour-gate";
import { clearTourProgress } from "@/lib/onboarding/tour-progress";
import { Icon } from "./icons/Icon";
import Tooltip from "./Tooltip";

const IS_DEV = process.env.NODE_ENV === "development";

export default function DevForceTourButton() {
  if (!IS_DEV) return null;

  const handleClick = () => {
    // Start a clean forced run: drop the done + progress markers so nothing
    // resumes or suppresses, arm the force-live flag, then hard-navigate to root
    // so TourHost remounts at welcome (a soft push would not re-run the mount
    // decision). The flag is cleared again when the run finishes or is skipped.
    resetOnboardingTutor();
    clearTourProgress();
    armForceLiveTour();
    window.location.assign("/");
  };

  const label = "Start onboarding tour (dev)";

  return (
    <Tooltip label={label} placement="top">
      <button
        type="button"
        onClick={handleClick}
        aria-label={label}
        className="pointer-events-auto w-12 h-12 rounded-full bg-white border-2 border-violet-300 hover:border-violet-500 hover:bg-violet-50 text-violet-600 hover:text-violet-700 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
      >
        {/* Map glyph, the "show me around / guided tour" meaning, distinct from
            the demo flask on the neighboring DevDemoToggleButton. */}
        <Icon name="map" className="w-5 h-5" />
      </button>
    </Tooltip>
  );
}
