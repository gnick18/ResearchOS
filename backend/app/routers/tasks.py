"""Task CRUD + move/replicate endpoints — JSON file storage."""

import json
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, HTTPException

from app.engine.dates import compute_end_date, is_weekend_active_for_task, resolve_weekend
from app.engine.shift import shift_task
from app.git_sync import commit_and_push
from app.schemas import (
    ShiftResult,
    TaskCreate,
    TaskMethodAttachment,
    TaskMoveRequest,
    TaskOut,
    TaskReplicateRequest,
    TaskUpdate,
    VariationNoteRequest,
)
from app.storage import (
    get_projects_store,
    get_tasks_store,
    get_methods_store,
    get_pcr_store,
    get_method_by_id,
    list_tasks_including_shared,
)
from app.config import settings

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _parse_date(val) -> date:
    if isinstance(val, date):
        return val
    return date.fromisoformat(str(val))


def _get_weekend_active(task: dict) -> bool:
    proj = get_projects_store().get(task["project_id"])
    project_wa = proj.get("weekend_active", False) if proj else False
    return is_weekend_active_for_task(task.get("weekend_override"), project_wa)


def _copy_pcr_data_for_method(method_id: int) -> dict:
    """Copy PCR gradient and ingredients from a PCR method.
    
    Returns a dict with pcr_gradient and pcr_ingredients fields ready to be
    stored on a method attachment, or empty dict if the method is not a PCR method.
    """
    method = get_method_by_id(method_id)
    if not method:
        return {}
    
    # Check if this is a PCR method
    github_path = method.get("github_path", "")
    if not github_path.startswith("pcr://protocol/"):
        return {}
    
    # Extract PCR protocol ID from the path
    try:
        pcr_id = int(github_path.replace("pcr://protocol/", ""))
    except ValueError:
        return {}
    
    # Get the PCR protocol (check both private and public stores)
    from app.storage import get_pcr_by_id
    pcr_protocol = get_pcr_by_id(pcr_id)
    if not pcr_protocol:
        return {}
    
    # Return the gradient and ingredients as-is (they're already JSON strings in storage)
    return {
        "pcr_gradient": pcr_protocol.get("gradient"),
        "pcr_ingredients": pcr_protocol.get("ingredients"),
    }


def _task_to_out(task: dict) -> TaskOut:
    from app.schemas import SubTask as SubTaskSchema, TaskMethodAttachment as TaskMethodAttachmentSchema, SharedUser
    
    wa = _get_weekend_active(task)
    start = _parse_date(task["start_date"])
    end = compute_end_date(start, task["duration_days"], wa)
    
    # Convert sub_tasks dict to SubTask schema objects if present
    sub_tasks = None
    if task.get("sub_tasks"):
        sub_tasks = [SubTaskSchema(**st) if isinstance(st, dict) else st for st in task["sub_tasks"]]
    
    # Convert method_attachments to schema objects if present
    method_attachments: List[TaskMethodAttachmentSchema] = []
    if task.get("method_attachments"):
        for att in task["method_attachments"]:
            if isinstance(att, dict):
                method_attachments.append(TaskMethodAttachmentSchema(**att))
            else:
                method_attachments.append(att)
    
    # Get method_ids from attachments or fall back to legacy method_ids field
    # Use or [] to handle None values (task.get returns None if key exists with None value)
    method_ids = task.get("method_ids") or []
    if not method_ids and method_attachments:
        method_ids = [att.method_id for att in method_attachments]
    
    # For backwards compatibility, set method_id to the first method
    method_id = method_ids[0] if method_ids else task.get("method_id")
    
    # Convert shared_with to SharedUser objects if present
    shared_with = []
    if task.get("shared_with"):
        for sw in task["shared_with"]:
            if isinstance(sw, dict):
                shared_with.append(SharedUser(**sw))
            else:
                shared_with.append(sw)
    
    return TaskOut(
        id=task["id"],
        project_id=task["project_id"],
        name=task["name"],
        start_date=start,
        duration_days=task["duration_days"],
        end_date=end,
        is_high_level=task.get("is_high_level", False),
        is_complete=task.get("is_complete", False),
        task_type=task.get("task_type", "other"),
        weekend_override=task.get("weekend_override"),
        method_id=method_id,
        method_ids=method_ids,
        deviation_log=task.get("deviation_log"),
        tags=task.get("tags"),
        sort_order=task.get("sort_order", 0),
        experiment_color=task.get("experiment_color"),
        sub_tasks=sub_tasks,
        pcr_gradient=task.get("pcr_gradient"),
        pcr_ingredients=task.get("pcr_ingredients"),
        method_attachments=method_attachments,
        owner=task.get("owner", ""),
        shared_with=shared_with,
        inherited_from_project=task.get("inherited_from_project"),
    )


