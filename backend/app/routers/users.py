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
    return Path(settings.github_localpath) / "data" / "users"


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
    return Path(settings.github_localpath) / "data" / "users" / "_user_metadata.json"


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


def _get_next_available_color() -> Optional[str]:
    """Get the next available color from the palette.
    
    Returns None if all colors are in use.
    """
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


def _migrate_existing_users() -> None:
    """Migrate existing users without metadata to have colors and created_at."""
    metadata = _read_user_metadata()
    existing_users = _get_available_users()
    
    for user in existing_users:
        if user not in metadata.get("users", {}):
            # Assign color and created_at to existing user
            created_at = datetime.now(timezone.utc).isoformat()
            color = _get_next_available_color()
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
