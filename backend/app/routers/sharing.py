"""Sharing API endpoints for tasks, methods, and projects.

Provides endpoints for:
- Sharing items with specific users
- Removing shared access
- Listing shared items
- Managing notifications
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.git_sync import commit_and_push
from app.schemas import ShareRequest, SharedUser, Notification
from app.storage import (
    get_tasks_store,
    get_projects_store,
    get_methods_store,
    get_public_methods_store,
    get_method_by_id,
    add_shared_item,
    remove_shared_item,
    get_shared_items_for_user,
    get_notifications_for_user,
    dismiss_notification,
    dismiss_all_notifications,
    get_dependency_chain,
    check_task_access,
    update_shared_task,
    get_task_from_owner,
    get_project_from_owner,
)

router = APIRouter(prefix="/sharing", tags=["sharing"])


# ── Response Models ───────────────────────────────────────────────────────────


class ShareResponse(BaseModel):
    """Response after sharing an item."""
    status: str
    item_id: int
    item_type: str
    shared_with: str
    permission: str
    chain_shared_count: Optional[int] = None
    tasks_shared_count: Optional[int] = None


class DependencyChainResponse(BaseModel):
    """Response for dependency chain preview."""
    task_id: int
    chain_task_ids: List[int]
    chain_count: int


class SharedItemResponse(BaseModel):
    """Response for a shared item."""
    id: int
    owner: str
    permission: str
    shared_at: str


class SharedItemsResponse(BaseModel):
    """Response for listing shared items."""
    projects: List[SharedItemResponse]
    tasks: List[SharedItemResponse]
    methods: List[SharedItemResponse]


class NotificationResponse(BaseModel):
    """Response for notifications list."""
    notifications: List[dict]
    unread_count: int


# ── Task Sharing Endpoints ────────────────────────────────────────────────────


@router.post("/tasks/{task_id}", response_model=ShareResponse)
async def share_task(task_id: int, body: ShareRequest):
    """Share a task with another user.
    
    If include_chain is True, shares all tasks in the dependency chain.
    Only the task owner can share the task.
    """
    # Verify task exists and user owns it
    task = get_tasks_store().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Check ownership
    owner = task.get("owner") or settings.current_user
    if owner != settings.current_user:
        raise HTTPException(status_code=403, detail="Only the task owner can share it")
    
    # Verify target user exists
    from app.routers.users import _user_exists
    if not _user_exists(body.username):
        raise HTTPException(status_code=404, detail=f"User '{body.username}' does not exist")
    
    # Can't share with yourself
    if body.username == settings.current_user:
        raise HTTPException(status_code=400, detail="Cannot share an item with yourself")
    
    task_ids_to_share = [task_id]
    
    # If include_chain, get all tasks in dependency chain
    if body.include_chain:
        chain_ids = get_dependency_chain(task_id)
        # Verify we own all tasks in the chain
        for tid in chain_ids:
            if tid != task_id:
                chain_task = get_tasks_store().get(tid)
                if not chain_task:
                    continue
                chain_owner = chain_task.get("owner") or settings.current_user
                if chain_owner != settings.current_user:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Cannot share entire chain: task {tid} is not owned by you"
                    )
        task_ids_to_share = chain_ids
    
    # Share each task
    shared_count = 0
    for tid in task_ids_to_share:
        t = get_tasks_store().get(tid)
        if t:
            success = add_shared_item(
                target_username=body.username,
                item_type="task",
                item_id=tid,
                owner=settings.current_user,
                permission=body.permission,
                item_name=t.get("name", f"Task {tid}")
            )
            if success:
                shared_count += 1
    
    await commit_and_push(f"Share {shared_count} task(s) with {body.username}")
    
    return ShareResponse(
        status="ok",
        item_id=task_id,
        item_type="task",
        shared_with=body.username,
        permission=body.permission,
        chain_shared_count=shared_count if body.include_chain else None
    )


@router.get("/tasks/{task_id}/chain", response_model=DependencyChainResponse)
async def get_task_dependency_chain(task_id: int):
    """Get all tasks in the dependency chain for a task.
    
    Used to preview what would be shared if include_chain is true.
    """
    task = get_tasks_store().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    chain_ids = get_dependency_chain(task_id)
    
    return DependencyChainResponse(
        task_id=task_id,
        chain_task_ids=chain_ids,
        chain_count=len(chain_ids)
    )


@router.delete("/tasks/{task_id}/users/{username}", response_model=ShareResponse)
async def unshare_task(task_id: int, username: str):
    """Remove a user's access to a task.
    
    Only the task owner can remove sharing.
    """
    task = get_tasks_store().get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    owner = task.get("owner") or settings.current_user
    if owner != settings.current_user:
        raise HTTPException(status_code=403, detail="Only the task owner can remove sharing")
    
    success = remove_shared_item(
        target_username=username,
        item_type="task",
        item_id=task_id,
        owner=settings.current_user
    )
    
    if not success:
        raise HTTPException(status_code=404, detail="Sharing not found")
    
    await commit_and_push(f"Remove task {task_id} access from {username}")
    
    return ShareResponse(
        status="ok",
        item_id=task_id,
        item_type="task",
        shared_with=username,
        permission="none"
    )


# ── Method Sharing Endpoints ──────────────────────────────────────────────────


@router.post("/methods/{method_id}", response_model=ShareResponse)
async def share_method(method_id: int, body: ShareRequest):
    """Share a method with another user.
    
    Only the method owner can share it.
    """
    # Get method (check both private and public stores)
    method = get_method_by_id(method_id)
    if not method:
        raise HTTPException(status_code=404, detail="Method not found")
    
    # Check ownership
    owner = method.get("owner") or method.get("created_by") or settings.current_user
    if owner != settings.current_user:
        raise HTTPException(status_code=403, detail="Only the method owner can share it")
    
    # Verify target user exists
    from app.routers.users import _user_exists
    if not _user_exists(body.username):
        raise HTTPException(status_code=404, detail=f"User '{body.username}' does not exist")
    
    # Can't share with yourself
    if body.username == settings.current_user:
        raise HTTPException(status_code=400, detail="Cannot share an item with yourself")
    
    # Share the method
    success = add_shared_item(
        target_username=body.username,
        item_type="method",
        item_id=method_id,
        owner=owner,
        permission=body.permission,
        item_name=method.get("name", f"Method {method_id}")
    )
    
    if not success:
        raise HTTPException(status_code=400, detail="Method is already shared with this user")
    
    await commit_and_push(f"Share method '{method.get('name')}' with {body.username}")
    
    return ShareResponse(
        status="ok",
        item_id=method_id,
        item_type="method",
        shared_with=body.username,
        permission=body.permission
    )


@router.delete("/methods/{method_id}/users/{username}", response_model=ShareResponse)
async def unshare_method(method_id: int, username: str):
    """Remove a user's access to a method.
    
    Only the method owner can remove sharing.
    """
    method = get_method_by_id(method_id)
    if not method:
        raise HTTPException(status_code=404, detail="Method not found")
    
    owner = method.get("owner") or method.get("created_by") or settings.current_user
    if owner != settings.current_user:
        raise HTTPException(status_code=403, detail="Only the method owner can remove sharing")
    
    success = remove_shared_item(
        target_username=username,
        item_type="method",
        item_id=method_id,
        owner=owner
    )
    
    if not success:
        raise HTTPException(status_code=404, detail="Sharing not found")
    
    await commit_and_push(f"Remove method {method_id} access from {username}")
    
    return ShareResponse(
        status="ok",
        item_id=method_id,
        item_type="method",
        shared_with=username,
        permission="none"
    )


# ── Project Sharing Endpoints ─────────────────────────────────────────────────


@router.post("/projects/{project_id}", response_model=ShareResponse)
async def share_project(project_id: int, body: ShareRequest):
    """Share a project with another user.
    
    All tasks in the project will be visible to the shared user.
    Only the project owner can share it.
    """
    project = get_projects_store().get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Check ownership
    owner = project.get("owner") or settings.current_user
    if owner != settings.current_user:
        raise HTTPException(status_code=403, detail="Only the project owner can share it")
    
    # Verify target user exists
    from app.routers.users import _user_exists
    if not _user_exists(body.username):
        raise HTTPException(status_code=404, detail=f"User '{body.username}' does not exist")
    
    # Can't share with yourself
    if body.username == settings.current_user:
        raise HTTPException(status_code=400, detail="Cannot share an item with yourself")
    
    # Share the project
    success = add_shared_item(
        target_username=body.username,
        item_type="project",
        item_id=project_id,
        owner=settings.current_user,
        permission=body.permission,
        item_name=project.get("name", f"Project {project_id}")
    )
    
    if not success:
        raise HTTPException(status_code=400, detail="Project is already shared with this user")
    
    await commit_and_push(f"Share project '{project.get('name')}' with {body.username}")
    
    return ShareResponse(
        status="ok",
        item_id=project_id,
        item_type="project",
        shared_with=body.username,
        permission=body.permission
    )


@router.delete("/projects/{project_id}/users/{username}", response_model=ShareResponse)
async def unshare_project(project_id: int, username: str):
    """Remove a user's access to a project.
    
    Only the project owner can remove sharing.
    """
    project = get_projects_store().get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    owner = project.get("owner") or settings.current_user
    if owner != settings.current_user:
        raise HTTPException(status_code=403, detail="Only the project owner can remove sharing")
    
    success = remove_shared_item(
        target_username=username,
        item_type="project",
        item_id=project_id,
        owner=settings.current_user
    )
    
    if not success:
        raise HTTPException(status_code=404, detail="Sharing not found")
    
    await commit_and_push(f"Remove project {project_id} access from {username}")
    
    return ShareResponse(
        status="ok",
        item_id=project_id,
        item_type="project",
        shared_with=username,
        permission="none"
    )


# ── Shared Items Listing ──────────────────────────────────────────────────────


@router.get("/shared-with-me", response_model=SharedItemsResponse)
async def list_shared_with_me():
    """List all items shared with the current user."""
    shared = get_shared_items_for_user(settings.current_user)
    
    def to_response(items: List[dict]) -> List[SharedItemResponse]:
        return [
            SharedItemResponse(
                id=item.get("id"),
                owner=item.get("owner"),
                permission=item.get("permission"),
                shared_at=item.get("shared_at")
            )
            for item in items
        ]
    
    return SharedItemsResponse(
        projects=to_response(shared.get("projects", [])),
        tasks=to_response(shared.get("tasks", [])),
        methods=to_response(shared.get("methods", []))
    )


# ── Notification Endpoints ────────────────────────────────────────────────────


@router.get("/notifications", response_model=NotificationResponse)
async def list_notifications(unread_only: bool = False):
    """Get notifications for the current user."""
    notifications = get_notifications_for_user(settings.current_user, unread_only=unread_only)
    unread_count = sum(1 for n in notifications if not n.get("read", False))
    
    return NotificationResponse(
        notifications=notifications,
        unread_count=unread_count
    )


@router.post("/notifications/{notification_id}/dismiss")
async def dismiss_single_notification(notification_id: str):
    """Mark a single notification as read."""
    success = dismiss_notification(settings.current_user, notification_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    return {"status": "ok", "notification_id": notification_id}


@router.post("/notifications/dismiss-all")
async def dismiss_all_user_notifications():
    """Mark all notifications as read."""
    count = dismiss_all_notifications(settings.current_user)
    
    return {"status": "ok", "dismissed_count": count}