def _copy_pcr_data_to_task(method_id: int) -> dict:
    """Copy PCR gradient and ingredients from a PCR method to a task.
    
    Returns a dict with pcr_gradient and pcr_ingredients fields ready to be
    stored on a task, or empty dict if the method is not a PCR method.
    """
    method = get_method_by_id(method_id)
    if not method:
        return {}
    
    # Check if this is a PCR method
    github_path = method.get("github_path", "")
    if not github_path.startswith("pcr://protocol/"):
        return {}
    
    # Extract PCR protocol ID from the path
    try:
        pcr_id = int(github_path.replace("pcr://protocol/", ""))
    except ValueError:
        return {}
    
    # Get the PCR protocol
    from app.storage import get_pcr_by_id
    pcr_protocol = get_pcr_by_id(pcr_id)
    if not pcr_protocol:
        return {}
    
    # Return the gradient and ingredients as-is (they're already JSON strings in storage)
    return {
        "pcr_gradient": pcr_protocol.get("gradient"),
        "pcr_ingredients": pcr_protocol.get("ingredients"),
    }


@router.get("/by-project/{project_id}", response_model=list[TaskOut])
async def list_tasks_by_project(project_id: int):
    tasks = get_tasks_store().query(project_id=project_id)
    tasks.sort(key=lambda t: (t.get("sort_order", 0), t.get("start_date", "")))
    return [_task_to_out(t) for t in tasks]


@router.get("/including-shared", response_model=list[TaskOut])
async def list_tasks_with_shared():
    """List user's own tasks plus tasks shared with them."""
    tasks = list_tasks_including_shared(settings.current_user)
    # Ensure all tasks have required fields
    for task in tasks:
        task.setdefault("owner", task.get("_owner", settings.current_user))
        task.setdefault("shared_with", [])
    # Sort by start date
    tasks.sort(key=lambda t: (t.get("start_date", ""), t.get("sort_order", 0)))
    return [_task_to_out(t) for t in tasks]


@router.get("/check-duplicate")
async def check_duplicate_task(
    project_id: int,
    name: str,
    task_type: str = "other",
    exclude_task_id: Optional[int] = None,
):
    """Check if a task with the same name exists in the same project with the same task type.
    
    Returns a list of matching tasks (existing or past tasks that match).
    """
    # Handle Miscellaneous project (project_id 0 means use the actual Miscellaneous project)
    actual_project_id = project_id
    if project_id == 0:
        from app.routers.projects import get_or_create_miscellaneous_project
        misc_project = get_or_create_miscellaneous_project()
        actual_project_id = misc_project["id"]
    
    # Get all tasks for this project
    all_tasks = get_tasks_store().query(project_id=actual_project_id)
    
    # Filter by name (case-insensitive) and task_type
    matching_tasks = []
    name_lower = name.strip().lower()
    
    for task in all_tasks:
        # Skip the task being edited (if exclude_task_id is provided)
        if exclude_task_id and task.get("id") == exclude_task_id:
            continue
        
        # Check if name matches (case-insensitive)
        task_name = task.get("name", "").strip().lower()
        if task_name == name_lower:
            # Check if task_type matches
            existing_task_type = task.get("task_type", "other")
            if existing_task_type == task_type:
                matching_tasks.append({
                    "id": task.get("id"),
                    "name": task.get("name"),
                    "task_type": existing_task_type,
                    "start_date": task.get("start_date"),
                    "is_complete": task.get("is_complete", False),
                })
    
    return {
        "has_duplicate": len(matching_tasks) > 0,
        "matching_tasks": matching_tasks,
    }


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(body: TaskCreate):
    data = body.model_dump()
    # If no project_id is provided, use the Miscellaneous project
    if data.get("project_id") is None:
        from app.routers.projects import get_or_create_miscellaneous_project
        misc_project = get_or_create_miscellaneous_project()
        data["project_id"] = misc_project["id"]
    # Resolve weekend on creation
    wa = False
    proj = get_projects_store().get(data["project_id"])
    if proj:
        wa = is_weekend_active_for_task(data.get("weekend_override"), proj.get("weekend_active", False))
    data["start_date"] = str(resolve_weekend(_parse_date(data["start_date"]), wa))
    data.setdefault("is_complete", False)
    data.setdefault("deviation_log", None)
    
    # Set owner field for sharing
    from app.config import settings
    data["owner"] = settings.current_user
    data["shared_with"] = []
    
    # Initialize method_attachments list
    method_attachments = []
    
    # Handle new method_ids field
    if data.get("method_ids"):
        for mid in data["method_ids"]:
            pcr_data = _copy_pcr_data_for_method(mid)
            method_attachments.append({
                "method_id": mid,
                **pcr_data
            })
    # Fall back to legacy method_id field for backwards compatibility
    elif data.get("method_id"):
        pcr_data = _copy_pcr_data_for_method(data["method_id"])
        method_attachments.append({
            "method_id": data["method_id"],
            **pcr_data
        })
        # Also set method_ids for consistency
        data["method_ids"] = [data["method_id"]]
    
    data["method_attachments"] = method_attachments
    
    # Legacy: also set pcr_gradient/pcr_ingredients from first method for backwards compat
    if method_attachments:
        data["pcr_gradient"] = method_attachments[0].get("pcr_gradient")
        data["pcr_ingredients"] = method_attachments[0].get("pcr_ingredients")

    rec = get_tasks_store().create(data)
    await commit_and_push(f"Create task: {rec['name']}")
    return _task_to_out(rec)


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(task_id: int):
    task = get_tasks_store().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_to_out(task)


