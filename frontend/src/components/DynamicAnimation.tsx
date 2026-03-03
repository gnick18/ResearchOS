"use client";

import { AnimationType } from "./animations";
import {
  CelebrationAnimation,
  RockExplosionAnimation,
  SpaceAnimation,
  UnderwaterAnimation,
  SportsAnimation,
  ScienceAnimation,
  PlantsAnimation,
  AnimalsAnimation,
  FungiAnimation,
  ScaryAnimation,
} from "./animations";

interface DynamicAnimationProps {
  type: AnimationType;
  x: number;
  y: number;
  onComplete: () => void;
}

export default function DynamicAnimation({
  type,
  x,
  y,
  onComplete,
}: DynamicAnimationProps) {
  // Render the appropriate animation based on type
  switch (type) {
    case "celebration":
      return <CelebrationAnimation x={x} y={y} onComplete={onComplete} />;
    case "rock":
      return <RockExplosionAnimation x={x} y={y} onComplete={onComplete} />;
    case "space":
      return <SpaceAnimation x={x} y={y} onComplete={onComplete} />;
    case "underwater":
      return <UnderwaterAnimation x={x} y={y} onComplete={onComplete} />;
    case "sports":
      return <SportsAnimation x={x} y={y} onComplete={onComplete} />;
    case "science":
      return <ScienceAnimation x={x} y={y} onComplete={onComplete} />;
    case "plants":
      return <PlantsAnimation x={x} y={y} onComplete={onComplete} />;
    case "animals":
      return <AnimalsAnimation x={x} y={y} onComplete={onComplete} />;
    case "fungi":
      return <FungiAnimation x={x} y={y} onComplete={onComplete} />;
    case "scary":
      return <ScaryAnimation x={x} y={y} onComplete={onComplete} />;
    default:
      // Default to celebration if unknown type
      return <CelebrationAnimation x={x} y={y} onComplete={onComplete} />;
  }
}
