"""Method library CRUD + deviation/fork workflow -- JSON file storage."""

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.git_sync import commit_and_push
from app.storage import methods_store, tasks_store

router = APIRouter(prefix="/methods", tags=["methods"])


# -- Schemas -------------------------------------------------------------------


class MethodAttachment(BaseModel):
    """A single attachment (file or protocol) within a method."""
    id: str
    name: str
    attachment_type: str  # "markdown", "pdf", or "pcr"
    path: str  # GitHub path or pcr://protocol/{id}
    order: int = 0  # Display order


class MethodCreate(BaseModel):
    name: str
    github_path: Optional[str] = None  # Legacy: kept for backwards compatibility
    method_type: str = "markdown"  # Legacy: "markdown", "pdf", or "pcr"
    folder_path: Optional[str] = None
    parent_method_id: Optional[int] = None
    tags: Optional[List[str]] = None
    attachments: Optional[List[MethodAttachment]] = None  # New: multiple attachments


class MethodUpdate(BaseModel):
    """Update schema for methods - all fields optional."""
    name: Optional[str] = None
    github_path: Optional[str] = None
    method_type: Optional[str] = None
    folder_path: Optional[str] = None
    parent_method_id: Optional[int] = None
    tags: Optional[List[str]] = None
    attachments: Optional[List[MethodAttachment]] = None


class MethodOut(BaseModel):
    id: int
    name: str
    github_path: Optional[str] = None  # Legacy: may be null for new multi-attachment methods
    method_type: Optional[str] = None  # Legacy: may be null for new multi-attachment methods
    folder_path: Optional[str]
    parent_method_id: Optional[int]
    tags: Optional[List[str]]
    attachments: List[MethodAttachment] = []  # Always present, may be empty


class MethodForkRequest(BaseModel):
    """Fork a method: create a new child method with deviations baked in."""
    new_name: str
    new_github_path: str
    deviations: str  # Markdown text describing what changed


class DeviationSaveRequest(BaseModel):
    """Save deviations to the task's result file only (no method fork)."""
    task_id: int
    deviations: str


# -- Endpoints -----------------------------------------------------------------


def _to_out(r: dict) -> MethodOut:
    """Convert record dict to MethodOut, handling legacy and new formats."""
    # Ensure method_type has a default for older records
    r.setdefault("method_type", "markdown")
    
    # Handle migration from old single-file format to new attachments format
    if "attachments" not in r or not r["attachments"]:
        # Migrate old format to new attachments format
        attachments = []
        if r.get("github_path"):
            # Determine type from path or method_type field
            method_type = r.get("method_type", "markdown")
            if method_type == "pcr" or r["github_path"].startswith("pcr://"):
                att_type = "pcr"
            elif method_type == "pdf" or r["github_path"].endswith(".pdf"):
                att_type = "pdf"
            else:
                att_type = "markdown"
            
            attachments = [{
                "id": "primary",
                "name": r.get("name", "Main"),
                "attachment_type": att_type,
                "path": r["github_path"],
                "order": 0
            }]
        r["attachments"] = attachments
    else:
        # Ensure attachments have all required fields
        for att in r["attachments"]:
            att.setdefault("id", f"att-{att.get('order', 0)}")
            att.setdefault("name", "Attachment")
            att.setdefault("attachment_type", "markdown")
            att.setdefault("order", 0)
    
    return MethodOut(**r)


@router.get("", response_model=list[MethodOut])
async def list_methods():
    records = methods_store.list_all()
    records.sort(key=lambda r: r.get("name", ""))
    return [_to_out(r) for r in records]


@router.post("", response_model=MethodOut, status_code=201)
async def create_method(body: MethodCreate):
    # Check for duplicate method name
    existing = methods_store.list_all()
    for method in existing:
        if method.get("name", "").lower() == body.name.lower():
            raise HTTPException(
                status_code=400, 
                detail=f"A method with the name '{body.name}' already exists. Please choose a different name."
            )
    
    data = body.model_dump()
    
    # Handle legacy format: if attachments not provided but github_path is, create attachment
    if not data.get("attachments") and data.get("github_path"):
        method_type = data.get("method_type", "markdown")
        if method_type == "pcr" or data["github_path"].startswith("pcr://"):
            att_type = "pcr"
        elif method_type == "pdf" or data["github_path"].endswith(".pdf"):
            att_type = "pdf"
        else:
            att_type = "markdown"
        
        data["attachments"] = [{
            "id": "primary",
            "name": data.get("name", "Main"),
            "attachment_type": att_type,
            "path": data["github_path"],
            "order": 0
        }]
    elif not data.get("attachments"):
        data["attachments"] = []
    
    rec = methods_store.create(data)
    await commit_and_push(f"Create method: {rec['name']}")
    return _to_out(rec)


