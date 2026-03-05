"""User management endpoints for multi-user support."""

import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.storage import reset_stores

router = APIRouter(prefix="/users", tags=["users"])


# ── User Color Palette ──────────────────────────────────────────────────────────

USER_COLOR_PALETTE = [
    "#3b82f6",  # Blue
    "#10b981",  # Emerald
    "#f59e0b",  # Amber
    "#ef4444",  # Red
    "#8b5cf6",  # Purple
    "#ec4899",  # Pink
    "#06b6d4",  # Cyan
    "#84cc16",  # Lime
    "#f97316",  # Orange
    "#6366f1",  # Indigo
    "#14b8a6",  # Teal
    "#a855f7",  # Violet
    "#eab308",  # Yellow
    "#22c55e",  # Green
    "#0ea5e9",  # Sky
    "#d946ef",  # Fuchsia
    "#f43f5e",  # Rose
    "#7c3aed",  # Violet dark
    "#059669",  # Emerald dark
    "#2563eb",  # Blue dark
]


# ── Request/Response Models ────────────────────────────────────────────────────

class UserListResponse(BaseModel):
    """Response for listing available users."""
    users: List[str]
    current_user: str


class LoginRequest(BaseModel):
    """Request to login as a specific user."""
    username: str


class LoginResponse(BaseModel):
    """Response after successful login."""
    status: str
    current_user: str


class CreateUserRequest(BaseModel):
    """Request to create a new user."""
    username: str


class CreateUserResponse(BaseModel):
    """Response after creating a new user."""
    status: str
    current_user: str
    created: bool


class ValidateResponse(BaseModel):
    """Response for user validation."""
    valid: bool
    current_user: str


class RenameUserRequest(BaseModel):
    """Request to rename a user."""
    old_username: str
    new_username: str


class RenameUserResponse(BaseModel):
    """Response after renaming a user."""
    status: str
    old_username: str
    new_username: str


class DeleteUserRequest(BaseModel):
    """Request to delete a user with two-step confirmation."""
    confirmation_step: int  # 1 or 2
    acknowledged_warning: bool


class DeleteUserResponse(BaseModel):
    """Response after deleting a user."""
    status: str
    deleted_username: str
    message: str


class UserMetadataResponse(BaseModel):
    """Response for user metadata."""
    username: str
    created_at: Optional[str] = None
    color: str


class AllUsersMetadataResponse(BaseModel):
    """Response for all users with metadata."""
    users: List[UserMetadataResponse]
    current_user: str


class LogoutResponse(BaseModel):
    """Response after logout."""
    status: str
    message: str


class MainUserResponse(BaseModel):
    """Response for getting the main user."""
    main_user: str
    current_user: str


class SetMainUserRequest(BaseModel):
    """Request to set the main user."""
    username: str


class SetMainUserResponse(BaseModel):
    """Response after setting the main user."""
    status: str
    main_user: str


# ── Helper Functions ────────────────────────────────────────────────────────────

def _get_users_dir() -> Path:
    """Get the users directory path."""
    return Path(settings.github_localpath) / "users"


def _get_available_users() -> List[str]:
    """List all available users by scanning the users directory.
    
    Excludes 'public' folder which is used for shared methods, not a user profile.
    Excludes 'lab' folder which is used for Lab Mode, not a regular user.
    Excludes subdirectory names that might have been incorrectly created at the root.
    """
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
        '_counters.json'
    }
    
    users = []
    for item in users_dir.iterdir():
        if item.is_dir() and not item.name.startswith('.') and item.name not in excluded_folders:
            users.append(item.name)
    
    return sorted(users)


def _user_exists(username: str) -> bool:
    """Check if a user folder exists."""
    user_dir = _get_users_dir() / username
    return user_dir.exists() and user_dir.is_dir()


def _create_user_folder(username: str) -> None:
    """Create a new user folder with all required subdirectories."""
    user_dir = _get_users_dir() / username
    user_dir.mkdir(parents=True, exist_ok=True)
    
    # Create all required subdirectories
    subdirs = [
        "projects", "tasks", "dependencies", "methods", "events",
        "goals", "pcr_protocols", "purchase_items", "item_catalog", "lab_links"
    ]
    
    for subdir in subdirs:
        (user_dir / subdir).mkdir(exist_ok=True)
    
    # Create empty counters file
    counters_file = user_dir / "_counters.json"
    if not counters_file.exists():
        counters_file.write_text("{}")


def _update_env_with_user(username: str) -> None:
    """Update the .env file with the new current user."""
    env_path = Path(__file__).parent.parent.parent / ".env"
    
    # Read existing .env content
    env_content = {}
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, _, value = line.partition("=")
                    env_content[key.strip()] = value.strip()
    
    # Update the current user
    env_content["CURRENT_USER"] = username
    
    # Write back to .env
    lines = []
    for key, value in env_content.items():
        # Handle values that might need quotes
        if " " in value or value.startswith("["):
            lines.append(f'{key}="{value}"')
        else:
            lines.append(f"{key}={value}")
    
    env_path.write_text("\n".join(lines) + "\n")


def _update_env_with_main_user(username: str) -> None:
    """Update the .env file with the new main user."""
    env_path = Path(__file__).parent.parent.parent / ".env"
    
    # Read existing .env content
    env_content = {}
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, _, value = line.partition("=")
                    env_content[key.strip()] = value.strip()
    
    # Update the main user
    env_content["MAIN_USER"] = username
    
    # Write back to .env
    lines = []
    for key, value in env_content.items():
        # Handle values that might need quotes
        if " " in value or value.startswith("["):
            lines.append(f'{key}="{value}"')
        else:
            lines.append(f"{key}={value}")
    
    env_path.write_text("\n".join(lines) + "\n")


