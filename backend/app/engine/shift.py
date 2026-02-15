"""Recursive date-shifting engine for ResearchOS.

When a task is moved, all downstream dependents must shift according to their
dependency type (FS, SS, SF), respecting weekend constraints.

Additionally, when a task is moved, upstream parents may need to shift to
maintain dependency constraints (bidirectional).

Rewritten to use JSON storage instead of SQLAlchemy.
"""

from __future__ import annotations

from collections import deque
from datetime import date, timedelta
from typing import Any, Dict

from app.engine.dates import (
    compute_end_date,
    is_weekend_active_for_task,
    resolve_weekend,
)
from app.schemas import ShiftResult, ShiftWarning, ShiftedTask
from app.storage import dependencies_store, projects_store, tasks_store


def _get_project_weekend(project_id: int) -> bool:
    """Get the weekend_active flag for a project."""
    proj = projects_store.get(project_id)
    return proj.get("weekend_active", False) if proj else False


def _task_wa(task: Dict[str, Any]) -> bool:
    """Get effective weekend_active for a task."""
    return is_weekend_active_for_task(
        task.get("weekend_override"), _get_project_weekend(task["project_id"])
    )


def _parse_date(val: Any) -> date:
    """Parse a date from string or date object."""
    if isinstance(val, date):
        return val
    return date.fromisoformat(str(val))


def detect_cycle(parent_id: int, child_id: int) -> bool:
    """Check if adding parent_id -> child_id would create a cycle.

    Uses BFS from child_id following existing dependencies to see if we
    can reach parent_id (which would mean a cycle).
    """
    all_deps = dependencies_store.list_all()
    # Build adjacency: parent -> [children]
    adj: dict[int, list[int]] = {}
    for d in all_deps:
        adj.setdefault(d["parent_id"], []).append(d["child_id"])

    visited: set[int] = set()
    queue = deque([child_id])

    while queue:
        current = queue.popleft()
        if current == parent_id:
            return True
        if current in visited:
            continue
        visited.add(current)
        for cid in adj.get(current, []):
            if cid not in visited:
                queue.append(cid)

    return False


def get_dependency_children(task_id: int) -> list[tuple[Dict[str, Any], Dict[str, Any]]]:
    """Get all direct children of a task with their dependency info.

    Returns list of (child_task_dict, dependency_dict) tuples.
    """
    all_deps = dependencies_store.query(parent_id=task_id)
    results = []
    for dep in all_deps:
        child = tasks_store.get(dep["child_id"])
        if child:
            results.append((child, dep))
    return results


def get_dependency_parents(task_id: int) -> list[tuple[Dict[str, Any], Dict[str, Any]]]:
    """Get all direct parents of a task with their dependency info.

    Returns list of (parent_task_dict, dependency_dict) tuples.
    """
    all_deps = dependencies_store.query(child_id=task_id)
    results = []
    for dep in all_deps:
        parent = tasks_store.get(dep["parent_id"])
        if parent:
            results.append((parent, dep))
    return results


