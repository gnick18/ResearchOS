"""Dependency CRUD endpoints — JSON file storage."""

from typing import List, Optional

from fastapi import APIRouter, HTTPException

from app.engine.shift import detect_cycle
from app.git_sync import commit_and_push
from app.schemas import DependencyCreate, DependencyOut
from app.storage import dependencies_store, tasks_store

router = APIRouter(prefix="/dependencies", tags=["dependencies"])


@router.get("", response_model=List[DependencyOut])
async def list_dependencies(project_id: Optional[int] = None):
    """List all dependencies, optionally filtered by project_id."""
    all_deps = dependencies_store.list_all()
    if project_id is not None:
        # Filter to only deps where the parent task belongs to this project
        project_task_ids = {
            t["id"] for t in tasks_store.query(project_id=project_id)
        }
        all_deps = [
            d for d in all_deps if d.get("parent_id") in project_task_ids
        ]
    return [DependencyOut(**d) for d in all_deps]


@router.post("", response_model=DependencyOut, status_code=201)
async def create_dependency(body: DependencyCreate):
    # Prevent self-dependency
    if body.parent_id == body.child_id:
        raise HTTPException(
            status_code=400, detail="A task cannot depend on itself"
        )

    # Check that both tasks exist
    parent_task = tasks_store.get(body.parent_id)
    child_task = tasks_store.get(body.child_id)
    if not parent_task:
        raise HTTPException(status_code=404, detail="Parent task not found")
    if not child_task:
        raise HTTPException(status_code=404, detail="Child task not found")

    # Only experiments can have dependencies
    if parent_task.get("task_type") != "experiment":
        raise HTTPException(
            status_code=400,
            detail="Only experiment tasks can be set as dependencies (parent)",
        )
    if child_task.get("task_type") != "experiment":
        raise HTTPException(
            status_code=400,
            detail="Only experiment tasks can have dependencies (child)",
        )

    # Check for cycles
    if detect_cycle(body.parent_id, body.child_id):
        raise HTTPException(
            status_code=400,
            detail="Adding this dependency would create a circular reference",
        )

    # Check for duplicate
    existing = dependencies_store.query(
        parent_id=body.parent_id, child_id=body.child_id
    )
    if existing:
        raise HTTPException(
            status_code=409, detail="This dependency already exists"
        )

    rec = dependencies_store.create(body.model_dump())
    await commit_and_push(f"Create dependency: {body.parent_id} -> {body.child_id}")
    return DependencyOut(**rec)


@router.delete("/{dep_id}", status_code=204)
async def delete_dependency(dep_id: int):
    dep = dependencies_store.get(dep_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Dependency not found")
    dependencies_store.delete(dep_id)
    await commit_and_push(f"Delete dependency {dep_id}")
