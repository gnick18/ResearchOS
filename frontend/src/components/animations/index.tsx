// Animation library - exports all animation types
import type { ComponentType } from "react";
import CelebrationIcon from "./icons/CelebrationIcon";
import RockIcon from "./icons/RockIcon";
import SpaceIcon from "./icons/SpaceIcon";
import UnderwaterIcon from "./icons/UnderwaterIcon";
import SportsIcon from "./icons/SportsIcon";
import ScienceIcon from "./icons/ScienceIcon";
import PlantsIcon from "./icons/PlantsIcon";
import AnimalsIcon from "./icons/AnimalsIcon";
import FungiIcon from "./icons/FungiIcon";
import ScaryIcon from "./icons/ScaryIcon";

export { default as CelebrationAnimation } from "../CelebrationAnimation";
export { default as RockExplosionAnimation } from "../RockExplosionAnimation";
export { default as SpaceAnimation } from "./SpaceAnimation";
export { default as UnderwaterAnimation } from "./UnderwaterAnimation";
export { default as SportsAnimation } from "./SportsAnimation";
export { default as ScienceAnimation } from "./ScienceAnimation";
export { default as PlantsAnimation } from "./PlantsAnimation";
export { default as AnimalsAnimation } from "./AnimalsAnimation";
export { default as FungiAnimation } from "./FungiAnimation";
export { default as ScaryAnimation } from "./ScaryAnimation";

// Animation type definitions.
//
// "none" is the explicit opt-out: the user has turned off the per-task
// celebration entirely. It is NOT a real animation, so it has no
// ANIMATION_METADATA entry (see the Exclude below) and DynamicAnimation
// renders nothing for it. The Settings picker surfaces it as a dedicated
// "None / off" tile.
export type AnimationType =
  | "celebration"
  | "rock"
  | "space"
  | "underwater"
  | "sports"
  | "science"
  | "plants"
  | "animals"
  | "fungi"
  | "scary"
  | "none";

/** The real animations the user can pick (everything except the "none"
 *  opt-out). ANIMATION_METADATA is keyed by this so "none" needs no tile
 *  metadata. */
export type RealAnimationType = Exclude<AnimationType, "none">;

/**
 * Icon shape for the animation metadata. Either a plain emoji string
 * (back-compat / fallback while 10 revamp agents are still in flight)
 * OR a React component that accepts an optional `className`. Components
 * are the target shape: each revamp agent swaps its entry from an
 * emoji to a custom SVG component.
 */
export type AnimationIcon = string | ComponentType<{ className?: string }>;

// Animation metadata for UI display. Keyed by RealAnimationType so the
// "none" opt-out (which has no tile of its own) is intentionally absent.
export const ANIMATION_METADATA: Record<RealAnimationType, {
  name: string;
  icon: AnimationIcon;
  description: string;
  color: string;
}> = {
  celebration: {
    name: "Celebration",
    icon: CelebrationIcon,
    description: "Confetti, unicorns, and rainbows",
    color: "#ff6b6b",
  },
  rock: {
    name: "Rock & Roll",
    icon: RockIcon,
    description: "Guitars, lightning, and skulls",
    color: "#ff4500",
  },
  space: {
    name: "Space",
    icon: SpaceIcon,
    description: "Rockets, planets, and aliens",
    color: "#8b5cf6",
  },
  underwater: {
    name: "Underwater",
    icon: UnderwaterIcon,
    description: "Fish, bubbles, and jellyfish",
    color: "#00bcd4",
  },
  sports: {
    name: "Sports",
    icon: SportsIcon,
    description: "Balls, trophies, and medals",
    color: "#10b981",
  },
  science: {
    name: "Science",
    icon: ScienceIcon,
    description: "Atoms, DNA, and beakers",
    color: "#009688",
  },
  plants: {
    name: "Plants",
    icon: PlantsIcon,
    description: "Flowers, leaves, and seeds",
    color: "#10ac84",
  },
  animals: {
    name: "Animals",
    icon: AnimalsIcon,
    description: "Paw prints, birds, and butterflies",
    color: "#ff9f43",
  },
  fungi: {
    name: "Fungi",
    icon: FungiIcon,
    description: "Mushrooms, spores, and mycelium",
    color: "#8B4513",
  },
  scary: {
    name: "Scary",
    icon: ScaryIcon,
    description: "Skulls, ghosts, and monsters",
    color: "#4a0000",
  },
};

/** Validates that a candidate value is a known AnimationType. Falls back
 *  to "rock" (the system default) for unknown / stale values — e.g. a
 *  user who previously selected the now-retired "beakerbot" option in
 *  their settings.json. Use at every persistence boundary so consumers
 *  can trust `ANIMATION_METADATA[animationType]` to always resolve. */
export function coerceAnimationType(
  candidate: unknown,
  fallback: AnimationType = "rock",
): AnimationType {
  if (typeof candidate !== "string") return fallback;
  // "none" is a valid stored choice (the opt-out) but has no metadata
  // entry, so accept it explicitly before the metadata lookup.
  if (candidate === "none") return "none";
  return candidate in ANIMATION_METADATA
    ? (candidate as AnimationType)
    : fallback;
}

/**
 * Render an `AnimationIcon` consistently across consumers. Emojis stay
 * as inline text spans (sized via the caller-supplied `emojiClassName`),
 * while component icons get rendered at a matched visual footprint with
 * the entry's `color` applied via the `color` CSS property so the SVG's
 * `currentColor` strokes pick it up.
 *
 * The two className args let consumers (today: the Settings page's
 * animation picker section) keep their existing emoji sizing while
 * still having a sensible default SVG size that visually matches each
 * slot.
 */
export function renderAnimationIcon(
  icon: AnimationIcon,
  color: string,
  emojiClassName = "text-heading",
  svgClassName = "w-6 h-6",
) {
  if (typeof icon === "string") {
    return <span className={emojiClassName}>{icon}</span>;
  }
  const Icon = icon;
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{ color }}
    >
      <Icon className={svgClassName} />
    </span>
  );
}
