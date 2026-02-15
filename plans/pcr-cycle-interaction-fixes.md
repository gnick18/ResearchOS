# PCR Cycle Interaction Fixes

## Overview

This plan addresses two issues with the PCR gradient editor's cycle interaction:

1. **Arrow Movement Issue**: Arrow buttons currently move steps into cycles when adjacent, but should instead swap with the entire cycle container
2. **Drag and Drop Feature**: Need to implement drag and drop for adding/removing steps from cycles, with popup hints

## Current Behavior Analysis

### Arrow Movement (Issue 1)

The current implementation in [`InteractiveGradientEditor.tsx`](frontend/src/components/InteractiveGradientEditor.tsx):

- [`handleMoveLeft()`](frontend/src/components/InteractiveGradientEditor.tsx:756) and [`handleMoveRight()`](frontend/src/components/InteractiveGradientEditor.tsx:769) simply swap blocks with their neighbors
- [`rebuildBlocksAfterMove()`](frontend/src/components/InteractiveGradientEditor.tsx:675) reassigns block types based on position
- When a step moves adjacent to a cycle container, it gets absorbed into the cycle

**Example of current problematic behavior:**
```
Before: [Initial Step] [Cycle Container + Cycle Steps] [Final Step]
After clicking left arrow on Final Step: 
[Initial Step] [Cycle Container + Cycle Steps + Final Step]  // Wrong!
```

**Desired behavior:**
```
Before: [Initial Step] [Cycle Container + Cycle Steps] [Final Step]
After clicking left arrow on Final Step:
[Initial Step] [Final Step] [Cycle Container + Cycle Steps]  // Swap with entire cycle
```

### Drag and Drop (Issue 2)

Currently there is no drag and drop functionality. Steps can only be moved via arrow buttons.

## Implementation Plan

### Part 1: Fix Arrow Movement to Never Enter Cycles

#### Changes to [`handleMoveLeft()`](frontend/src/components/InteractiveGradientEditor.tsx:756)

```typescript
const handleMoveLeft = useCallback((id: string) => {
  const blockIndex = blocks.findIndex(b => b.id === id);
  if (blockIndex <= 0) return;
  
  const prevBlock = blocks[blockIndex - 1];
  
  // Check if previous block is a cycle step (inside a cycle)
  // If so, find the cycle container and swap with the entire cycle
  if (prevBlock.type === "cycle" && prevBlock.cycleIndex !== undefined) {
    // Find the start of this cycle (the cycle container)
    const cycleContainerIndex = prevBlock.cycleContainerIndex;
    const containerIndex = blocks.findIndex(
      b => b.id === `cycle-container-${cycleContainerIndex}`
    );
    
    if (containerIndex >= 0) {
      // Find all blocks belonging to this cycle
      const cycleEndIndex = findCycleEndIndex(blocks, cycleContainerIndex);
      
      // Move the step to before the cycle container
      // This effectively swaps with the entire cycle
      const newBlocks = [...blocks];
      const [movingBlock] = newBlocks.splice(blockIndex, 1);
      newBlocks.splice(containerIndex, 0, movingBlock);
      
      const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
      onChange(blocksToGradient(rebuiltBlocks));
      return;
    }
  }
  
  // Check if previous block is a cycle container
  if (prevBlock.id.startsWith("cycle-container-")) {
    // Find the end of this cycle and swap with entire cycle
    const cycleContainerIndex = prevBlock.cycleContainerIndex;
    const cycleEndIndex = findCycleEndIndex(blocks, cycleContainerIndex!);
    
    // Move the step to before the cycle container
    const newBlocks = [...blocks];
    const [movingBlock] = newBlocks.splice(blockIndex, 1);
    newBlocks.splice(blockIndex - 1, 0, movingBlock); // Swap positions
    
    const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
    onChange(blocksToGradient(rebuiltBlocks));
    return;
  }
  
  // Normal swap for non-cycle blocks
  const newBlocks = [...blocks];
  [newBlocks[blockIndex - 1], newBlocks[blockIndex]] = 
    [newBlocks[blockIndex], newBlocks[blockIndex - 1]];
  
  const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
  onChange(blocksToGradient(rebuiltBlocks));
}, [blocks, onChange, blocksToGradient, rebuildBlocksAfterMove]);
```

#### Similar Changes to [`handleMoveRight()`](frontend/src/components/InteractiveGradientEditor.tsx:769)

The same logic applies but in the opposite direction.

#### Helper Function Needed