@router.put("/{task_id}", response_model=TaskOut)
async def update_task(task_id: int, body: TaskUpdate):
    task = get_tasks_store().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    updates = body.model_dump(exclude_unset=True)
    
    # Prevent changing task_type once it's set
    if "task_type" in updates:
        current_type = task.get("task_type", "other")
        new_type = updates["task_type"]
        if current_type != new_type:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot change task type from '{current_type}' to '{new_type}'. Task types are immutable once set.",
            )
    
    # Convert date to string for JSON storage
    if "start_date" in updates and updates["start_date"] is not None:
        updates["start_date"] = str(updates["start_date"])

    # Handle method_attachments updates
    if "method_attachments" in updates:
        # Convert TaskMethodAttachment objects to dicts for JSON storage
        attachments = []
        for att in updates["method_attachments"]:
            if isinstance(att, dict):
                attachments.append(att)
            else:
                attachments.append(att.model_dump())
        updates["method_attachments"] = attachments
        # Also update method_ids for consistency
        updates["method_ids"] = [att["method_id"] for att in attachments]
    
    # Handle method_ids updates (rebuild method_attachments)
    if "method_ids" in updates and "method_attachments" not in updates:
        existing_attachments = task.get("method_attachments", [])
        new_attachments = []
        for mid in updates["method_ids"]:
            # Check if we already have an attachment for this method
            existing = next((a for a in existing_attachments if a.get("method_id") == mid), None)
            if existing:
                new_attachments.append(existing)
            else:
                # Create new attachment with PCR data copy
                pcr_data = _copy_pcr_data_for_method(mid)
                new_attachments.append({
                    "method_id": mid,
                    **pcr_data
                })
        updates["method_attachments"] = new_attachments
    
    # Legacy: If method_id is being changed, update method_attachments
    if "method_id" in updates and "method_ids" not in updates and "method_attachments" not in updates:
        new_method_id = updates["method_id"]
        if new_method_id is not None:
            pcr_data = _copy_pcr_data_for_method(new_method_id)
            updates["method_attachments"] = [{
                "method_id": new_method_id,
                **pcr_data
            }]
            updates["method_ids"] = [new_method_id]
            # Legacy fields
            updates["pcr_gradient"] = pcr_data.get("pcr_gradient")
            updates["pcr_ingredients"] = pcr_data.get("pcr_ingredients")
        else:
            # Method is being removed, clear all method data
            updates["method_attachments"] = []
            updates["method_ids"] = []
            updates["pcr_gradient"] = None
            updates["pcr_ingredients"] = None

    updated = get_tasks_store().update(task_id, updates)
    await commit_and_push(f"Update task: {updated['name']}")
    return _task_to_out(updated)


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: int):
    task = get_tasks_store().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task_name = task.get("name", f"Task {task_id}")
    task_type = task.get("task_type", "other")
    
    # Delete the task
    get_tasks_store().delete(task_id)
    
    # Delete dependencies referencing this task
    from app.storage import get_dependencies_store
    for dep in get_dependencies_store().list_all():
        if dep.get("parent_id") == task_id or dep.get("child_id") == task_id:
            get_dependencies_store().delete(dep["id"])
    
    # Clean up results directory if it exists
    from app.config import settings
    from pathlib import Path
    import shutil
    
    results_dir = Path(settings.github_localpath) / "results" / f"task-{task_id}"
    if results_dir.exists():
        shutil.rmtree(str(results_dir))
        print(f"Deleted results directory: {results_dir}")
    
    # Clean up attachment files and metadata for experiments
    if task_type == "experiment":
        from app.storage import (
            get_image_metadata_store, 
            get_file_metadata_store,
            _data_root,
        )
        
        img_store = get_image_metadata_store()
        file_store = get_file_metadata_store()
        
        # Get all entries for this experiment to find folders to clean
        img_entries = img_store.get_by_experiment(task_id)
        file_entries = file_store.get_by_experiment(task_id)
        
        # Get unique folders
        folders_to_clean = set()
        for entry in img_entries:
            folder = entry.get("folder")
            if folder:
                folders_to_clean.add(("Images", folder))
        for entry in file_entries:
            folder = entry.get("folder")
            if folder:
                folders_to_clean.add(("Files", folder))
        
        # Delete the actual files
        data_root = _data_root()
        for folder_type, folder_name in folders_to_clean:
            folder_path = data_root / folder_type / folder_name
            if folder_path.exists():
                shutil.rmtree(str(folder_path))
                print(f"Deleted {folder_type} folder: {folder_name}")
        
        # Delete metadata entries
        img_store.delete_by_experiment(task_id)
        file_store.delete_by_experiment(task_id)
    
    await commit_and_push(f"Delete task: {task_name}")