@router.get("/{method_id}", response_model=MethodOut)
async def get_method(method_id: int):
    rec = methods_store.get(method_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Method not found")
    return _to_out(rec)


@router.get("/{method_id}/children", response_model=list[MethodOut])
async def get_method_children(method_id: int):
    """Get all child methods (forks) of a method."""
    children = methods_store.query(parent_method_id=method_id)
    return [_to_out(c) for c in children]


@router.post("/{method_id}/fork", response_model=MethodOut, status_code=201)
async def fork_method(method_id: int, body: MethodForkRequest):
    """Fork a method: create a new child method inheriting parent's tags."""
    parent = methods_store.get(method_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent method not found")

    child_data = {
        "name": body.new_name,
        "github_path": body.new_github_path,
        "method_type": "markdown",  # Forks are always markdown
        "folder_path": parent.get("folder_path"),
        "parent_method_id": parent["id"],
        "tags": parent.get("tags"),
    }
    rec = methods_store.create(child_data)
    await commit_and_push(f"Fork method: {parent['name']} -> {rec['name']}")
    return _to_out(rec)


@router.post("/save-deviation")
async def save_deviation_to_task(body: DeviationSaveRequest):
    """Save deviations to the task's deviation_log only (no method fork)."""
    task = tasks_store.get(body.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    existing_log = task.get("deviation_log") or ""
    if existing_log:
        task["deviation_log"] = f"{existing_log}\n\n---\n\n{body.deviations}"
    else:
        task["deviation_log"] = body.deviations

    tasks_store.save(task["id"], task)
    await commit_and_push(f"Save deviation for task {task['id']}")
    return {"status": "ok", "task_id": task["id"]}


@router.put("/{method_id}", response_model=MethodOut)
async def update_method(method_id: int, body: MethodUpdate):
    """Update a method's metadata (name, folder_path, tags, attachments, etc.)."""
    rec = methods_store.get(method_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Method not found")
    updates = body.model_dump(exclude_unset=True)
    
    # Check for duplicate name if name is being changed
    if "name" in updates and updates["name"] != rec.get("name"):
        existing = methods_store.list_all()
        for method in existing:
            if method.get("name", "").lower() == updates["name"].lower() and method["id"] != method_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"A method with the name '{updates['name']}' already exists. Please choose a different name."
                )
    
    # Handle legacy format migration on update
    if "attachments" in updates and updates["attachments"]:
        # Clear legacy fields when attachments are explicitly set
        updates["github_path"] = None
        updates["method_type"] = None
    
    updated = methods_store.update(method_id, updates)
    await commit_and_push(f"Update method: {updated['name']}")
    return _to_out(updated)


@router.get("/{method_id}/experiments")
async def get_method_experiments(method_id: int):
    """Get all experiments (tasks) that have this method attached."""
    from app.engine.dates import compute_end_date, is_weekend_active_for_task
    from app.storage import projects_store
    
    # Verify method exists
    rec = methods_store.get(method_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Method not found")
    
    # Find all tasks that have this method_id in their method_ids list or method_attachments
    all_tasks = tasks_store.list_all()
    experiments = []
    
    for task in all_tasks:
        # Check method_ids list (use or [] to handle None)
        method_ids = task.get("method_ids") or []
        
        # Check method_attachments (use or [] to handle None)
        method_attachments = task.get("method_attachments") or []
        attachment_method_ids = [att.get("method_id") for att in method_attachments if att.get("method_id")]
        
        # Also check legacy method_id field
        legacy_method_id = task.get("method_id")
        
        # Check if this method is linked in any of the ways
        if method_id in method_ids or method_id in attachment_method_ids or legacy_method_id == method_id:
            # Compute end_date if not stored
            start_date = task.get("start_date")
            duration_days = task.get("duration_days", 1)
            
            # Compute end date using the same logic as tasks router
            from datetime import date
            try:
                start = date.fromisoformat(str(start_date)) if start_date else date.today()
            except (ValueError, TypeError):
                start = date.today()
            
            # Get weekend active status
            proj = projects_store.get(task.get("project_id"))
            project_wa = proj.get("weekend_active", False) if proj else False
            wa = is_weekend_active_for_task(task.get("weekend_override"), project_wa)
            
            end_date = compute_end_date(start, duration_days, wa)
            
            # Get variation notes for this specific method
            variation_notes = None
            method_attachments = task.get("method_attachments") or []
            for att in method_attachments:
                if att.get("method_id") == method_id:
                    variation_notes = att.get("variation_notes")
                    break
            
            experiments.append({
                "id": task["id"],
                "name": task["name"],
                "project_id": task["project_id"],
                "start_date": str(start_date) if start_date else str(start),
                "duration_days": duration_days,
                "end_date": str(end_date),
                "is_complete": task.get("is_complete", False),
                "task_type": task.get("task_type", "experiment"),
                "experiment_color": task.get("experiment_color"),
                "variation_notes": variation_notes,
            })
    
    # Sort by start date descending (most recent first)
    experiments.sort(key=lambda t: t["start_date"], reverse=True)
    
    return experiments


@router.delete("/{method_id}", status_code=204)
async def delete_method(method_id: int):
    rec = methods_store.get(method_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Method not found")
    methods_store.delete(method_id)
    await commit_and_push(f"Delete method: {rec['name']}")
