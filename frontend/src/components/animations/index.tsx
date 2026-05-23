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

// Animation type definitions
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
  | "scary";

/**
 * Icon shape for the animation metadata. Either a plain emoji string
 * (back-compat / fallback while 10 revamp agents are still in flight)
 * OR a React component that accepts an optional `className`. Components
 * are the target shape: each revamp agent swaps its entry from an
 * emoji to a custom SVG component.
 */
export type AnimationIcon = string | ComponentType<{ className?: string }>;

// Animation metadata for UI display
export const ANIMATION_METADATA: Record<AnimationType, {
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
 * The two className args let the three current consumers (settings page,
 * Toolbar, AnimationSettingsPopup) keep their existing emoji sizing
 * (`text-xl`, `text-base`, `text-2xl`) while still having a sensible
 * default SVG size that visually matches each slot.
 */
export function renderAnimationIcon(
  icon: AnimationIcon,
  color: string,
  emojiClassName = "text-xl",
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