# Reserved folder names that cannot be used as usernames
RESERVED_USERNAMES = {'public', '.git', '.github', 'lab'}


# ── User Metadata Functions ─────────────────────────────────────────────────────

def _get_user_metadata_path() -> Path:
    """Get the path to the user metadata file."""
    return Path(settings.github_localpath) / "users" / "_user_metadata.json"


def _read_user_metadata() -> Dict:
    """Read user metadata from file, creating if doesn't exist."""
    metadata_path = _get_user_metadata_path()
    
    if not metadata_path.exists():
        # Create initial metadata structure
        default_metadata = {
            "version": 1,
            "users": {},
            "color_assignments": {}
        }
        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        metadata_path.write_text(json.dumps(default_metadata, indent=2))
        return default_metadata
    
    try:
        return json.loads(metadata_path.read_text())
    except (json.JSONDecodeError, OSError):
        # Return default if file is corrupted
        return {
            "version": 1,
            "users": {},
            "color_assignments": {}
        }


def _write_user_metadata(metadata: Dict) -> None:
    """Write user metadata to file."""
    metadata_path = _get_user_metadata_path()
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2))


def _get_next_available_color(metadata: Optional[Dict] = None) -> Optional[str]:
    """Get the next available color from the palette.
    
    Args:
        metadata: Optional metadata dict to use instead of reading from file.
                  This is useful during migration to avoid race conditions.
    
    Returns None if all colors are in use.
    """
    if metadata is None:
        metadata = _read_user_metadata()
    used_colors = set(metadata.get("color_assignments", {}).keys())
    
    for color in USER_COLOR_PALETTE:
        if color not in used_colors:
            return color
    
    # All colors in use - cycle back and reuse the oldest one
    # This shouldn't happen often with 20 colors
    return USER_COLOR_PALETTE[0] if USER_COLOR_PALETTE else None


def _assign_color_to_user(username: str) -> str:
    """Assign a color to a user and return it."""
    metadata = _read_user_metadata()
    
    # Check if user already has a color
    if username in metadata.get("users", {}):
        existing_color = metadata["users"][username].get("color")
        if existing_color:
            return existing_color
    
    # Get next available color
    color = _get_next_available_color()
    if not color:
        color = USER_COLOR_PALETTE[0]  # Fallback
    
    # Update metadata
    if "users" not in metadata:
        metadata["users"] = {}
    if "color_assignments" not in metadata:
        metadata["color_assignments"] = {}
    
    # Initialize user entry if needed
    if username not in metadata["users"]:
        metadata["users"][username] = {}
    
    metadata["users"][username]["color"] = color
    metadata["color_assignments"][color] = username
    
    _write_user_metadata(metadata)
    return color


def _free_color_for_user(username: str) -> None:
    """Free up a user's color when they are deleted."""
    metadata = _read_user_metadata()
    
    if username in metadata.get("users", {}):
        color = metadata["users"][username].get("color")
        if color and color in metadata.get("color_assignments", {}):
            del metadata["color_assignments"][color]
        del metadata["users"][username]
        _write_user_metadata(metadata)


def _update_user_metadata_on_create(username: str) -> Dict:
    """Create metadata entry for a new user."""
    metadata = _read_user_metadata()
    
    if "users" not in metadata:
        metadata["users"] = {}
    if "color_assignments" not in metadata:
        metadata["color_assignments"] = {}
    
    # Get creation time
    created_at = datetime.now(timezone.utc).isoformat()
    
    # Get next available color
    color = _get_next_available_color()
    if not color:
        color = USER_COLOR_PALETTE[0]  # Fallback
    
    metadata["users"][username] = {
        "created_at": created_at,
        "color": color
    }
    metadata["color_assignments"][color] = username
    
    _write_user_metadata(metadata)
    return metadata["users"][username]


def _update_user_metadata_on_rename(old_username: str, new_username: str) -> None:
    """Update metadata when a user is renamed."""
    metadata = _read_user_metadata()
    
    if old_username in metadata.get("users", {}):
        # Move the user entry to the new key
        metadata["users"][new_username] = metadata["users"].pop(old_username)
        
        # Update color assignment
        color = metadata["users"][new_username].get("color")
        if color and color in metadata.get("color_assignments", {}):
            metadata["color_assignments"][color] = new_username
        
        _write_user_metadata(metadata)


def _rebuild_color_assignments(metadata: Dict) -> None:
    """Rebuild color_assignments from users data to ensure consistency.
    
    This ensures that color_assignments is always a perfect reverse mapping
    of the colors assigned in the users dictionary.
    """
    metadata["color_assignments"] = {}
    for username, data in metadata.get("users", {}).items():
        color = data.get("color")
        if color:
            metadata["color_assignments"][color] = username


