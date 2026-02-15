# PCR Method Copy for Experiments - Implementation Plan

## Problem Statement

When an experiment is created with a PCR method attached, the gradient and recipe conditions should be copied to the experiment. Changes made in the experiment popup should only affect the experiment's copy, NOT the underlying PCR method.

**Current Behavior (INCORRECT):**
- Tasks only store `method_id` reference
- PCR data is fetched fresh from the protocol each time
- Edits in experiment popup are saved to `deviation_log` as text, not as structured data
- Modified gradient/ingredients are lost when popup closes

**Expected Behavior:**
- Copy PCR gradient/ingredients to task when method is linked
- Edits in experiment popup save to task's copy
- Underlying PCR protocol remains unchanged
- "Reset to Method" button to restore original values

## Implementation Plan

### 1. Backend Changes

#### 1.1 Update Schemas (`backend/app/schemas.py`)

Add new fields to Task schemas:

```python
# Add to TaskCreate
pcr_gradient: Optional[str] = None  # JSON string of PCRGradient
pcr_ingredients: Optional[str] = None  # JSON string of List[PCRIngredient]

# Add to TaskUpdate  
pcr_gradient: Optional[str] = None
pcr_ingredients: Optional[str] = None

# Add to TaskOut
pcr_gradient: Optional[str] = None
pcr_ingredients: Optional[str] = None
```

#### 1.2 Update Tasks Router (`backend/app/routers/tasks.py`)

- When a task is created/updated with a `method_id` that points to a PCR method:
  - Fetch the PCR protocol
  - Copy `gradient` and `ingredients` to the task's `pcr_gradient` and `pcr_ingredients` fields
- Add helper function to detect PCR methods and auto-copy data

#### 1.3 Add Reset Endpoint (optional - can be done frontend-side)

Add an endpoint to reset task's PCR data to match the original method:
```
POST /tasks/{task_id}/reset-pcr
```

### 2. Frontend Changes

#### 2.1 Update Types (`frontend/src/lib/types.ts`)

Add fields to Task interface:
```typescript
pcr_gradient?: string;  // JSON string
pcr_ingredients?: string;  // JSON string
```

#### 2.2 Update TaskDetailPopup (`frontend/src/components/TaskDetailPopup.tsx`)

**MethodTab changes:**
1. Load PCR data from `task.pcr_gradient` and `task.pcr_ingredients` (not from protocol)
2. Fall back to protocol data if task fields are empty (for backwards compatibility)
3. Save changes to task's PCR fields (via `tasksApi.update`)
4. Add "Reset to Method" button that:
   - Fetches original protocol data
   - Updates task's PCR fields to match
   - Shows confirmation dialog

**UI additions:**
- Show indicator when viewing experiment's copy vs original method
- "Reset to Method" button with confirmation
- Clear visual distinction between edited and original values

### 3. Data Migration

Existing experiments with PCR methods will have empty `pcr_gradient`/`pcr_ingredients` fields. The frontend will handle this by:
1. Checking if task has PCR data stored
2. If not, fetching from protocol (current behavior)
3. Saving to task on first edit (migrating automatically)

### 4. Visual Design

```
┌─────────────────────────────────────────────────────────────┐
│ Method Tab Header                                           │
├─────────────────────────────────────────────────────────────┤
│ [Protocol Name] [PCR badge]                                 │
│                                                             │
│ ⚠️ This is your experiment's copy of the protocol          │
│ [Reset to Method] [Change]                                  │
├─────────────────────────────────────────────────────────────┤
│ Thermal Gradient                                            │
│ [Interactive Gradient Editor]                               │
├─────────────────────────────────────────────────────────────┤
│ Reaction Recipe                                             │
│ [Recipe Table - Editable]                                   │
└─────────────────────────────────────────────────────────────┘
```

## Files to Modify

| File | Changes |
|------|---------|
| `backend/app/schemas.py` | Add `pcr_gradient`, `pcr_ingredients` to Task schemas |
| `backend/app/routers/tasks.py` | Auto-copy PCR data when linking method |
| `frontend/src/lib/types.ts` | Add PCR fields to Task type |
| `frontend/src/components/TaskDetailPopup.tsx` | Load/save from task, add Reset button |

## Testing Checklist

- [ ] Create new experiment with PCR method → data copied
- [ ] Edit PCR data in experiment popup → saves to task only
- [ ] Verify original PCR protocol unchanged
- [ ] Reset to Method button → restores original values
- [ ] Existing experiments (without PCR copy) → fallback works
- [ ] Change method → new method's data copied
- [ ] Unlink method → PCR data cleared