def find_ss_siblings(task_id: int) -> list[Dict[str, Any]]:
    """Find all tasks that start at the same time as this task via SS dependencies.

    This includes:
    - Tasks that this task has SS dependency with (this task is child, sibling is parent)
    - Tasks that have SS dependency with this task (this task is parent, sibling is child)

    Returns list of sibling task dicts.
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


def shift_task(
    task_id: int,
    new_start_date: date,
    confirmed: bool = False,
) -> ShiftResult:
    """Move a task to a new start date and recursively shift all dependents.

    Also shifts upstream parents if needed to maintain dependency constraints.

    Args:
        task_id: The task being moved.
        new_start_date: The desired new start date.
        confirmed: If True, suppress warnings and apply even if SF shifts into past.

    Returns:
        ShiftResult with all affected tasks and any warnings.
    """
    task = tasks_store.get(task_id)
    if task is None:
        raise ValueError(f"Task {task_id} not found")

    wa = _task_wa(task)

    # Resolve weekend for the moved task itself
    resolved_start = resolve_weekend(new_start_date, wa)

    # Compute old end date for the shift record
    old_start = _parse_date(task["start_date"])
    old_end = compute_end_date(old_start, task["duration_days"], wa)

    # Apply the move
    task["start_date"] = str(resolved_start)
    tasks_store.save(task_id, task)
    new_end = compute_end_date(resolved_start, task["duration_days"], wa)

    affected: list[ShiftedTask] = [
        ShiftedTask(
            task_id=task["id"],
            name=task["name"],
            old_start=old_start,
            new_start=resolved_start,
            old_end=old_end,
            new_end=new_end,
        )
    ]
    warnings: list[ShiftWarning] = []

    # First, shift upstream parents if needed (reverse cascade)
    # This ensures that if a child moves, parents adjust to maintain constraints
    upstream_queue: deque[int] = deque([task_id])
    upstream_visited: set[int] = {task_id}

    while upstream_queue:
        current_id = upstream_queue.popleft()
        current_task = tasks_store.get(current_id)
        if not current_task:
            continue

        parents = get_dependency_parents(current_id)

        for parent_task, dep in parents:
            if parent_task["id"] in upstream_visited:
                continue
            upstream_visited.add(parent_task["id"])

            parent_wa = _task_wa(parent_task)
            parent_old_start = _parse_date(parent_task["start_date"])
            parent_old_end = compute_end_date(
                parent_old_start, parent_task["duration_days"], parent_wa
            )

            current_start = _parse_date(current_task["start_date"])
            current_end = compute_end_date(
                current_start, current_task["duration_days"], _task_wa(current_task)
            )

            # Compute required parent position based on dependency type
            dep_type = dep["dep_type"]
            parent_new_start = None

            if dep_type == "FS":
                # Finish-to-Start: parent must finish before child starts
                # To maintain the relative gap, parent should end right before child starts
                # parent_end = child_start - 1
                required_parent_end = current_start - timedelta(days=1)
                if parent_old_end != required_parent_end:
                    # Parent needs to move (earlier or later) to maintain the gap
                    if parent_wa:
                        parent_new_start = required_parent_end - timedelta(
                            days=parent_task["duration_days"] - 1
                        )
                    else:
                        d = required_parent_end
                        remaining = parent_task["duration_days"] - 1
                        while remaining > 0:
                            d -= timedelta(days=1)
                            if d.weekday() < 5:
                                remaining -= 1
                        parent_new_start = d

            elif dep_type == "SS":
                # Start-to-Start: parent must start before or when child starts
                # parent_start <= child_start
                if parent_old_start > current_start:
                    # Parent needs to move earlier
                    parent_new_start = current_start

            elif dep_type == "SF":
                # Start-to-Finish: child finishes when parent starts
                # Based on frontend behavior, child is positioned to finish exactly
                # when parent starts: child_end = parent_start
                # So parent should start when child ends
                if parent_old_start != current_end:
                    # Parent needs to move (earlier or later) to start when child ends
                    parent_new_start = current_end

            if parent_new_start is not None:
                # Resolve weekends
                parent_new_start = resolve_weekend(parent_new_start, parent_wa)
                parent_new_end = compute_end_date(
                    parent_new_start, parent_task["duration_days"], parent_wa
                )

                # Apply the shift
                parent_task["start_date"] = str(parent_new_start)
                tasks_store.save(parent_task["id"], parent_task)

                affected.append(
                    ShiftedTask(
                        task_id=parent_task["id"],
                        name=parent_task["name"],
                        old_start=parent_old_start,
                        new_start=parent_new_start,
                        old_end=parent_old_end,
                        new_end=parent_new_end,
                    )
                )

                upstream_queue.append(parent_task["id"])

    # Then, recursively shift all downstream dependents (forward cascade)
    queue: deque[int] = deque([task_id])
    visited: set[int] = {task_id}

    while queue:
        current_id = queue.popleft()

        current_task = tasks_store.get(current_id)
        if not current_task:
            continue
        current_wa = _task_wa(current_task)
        current_start = _parse_date(current_task["start_date"])
        current_end = compute_end_date(
            current_start, current_task["duration_days"], current_wa
        )

        children = get_dependency_children(current_id)

        for child_task, dep in children:
            if child_task["id"] in visited:
                continue
            visited.add(child_task["id"])

            child_wa = _task_wa(child_task)
            child_old_start = _parse_date(child_task["start_date"])
            child_old_end = compute_end_date(
                child_old_start, child_task["duration_days"], child_wa
            )

            # Get ALL parents of this child to calculate the correct start date
            # A task with multiple parents should start based on ALL constraints
            all_parents = get_dependency_parents(child_task["id"])
            
            # Calculate required start date from each parent
            # For FS: child starts after parent ends (latest of all FS parents)
            # For SS: child starts at parent start (earliest of all SS parents)
            # For SF: child finishes when parent starts
            # IMPORTANT: For FS, also consider SS siblings of the parent
            # (child must wait for the longest sibling to finish)
            required_starts = []
            
            for parent_task, parent_dep in all_parents:
                parent_wa = _task_wa(parent_task)
                parent_start = _parse_date(parent_task["start_date"])
                parent_end = compute_end_date(
                    parent_start, parent_task["duration_days"], parent_wa
                )
                
                parent_dep_type = parent_dep["dep_type"]
                
                if parent_dep_type == "FS":
                    # Child starts after parent ends
                    # But also consider SS siblings of the parent
                    # The child must wait for the LONGEST sibling to finish
                    latest_end = parent_end
                    
                    # Find all SS siblings of this parent
                    ss_siblings = find_ss_siblings(parent_task["id"])
                    for sibling in ss_siblings:
                        sibling_wa = _task_wa(sibling)
                        sibling_start = _parse_date(sibling["start_date"])
                        sibling_end = compute_end_date(
                            sibling_start, sibling["duration_days"], sibling_wa
                        )
                        if sibling_end > latest_end:
                            latest_end = sibling_end
                    
                    required_start = latest_end + timedelta(days=1)
                    required_starts.append(required_start)
                elif parent_dep_type == "SS":
                    # Child starts at same time as parent
                    required_starts.append(parent_start)
                elif parent_dep_type == "SF":
                    # Child finishes when parent starts
                    if child_wa:
                        required_start = parent_start - timedelta(
                            days=child_task["duration_days"] - 1
                        )
                    else:
                        d = parent_start
                        remaining = child_task["duration_days"] - 1
                        while remaining > 0:
                            d -= timedelta(days=1)
                            if d.weekday() < 5:
                                remaining -= 1
                        required_start = d
                    required_starts.append(required_start)
            
            # The child must satisfy ALL constraints, so take the latest start
            if required_starts:
                child_new_start = max(required_starts)
            else:
                # No parents (shouldn't happen, but fallback)
                continue

            # Resolve weekends
            child_new_start = resolve_weekend(child_new_start, child_wa)
            child_new_end = compute_end_date(
                child_new_start, child_task["duration_days"], child_wa
            )

            # Check for SF shifting into the past
            today = date.today()
            dep_type = dep["dep_type"]
            if dep_type == "SF" and child_new_start < today:
                warnings.append(
                    ShiftWarning(
                        task_id=child_task["id"],
                        name=child_task["name"],
                        message=(
                            f"SF dependency shifts task '{child_task['name']}' "
                            f"start date to {child_new_start}, which is in the past."
                        ),
                    )
                )
                if not confirmed:
                    return ShiftResult(
                        affected_tasks=affected,
                        warnings=warnings,
                        requires_confirmation=True,
                    )

            # Apply the shift
            child_task["start_date"] = str(child_new_start)
            tasks_store.save(child_task["id"], child_task)

            affected.append(
                ShiftedTask(
                    task_id=child_task["id"],
                    name=child_task["name"],
                    old_start=child_old_start,
                    new_start=child_new_start,
                    old_end=child_old_end,
                    new_end=child_new_end,
                )
            )

            queue.append(child_task["id"])

    return ShiftResult(
        affected_tasks=affected,
        warnings=warnings,
        requires_confirmation=False,
    )