def _migrate_existing_users() -> None:
    """Migrate existing users without metadata to have colors and created_at.
    
    Also fixes users that have duplicate colors by reassigning them.
    """
    metadata = _read_user_metadata()
    existing_users = _get_available_users()
    
    # First, check for duplicate colors and fix them
    color_to_users = {}
    for user, data in metadata.get("users", {}).items():
        color = data.get("color")
        if color:
            if color not in color_to_users:
                color_to_users[color] = []
            color_to_users[color].append(user)
    
    # Reassign colors for users with duplicates
    for color, users_with_color in color_to_users.items():
        if len(users_with_color) > 1:
            # First user keeps the color - ensure it's tracked in color_assignments
            first_user = users_with_color[0]
            if "color_assignments" not in metadata:
                metadata["color_assignments"] = {}
            metadata["color_assignments"][color] = first_user
            
            # Reassign other users to new colors (pass metadata to avoid race condition)
            for user in users_with_color[1:]:
                new_color = _get_next_available_color(metadata)
                if not new_color:
                    new_color = USER_COLOR_PALETTE[0]
                if "users" not in metadata:
                    metadata["users"] = {}
                if user in metadata["users"]:
                    metadata["users"][user]["color"] = new_color
                    metadata["color_assignments"][new_color] = user
    
    # Then, add any missing users (pass metadata to avoid race condition)
    for user in existing_users:
        if user not in metadata.get("users", {}):
            # Assign color and created_at to existing user
            created_at = datetime.now(timezone.utc).isoformat()
            color = _get_next_available_color(metadata)
            if not color:
                color = USER_COLOR_PALETTE[0]
            
            if "users" not in metadata:
                metadata["users"] = {}
            if "color_assignments" not in metadata:
                metadata["color_assignments"] = {}
            
            metadata["users"][user] = {
                "created_at": created_at,
                "color": color
            }
            metadata["color_assignments"][color] = user
    
    # Rebuild color_assignments to ensure consistency
    _rebuild_color_assignments(metadata)
    
    _write_user_metadata(metadata)


def _rename_user_folder(old_username: str, new_username: str) -> None:
    """Rename a user folder while preserving all data.
    
    Args:
        old_username: Current username (folder name)
        new_username: New username (new folder name)
        
    Raises:
        ValueError: If old folder doesn't exist or new folder already exists
    """
    users_dir = _get_users_dir()
    old_path = users_dir / old_username
    new_path = users_dir / new_username
    
    if not old_path.exists():
        raise ValueError(f"User '{old_username}' does not exist")
    
    if new_path.exists():
        raise ValueError(f"User '{new_username}' already exists")
    
    # Rename the folder - all contents are preserved automatically
    shutil.move(str(old_path), str(new_path))


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("", response_model=UserListResponse)
async def list_users():
    """List all available users."""
    users = _get_available_users()
    return UserListResponse(
        users=users,
        current_user=settings.current_user
    )


@router.post("/login", response_model=LoginResponse)
async def login_user(request: LoginRequest):
    """Login as a specific user."""
    username = request.username.strip()
    
    if not username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    
    # Special handling for lab user - auto-create if doesn't exist
    if username.lower() == "lab":
        if not _user_exists(username):
            # Create lab user folder (minimal structure - lab reads from all users)
            _create_user_folder(username)
    
    if not _user_exists(username):
        raise HTTPException(status_code=404, detail=f"User '{username}' does not exist")
    
    # Update .env with the new user
    _update_env_with_user(username)
    
    # Update the settings object
    settings.current_user = username
    
    # Reinitialize stores to use the new user path
    reset_stores()
    
    return LoginResponse(
        status="ok",
        current_user=username
    )


@router.post("/create", response_model=CreateUserResponse)
async def create_user(request: CreateUserRequest):
    """Create a new user and login as them."""
    username = request.username.strip()
    
    if not username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    
    # Validate username format (alphanumeric and underscores only)
    if not re.match(r'^[a-zA-Z0-9_]+$', username):
        raise HTTPException(
            status_code=400, 
            detail="Username can only contain letters, numbers, and underscores"
        )
    
    # Check for reserved usernames
    if username.lower() in {name.lower() for name in RESERVED_USERNAMES}:
        raise HTTPException(
            status_code=400, 
            detail=f"Username '{username}' is reserved and cannot be used"
        )
    
    # Check if user already exists
    already_exists = _user_exists(username)
    
    if not already_exists:
        # Create the user folder
        _create_user_folder(username)
        # Create metadata for the new user (color, created_at)
        _update_user_metadata_on_create(username)
    
    # Update .env with the new user
    _update_env_with_user(username)
    
    # Update the settings object
    settings.current_user = username
    
    # Reinitialize stores to use the new user path
    reset_stores()
    
    return CreateUserResponse(
        status="ok",
        current_user=username,
        created=not already_exists
    )


@router.get("/validate", response_model=ValidateResponse)
async def validate_user():
    """Check if the current user is valid (exists in users directory)."""
    current = settings.current_user
    
    if not current:
        return ValidateResponse(valid=False, current_user="")
    
    valid = _user_exists(current)
    return ValidateResponse(valid=valid, current_user=current)


@router.post("/logout", response_model=LogoutResponse)
async def logout_user():
    """Logout the current user by clearing the session.
    
    This clears the current_user setting, which will trigger the
    login screen on the frontend.
    """
    # Clear the current user in settings
    settings.current_user = ""
    
    # Update .env to clear the current user
    _update_env_with_user("")
    
    # Reset stores
    reset_stores()
    
    return LogoutResponse(
        status="ok",
        message="Logged out successfully"
    )