@router.get("/by-method/{method_id}", response_model=list[TaskOut])
async def list_tasks_by_method(method_id: int):
    """List all tasks linked to a specific method."""
    tasks = get_tasks_store().query(method_id=method_id)
    tasks.sort(key=lambda t: t.get("start_date", ""), reverse=True)
    return [_task_to_out(t) for t in tasks]


@router.post("/{task_id}/move", response_model=ShiftResult)
async def move_task(task_id: int, body: TaskMoveRequest):
    """Move a task and recursively shift all dependents."""
    try:
        result = shift_task(task_id, body.new_start_date, confirmed=body.confirmed)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    await commit_and_push(f"Move task {task_id} to {body.new_start_date}")
    return result


@router.post("/{task_id}/replicate", response_model=list[TaskOut], status_code=201)
async def replicate_task(task_id: int, body: TaskReplicateRequest):
    """Create N copies of a task, each offset by offset_days."""
    template = get_tasks_store().get(task_id)
    if not template:
        raise HTTPException(status_code=404, detail="Task not found")

    wa = _get_weekend_active(template)
    template_start = _parse_date(template["start_date"])
    created: list[TaskOut] = []

    for i in range(1, body.count + 1):
        new_start = template_start + timedelta(days=body.offset_days * i)
        new_start = resolve_weekend(new_start, wa)
        new_data = {
            "project_id": template["project_id"],
            "name": f"{template['name']} (Rep {i})",
            "start_date": str(new_start),
            "duration_days": template["duration_days"],
            "is_high_level": template.get("is_high_level", False),
            "is_complete": False,
            "weekend_override": template.get("weekend_override"),
            "method_id": template.get("method_id"),
            "deviation_log": None,
            "tags": template.get("tags"),
            "sort_order": template.get("sort_order", 0) + i,
            # Copy PCR data from template
            "pcr_gradient": template.get("pcr_gradient"),
            "pcr_ingredients": template.get("pcr_ingredients"),
        }
        rec = get_tasks_store().create(new_data)
        created.append(_task_to_out(rec))

    await commit_and_push(f"Replicate task: {template['name']} x{body.count}")
    return created


