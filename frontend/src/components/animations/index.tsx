// Animation library - exports all animation types
import type { ComponentType } from "react";
import BeakerBot from "../BeakerBot";

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
export { default as BeakerBotRewardAnimation } from "./BeakerBotRewardAnimation";

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
  | "scary"
  | "beakerbot";

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
    icon: "🎉",
    description: "Confetti, unicorns, and rainbows",
    color: "#ff6b6b",
  },
  rock: {
    name: "Rock & Roll",
    icon: "🎸",
    description: "Guitars, lightning, and skulls",
    color: "#ff4500",
  },
  space: {
    name: "Space",
    icon: "🚀",
    description: "Rockets, planets, and aliens",
    color: "#8b5cf6",
  },
  underwater: {
    name: "Underwater",
    icon: "🐠",
    description: "Fish, bubbles, and jellyfish",
    color: "#00bcd4",
  },
  sports: {
    name: "Sports",
    icon: "🏆",
    description: "Balls, trophies, and medals",
    color: "#10b981",
  },
  science: {
    name: "Science",
    icon: "🔬",
    description: "Atoms, DNA, and beakers",
    color: "#009688",
  },
  plants: {
    name: "Plants",
    icon: "🌸",
    description: "Flowers, leaves, and seeds",
    color: "#10ac84",
  },
  animals: {
    name: "Animals",
    icon: "🐾",
    description: "Paw prints, birds, and butterflies",
    color: "#ff9f43",
  },
  fungi: {
    name: "Fungi",
    icon: "🍄",
    description: "Mushrooms, spores, and mycelium",
    color: "#8B4513",
  },
  scary: {
    name: "Scary",
    icon: "💀",
    description: "Skulls, ghosts, and monsters",
    color: "#4a0000",
  },
  beakerbot: {
    name: "BeakerBot",
    // BeakerBot mascot SVG. Tints via currentColor — pass a Tailwind
    // text-color utility (e.g. text-sky-500) in `className` to color it.
    // Idle pose, non-animated (matches the brand-mark accent at the top
    // of AppShell.tsx ~L176; this settings-card slot is decorative, the
    // idle bob is reserved for the onboarding wizard).
    icon: ({ className }) => (
      <BeakerBot
        pose="idle"
        animated={false}
        ariaLabel="BeakerBot"
        className={className}
      />
    ),
    description: "Random BeakerBot scenes — ladders, skateboards, more",
    color: "#0ea5e9",
  },
};

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