@router.put("/rename", response_model=RenameUserResponse)
async def rename_user(request: RenameUserRequest):
    """Rename a user profile and its data folder.
    
    All data in the user's folder is preserved during the rename.
    If the renamed user is the current user, the .env file is updated.
    User metadata (created_at, color) is preserved and updated.
    """
    old_username = request.old_username.strip()
    new_username = request.new_username.strip()
    
    # Validate old username
    if not old_username:
        raise HTTPException(status_code=400, detail="Old username cannot be empty")
    
    if not _user_exists(old_username):
        raise HTTPException(status_code=404, detail=f"User '{old_username}' does not exist")
    
    # Validate new username
    if not new_username:
        raise HTTPException(status_code=400, detail="New username cannot be empty")
    
    # Validate username format (alphanumeric and underscores only)
    if not re.match(r'^[a-zA-Z0-9_]+$', new_username):
        raise HTTPException(
            status_code=400, 
            detail="Username can only contain letters, numbers, and underscores"
        )
    
    # Check for reserved usernames
    if new_username.lower() in {name.lower() for name in RESERVED_USERNAMES}:
        raise HTTPException(
            status_code=400, 
            detail=f"Username '{new_username}' is reserved and cannot be used"
        )
    
    # Check if new username already exists
    if _user_exists(new_username):
        raise HTTPException(
            status_code=409, 
            detail=f"User '{new_username}' already exists"
        )
    
    # If old and new are the same, nothing to do
    if old_username == new_username:
        return RenameUserResponse(
            status="ok",
            old_username=old_username,
            new_username=new_username
        )
    
    # Rename the folder (preserves all data)
    try:
        _rename_user_folder(old_username, new_username)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rename user folder: {str(e)}")
    
    # Update user metadata (preserves created_at and color)
    _update_user_metadata_on_rename(old_username, new_username)
    
    # If the renamed user was the current user, update .env and settings
    if settings.current_user == old_username:
        _update_env_with_user(new_username)
        settings.current_user = new_username
        reset_stores()
    
    # If the renamed user was the main user, update main_user in .env and settings
    if settings.main_user == old_username:
        _update_env_with_main_user(new_username)
        settings.main_user = new_username
    
    return RenameUserResponse(
        status="ok",
        old_username=old_username,
        new_username=new_username
    )


@router.delete("/{username}", response_model=DeleteUserResponse)
async def delete_user(username: str, request: DeleteUserRequest):
    """Delete a user with two-step confirmation.
    
    Step 1: Warning about data removal from folder
    Step 2: Warning recommending data backup
    
    Both steps must be acknowledged before deletion.
    """
    username = username.strip()
    
    if not username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    
    if not _user_exists(username):
        raise HTTPException(status_code=404, detail=f"User '{username}' does not exist")
    
    # Check for reserved usernames
    if username.lower() in {name.lower() for name in RESERVED_USERNAMES}:
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot delete reserved user '{username}'"
        )
    
    # Validate confirmation step
    if request.confirmation_step not in (1, 2):
        raise HTTPException(
            status_code=400, 
            detail="Confirmation step must be 1 or 2"
        )
    
    if not request.acknowledged_warning:
        raise HTTPException(
            status_code=400, 
            detail="Warning must be acknowledged"
        )
    
    # Step 1: Return warning about data removal
    if request.confirmation_step == 1:
        return DeleteUserResponse(
            status="warning",
            deleted_username="",
            message="This will remove all data for user '{username}' from the folder the program is pointing to. Please acknowledge and proceed to step 2."
        )
    
    # Step 2: Final warning and deletion
    if request.confirmation_step == 2:
        # Get user directory path before deletion
        users_dir = _get_users_dir()
        user_path = users_dir / username
        
        try:
            # Delete the user folder
            shutil.rmtree(str(user_path))
            
            # Free up the user's color for reuse
            _free_color_for_user(username)
            
            # If the deleted user was the current user, clear the session
            if settings.current_user == username:
                settings.current_user = ""
                reset_stores()
            
            # If the deleted user was the main user, clear the main user
            if settings.main_user == username:
                _update_env_with_main_user("")
                settings.main_user = ""
            
            return DeleteUserResponse(
                status="ok",
                deleted_username=username,
                message=f"User '{username}' has been deleted successfully"
            )
        except Exception as e:
            raise HTTPException(
                status_code=500, 
                detail=f"Failed to delete user: {str(e)}"
            )


@router.get("/metadata", response_model=AllUsersMetadataResponse)
async def get_all_users_metadata():
    """Get metadata for all users (colors, created_at dates)."""
    # Ensure existing users are migrated
    _migrate_existing_users()
    
    metadata = _read_user_metadata()
    users = _get_available_users()
    
    user_metadata_list = []
    for user in users:
        user_data = metadata.get("users", {}).get(user, {})
        user_metadata_list.append(UserMetadataResponse(
            username=user,
            created_at=user_data.get("created_at"),
            color=user_data.get("color", USER_COLOR_PALETTE[0])
        ))
    
    return AllUsersMetadataResponse(
        users=user_metadata_list,
        current_user=settings.current_user
    )


@router.get("/metadata/{username}", response_model=UserMetadataResponse)
async def get_user_metadata(username: str):
    """Get metadata for a specific user."""
    # Ensure existing users are migrated
    _migrate_existing_users()
    
    if not _user_exists(username):
        raise HTTPException(status_code=404, detail=f"User '{username}' does not exist")
    
    metadata = _read_user_metadata()
    user_data = metadata.get("users", {}).get(username, {})
    
    return UserMetadataResponse(
        username=username,
        created_at=user_data.get("created_at"),
        color=user_data.get("color", USER_COLOR_PALETTE[0])
    )