@router.post("/{task_id}/reset-pcr", response_model=TaskOut)
async def reset_task_pcr(task_id: int, method_id: Optional[int] = None):
    """Reset a task's PCR data to match the original method.
    
    This endpoint re-copies the gradient and ingredients from the linked PCR method,
    discarding any experiment-specific modifications.
    
    If method_id is provided, resets only that method's attachment.
    Otherwise, resets the first/primary method's attachment.
    """
    task = get_tasks_store().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Get method_attachments
    method_attachments = task.get("method_attachments", [])
    if not method_attachments:
        # Fall back to legacy method_id
        legacy_method_id = task.get("method_id")
        if not legacy_method_id:
            raise HTTPException(status_code=400, detail="Task has no linked methods")
        # Copy fresh PCR data from the method
        pcr_data = _copy_pcr_data_for_method(legacy_method_id)
        if not pcr_data:
            raise HTTPException(status_code=400, detail="Linked method is not a PCR method")
        updated = get_tasks_store().update(task_id, pcr_data)
        await commit_and_push(f"Reset PCR data for task: {updated['name']}")
        return _task_to_out(updated)
    
    # Determine which method to reset
    target_method_id = method_id or method_attachments[0].get("method_id")
    
    # Find and update the attachment
    updated_attachments = []
    for att in method_attachments:
        if att.get("method_id") == target_method_id:
            # Reset this attachment's PCR data
            pcr_data = _copy_pcr_data_for_method(target_method_id)
            updated_attachments.append({
                "method_id": target_method_id,
                **pcr_data
            })
        else:
            updated_attachments.append(att)
    
    updated = get_tasks_store().update(task_id, {"method_attachments": updated_attachments})
    await commit_and_push(f"Reset PCR data for task: {updated['name']}")
    return _task_to_out(updated)


@router.post("/{task_id}/methods/{method_id}", response_model=TaskOut)
async def add_method_to_task(task_id: int, method_id: int):
    """Add a method to a task's method list."""
    task = get_tasks_store().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Check if method exists (check both private and public)
    method = get_method_by_id(method_id)
    if not method:
        raise HTTPException(status_code=404, detail="Method not found")
    
    # Get existing attachments
    method_attachments = task.get("method_attachments", [])
    
    # Check if method is already attached
    if any(att.get("method_id") == method_id for att in method_attachments):
        raise HTTPException(status_code=400, detail="Method is already attached to this task")
    
    # Add new method attachment with PCR data copy
    pcr_data = _copy_pcr_data_for_method(method_id)
    method_attachments.append({
        "method_id": method_id,
        **pcr_data
    })
    
    updated = get_tasks_store().update(task_id, {
        "method_attachments": method_attachments,
        "method_ids": [att.get("method_id") for att in method_attachments]
    })
    await commit_and_push(f"Add method {method_id} to task: {updated['name']}")
    return _task_to_out(updated)


@router.delete("/{task_id}/methods/{method_id}", response_model=TaskOut)
async def remove_method_from_task(task_id: int, method_id: int):
    """Remove a method from a task's method list."""
    task = get_tasks_store().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Get existing attachments
    method_attachments = task.get("method_attachments", [])
    
    # Check if method is attached
    if not any(att.get("method_id") == method_id for att in method_attachments):
        raise HTTPException(status_code=400, detail="Method is not attached to this task")
    
    # Remove the method attachment
    updated_attachments = [att for att in method_attachments if att.get("method_id") != method_id]
    
    updated = get_tasks_store().update(task_id, {
        "method_attachments": updated_attachments,
        "method_ids": [att.get("method_id") for att in updated_attachments]
    })
    await commit_and_push(f"Remove method {method_id} from task: {updated['name']}")
    return _task_to_out(updated)


