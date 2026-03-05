# Shared Experiment Initials on GANTT Chart

## Overview

Display the initial of the user who shared an experiment (the owner) on the GANTT chart across all accounts. Both the owner and recipients of shared experiments should see the owner's initial on the task bar.

## Current State

The GanttChart component already has code to show initials for shared tasks, but it shows the initials of users the task is shared WITH (recipients), not the owner who shared it.

**Current code in [`GanttChart.tsx`](frontend/src/components/GanttChart.tsx:1606-1610):**
```tsx
{!isLabMode && task.shared_with && task.shared_with.length > 0 && (
  <span className="mr-1 opacity-70 text-[10px]" title={`Shared with: ${task.shared_with.map(u => u.username).join(', ')}`}>
    [{task.shared_with.map(u => u.username.charAt(0).toUpperCase()).join('')}]
  </span>
)}
```

This shows initials like `[AB]` if the task is shared with Alice and Bob.

## Desired Behavior

- Show the **owner's** initial on shared experiments
- Both the owner and recipients should see the owner's initial
- Example: If User A shares an experiment with User B:
  - User A sees `[A]` on their shared experiment
  - User B sees `[A]` on the shared experiment they received

## Implementation

### Change Required

Modify the code in [`GanttChart.tsx`](frontend/src/components/GanttChart.tsx:1606-1610) to show the owner's initial instead of the shared_with initials:

**New code:**
```tsx
{!isLabMode && task.shared_with && task.shared_with.length > 0 && task.owner && (
  <span className="mr-1 opacity-70 text-[10px]" title={`Shared by: ${task.owner}`}>
    [{task.owner.charAt(0).toUpperCase()}]
  </span>
)}
```

### Key Changes

1. **Change from `shared_with.map(...)` to `task.owner.charAt(0)`** - Show only the owner's initial
2. **Update title tooltip** - Change from "Shared with: Alice, Bob" to "Shared by: OwnerName"
3. **Add null check for `task.owner`** - Ensure the owner field exists before displaying

## Files to Modify

| File | Change |
|------|--------|
| [`frontend/src/components/GanttChart.tsx`](frontend/src/components/GanttChart.tsx:1606-1610) | Update the shared experiment initials display logic |

## Testing Checklist

- [ ] Owner of a shared experiment sees their own initial on the GANTT chart
- [ ] Recipient of a shared experiment sees the owner's initial on the GANTT chart
- [ ] Non-shared experiments do not show any initial
- [ ] Tooltip shows "Shared by: [owner username]"
- [ ] Works correctly in both 1-week and multi-week views
- [ ] Works correctly for experiments in dependency chains

## Technical Notes

- The `task.owner` field is already populated by the backend in [`tasks.py`](backend/app/routers/tasks.py:139)
- The `task.shared_with` array is already populated and indicates the task is shared
- No backend changes are required - all necessary data is already available
