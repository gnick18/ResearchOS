# Animation System Plan

## Overview

This plan outlines the implementation of a unified animation selection system that allows users to choose different celebration animations for:
1. **Task Sub-task Completion** - When checking off sub-tasks
2. **High-Level Goal Completion** - When completing high-level goals

## Architecture

### 1. Animation Types (10 total)

| ID | Name | Description | Elements |
|----|------|-------------|----------|
| `celebration` | Celebration | Default confetti and unicorns | Confetti, stars, hearts, unicorns, rainbows |
| `rock` | Rock-n-Roll | Explosive rock theme | Guitars, rock hands, planes, fire, lightning, skulls |
| `space` | Space | Cosmic adventure | Stars, planets, rockets, UFOs, asteroids, comets |
| `underwater` | Underwater | Ocean depths | Fish, bubbles, jellyfish, coral, seahorses, whales |
| `sports` | Sports | Athletic victory | Trophies, balls, whistles, medals, equipment |
| `science` | Science | Laboratory celebration | Atoms, DNA, beakers, molecules, microscopes |
| `nature` | Nature | Garden growth | Flowers, leaves, butterflies, trees, seeds |
| `animals` | Animals | Wildlife safari | Paw prints, feathers, various animal emojis |
| `fungi` | Fungi | Mushroom kingdom | Mushrooms, spores, mycelium networks |
| `scary` | Scary | Spooky celebration | Skulls, vampires, ghosts, monsters, bats |

### 2. Component Structure

```
frontend/src/components/
  animations/
    index.ts                    # Export all animations
    CelebrationAnimation.tsx    # Existing - renamed
    RockExplosionAnimation.tsx  # Existing
    SpaceAnimation.tsx          # New
    UnderwaterAnimation.tsx     # New
    SportsAnimation.tsx         # New
    ScienceAnimation.tsx        # New
    NatureAnimation.tsx         # New
    AnimalsAnimation.tsx        # New
    FungiAnimation.tsx          # New
    ScaryAnimation.tsx          # New
    
  AnimationSettingsPopup.tsx    # Settings modal
```

### 3. State Management

Add to `frontend/src/lib/store.ts`:

```typescript
// Animation settings
taskAnimationType: AnimationType;
goalAnimationType: AnimationType;
setTaskAnimationType: (type: AnimationType) => void;
setGoalAnimationType: (type: AnimationType) => void;
```

### 4. Type Definitions

Add to `frontend/src/lib/types.ts`:

```typescript
export type AnimationType = 
  | "celebration" 
  | "rock" 
  | "space" 
  | "underwater" 
  | "sports" 
  | "science" 
  | "nature" 
  | "animals" 
  | "fungi" 
  | "scary";

export interface AnimationOption {
  id: AnimationType;
  name: string;
  icon: string;  // Emoji icon for the selector
  description: string;
}
```

### 5. Animation Settings Popup UI

```
+------------------------------------------+
|  Animation Settings                   [X] |
+------------------------------------------+
|                                          |
|  Task Sub-task Completion                |
|  [===================================]   |
|  Current: Rock-n-Roll                    |
|                                          |
|  High-Level Goal Completion              |
|  [===================================]   |
|  Current: Celebration                    |
|                                          |
|  Available Animations                    |
|  +--------+ +--------+ +--------+        |
|  |  conf  | |  rock  | | space  |        |
|  +--------+ +--------+ +--------+        |
|  +--------+ +--------+ +--------+        |
|  |underH2O| | sports | |science |        |
|  +--------+ +--------+ +--------+        |
|  +--------+ +--------+ +--------+        |
|  | nature | |animals | | fungi  |        |
|  +--------+ +--------+ +--------+        |
|  +--------+                              |
|  | scary  |                              |
|  +--------+                              |
|                                          |
|  [Save]                        [Cancel]  |
+------------------------------------------+
```

### 6. GanttChart Header Integration

Add a sparkle/party icon button in the GanttChart header area that opens the AnimationSettingsPopup.

Location: Upper section of the GANTT page, near view mode selector.

Button design: 
- Icon: ` sparkle ` or ` party popper ` emoji
- Tooltip: "Animation Settings"
- On click: Opens AnimationSettingsPopup

### 7. Animation Component Interface

All animation components share the same props:

```typescript
interface AnimationProps {
  x: number;        // X position to center animation
  y: number;        // Y position to center animation
  onComplete: () => void;  // Callback when animation finishes
}
```

### 8. Animation Registry

Create a registry to map animation types to components:

```typescript
// frontend/src/components/animations/index.ts
import CelebrationAnimation from './CelebrationAnimation';
import RockExplosionAnimation from './RockExplosionAnimation';
// ... other imports

export const ANIMATION_REGISTRY: Record<AnimationType, React.FC<AnimationProps>> = {
  celebration: CelebrationAnimation,
  rock: RockExplosionAnimation,
  space: SpaceAnimation,
  underwater: UnderwaterAnimation,
  sports: SportsAnimation,
  science: ScienceAnimation,
  nature: NatureAnimation,
  animals: AnimalsAnimation,
  fungi: FungiAnimation,
  scary: ScaryAnimation,
};

export const ANIMATION_OPTIONS: AnimationOption[] = [
  { id: 'celebration', name: 'Celebration', icon: ' confetti ', description: 'Confetti, unicorns, and rainbows' },
  { id: 'rock', name: 'Rock-n-Roll', icon: ' guitar ', description: 'Guitars, lightning, and rock hands' },
  // ... etc
];
```