@router.put("/{task_id}/methods/{method_id}/pcr", response_model=TaskOut)
async def update_method_pcr_data(
    task_id: int, 
    method_id: int, 
    pcr_gradient: Optional[str] = None,
    pcr_ingredients: Optional[str] = None
):
    """Update PCR data for a specific method attachment on a task."""
    task = get_tasks_store().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Get existing attachments
    method_attachments = task.get("method_attachments", [])
    
    # Find the attachment to update
    attachment_found = False
    updated_attachments = []
    for att in method_attachments:
        if att.get("method_id") == method_id:
            attachment_found = True
            updated_att = {"method_id": method_id}
            if pcr_gradient is not None:
                updated_att["pcr_gradient"] = pcr_gradient
            elif att.get("pcr_gradient"):
                updated_att["pcr_gradient"] = att["pcr_gradient"]
            if pcr_ingredients is not None:
                updated_att["pcr_ingredients"] = pcr_ingredients
            elif att.get("pcr_ingredients"):
                updated_att["pcr_ingredients"] = att["pcr_ingredients"]
            updated_attachments.append(updated_att)
        else:
            updated_attachments.append(att)
    
    if not attachment_found:
        raise HTTPException(status_code=400, detail="Method is not attached to this task")
    
    updated = get_tasks_store().update(task_id, {"method_attachments": updated_attachments})
    await commit_and_push(f"Update PCR data for method {method_id} on task: {updated['name']}")
    return _task_to_out(updated)


@router.put("/{task_id}/methods/{method_id}/notes", response_model=TaskOut)
async def save_variation_notes(
    task_id: int, 
    method_id: int, 
    body: VariationNoteRequest
):
    """Save variation notes for a specific method attachment on a task.
    
    This endpoint allows users to document variations made to a method
    during a specific experimental run. Notes are stored as markdown content
    with timestamped entries.
    """
    task = get_tasks_store().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Get existing attachments
    method_attachments = task.get("method_attachments", [])
    
    # Find the attachment to update
    attachment_found = False
    updated_attachments = []
    for att in method_attachments:
        if att.get("method_id") == method_id:
            attachment_found = True
            updated_att = {
                "method_id": method_id,
                "variation_notes": body.variation_notes,
            }
            # Preserve existing PCR data if present
            if att.get("pcr_gradient"):
                updated_att["pcr_gradient"] = att["pcr_gradient"]
            if att.get("pcr_ingredients"):
                updated_att["pcr_ingredients"] = att["pcr_ingredients"]
            updated_attachments.append(updated_att)
        else:
            updated_attachments.append(att)
    
    if not attachment_found:
        raise HTTPException(status_code=400, detail="Method is not attached to this task")
    
    updated = get_tasks_store().update(task_id, {"method_attachments": updated_attachments})
    await commit_and_push(f"Save variation notes for method {method_id} on task: {updated['name']}")
    return _task_to_out(updated)


@router.post("/{task_id}/convert", response_model=TaskOut)
async def convert_task_type(task_id: int, new_task_type: str):
    """Convert a task from one type to another.
    
    This endpoint allows converting between 'experiment', 'purchase', and 'list' types.
    Shared metadata (name, dates, project, duration, completion status, etc.) is preserved.
    Type-specific data will be cleared:
    
    - Converting FROM experiment: clears method_ids, method_attachments, pcr_gradient, 
      pcr_ingredients, deviation_log, experiment_color
    - Converting FROM purchase: clears associated purchase items
    - Converting FROM list: clears sub_tasks
    
    The user should be warned about data loss before calling this endpoint.
    """
    task = get_tasks_store().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    current_type = task.get("task_type", "list")
    
    # Validate new task type
    valid_types = ["experiment", "purchase", "list"]
    if new_task_type not in valid_types:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid task type '{new_task_type}'. Must be one of: {', '.join(valid_types)}"
        )
    
    # No change needed
    if current_type == new_task_type:
        return _task_to_out(task)
    
    # Build update dict - preserve shared metadata, clear type-specific data
    updates = {
        "task_type": new_task_type,
        # Clear experiment-specific fields
        "method_ids": [],
        "method_attachments": [],
        "method_id": None,
        "pcr_gradient": None,
        "pcr_ingredients": None,
        "deviation_log": None,
        "experiment_color": None,
        # Clear list-specific fields
        "sub_tasks": None,
    }
    
    # If converting from purchase, delete associated purchase items
    if current_type == "purchase":
        from app.storage import get_purchase_items_store
        purchase_items = get_purchase_items_store().query(task_id=task_id)
        for item in purchase_items:
            get_purchase_items_store().delete(item["id"])
    
    updated = get_tasks_store().update(task_id, updates)
    await commit_and_push(f"Convert task {task_id} from {current_type} to {new_task_type}: {updated['name']}")
    return _task_to_out(updated)