@router.get("/main", response_model=MainUserResponse)
async def get_main_user():
    """Get the main user (default user to return to when exiting lab mode)."""
    return MainUserResponse(
        main_user=settings.main_user,
        current_user=settings.current_user
    )


@router.put("/main", response_model=SetMainUserResponse)
async def set_main_user(request: SetMainUserRequest):
    """Set the main user (default user to return to when exiting lab mode).
    
    This does not change the current user - it only sets the default
    user that will be used when exiting lab mode.
    """
    username = request.username.strip()
    
    if not username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    
    # Special handling for lab user - can't be main user
    if username.lower() == "lab":
        raise HTTPException(
            status_code=400, 
            detail="Lab user cannot be set as the main user"
        )
    
    if not _user_exists(username):
        raise HTTPException(status_code=404, detail=f"User '{username}' does not exist")
    
    # Update .env with the new main user
    _update_env_with_main_user(username)
    
    # Update the settings object
    settings.main_user = username
    
    return SetMainUserResponse(
        status="ok",
        main_user=username
    )


# ── User Account Migration Models ────────────────────────────────────────────────

class MigrationStats(BaseModel):
    """Statistics for a user account migration."""
    projects_count: int = 0
    tasks_count: int = 0
    dependencies_count: int = 0
    methods_count: int = 0
    events_count: int = 0
    goals_count: int = 0
    pcr_protocols_count: int = 0
    purchase_items_count: int = 0
    notes_count: int = 0
    lab_links_count: int = 0
    images_count: int = 0
    files_count: int = 0
    total_size_bytes: int = 0


class MigrationPreviewRequest(BaseModel):
    """Request to preview a user account migration."""
    source_path: str        # Path to source users folder
    source_username: str    # Username to migrate
    target_path: str        # Path to target users folder
    target_username: str    # Username in target (can differ if renaming)


class MigrationPreviewResponse(BaseModel):
    """Response for migration preview."""
    status: str
    source_username: str
    target_username: str
    source_path: str
    target_path: str
    can_proceed: bool
    warnings: List[str]
    stats: MigrationStats
    existing_users_in_target: List[str]


class MigrateUserRequest(BaseModel):
    """Request to execute a user account migration."""
    source_path: str
    source_username: str
    target_path: str
    target_username: str
    delete_source: bool = False  # Whether to delete source after migration


class MigrateUserResponse(BaseModel):
    """Response after user account migration."""
    status: str
    message: str
    source_username: str
    target_username: str
    target_path: str
    id_mappings: Dict[str, Dict[int, int]]  # entity -> old_id -> new_id
    items_migrated: int
    bytes_copied: int


class MigrationProgress(BaseModel):
    """Progress tracking for migration."""
    status: str  # "idle", "in_progress", "complete", "error"
    current_step: str
    items_processed: int
    total_items: int
    bytes_copied: int
    total_bytes: int
    error_message: str = ""


class UsersAtPathResponse(BaseModel):
    """Response for listing users at a specific path."""
    users: List[str]
    path: str
    exists: bool


# ── Migration State (for progress tracking) ───────────────────────────────────────

_migration_state = {
    "status": "idle",
    "current_step": "",
    "items_processed": 0,
    "total_items": 0,
    "bytes_copied": 0,
    "total_bytes": 0,
    "error_message": ""
}


# ── Migration Helper Functions ────────────────────────────────────────────────────

def _get_users_at_path(path: str) -> List[str]:
    """List users at a specific path."""
    users_dir = Path(path) / "users"
    if not users_dir.exists():
        return []
    
    excluded_folders = {
        'public', '.git', '.github', 'lab', '_no_user_',
        'projects', 'tasks', 'dependencies', 'methods', 'events',
        'goals', 'pcr_protocols', 'purchase_items', 'item_catalog', 'lab_links',
        '_counters.json', '_user_metadata.json', '_global_counters.json'
    }
    
    users = []
    for item in users_dir.iterdir():
        if item.is_dir() and not item.name.startswith('.') and item.name not in excluded_folders:
            users.append(item.name)
    
    return sorted(users)


def _scan_user_folder(user_path: Path) -> MigrationStats:
    """Scan a user folder and return statistics."""
    stats = MigrationStats()
    
    if not user_path.exists():
        return stats
    
    # Count entities
    entity_dirs = {
        "projects": "projects_count",
        "tasks": "tasks_count",
        "dependencies": "dependencies_count",
        "methods": "methods_count",
        "events": "events_count",
        "goals": "goals_count",
        "pcr_protocols": "pcr_protocols_count",
        "purchase_items": "purchase_items_count",
        "notes": "notes_count",
        "lab_links": "lab_links_count",
    }
    
    for dir_name, stat_name in entity_dirs.items():
        entity_dir = user_path / dir_name
        if entity_dir.exists():
            count = len(list(entity_dir.glob("*.json")))
            setattr(stats, stat_name, count)
    
    # Count attachments
    images_dir = user_path / "Images"
    if images_dir.exists():
        stats.images_count = len(list(images_dir.rglob("*")))
        stats.total_size_bytes += sum(f.stat().st_size for f in images_dir.rglob("*") if f.is_file())
    
    files_dir = user_path / "Files"
    if files_dir.exists():
        stats.files_count = len(list(files_dir.rglob("*")))
        stats.total_size_bytes += sum(f.stat().st_size for f in files_dir.rglob("*") if f.is_file())
    
    # Add JSON file sizes
    for dir_name in entity_dirs.keys():
        entity_dir = user_path / dir_name
        if entity_dir.exists():
            stats.total_size_bytes += sum(f.stat().st_size for f in entity_dir.glob("*.json") if f.is_file())
    
    return stats


