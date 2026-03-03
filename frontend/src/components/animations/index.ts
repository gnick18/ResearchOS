// Animation library - exports all animation types
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

// Animation metadata for UI display
export const ANIMATION_METADATA: Record<AnimationType, {
  name: string;
  icon: string;
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
};