```typescript
// Find the index of the last block in a cycle
const findCycleEndIndex = (blocks: GradientBlock[], cycleContainerIndex: number): number => {
  let lastCycleStepIndex = -1;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === "cycle" && 
        blocks[i].cycleContainerIndex === cycleContainerIndex) {
      lastCycleStepIndex = i;
    }
  }
  return lastCycleStepIndex;
};
```

### Part 2: Implement Drag and Drop

#### 2.1 Add Drag State to Component

```typescript
// Add new state variables
const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
const [dropTargetId, setDropTargetId] = useState<string | null>(null);
const [showDragHint, setShowDragHint] = useState(false);
const dragHintTimeoutRef = useRef<NodeJS.Timeout | null>(null);
```

#### 2.2 Add Drag Handlers to StepBlock

Update the [`StepBlock`](frontend/src/components/InteractiveGradientEditor.tsx:232) component:

```typescript
interface StepBlockProps {
  // ... existing props
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (id: string) => void;
  onDrop: (targetId: string) => void;
  isDragging: boolean;
  isDropTarget: boolean;
  showDragHint: boolean;
}

function StepBlock({
  // ... existing props
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragging,
  isDropTarget,
  showDragHint,
}: StepBlockProps) {
  
  const handleMouseDown = () => {
    // Start a timer to show drag hint after holding
    dragHintTimeoutRef.current = setTimeout(() => {
      setShowDragHint(true);
    }, 500); // Show hint after 500ms hold
  };
  
  const handleMouseUp = () => {
    if (dragHintTimeoutRef.current) {
      clearTimeout(dragHintTimeoutRef.current);
    }
    setShowDragHint(false);
  };
  
  return (
    <div className="relative flex flex-col items-center">
      {/* Drag hint popup */}
      {showDragHint && isEditing && (
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 
                        bg-gray-800 text-white text-xs px-2 py-1 rounded 
                        whitespace-nowrap z-20 animate-fade-in">
          Drag to move into/out of cycles
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 
                          translate-y-full border-4 border-transparent 
                          border-t-gray-800" />
        </div>
      )}
      
      <div
        draggable={isEditing}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", block.id);
          onDragStart(block.id);
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          e.preventDefault();
          onDragOver(block.id);
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDrop(block.id);
        }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`
          // ... existing classes
          ${isDragging ? "opacity-50 scale-95" : ""}
          ${isDropTarget ? "ring-2 ring-green-400 ring-offset-2" : ""}
          ${isEditing ? "cursor-grab active:cursor-grabbing" : ""}
        `}
        // ... rest of component
      >
        {/* ... existing content */}
      </div>
    </div>
  );
}
```

#### 2.3 Add Drop Zone to CycleContainer

Update [`CycleContainer`](frontend/src/components/InteractiveGradientEditor.tsx:358) to accept drops:

```typescript
interface CycleContainerProps {
  // ... existing props
  onDropIntoCycle: (draggedId: string, cycleContainerIndex: number) => void;
  isDropTarget: boolean;
}

function CycleContainer({
  // ... existing props
  onDropIntoCycle,
  isDropTarget,
}: CycleContainerProps) {
  return (
    <div
      className={`
        relative border-2 border-dashed rounded-xl p-3 bg-purple-50/50 min-w-[80px]
        ${isEditing ? "cursor-default" : ""}
        ${isDropTarget ? "border-green-400 bg-green-50 ring-2 ring-green-300" : 
          "border-purple-300"}
      `}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData("text/plain");
        onDropIntoCycle(draggedId, block.cycleContainerIndex!);
      }}
    >
      {/* ... existing content */}
    </div>
  );
}
```

#### 2.4 Add Drop Zone Outside Cycles

Add a drop zone area below the blocks for removing from cycles:

```typescript
// In the main component render:
<div className="flex items-start gap-3 flex-wrap p-4 pt-6 bg-gray-50 rounded-lg min-h-[140px] pb-12">
  {renderBlocks()}
  
  {/* Drop zone for removing from cycles */}
  {isEditing && draggedBlockId && (
    <div 
      className="flex-1 min-h-[80px] border-2 border-dashed border-gray-300 
                 rounded-lg flex items-center justify-center text-gray-400 
                 text-sm hover:border-green-400 hover:bg-green-50 
                 transition-colors"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData("text/plain");
        handleRemoveFromCycle(draggedId);
      }}
    >
      Drop here to remove from cycle
    </div>
  )}
</div>
```

