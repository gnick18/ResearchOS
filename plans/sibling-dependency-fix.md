# Sibling Dependency Timing Fix

## Problem Description

When tasks are "siblings" (start at the same time via SS dependencies), their children should wait for the LONGEST sibling to finish, not just their direct parent.

### Example Scenario

1. A (1 day) starts Monday, ends Monday
2. C (3 days) starts Monday (same time as A via SS), ends Wednesday
3. B depends on A with FS (starts after A ends)
4. **Expected**: B should start Thursday (after C finishes on Wednesday)
5. **Current**: B starts Tuesday (after A finishes on Monday), overlapping with C

## Root Cause

The shift engine only considers direct dependencies when calculating a child's start date. It doesn't account for "sibling" tasks that start at the same time as the parent.

## Solution

When calculating a child's start date for FS dependencies, we need to:

1. Find all direct parents of the child
2. For each parent, find all "siblings" (tasks that share an SS dependency with the parent, meaning they start at the same time)
3. Calculate the end date of each parent and each sibling
4. The child should start after the LATEST end date among all parents and their siblings

### Algorithm Changes

In `shift_task()` function, when processing downstream children:

```python
# For FS dependencies, consider sibling tasks
if dep_type == "FS":
    # Find all siblings of this parent (tasks that start at same time via SS)
    parent_siblings = find_ss_siblings(parent_task["id"])
    
    # Calculate the latest end date among parent and its siblings
    latest_end = parent_end
    for sibling in parent_siblings:
        sibling_end = calculate_end_date(sibling)
        if sibling_end > latest_end:
            latest_end = sibling_end
    
    # Child starts after the latest end
    required_start = latest_end + timedelta(days=1)
```

### Helper Function Needed

```python
def find_ss_siblings(task_id: int) -> list[Dict[str, Any]]:
    """Find all tasks that start at the same time as this task via SS dependencies.
    
    This includes:
    - Tasks that this task has SS dependency with (this task is child)
    - Tasks that have SS dependency with this task (this task is parent)
    """
    siblings = []
    all_deps = dependencies_store.list_all()
    
    for dep in all_deps:
        if dep["dep_type"] == "SS":
            if dep["parent_id"] == task_id:
                # This task is parent, sibling is child
                sibling = tasks_store.get(dep["child_id"])
                if sibling:
                    siblings.append(sibling)
            elif dep["child_id"] == task_id:
                # This task is child, sibling is parent
                sibling = tasks_store.get(dep["parent_id"])
                if sibling:
                    siblings.append(sibling)
    
    return siblings
```

## Implementation Steps

1. Add `find_ss_siblings()` helper function to shift.py
2. Modify the downstream shift logic to consider siblings for FS dependencies
3. Test with the scenario: A(1day) SS C(3days), A FS B(1day)
   - Expected: B starts after C ends (Thursday if A and C start Monday)

## Visual Example

```
Monday   Tuesday   Wednesday   Thursday
|--------|---------|-----------|----------
A [1 day]                                    
C [3 days -----------------]                 
B should start here ->        [B 1 day]
```

Currently B incorrectly starts Tuesday, overlapping with C.