# Dependency Tree Revamp Plan

## Overview

This plan outlines the changes needed to revamp the dependency tree popup that appears when clicking on an experiment that is part of a dependency chain. The main goals are:

1. **New Visualization**: Show the entire dependency chain as a vertical tree with clear order indicators
2. **Remove Drag-and-Drop**: Eliminate the ability to reorder dependencies via drag-and-drop in this popup
3. **Highlight Current Task**: Make the selected task stand out in the tree
4. **Clean Up Code**: Remove all related code for features being removed

## Current Implementation Analysis

### Location
The dependency tree is rendered in [`TaskDetailPopup.tsx`](frontend/src/components/TaskDetailPopup.tsx) within the `DetailsTab` component, specifically in the "Dependency Tree Section" (lines ~1285-1430).

### Current Features (to be removed)
1. **Drag-and-drop reordering**: Tasks can be dragged to reorder dependencies
2. **Drag-to-break**: Tasks can be dragged away from the container to break dependencies
3. **Dependency type popup**: Shows options for FS/SS/SF dependency types when dropping
4. **Fluid chain dynamics**: Complex mouse tracking for drag animations
5. **Remove from chain checkbox**: In edit mode, allows removing task from chain

### Current State Variables (to be removed)
```typescript
// Drag-drop state for dependency tree
const [draggedDepTask, setDraggedDepTask] = useState<Task | null>(null);
const [dragOverDepTask, setDragOverDepTask] = useState<Task | null>(null);
const [showDepTypePopup, setShowDepTypePopup] = useState(false);
const [depPopupParent, setDepPopupParent] = useState<Task | null>(null);
const [depPopupChild, setDepPopupChild] = useState<Task | null>(null);

// Drag-to-break state
const [isDraggingToBreak, setIsDraggingToBreak] = useState(false);
const [breakawayTask, setBreakawayTask] = useState<Task | null>(null);
const [showBreakIndicator, setShowBreakIndicator] = useState(false);

// Fluid chain dynamics state
const taskCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
const [chainPositions, setChainPositions] = useState<Map<number, { x: number; y: number; width: number; height: number }>>(new Map());
const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

// Remove from chain state
const [showRemoveFromChain, setShowRemoveFromChain] = useState(false);
const [removeStartDate, setRemoveStartDate] = useState(task.start_date);
```

### Current Handlers (to be removed)
- `handleDepDragStart`
- `handleDepDragOver`
- `handleDepDragLeave`
- `handleDepDrop`
- `handleDepDragEnd`
- `handleTaskCardDragStart`
- `handleTaskCardDrag`
- `handleTaskCardDrop`
- `handleCreateDepFromTree`
- `handleRemoveFromChain`

### CSS Styles to Remove (from [`globals.css`](frontend/src/app/globals.css))
- `.dep-card-shaking` (lines 292-294)
- `.dep-card-breakaway` (lines 296-300)
- `.dep-break-indicator` (lines 302-318)
- `@keyframes shake` (lines 278-282)
- `@keyframes break-shake` (lines 284-290)
- `@keyframes pulse-scale` (lines 320-323)
- Chain node drag-related styles (cursor: grab, etc.)

---

## New Implementation Design

### Visual Design

```
Dependency Chain
================

  1. [First Task]           <- Start of chain
       |
       v
  2. [Second Task]
       |
       v
  3. [Current Task] **      <- Highlighted with border/glow
       |
       v
  4. [Fourth Task]
       |
       v
  5. [Last Task]            <- End of chain
```

### Features
1. **Vertical Tree Layout**: Tasks displayed top-to-bottom in dependency order
2. **Order Numbers**: Each task shows its position in the chain (1, 2, 3, etc.)
3. **Connecting Lines**: Visual connectors between tasks showing flow
4. **Current Task Highlighting**: 
   - Distinct background color
   - Border highlight
   - "(this task)" label
   - Prominent styling
5. **Smooth Animation**: 
   - Fade-in animation when tree appears
   - Subtle scale animation for the current task
6. **Task Status Indicators**: Show completion status for each task

### Interaction
- **Read-only**: No drag-and-drop, no reordering
- **Click to navigate**: Clicking another task in the chain opens that task's popup
- **Remove button**: Small X button next to each dependency to remove it (existing functionality preserved)

---

## Implementation Steps

### Step 1: Remove Drag-and-Drop Code from DetailsTab

Remove the following state variables and their usages:
- `draggedDepTask`, `setDraggedDepTask`
- `dragOverDepTask`, `setDragOverDepTask`
- `showDepTypePopup`, `setShowDepTypePopup`
- `depPopupParent`, `setDepPopupParent`
- `depPopupChild`, `setDepPopupChild`
- `isDraggingToBreak`, `setIsDraggingToBreak`
- `breakawayTask`, `setBreakawayTask`
- `showBreakIndicator`, `setShowBreakIndicator`
- `taskCardRefs`
- `chainPositions`, `setChainPositions`
- `mousePos`, `setMousePos`
- `showRemoveFromChain`, `setShowRemoveFromChain`
- `removeStartDate`, `setRemoveStartDate`

