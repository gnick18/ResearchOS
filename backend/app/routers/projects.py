"""Project CRUD endpoints — JSON file storage."""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.git_sync import commit_and_push
from app.schemas import ProjectCreate, ProjectOut, ProjectUpdate
from app.storage import projects_store

router = APIRouter(prefix="/projects", tags=["projects"])


def _to_out(rec: dict) -> ProjectOut:
    # Ensure defaults for new fields
    rec.setdefault("sort_order", 0)
    rec.setdefault("is_archived", False)
    rec.setdefault("archived_at", None)
    return ProjectOut(**rec)


@router.get("", response_model=list[ProjectOut])
async def list_projects():
    records = projects_store.list_all()
    # Ensure all records have the new fields with defaults
    for rec in records:
        rec.setdefault("sort_order", 0)
        rec.setdefault("is_archived", False)
        rec.setdefault("archived_at", None)
    # Sort by sort_order first, then by created_at descending for items with same order
    records.sort(key=lambda r: (r.get("is_archived", False), r.get("sort_order", 0), -datetime.fromisoformat(r.get("created_at", "1970-01-01")).timestamp() if r.get("created_at") else 0))
    return [_to_out(r) for r in records]


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(body: ProjectCreate):
    data = body.model_dump()
    data["created_at"] = datetime.utcnow().isoformat()
    # Set default sort_order to be after all existing non-archived projects
    existing = projects_store.list_all()
    max_order = max((p.get("sort_order", 0) for p in existing if not p.get("is_archived", False)), default=-1)
    data["sort_order"] = max_order + 1
    data["is_archived"] = False
    data["archived_at"] = None
    rec = projects_store.create(data)
    await commit_and_push(f"Create project: {rec['name']}")
    return _to_out(rec)


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: int):
    rec = projects_store.get(project_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Project not found")
    return _to_out(rec)


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(project_id: int, body: ProjectUpdate):
    rec = projects_store.get(project_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Project not found")

    updates = body.model_dump(exclude_unset=True)
    updated = projects_store.update(project_id, updates)
    await commit_and_push(f"Update project: {updated['name']}")
    return _to_out(updated)


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: int):
    rec = projects_store.get(project_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Project not found")
    # Also delete all tasks and dependencies for this project
    from app.storage import tasks_store, dependencies_store

    tasks = tasks_store.query(project_id=project_id)
    task_ids = {t["id"] for t in tasks}
    for t in tasks:
        tasks_store.delete(t["id"])
    # Delete dependencies that reference any of those tasks
    for dep in dependencies_store.list_all():
        if dep.get("parent_id") in task_ids or dep.get("child_id") in task_ids:
            dependencies_store.delete(dep["id"])

    projects_store.delete(project_id)
    await commit_and_push(f"Delete project: {rec['name']}")


# New endpoint for reordering projects
class ReorderRequest(BaseModel):
    project_ids: List[int]


@router.post("/reorder", status_code=200)
async def reorder_projects(body: ReorderRequest):
    """Update sort_order for all projects based on the provided order."""
    for idx, project_id in enumerate(body.project_ids):
        rec = projects_store.get(project_id)
        if rec:
            rec["sort_order"] = idx
            projects_store.save(project_id, rec)
    await commit_and_push("Reorder projects")
    return {"status": "ok"}


# New endpoint for archiving/unarchiving projects
class ArchiveRequest(BaseModel):
    is_archived: bool


@router.post("/{project_id}/archive", response_model=ProjectOut)
async def archive_project(project_id: int, body: ArchiveRequest):
    """Archive or unarchive a project."""
    rec = projects_store.get(project_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Project not found")
    
    rec["is_archived"] = body.is_archived
    if body.is_archived:
        rec["archived_at"] = datetime.utcnow().isoformat()
    else:
        rec["archived_at"] = None
        # When unarchiving, set sort_order to be after all existing non-archived projects
        existing = projects_store.list_all()
        max_order = max((p.get("sort_order", 0) for p in existing if not p.get("is_archived", False)), default=-1)
        rec["sort_order"] = max_order + 1
    
    projects_store.save(project_id, rec)
    action = "Archive" if body.is_archived else "Unarchive"
    await commit_and_push(f"{action} project: {rec['name']}")
    return _to_out(rec)