def _read_counters_at_path(user_path: Path) -> Dict[str, int]:
    """Read counters from a user folder."""
    counters_file = user_path / "_counters.json"
    if not counters_file.exists():
        return {}
    try:
        return json.loads(counters_file.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def _write_counters_at_path(user_path: Path, counters: Dict[str, int]) -> None:
    """Write counters to a user folder."""
    counters_file = user_path / "_counters.json"
    counters_file.parent.mkdir(parents=True, exist_ok=True)
    counters_file.write_text(json.dumps(counters, indent=2))


def _read_global_counters_at_path(users_dir: Path) -> Dict[str, int]:
    """Read global counters from a users directory."""
    counters_file = users_dir / "_global_counters.json"
    if not counters_file.exists():
        return {}
    try:
        return json.loads(counters_file.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def _write_global_counters_at_path(users_dir: Path, counters: Dict[str, int]) -> None:
    """Write global counters to a users directory."""
    counters_file = users_dir / "_global_counters.json"
    counters_file.parent.mkdir(parents=True, exist_ok=True)
    counters_file.write_text(json.dumps(counters, indent=2))


def _read_user_metadata_at_path(users_dir: Path) -> Dict:
    """Read user metadata from a users directory."""
    metadata_file = users_dir / "_user_metadata.json"
    if not metadata_file.exists():
        return {"version": 1, "users": {}, "color_assignments": {}}
    try:
        return json.loads(metadata_file.read_text())
    except (json.JSONDecodeError, OSError):
        return {"version": 1, "users": {}, "color_assignments": {}}


def _write_user_metadata_at_path(users_dir: Path, metadata: Dict) -> None:
    """Write user metadata to a users directory."""
    metadata_file = users_dir / "_user_metadata.json"
    metadata_file.parent.mkdir(parents=True, exist_ok=True)
    metadata_file.write_text(json.dumps(metadata, indent=2))


def _build_id_mappings(source_counters: Dict[str, int], target_counters: Dict[str, int]) -> Dict[str, Dict[int, int]]:
    """Build mappings from old IDs to new IDs based on counters."""
    mappings = {}
    
    # Entity types that need ID remapping
    entity_types = ["projects", "tasks", "dependencies", "methods", "events", 
                    "goals", "pcr_protocols", "purchase_items", "notes", "lab_links"]
    
    for entity in entity_types:
        source_max = source_counters.get(entity, 0)
        target_start = target_counters.get(entity, 0)
        
        if source_max > 0:
            mappings[entity] = {}
            for old_id in range(1, source_max + 1):
                target_start += 1
                mappings[entity][old_id] = target_start
    
    return mappings


def _update_references_in_data(data: Dict, id_mappings: Dict[str, Dict[int, int]]) -> Dict:
    """Update all ID references in a data dictionary."""
    # Update project_id references (in tasks)
    if "project_id" in data and data["project_id"]:
        if "projects" in id_mappings and data["project_id"] in id_mappings["projects"]:
            data["project_id"] = id_mappings["projects"][data["project_id"]]
    
    # Update method_ids references (in tasks)
    if "method_ids" in data and data["method_ids"]:
        new_method_ids = []
        for mid in data["method_ids"]:
            if "methods" in id_mappings and mid in id_mappings["methods"]:
                new_method_ids.append(id_mappings["methods"][mid])
            else:
                new_method_ids.append(mid)
        data["method_ids"] = new_method_ids
    
    # Update parent_id and child_id references (in dependencies)
    if "parent_id" in data and data["parent_id"]:
        if "tasks" in id_mappings and data["parent_id"] in id_mappings["tasks"]:
            data["parent_id"] = id_mappings["tasks"][data["parent_id"]]
    
    if "child_id" in data and data["child_id"]:
        if "tasks" in id_mappings and data["child_id"] in id_mappings["tasks"]:
            data["child_id"] = id_mappings["tasks"][data["child_id"]]
    
    # Update task_id references (in purchase_items, events)
    if "task_id" in data and data["task_id"]:
        if "tasks" in id_mappings and data["task_id"] in id_mappings["tasks"]:
            data["task_id"] = id_mappings["tasks"][data["task_id"]]
    
    return data


def _migrate_entity_files(
    source_dir: Path,
    target_dir: Path,
    entity_name: str,
    id_mappings: Dict[str, Dict[int, int]],
    progress_callback=None
) -> int:
    """Migrate all JSON files for an entity type."""
    source_entity_dir = source_dir / entity_name
    target_entity_dir = target_dir / entity_name
    
    if not source_entity_dir.exists():
        return 0
    
    target_entity_dir.mkdir(parents=True, exist_ok=True)
    
    count = 0
    entity_mapping = id_mappings.get(entity_name, {})
    
    for json_file in sorted(source_entity_dir.glob("*.json")):
        try:
            data = json.loads(json_file.read_text())
            old_id = data.get("id")
            
            # Update ID if there's a mapping
            if old_id and old_id in entity_mapping:
                data["id"] = entity_mapping[old_id]
                new_filename = f"{data['id']}.json"
            else:
                new_filename = json_file.name
            
            # Update any references
            data = _update_references_in_data(data, id_mappings)
            
            # Write to target
            target_file = target_entity_dir / new_filename
            target_file.write_text(json.dumps(data, indent=2, default=str))
            count += 1
            
            if progress_callback:
                progress_callback(1, json_file.stat().st_size)
                
        except (json.JSONDecodeError, OSError) as e:
            print(f"Warning: Failed to migrate {json_file}: {e}")
            continue
    
    return count


def _migrate_attachments(
    source_dir: Path,
    target_dir: Path,
    folder_name: str,  # "Images" or "Files"
    id_mappings: Dict[str, Dict[int, int]],
    progress_callback=None
) -> tuple[int, int]:
    """Migrate attachment folder with metadata updates."""
    source_attach_dir = source_dir / folder_name
    target_attach_dir = target_dir / folder_name
    
    if not source_attach_dir.exists():
        return 0, 0
    
    target_attach_dir.mkdir(parents=True, exist_ok=True)
    
    files_copied = 0
    bytes_copied = 0
    
    # Copy all files and subdirectories
    for item in source_attach_dir.iterdir():
        if item.is_file():
            # Copy files directly (like _metadata.json)
            target_file = target_attach_dir / item.name
            shutil.copy2(str(item), str(target_file))
            files_copied += 1
            bytes_copied += item.stat().st_size
            
            # Update metadata if it's the metadata file
            if item.name == "_metadata.json":
                try:
                    metadata = json.loads(item.read_text())
                    # Update experiment_id references in entries
                    for entry in metadata.get("entries", []):
                        exp_id = entry.get("experiment_id")
                        if exp_id and "tasks" in id_mappings and exp_id in id_mappings["tasks"]:
                            entry["experiment_id"] = id_mappings["tasks"][exp_id]
                    
                    target_file.write_text(json.dumps(metadata, indent=2, default=str))
                except (json.JSONDecodeError, OSError):
                    pass
            
            if progress_callback:
                progress_callback(1, item.stat().st_size)
                
        elif item.is_dir():
            # Copy experiment folders
            target_subdir = target_attach_dir / item.name
            shutil.copytree(str(item), str(target_subdir), dirs_exist_ok=True)
            
            # Count files and bytes
            for f in target_subdir.rglob("*"):
                if f.is_file():
                    files_copied += 1
                    bytes_copied += f.stat().st_size
            
            if progress_callback:
                progress_callback(files_copied, bytes_copied)
    
    return files_copied, bytes_copied


# ── Migration Endpoints ───────────────────────────────────────────────────────────

@router.get("/at-path", response_model=UsersAtPathResponse)
async def list_users_at_path(path: str):
    """List users at a specific path (for migration source/target selection)."""
    users_dir = Path(path) / "users"
    exists = users_dir.exists()
    
    if not exists:
        return UsersAtPathResponse(
            users=[],
            path=path,
            exists=False
        )
    
    users = _get_users_at_path(path)
    return UsersAtPathResponse(
        users=users,
        path=path,
        exists=True
    )


@router.post("/migrate/preview", response_model=MigrationPreviewResponse)
async def preview_migration(request: MigrationPreviewRequest):
    """Preview a user account migration."""
    source_users_dir = Path(request.source_path) / "users"
    target_users_dir = Path(request.target_path) / "users"
    
    warnings = []
    
    # Validate source
    if not source_users_dir.exists():
        raise HTTPException(status_code=400, detail=f"Source path does not exist: {request.source_path}")
    
    source_user_dir = source_users_dir / request.source_username
    if not source_user_dir.exists():
        raise HTTPException(status_code=404, detail=f"Source user '{request.source_username}' not found")
    
    # Validate target
    if not target_users_dir.exists():
        warnings.append(f"Target path does not exist, it will be created: {request.target_path}")
    
    # Check for username conflict
    target_user_dir = target_users_dir / request.target_username
    if target_user_dir.exists():
        warnings.append(f"User '{request.target_username}' already exists in target. Data will be merged.")
    
    # Validate target username
    if not re.match(r'^[a-zA-Z0-9_]+$', request.target_username):
        raise HTTPException(
            status_code=400,
            detail="Target username can only contain letters, numbers, and underscores"
        )
    
    if request.target_username.lower() in {name.lower() for name in RESERVED_USERNAMES}:
        raise HTTPException(
            status_code=400,
            detail=f"Target username '{request.target_username}' is reserved"
        )
    
    # Get stats
    stats = _scan_user_folder(source_user_dir)
    
    # Get existing users in target
    existing_users = _get_users_at_path(request.target_path)
    
    return MigrationPreviewResponse(
        status="ok",
        source_username=request.source_username,
        target_username=request.target_username,
        source_path=request.source_path,
        target_path=request.target_path,
        can_proceed=True,
        warnings=warnings,
        stats=stats,
        existing_users_in_target=existing_users
    )


@router.post("/migrate", response_model=MigrateUserResponse)
async def migrate_user(request: MigrateUserRequest):
    """Execute a user account migration."""
    global _migration_state
    
    source_users_dir = Path(request.source_path) / "users"
    target_users_dir = Path(request.target_path) / "users"
    
    # Initialize migration state
    _migration_state = {
        "status": "in_progress",
        "current_step": "Initializing",
        "items_processed": 0,
        "total_items": 0,
        "bytes_copied": 0,
        "total_bytes": 0,
        "error_message": ""
    }
    
    try:
        # Validate source
        if not source_users_dir.exists():
            raise HTTPException(status_code=400, detail=f"Source path does not exist: {request.source_path}")
        
        source_user_dir = source_users_dir / request.source_username
        if not source_user_dir.exists():
            raise HTTPException(status_code=404, detail=f"Source user '{request.source_username}' not found")
        
        # Create target directories
        target_users_dir.mkdir(parents=True, exist_ok=True)
        target_user_dir = target_users_dir / request.target_username
        target_user_dir.mkdir(parents=True, exist_ok=True)
        
        # Read counters
        source_counters = _read_counters_at_path(source_user_dir)
        target_counters = _read_counters_at_path(target_user_dir)
        
        # Build ID mappings
        id_mappings = _build_id_mappings(source_counters, target_counters)
        
        # Update target counters
        for entity, mapping in id_mappings.items():
            if mapping:
                max_new_id = max(mapping.values())
                if max_new_id > target_counters.get(entity, 0):
                    target_counters[entity] = max_new_id
        
        _write_counters_at_path(target_user_dir, target_counters)
        
        # Handle global counters for methods and PCR protocols
        target_global_counters = _read_global_counters_at_path(target_users_dir)
        source_global_counters = _read_global_counters_at_path(source_users_dir)
        
        # Update global counters if source has higher values
        for entity in ["methods", "pcr_protocols"]:
            source_max = source_global_counters.get(entity, 0)
            target_max = target_global_counters.get(entity, 0)
            if source_max > target_max:
                target_global_counters[entity] = source_max
        
        _write_global_counters_at_path(target_users_dir, target_global_counters)
        
        # Migrate entity files
        entity_types = ["projects", "tasks", "dependencies", "methods", "events",
                       "goals", "pcr_protocols", "purchase_items", "notes", "lab_links"]
        
        items_migrated = 0
        bytes_copied = 0
        
        def progress_callback(items, bytes):
            nonlocal items_migrated, bytes_copied
            items_migrated += items
            bytes_copied += bytes
            _migration_state["items_processed"] = items_migrated
            _migration_state["bytes_copied"] = bytes_copied
        
        for entity in entity_types:
            _migration_state["current_step"] = f"Migrating {entity}"
            count = _migrate_entity_files(
                source_user_dir, target_user_dir, entity, id_mappings, progress_callback
            )
            items_migrated += count
        
        # Migrate attachments
        _migration_state["current_step"] = "Migrating images"
        img_files, img_bytes = _migrate_attachments(
            source_user_dir, target_user_dir, "Images", id_mappings, progress_callback
        )
        items_migrated += img_files
        bytes_copied += img_bytes
        
        _migration_state["current_step"] = "Migrating files"
        file_files, file_bytes = _migrate_attachments(
            source_user_dir, target_user_dir, "Files", id_mappings, progress_callback
        )
        items_migrated += file_files
        bytes_copied += file_bytes
        
        # Update user metadata in target
        _migration_state["current_step"] = "Updating user metadata"
        target_metadata = _read_user_metadata_at_path(target_users_dir)
        
        # Get source user metadata for created_at
        source_metadata = _read_user_metadata_at_path(source_users_dir)
        source_user_meta = source_metadata.get("users", {}).get(request.source_username, {})
        
        # Assign color for migrated user
        if request.target_username not in target_metadata.get("users", {}):
            color = _get_next_available_color(target_metadata)
            if not color:
                color = USER_COLOR_PALETTE[0]
            
            if "users" not in target_metadata:
                target_metadata["users"] = {}
            if "color_assignments" not in target_metadata:
                target_metadata["color_assignments"] = {}
            
            target_metadata["users"][request.target_username] = {
                "created_at": source_user_meta.get("created_at", datetime.now(timezone.utc).isoformat()),
                "color": color
            }
            target_metadata["color_assignments"][color] = request.target_username
        
        _write_user_metadata_at_path(target_users_dir, target_metadata)
        
        # Delete source if requested
        if request.delete_source:
            _migration_state["current_step"] = "Deleting source"
            shutil.rmtree(str(source_user_dir))
            
            # Update source metadata to remove user
            source_meta = _read_user_metadata_at_path(source_users_dir)
            if request.source_username in source_meta.get("users", {}):
                color = source_meta["users"][request.source_username].get("color")
                if color and color in source_meta.get("color_assignments", {}):
                    del source_meta["color_assignments"][color]
                del source_meta["users"][request.source_username]
                _write_user_metadata_at_path(source_users_dir, source_meta)
        
        _migration_state["status"] = "complete"
        _migration_state["current_step"] = "Done"
        
        return MigrateUserResponse(
            status="ok",
            message=f"Successfully migrated user '{request.source_username}' to '{request.target_username}'",
            source_username=request.source_username,
            target_username=request.target_username,
            target_path=request.target_path,
            id_mappings=id_mappings,
            items_migrated=items_migrated,
            bytes_copied=bytes_copied
        )
        
    except HTTPException:
        raise
    except Exception as e:
        _migration_state["status"] = "error"
        _migration_state["error_message"] = str(e)
        raise HTTPException(status_code=500, detail=f"Migration failed: {str(e)}")


@router.get("/migrate/progress", response_model=MigrationProgress)
async def get_migration_progress():
    """Get current migration progress."""
    return MigrationProgress(
        status=_migration_state["status"],
        current_step=_migration_state["current_step"],
        items_processed=_migration_state["items_processed"],
        total_items=_migration_state["total_items"],
        bytes_copied=_migration_state["bytes_copied"],
        total_bytes=_migration_state["total_bytes"],
        error_message=_migration_state["error_message"]
    )