Remove all drag-related handlers:

### Step 2: Remove Dependency Type Popup

Remove the JSX for the dependency type popup (lines ~1229-1283).

### Step 3: Remove "Remove from Chain" Section

Remove the checkbox and related UI from the edit form (lines ~1564-1608).

### Step 4: Create New Dependency Tree Component

Create a new clean visualization:

```tsx
// New Dependency Tree Section
{hasDependencies && (
  <div className="bg-gray-50 rounded-lg p-4">
    <h4 className="text-xs font-semibold text-gray-500 mb-3">
      Dependency Chain
    </h4>
    
    <DependencyChainTree 
      task={task}
      parentTasks={parentTasks}
      childTasks={childTasks}
      taskDependencies={taskDependencies}
      dependentTasks={dependentTasks}
      onTaskClick={onTaskClick}
      onRemoveDependency={handleRemoveDependency}
    />
  </div>
)}
```

### Step 5: Implement DependencyChainTree Component

Create a new component or inline implementation that:

1. Builds the full chain from root to leaf
2. Renders tasks vertically with order numbers
3. Highlights the current task
4. Shows connecting lines between tasks
5. Provides remove buttons for dependencies

### Step 6: Clean Up CSS

Remove drag-related styles from [`globals.css`](frontend/src/app/globals.css):
- Remove shake/break animations
- Remove break indicator styles
- Simplify chain-node styles (remove cursor: grab, etc.)

### Step 7: Keep "Add Dependency" Dropdown

Preserve the existing "Add Dependency" dropdown in the edit form (lines ~1610-1665) - this is separate from the drag-drop functionality and should remain.

---

## Code Changes Summary

### Files to Modify

1. **[`frontend/src/components/TaskDetailPopup.tsx`](frontend/src/components/TaskDetailPopup.tsx)**
   - Remove ~200 lines of drag-drop related code
   - Add new clean dependency tree visualization
   - Simplify the DetailsTab component

2. **[`frontend/src/app/globals.css`](frontend/src/app/globals.css)**
   - Remove ~50 lines of drag-related CSS
   - Add new tree animation styles

### Files Unchanged

- Backend code (no changes needed - API remains the same)
- Types (no changes needed)
- Other components

---

## New Dependency Tree Component Design

```tsx
function DependencyChainTree({
  task,
  parentTasks,
  childTasks,
  taskDependencies,
  dependentTasks,
  onTaskClick,
  onRemoveDependency,
}: {
  task: Task;
  parentTasks: Task[];
  childTasks: Task[];
  taskDependencies: Dependency[];
  dependentTasks: Dependency[];
  onTaskClick: (taskId: number) => void;
  onRemoveDependency: (depId: number) => void;
}) {
  // Build the full chain by traversing up and down
  const chain = buildFullChain(task, parentTasks, childTasks, taskDependencies, dependentTasks);
  
  return (
    <div className="dependency-chain-tree">
      {chain.map((chainTask, index) => {
        const isCurrentTask = chainTask.id === task.id;
        const isComplete = chainTask.is_complete;
        
        return (
          <div key={chainTask.id} className="chain-item">
            {/* Order number */}
            <div className="chain-order">{index + 1}</div>
            
            {/* Task card */}
            <div 
              className={`chain-task ${isCurrentTask ? 'current' : ''} ${isComplete ? 'complete' : ''}`}
              onClick={() => !isCurrentTask && onTaskClick(chainTask.id)}
            >
              <span className="task-name">{chainTask.name}</span>
              {isCurrentTask && <span className="current-label">(this task)</span>}
              {isComplete && <span className="complete-check">{'\u2713'}</span>}
            </div>
            
            {/* Connector line (except for last item) */}
            {index < chain.length - 1 && (
              <div className="chain-connector">
                <div className="connector-line" />
                <div className="connector-arrow">{'\u2193'}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

---

## Animation Design

### Tree Appearance Animation
```css
@keyframes chain-fade-in {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dependency-chain-tree .chain-item {
  animation: chain-fade-in 0.3s ease-out forwards;
  animation-delay: calc(var(--index) * 0.05s);
  opacity: 0;
}
```

### Current Task Highlight Animation
```css
.chain-task.current {
  animation: current-pulse 2s ease-in-out infinite;
}

@keyframes current-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3); }
  50% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.5); }
}
```

---

## Questions for User

1. Should clicking on another task in the chain open that task's popup, or should the tree be completely read-only?
2. Should the remove dependency (X button) functionality be preserved, or should dependencies only be removable via the edit form?
3. Should there be any visual indication of dependency type (FS/SS/SF) in the new tree?

---

## Estimated Complexity

- **Frontend Changes**: Moderate (~150 lines removed, ~80 lines added)
- **CSS Changes**: Simple (~50 lines removed, ~30 lines added)
- **Backend Changes**: None required
- **Testing**: Low risk - simplifying existing functionality