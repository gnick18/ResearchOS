// Registry of the app-launch Splash redesign variants.
//
// The dev page (/dev/splash) toggles between these; once Grant picks a winner
// the real Splash wrapper imports the chosen one by id. Keeping the list in one
// place means the dev page and production never drift on names.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { ComponentType } from "react";

import type { SplashVariantProps } from "./shared";
import { VariantAurora } from "./VariantAurora";
import { VariantSplitStage } from "./VariantSplitStage";
import { VariantBloom } from "./VariantBloom";

export type SplashVariantId = "aurora" | "split" | "bloom";

export interface SplashVariantEntry {
  id: SplashVariantId;
  label: string;
  blurb: string;
  Component: ComponentType<SplashVariantProps>;
}

export const SPLASH_VARIANTS: SplashVariantEntry[] = [
  {
    id: "aurora",
    label: "Aurora Curtain",
    blurb:
      "Calm centered composition. Big greeting up top, beaker fills below, then a soft rainbow curtain sweeps diagonally and dissolves.",
    Component: VariantAurora,
  },
  {
    id: "split",
    label: "Split Stage",
    blurb:
      "Editorial asymmetry. Left hero column (Welcome back / huge name / wordmark lockup), mascot anchored right, brand-sky hairline meter along the bottom, restrained lift-and-fade exit.",
    Component: VariantSplitStage,
  },
  {
    id: "bloom",
    label: "Pour and Bloom",
    blurb:
      "Kinetic. Wordmark gets painted by the rising liquid, then the rainbow blooms radially out of the beaker to fill the screen and dissolve.",
    Component: VariantBloom,
  },
];

export { VariantAurora, VariantSplitStage, VariantBloom };
export type { SplashVariantProps } from "./shared";
