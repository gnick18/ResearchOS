"""Lab Mode endpoints for cross-user data access.

Lab Mode provides view-only access to all data across all users.
This is designed for PIs, lab managers, and students to find notes
from each other or review work from past researchers.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.routers.users import _migrate_existing_users, USER_COLOR_PALETTE

router = APIRouter(prefix="/lab", tags=["lab"])


# ── Request/Response Models ────────────────────────────────────────────────────

class LabUser(BaseModel):
    """User info for Lab Mode."""
    username: str
    color: str
    created_at: Optional[str] = None


class LabUsersResponse(BaseModel):
    """Response for listing all users with metadata."""
    users: List[LabUser]


class LabTask(BaseModel):
    """Task with user attribution for Lab Mode."""
    id: int
    name: str
    project_id: int
    start_date: str
    duration_days: int
    end_date: str
    is_complete: bool
    task_type: str
    username: str
    user_color: str
    experiment_color: Optional[str] = None
    method_ids: List[int] = []
    notes: Optional[str] = None


class LabProject(BaseModel):
    """Project with user attribution for Lab Mode."""
    id: int
    name: str
    color: str
    username: str
    user_color: str
    is_archived: bool = False


class LabMethod(BaseModel):
    """Method with user attribution for Lab Mode."""
    id: int
    name: str
    username: str
    user_color: str
    is_public: bool = False


class LabSearchResult(BaseModel):
    """Search result with user attribution."""
    type: str  # 'task', 'project', 'method'
    id: int
    name: str
    username: str
    user_color: str
    match_field: str
    match_preview: str


class LabSearchResponse(BaseModel):
    """Response for cross-user search."""
    results: List[LabSearchResult]
    total_count: int


# ── Helper Functions ────────────────────────────────────────────────────────────

def _get_users_dir() -> Path:
    """Get the users directory path."""
    return Path(settings.github_localpath) / "data" / "users"


def _get_user_metadata_path() -> Path:
    """Get the path to the user metadata file."""
    return _get_users_dir() / "_user_metadata.json"


def _read_user_metadata() -> Dict:
    """Read user metadata from file."""
    metadata_path = _get_user_metadata_path()
    
    if not metadata_path.exists():
        return {
            "version": 1,
            "users": {},
            "color_assignments": {}
        }
    
    try:
        return json.loads(metadata_path.read_text())
    except (json.JSONDecodeError, OSError):
        return {
            "version": 1,
            "users": {},
            "color_assignments": {}
        }


def _get_user_color(username: str) -> str:
    """Get the color for a user from metadata."""
    metadata = _read_user_metadata()
    user_data = metadata.get("users", {}).get(username, {})
    return user_data.get("color", USER_COLOR_PALETTE[0])  # Default to first color in palette


def _get_available_users() -> List[str]:
    """List all available users by scanning the users directory."""
    users_dir = _get_users_dir()
    if not users_dir.exists():
        return []
    
    # Folders that are not user profiles
    # Includes both reserved names and subdirectory names that shouldn't be at root level
    excluded_folders = {
        'public', '.git', '.github', 'lab', '_no_user_',
        # Subdirectory names that should be inside user folders, not at root
        'projects', 'tasks', 'dependencies', 'methods', 'events',
        'goals', 'pcr_protocols', 'purchase_items', 'item_catalog', 'lab_links',
    }
    
    users = []
    for item in users_dir.iterdir():
        if item.is_dir() and not item.name.startswith('.') and item.name not in excluded_folders:
            users.append(item.name)
    
    return sorted(users)


def _read_json_file(path: Path) -> Optional[Dict]:
    """Safely read a JSON file."""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def _list_json_files(directory: Path) -> List[Dict]:
    """List all JSON files in a directory."""
    if not directory.exists():
        return []
    
    records = []
    for json_file in sorted(directory.glob("*.json")):
        data = _read_json_file(json_file)
        if data:
            records.append(data)
    return records


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/users", response_model=LabUsersResponse)
async def list_lab_users():
    """List all users with their metadata (colors, created_at)."""
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    metadata = _read_user_metadata()
    users = _get_available_users()
    
    lab_users = []
    for user in users:
        user_data = metadata.get("users", {}).get(user, {})
        lab_users.append(LabUser(
            username=user,
            color=user_data.get("color", USER_COLOR_PALETTE[0]),
            created_at=user_data.get("created_at")
        ))
    
    return LabUsersResponse(users=lab_users)


@router.get("/tasks", response_model=List[LabTask])
async def get_all_tasks(
    exclude_goals: bool = True,
    exclude_lists: bool = True,
    usernames: Optional[str] = None
):
    """Get all tasks across all users.
    
    Args:
        exclude_goals: If True, exclude high-level goals (task_type='goal')
        exclude_lists: If True, exclude list tasks from Gantt view
        usernames: Comma-separated list of usernames to filter by
    """
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    all_tasks = []
    
    # Parse username filter if provided
    username_filter = None
    if usernames:
        username_filter = set(u.strip() for u in usernames.split(",") if u.strip())
    
    for user in _get_available_users():
        # Skip if username filter is active and this user is not in it
        if username_filter and user not in username_filter:
            continue
        
        user_color = _get_user_color(user)
        tasks_dir = users_dir / user / "tasks"
        
        for task_data in _list_json_files(tasks_dir):
            # Skip high-level goals if requested
            if exclude_goals and task_data.get("task_type") == "goal":
                continue
            
            # Skip list tasks if requested
            if exclude_lists and task_data.get("task_type") == "list":
                continue
            
            all_tasks.append(LabTask(
                id=task_data.get("id", 0),
                name=task_data.get("name", ""),
                project_id=task_data.get("project_id", 0),
                start_date=task_data.get("start_date", ""),
                duration_days=task_data.get("duration_days", 1),
                end_date=task_data.get("end_date", ""),
                is_complete=task_data.get("is_complete", False),
                task_type=task_data.get("task_type", "experiment"),
                username=user,
                user_color=user_color,
                experiment_color=task_data.get("experiment_color"),
                method_ids=task_data.get("method_ids") or [],
                notes=task_data.get("notes")
            ))
    
    return all_tasks


@router.get("/projects", response_model=List[LabProject])
async def get_all_projects(usernames: Optional[str] = None):
    """Get all projects across all users.
    
    Args:
        usernames: Comma-separated list of usernames to filter by
    """
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    all_projects = []
    
    # Parse username filter if provided
    username_filter = None
    if usernames:
        username_filter = set(u.strip() for u in usernames.split(",") if u.strip())
    
    for user in _get_available_users():
        # Skip if username filter is active and this user is not in it
        if username_filter and user not in username_filter:
            continue
        
        user_color = _get_user_color(user)
        projects_dir = users_dir / user / "projects"
        
        for project_data in _list_json_files(projects_dir):
            all_projects.append(LabProject(
                id=project_data.get("id", 0),
                name=project_data.get("name", ""),
                color=project_data.get("color", "#3b82f6"),
                username=user,
                user_color=user_color,
                is_archived=project_data.get("is_archived", False)
            ))
    
    return all_projects


@router.get("/methods", response_model=List[LabMethod])
async def get_all_methods():
    """Get all methods across all users (including public methods)."""
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    all_methods = []
    
    # Get public methods
    public_methods_dir = users_dir / "public" / "methods"
    for method_data in _list_json_files(public_methods_dir):
        all_methods.append(LabMethod(
            id=method_data.get("id", 0),
            name=method_data.get("name", ""),
            username="public",
            user_color="#6b7280",  # Gray for public
            is_public=True
        ))
    
    # Get user-specific methods
    for user in _get_available_users():
        user_color = _get_user_color(user)
        methods_dir = users_dir / user / "methods"
        
        for method_data in _list_json_files(methods_dir):
            all_methods.append(LabMethod(
                id=method_data.get("id", 0),
                name=method_data.get("name", ""),
                username=user,
                user_color=user_color,
                is_public=False
            ))
    
    return all_methods


@router.get("/experiments", response_model=List[LabTask])
async def get_all_experiments(usernames: Optional[str] = None):
    """Get all experiment tasks across all users.
    
    Args:
        usernames: Comma-separated list of usernames to filter by
    """
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    all_experiments = []
    
    # Parse username filter if provided
    username_filter = None
    if usernames:
        username_filter = set(u.strip() for u in usernames.split(",") if u.strip())
    
    for user in _get_available_users():
        # Skip if username filter is active and this user is not in it
        if username_filter and user not in username_filter:
            continue
        
        user_color = _get_user_color(user)
        tasks_dir = users_dir / user / "tasks"
        
        for task_data in _list_json_files(tasks_dir):
            # Only include experiments
            if task_data.get("task_type") != "experiment":
                continue
            
            all_experiments.append(LabTask(
                id=task_data.get("id", 0),
                name=task_data.get("name", ""),
                project_id=task_data.get("project_id", 0),
                start_date=task_data.get("start_date", ""),
                duration_days=task_data.get("duration_days", 1),
                end_date=task_data.get("end_date", ""),
                is_complete=task_data.get("is_complete", False),
                task_type="experiment",
                username=user,
                user_color=user_color,
                experiment_color=task_data.get("experiment_color"),
                method_ids=task_data.get("method_ids") or [],
                notes=task_data.get("notes")
            ))
    
    return all_experiments


@router.get("/search", response_model=LabSearchResponse)
async def search_across_users(
    q: str,
    usernames: Optional[str] = None,
    task_types: Optional[str] = None
):
    """Search across all users' data.
    
    Args:
        q: Search query string
        usernames: Comma-separated list of usernames to filter by
        task_types: Comma-separated list of task types to include (experiment, purchase, list)
    """
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    results = []
    query_lower = q.lower()
    
    # Parse filters
    username_filter = None
    if usernames:
        username_filter = set(u.strip() for u in usernames.split(",") if u.strip())
    
    task_type_filter = None
    if task_types:
        task_type_filter = set(t.strip() for t in task_types.split(",") if t.strip())
    
    for user in _get_available_users():
        # Skip if username filter is active and this user is not in it
        if username_filter and user not in username_filter:
            continue
        
        user_color = _get_user_color(user)
        
        # Search tasks
        tasks_dir = users_dir / user / "tasks"
        for task_data in _list_json_files(tasks_dir):
            # Skip high-level goals (always hidden in Lab Mode)
            if task_data.get("task_type") == "goal":
                continue
            
            # Apply task type filter
            if task_type_filter and task_data.get("task_type") not in task_type_filter:
                continue
            
            # Search in name and notes
            name = task_data.get("name", "")
            notes = task_data.get("notes", "")
            
            if query_lower in name.lower():
                results.append(LabSearchResult(
                    type="task",
                    id=task_data.get("id", 0),
                    name=name,
                    username=user,
                    user_color=user_color,
                    match_field="name",
                    match_preview=_create_preview(name, query_lower)
                ))
            elif notes and query_lower in notes.lower():
                results.append(LabSearchResult(
                    type="task",
                    id=task_data.get("id", 0),
                    name=name,
                    username=user,
                    user_color=user_color,
                    match_field="notes",
                    match_preview=_create_preview(notes, query_lower)
                ))
        
        # Search projects
        projects_dir = users_dir / user / "projects"
        for project_data in _list_json_files(projects_dir):
            name = project_data.get("name", "")
            if query_lower in name.lower():
                results.append(LabSearchResult(
                    type="project",
                    id=project_data.get("id", 0),
                    name=name,
                    username=user,
                    user_color=user_color,
                    match_field="name",
                    match_preview=_create_preview(name, query_lower)
                ))
    
    return LabSearchResponse(
        results=results[:100],  # Limit to 100 results
        total_count=len(results)
    )


def _create_preview(text: str, query: str, context_chars: int = 50) -> str:
    """Create a preview snippet with the query highlighted."""
    text_lower = text.lower()
    idx = text_lower.find(query)
    
    if idx == -1:
        return text[:context_chars] + "..." if len(text) > context_chars else text
    
    start = max(0, idx - context_chars)
    end = min(len(text), idx + len(query) + context_chars)
    
    preview = text[start:end]
    if start > 0:
        preview = "..." + preview
    if end < len(text):
        preview = preview + "..."
    
    return preview


@router.get("/user/{username}/tasks", response_model=List[LabTask])
async def get_user_tasks(username: str, exclude_goals: bool = True):
    """Get all tasks for a specific user."""
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    user_color = _get_user_color(username)
    tasks_dir = users_dir / username / "tasks"
    
    tasks = []
    for task_data in _list_json_files(tasks_dir):
        # Skip high-level goals if requested
        if exclude_goals and task_data.get("task_type") == "goal":
            continue
        
        tasks.append(LabTask(
            id=task_data.get("id", 0),
            name=task_data.get("name", ""),
            project_id=task_data.get("project_id", 0),
            start_date=task_data.get("start_date", ""),
            duration_days=task_data.get("duration_days", 1),
            end_date=task_data.get("end_date", ""),
            is_complete=task_data.get("is_complete", False),
            task_type=task_data.get("task_type", "experiment"),
            username=username,
            user_color=user_color,
            experiment_color=task_data.get("experiment_color"),
            method_ids=task_data.get("method_ids") or [],
            notes=task_data.get("notes")
        ))
    
    return tasks


@router.get("/user/{username}/projects", response_model=List[LabProject])
async def get_user_projects(username: str):
    """Get all projects for a specific user."""
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    user_color = _get_user_color(username)
    projects_dir = users_dir / username / "projects"
    
    projects = []
    for project_data in _list_json_files(projects_dir):
        projects.append(LabProject(
            id=project_data.get("id", 0),
            name=project_data.get("name", ""),
            color=project_data.get("color", "#3b82f6"),
            username=username,
            user_color=user_color,
            is_archived=project_data.get("is_archived", False)
        ))
    
    return projects
