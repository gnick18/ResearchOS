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
    return Path(settings.github_localpath) / "users"


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
    color = user_data.get("color", USER_COLOR_PALETTE[0])  # Default to first color in palette
    print(f"[Lab] _get_user_color({username}) -> {color}")  # Debug logging
    return color


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
            
            # Calculate end_date if missing
            start_date = task_data.get("start_date", "")
            duration_days = task_data.get("duration_days", 1)
            end_date = task_data.get("end_date", "")
            
            # If end_date is missing or empty, calculate it from start_date + duration_days
            if not end_date and start_date:
                try:
                    from datetime import datetime, timedelta
                    start = datetime.strptime(start_date, "%Y-%m-%d")
                    end = start + timedelta(days=duration_days - 1)
                    end_date = end.strftime("%Y-%m-%d")
                except (ValueError, TypeError):
                    end_date = start_date
            
            all_tasks.append(LabTask(
                id=task_data.get("id", 0),
                name=task_data.get("name", ""),
                project_id=task_data.get("project_id", 0),
                start_date=start_date,
                duration_days=duration_days,
                end_date=end_date,
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
            
            # Calculate end_date if missing
            start_date = task_data.get("start_date", "")
            duration_days = task_data.get("duration_days", 1)
            end_date = task_data.get("end_date", "")
            
            # If end_date is missing or empty, calculate it from start_date + duration_days
            if not end_date and start_date:
                try:
                    from datetime import datetime, timedelta
                    start = datetime.strptime(start_date, "%Y-%m-%d")
                    end = start + timedelta(days=duration_days - 1)
                    end_date = end.strftime("%Y-%m-%d")
                except (ValueError, TypeError):
                    end_date = start_date
            
            all_experiments.append(LabTask(
                id=task_data.get("id", 0),
                name=task_data.get("name", ""),
                project_id=task_data.get("project_id", 0),
                start_date=start_date,
                duration_days=duration_days,
                end_date=end_date,
                is_complete=task_data.get("is_complete", False),
                task_type="experiment",
                username=user,
                user_color=user_color,
                experiment_color=task_data.get("experiment_color"),
                method_ids=task_data.get("method_ids") or [],
                notes=task_data.get("notes")
            ))
    
    return all_experiments


@router.get("/purchases", response_model=List[LabTask])
async def get_all_purchases(usernames: Optional[str] = None):
    """Get all purchase tasks across all users.
    
    Args:
        usernames: Comma-separated list of usernames to filter by
    """
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    all_purchases = []
    
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
            # Only include purchases
            if task_data.get("task_type") != "purchase":
                continue
            
            # Calculate end_date if missing
            start_date = task_data.get("start_date", "")
            duration_days = task_data.get("duration_days", 1)
            end_date = task_data.get("end_date", "")
            
            # If end_date is missing or empty, calculate it from start_date + duration_days
            if not end_date and start_date:
                try:
                    from datetime import datetime, timedelta
                    start = datetime.strptime(start_date, "%Y-%m-%d")
                    end = start + timedelta(days=duration_days - 1)
                    end_date = end.strftime("%Y-%m-%d")
                except (ValueError, TypeError):
                    end_date = start_date
            
            all_purchases.append(LabTask(
                id=task_data.get("id", 0),
                name=task_data.get("name", ""),
                project_id=task_data.get("project_id", 0),
                start_date=start_date,
                duration_days=duration_days,
                end_date=end_date,
                is_complete=task_data.get("is_complete", False),
                task_type="purchase",
                username=user,
                user_color=user_color,
                experiment_color=task_data.get("experiment_color"),
                method_ids=task_data.get("method_ids") or [],
                notes=task_data.get("notes")
            ))
    
    return all_purchases


@router.get("/search", response_model=LabSearchResponse)
async def search_across_users(
    q: Optional[str] = None,
    usernames: Optional[str] = None,
    task_types: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    project_id: Optional[int] = None,
    method_id: Optional[int] = None,
    method_folder: Optional[str] = None,
    completion_status: Optional[str] = None  # "all", "complete", "incomplete"
):
    """Search across all users' data.
    
    Args:
        q: Search query string (optional when using other filters)
        usernames: Comma-separated list of usernames to filter by
        task_types: Comma-separated list of task types to include (experiment, purchase, list)
        date_from: Filter tasks starting from this date (YYYY-MM-DD)
        date_to: Filter tasks ending before this date (YYYY-MM-DD)
        project_id: Filter by project ID
        method_id: Filter by method ID
        method_folder: Filter by method folder/category
        completion_status: Filter by completion status ("all", "complete", "incomplete")
    """
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    results = []
    query_lower = q.lower() if q else None
    
    # Parse filters
    username_filter = None
    if usernames:
        username_filter = set(u.strip() for u in usernames.split(",") if u.strip())
    
    task_type_filter = None
    if task_types:
        task_type_filter = set(t.strip() for t in task_types.split(",") if t.strip())
    
    # Build method folder lookup (method_id -> folder_path)
    method_folder_lookup = {}
    if method_folder:
        # Scan all methods to build folder lookup
        for user in _get_available_users():
            methods_dir = users_dir / user / "methods"
            for method_data in _list_json_files(methods_dir):
                if method_data.get("folder_path") == method_folder:
                    method_folder_lookup[method_data.get("id")] = True
        # Also check public methods
        public_methods_dir = users_dir / "public" / "methods"
        for method_data in _list_json_files(public_methods_dir):
            if method_data.get("folder_path") == method_folder:
                method_folder_lookup[method_data.get("id")] = True
    
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
            
            # Apply project filter
            if project_id is not None and task_data.get("project_id") != project_id:
                continue
            
            # Apply completion status filter
            if completion_status == "complete" and not task_data.get("is_complete"):
                continue
            if completion_status == "incomplete" and task_data.get("is_complete"):
                continue
            
            # Apply date range filter
            task_start = task_data.get("start_date", "")
            task_end = task_data.get("end_date", "")
            
            # Calculate end_date if missing
            if not task_end and task_start:
                try:
                    from datetime import datetime, timedelta
                    start = datetime.strptime(task_start, "%Y-%m-%d")
                    duration = task_data.get("duration_days", 1)
                    end = start + timedelta(days=duration - 1)
                    task_end = end.strftime("%Y-%m-%d")
                except (ValueError, TypeError):
                    task_end = task_start
            
            if date_from and task_end < date_from:
                continue
            if date_to and task_start > date_to:
                continue
            
            # Apply method filter
            task_method_ids = task_data.get("method_ids") or []
            if method_id is not None and method_id not in task_method_ids:
                continue
            
            # Apply method folder filter
            if method_folder:
                has_folder_method = any(mid in method_folder_lookup for mid in task_method_ids)
                if not has_folder_method:
                    continue
            
            # Apply keyword search (if provided)
            name = task_data.get("name", "")
            notes = task_data.get("notes", "")
            tags = task_data.get("tags", [])
            
            if query_lower:
                # Search in name, notes, and tags
                tags_str = " ".join(tags) if tags else ""
                searchable = f"{name} {notes} {tags_str}".lower()
                
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
                elif tags and query_lower in tags_str.lower():
                    results.append(LabSearchResult(
                        type="task",
                        id=task_data.get("id", 0),
                        name=name,
                        username=user,
                        user_color=user_color,
                        match_field="tags",
                        match_preview=_create_preview(tags_str, query_lower)
                    ))
            else:
                # No keyword search, just add as result (filtered by other criteria)
                results.append(LabSearchResult(
                    type="task",
                    id=task_data.get("id", 0),
                    name=name,
                    username=user,
                    user_color=user_color,
                    match_field="filter",
                    match_preview=notes[:100] if notes else ""
                ))
        
        # Search projects (only if keyword search is active)
        if query_lower:
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


@router.get("/method-folders", response_model=List[str])
async def get_all_method_folders():
    """Get all unique method folders across all users."""
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    folders = set()
    
    # Get folders from public methods
    public_methods_dir = users_dir / "public" / "methods"
    for method_data in _list_json_files(public_methods_dir):
        folder = method_data.get("folder_path")
        if folder:
            folders.add(folder)
    
    # Get folders from user methods
    for user in _get_available_users():
        methods_dir = users_dir / user / "methods"
        for method_data in _list_json_files(methods_dir):
            folder = method_data.get("folder_path")
            if folder:
                folders.add(folder)
    
    return sorted(folders)


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
        
        # Calculate end_date if missing
        start_date = task_data.get("start_date", "")
        duration_days = task_data.get("duration_days", 1)
        end_date = task_data.get("end_date", "")
        
        # If end_date is missing or empty, calculate it from start_date + duration_days
        if not end_date and start_date:
            try:
                from datetime import datetime, timedelta
                start = datetime.strptime(start_date, "%Y-%m-%d")
                end = start + timedelta(days=duration_days - 1)
                end_date = end.strftime("%Y-%m-%d")
            except (ValueError, TypeError):
                end_date = start_date
        
        tasks.append(LabTask(
            id=task_data.get("id", 0),
            name=task_data.get("name", ""),
            project_id=task_data.get("project_id", 0),
            start_date=start_date,
            duration_days=duration_days,
            end_date=end_date,
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


class LabPurchaseItem(BaseModel):
    """Purchase item for Lab Mode."""
    id: int
    task_id: int
    item_name: str
    quantity: int
    link: Optional[str] = None
    cas: Optional[str] = None
    price_per_unit: float
    shipping_fees: float
    total_price: float
    notes: Optional[str] = None
    funding_string: Optional[str] = None


class LabNoteEntry(BaseModel):
    """A single entry within a note."""
    id: str
    title: str
    date: str
    content: str = ""
    created_at: str
    updated_at: str


class LabNote(BaseModel):
    """Note with user attribution for Lab Mode."""
    id: int
    title: str
    description: str
    is_running_log: bool
    is_shared: bool
    entries: List[LabNoteEntry] = []
    created_at: str
    updated_at: str
    username: str
    user_color: str


@router.get("/user/{username}/purchases/{task_id}", response_model=List[LabPurchaseItem])
async def get_user_purchase_items(username: str, task_id: int):
    """Get all purchase items for a specific task from a specific user."""
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    purchase_items_dir = users_dir / username / "purchase_items"
    
    items = []
    for item_data in _list_json_files(purchase_items_dir):
        # Filter by task_id
        if item_data.get("task_id") != task_id:
            continue
        
        # Calculate total price
        qty = item_data.get("quantity", 0)
        ppu = item_data.get("price_per_unit", 0.0)
        ship = item_data.get("shipping_fees", 0.0)
        total_price = round(qty * ppu + ship, 2)
        
        items.append(LabPurchaseItem(
            id=item_data.get("id", 0),
            task_id=item_data.get("task_id", 0),
            item_name=item_data.get("item_name", ""),
            quantity=qty,
            link=item_data.get("link"),
            cas=item_data.get("cas"),
            price_per_unit=ppu,
            shipping_fees=ship,
            total_price=total_price,
            notes=item_data.get("notes"),
            funding_string=item_data.get("funding_string"),
        ))
    
    return items


# ── Notes Endpoints ────────────────────────────────────────────────────────────


@router.get("/notes", response_model=List[LabNote])
async def get_all_notes(
    usernames: Optional[str] = None,
    shared_only: bool = False
):
    """Get all notes across all users.
    
    Args:
        usernames: Comma-separated list of usernames to filter by
        shared_only: If True, only return notes where is_shared=True
    """
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    all_notes = []
    
    # Parse username filter if provided
    username_filter = None
    if usernames:
        username_filter = set(u.strip() for u in usernames.split(",") if u.strip())
    
    for user in _get_available_users():
        # Skip if username filter is active and this user is not in it
        if username_filter and user not in username_filter:
            continue
        
        user_color = _get_user_color(user)
        notes_dir = users_dir / user / "notes"
        
        for note_data in _list_json_files(notes_dir):
            # Filter by shared status if requested
            if shared_only and not note_data.get("is_shared", False):
                continue
            
            # Parse entries
            entries = []
            for entry_data in note_data.get("entries", []):
                entries.append(LabNoteEntry(
                    id=entry_data.get("id", ""),
                    title=entry_data.get("title", ""),
                    date=entry_data.get("date", ""),
                    content=entry_data.get("content", ""),
                    created_at=entry_data.get("created_at", ""),
                    updated_at=entry_data.get("updated_at", "")
                ))
            
            all_notes.append(LabNote(
                id=note_data.get("id", 0),
                title=note_data.get("title", ""),
                description=note_data.get("description", ""),
                is_running_log=note_data.get("is_running_log", False),
                is_shared=note_data.get("is_shared", False),
                entries=entries,
                created_at=note_data.get("created_at", ""),
                updated_at=note_data.get("updated_at", ""),
                username=user,
                user_color=user_color
            ))
    
    return all_notes


@router.get("/notes/shared", response_model=List[LabNote])
async def get_shared_notes(usernames: Optional[str] = None):
    """Get only shared notes across all users.
    
    Args:
        usernames: Comma-separated list of usernames to filter by
    """
    return await get_all_notes(usernames=usernames, shared_only=True)


@router.get("/user/{username}/notes", response_model=List[LabNote])
async def get_user_notes(username: str):
    """Get all notes for a specific user."""
    # Ensure existing users are migrated (have colors assigned)
    _migrate_existing_users()
    
    users_dir = _get_users_dir()
    user_color = _get_user_color(username)
    notes_dir = users_dir / username / "notes"
    
    notes = []
    for note_data in _list_json_files(notes_dir):
        # Parse entries
        entries = []
        for entry_data in note_data.get("entries", []):
            entries.append(LabNoteEntry(
                id=entry_data.get("id", ""),
                title=entry_data.get("title", ""),
                date=entry_data.get("date", ""),
                content=entry_data.get("content", ""),
                created_at=entry_data.get("created_at", ""),
                updated_at=entry_data.get("updated_at", "")
            ))
        
        notes.append(LabNote(
            id=note_data.get("id", 0),
            title=note_data.get("title", ""),
            description=note_data.get("description", ""),
            is_running_log=note_data.get("is_running_log", False),
            is_shared=note_data.get("is_shared", False),
            entries=entries,
            created_at=note_data.get("created_at", ""),
            updated_at=note_data.get("updated_at", ""),
            username=username,
            user_color=user_color
        ))
    
    return notes