#### 2.5 Implement Drop Logic

```typescript
const handleDropIntoCycle = useCallback((draggedId: string, cycleContainerIndex: number) => {
  const draggedIndex = blocks.findIndex(b => b.id === draggedId);
  if (draggedIndex === -1) return;
  
  const newBlocks = [...blocks];
  const [draggedBlock] = newBlocks.splice(draggedIndex, 1);
  
  // Find the end of the target cycle
  let insertIndex = -1;
  for (let i = 0; i < newBlocks.length; i++) {
    if (newBlocks[i].type === "cycle" && 
        newBlocks[i].cycleContainerIndex === cycleContainerIndex) {
      insertIndex = i + 1;
    }
  }
  
  if (insertIndex === -1) {
    // Empty cycle, find the container and insert after it
    insertIndex = newBlocks.findIndex(
      b => b.id === `cycle-container-${cycleContainerIndex}`
    ) + 1;
  }
  
  // Insert the block into the cycle
  newBlocks.splice(insertIndex, 0, draggedBlock);
  
  const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
  onChange(blocksToGradient(rebuiltBlocks));
  setDraggedBlockId(null);
}, [blocks, onChange, blocksToGradient, rebuildBlocksAfterMove]);

const handleRemoveFromCycle = useCallback((draggedId: string) => {
  const draggedIndex = blocks.findIndex(b => b.id === draggedId);
  if (draggedIndex === -1) return;
  
  const newBlocks = [...blocks];
  const [draggedBlock] = newBlocks.splice(draggedIndex, 1);
  
  // Find the last cycle container and insert after it
  // Or insert at the end if no cycles
  let insertIndex = newBlocks.length;
  
  // Find the last cycle's end
  for (let i = newBlocks.length - 1; i >= 0; i--) {
    if (newBlocks[i].type === "cycle" && newBlocks[i].cycleIndex !== undefined) {
      insertIndex = i + 1;
      break;
    }
  }
  
  // Insert as a final step
  newBlocks.splice(insertIndex, 0, draggedBlock);
  
  const rebuiltBlocks = rebuildBlocksAfterMove(newBlocks);
  onChange(blocksToGradient(rebuiltBlocks));
  setDraggedBlockId(null);
}, [blocks, onChange, blocksToGradient, rebuildBlocksAfterMove]);
```

### Part 3: Update Instructions

Update the editing instructions to reflect the new behavior:

```typescript
{isEditing && (
  <div className="text-xs text-gray-500 mb-3 flex items-center gap-4">
    <span>• Click to select, use arrows to move</span>
    <span>• Double-click to edit</span>
    <span>• Drag and drop to add/remove from cycles</span>
    {isErasing && <span className="text-red-500 font-medium">• Click a block to erase</span>}
  </div>
)}
```

## Summary of Changes

### Files to Modify
- [`frontend/src/components/InteractiveGradientEditor.tsx`](frontend/src/components/InteractiveGradientEditor.tsx)

### Key Changes

1. **Arrow Movement Fix**:
   - Modify [`handleMoveLeft()`](frontend/src/components/InteractiveGradientEditor.tsx:756) to detect cycle boundaries
   - Modify [`handleMoveRight()`](frontend/src/components/InteractiveGradientEditor.tsx:769) similarly
   - Add helper function to find cycle boundaries
   - When arrow would move into a cycle, swap with entire cycle instead

2. **Drag and Drop**:
   - Add drag state variables
   - Update [`StepBlock`](frontend/src/components/InteractiveGradientEditor.tsx:232) with drag handlers
   - Update [`CycleContainer`](frontend/src/components/InteractiveGradientEditor.tsx:358) with drop handlers
   - Add drop zone for removing from cycles
   - Implement drop logic functions

3. **Popup Hints**:
   - Add hint popup that appears after 500ms hold
   - Show "Drag to move into/out of cycles" message
   - Auto-hide on mouse release

## Testing Checklist

- [ ] Arrow left on a step adjacent to cycle start swaps with entire cycle
- [ ] Arrow right on a step adjacent to cycle end swaps with entire cycle
- [ ] Arrow movement within a cycle still works normally
- [ ] Dragging a step into a cycle adds it to the cycle
- [ ] Dragging a step out of a cycle removes it from the cycle
- [ ] Popup hint appears after holding click for 500ms
- [ ] Popup hint disappears on mouse release
- [ ] Visual feedback during drag (opacity, drop target highlighting)