## Implementation Steps

### Phase 1: Foundation
1. Add AnimationType and related types to types.ts
2. Add animation settings to store.ts
3. Create animations/index.ts with registry

### Phase 2: Animation Components
4. Create SpaceAnimation.tsx
5. Create UnderwaterAnimation.tsx
6. Create SportsAnimation.tsx
7. Create ScienceAnimation.tsx
8. Create NatureAnimation.tsx
9. Create AnimalsAnimation.tsx
10. Create FungiAnimation.tsx
11. Create ScaryAnimation.tsx

### Phase 3: UI Integration
12. Create AnimationSettingsPopup.tsx
13. Add animation settings button to GanttChart header
14. Update TaskDetailPopup to use selected animation type
15. Update HighLevelGoalModal to use selected animation type

### Phase 4: Testing
16. Test all animations work correctly
17. Test settings persistence
18. Test animation triggering in both contexts

## Animation Design Details

### Space Animation
- **Elements**: Stars, planets, rockets, UFOs, asteroids, comets, astronauts
- **Colors**: Deep purple, bright blue, silver, gold stars
- **Motion**: Floating upward with slight rotation, rockets fly diagonally
- **Special**: Shooting stars with trailing tails

### Underwater Animation
- **Elements**: Fish, bubbles, jellyfish, coral, seahorses, whales, octopus
- **Colors**: Ocean blue, teal, coral pink, sandy beige
- **Motion**: Floating upward with sway, bubbles rise and pop
- **Special**: Jellyfish pulse, fish swim in schools

### Sports Animation
- **Elements**: Trophies, medals, balls (soccer, basketball, football), whistles, equipment
- **Colors**: Gold, silver, bronze, team colors
- **Motion**: Balls bounce, trophies spin, medals swing
- **Special**: Victory confetti in team colors

### Science Animation
- **Elements**: Atoms, DNA helixes, beakers, molecules, microscopes, test tubes
- **Colors**: Lab green, chemical blue, purple, scientific white
- **Motion**: Atoms orbit, DNA spins, bubbles rise from beakers
- **Special**: Glowing chemical reactions

### Nature Animation
- **Elements**: Flowers, leaves, butterflies, trees, seeds, vines, suns
- **Colors**: Green, flower colors (pink, yellow, purple), sky blue
- **Motion**: Leaves flutter down, butterflies fly up, flowers bloom
- **Special**: Growing vines that spread

### Animals Animation
- **Elements**: Paw prints, feathers, animal emojis (lion, elephant, dog, cat, bird)
- **Colors**: Earth tones, fur colors, feather colors
- **Motion**: Paw prints appear in sequence, feathers float, animals bounce
- **Special**: Safari scene with multiple animals

### Fungi Animation
- **Elements**: Mushrooms, spores, mycelium networks, mold circles
- **Colors**: Earth tones, mushroom reds/browns, spore green
- **Motion**: Mushrooms pop up, spores float and spread, mycelium grows
- **Special**: Network of connected mycelium strands

### Scary Animation
- **Elements**: Skulls, vampires, ghosts, monsters, bats, spiders, cobwebs
- **Colors**: Dark purple, black, blood red, ghostly white
- **Motion**: Bats fly, ghosts float, spiders descend on webs
- **Special**: Fog effect, glowing eyes

## File Changes Summary

### New Files
- `frontend/src/components/animations/index.ts`
- `frontend/src/components/animations/SpaceAnimation.tsx`
- `frontend/src/components/animations/UnderwaterAnimation.tsx`
- `frontend/src/components/animations/SportsAnimation.tsx`
- `frontend/src/components/animations/ScienceAnimation.tsx`
- `frontend/src/components/animations/NatureAnimation.tsx`
- `frontend/src/components/animations/AnimalsAnimation.tsx`
- `frontend/src/components/animations/FungiAnimation.tsx`
- `frontend/src/components/animations/ScaryAnimation.tsx`
- `frontend/src/components/AnimationSettingsPopup.tsx`

### Modified Files
- `frontend/src/lib/types.ts` - Add AnimationType and interfaces
- `frontend/src/lib/store.ts` - Add animation settings state
- `frontend/src/components/GanttChart.tsx` - Add settings button
- `frontend/src/components/TaskDetailPopup.tsx` - Use selected animation
- `frontend/src/components/HighLevelGoalModal.tsx` - Use selected animation
- `frontend/src/components/CelebrationAnimation.tsx` - Move to animations folder
- `frontend/src/components/RockExplosionAnimation.tsx` - Move to animations folder