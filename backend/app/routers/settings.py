"""Settings router for managing environment configuration."""

import os
import platform
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.storage import reset_stores

router = APIRouter(prefix="/settings", tags=["settings"])

# ── File Watcher for .env changes ───────────────────────────────────────────────

_env_path = Path(__file__).parent.parent.parent / ".env"
_last_mtime: float = 0


def _check_env_file() -> None:
    """Check if .env file has been modified and reload settings if so."""
    global _last_mtime
    try:
        if _env_path.exists():
            current_mtime = _env_path.stat().st_mtime
            if current_mtime != _last_mtime:
                _last_mtime = current_mtime
                # Reload settings from .env
                settings.reload()
                # Reinitialize stores with new path
                reset_stores()
                print("[Settings] Detected .env change, reloaded settings")
    except Exception as e:
        print(f"[Settings] Error checking .env file: {e}")


def _env_watcher_loop() -> None:
    """Background thread that periodically checks for .env changes."""
    global _last_mtime
    # Initialize last mtime
    if _env_path.exists():
        _last_mtime = _env_path.stat().st_mtime
    
    while True:
        time.sleep(2)  # Check every 2 seconds
        _check_env_file()


# Start the file watcher thread
_watcher_thread = threading.Thread(target=_env_watcher_loop, daemon=True)
_watcher_thread.start()


class SettingsResponse(BaseModel):
    """Current settings (token partially masked for security)."""
    github_token_masked: str
    github_repo: str
    github_localpath: str
    current_user: str
    main_user: str
    storage_mode: str
    is_configured: bool


class SettingsUpdate(BaseModel):
    """Settings update request."""
    github_token: Optional[str] = None
    github_repo: Optional[str] = None
    github_localpath: Optional[str] = None
    current_user: Optional[str] = None
    main_user: Optional[str] = None
    storage_mode: Optional[str] = None


class FolderSetupRequest(BaseModel):
    """Request to set up research folder."""
    mode: str  # "github" or "local"
    local_path: str
    github_token: Optional[str] = None
    github_repo: Optional[str] = None
    create_if_missing: bool = False


class FolderSetupResponse(BaseModel):
    """Response after folder setup."""
    status: str
    message: str
    path: str
    mode: str
    created_folders: bool


class StorageModeResponse(BaseModel):
    """Response for storage mode query."""
    mode: str
    path: str
    is_configured: bool


def mask_token(token: str) -> str:
    """Mask a GitHub token for display, showing only first 4 and last 4 chars."""
    if not token or len(token) < 12:
        return "***not set***" if not token else "***" + token[-4:]
    return f"{token[:4]}...{token[-4:]}"


def write_env_file(github_token: str, github_repo: str, github_localpath: str, current_user: str, main_user: str = "", storage_mode: str = "github") -> None:
    """Write settings to .env file in backend directory."""
    global _last_mtime
    env_path = Path(__file__).parent.parent.parent / ".env"
    
    content = f"""GITHUB_TOKEN={github_token}
GITHUB_REPO={github_repo}
GITHUB_LOCALPATH={github_localpath}
CORS_ORIGINS=["http://localhost:3000"]
CURRENT_USER={current_user}
MAIN_USER={main_user}
STORAGE_MODE={storage_mode}
"""
    env_path.write_text(content)
    
    # Update the last mtime to prevent the watcher from triggering a duplicate reload
    _last_mtime = env_path.stat().st_mtime


@router.get("", response_model=SettingsResponse)
async def get_settings():
    """Get current environment settings."""
    token = settings.github_token
    is_configured = bool(settings.github_localpath)
    
    return SettingsResponse(
        github_token_masked=mask_token(token),
        github_repo=settings.github_repo,
        github_localpath=settings.github_localpath,
        current_user=settings.current_user,
        main_user=settings.main_user,
        storage_mode=settings.storage_mode,
        is_configured=is_configured,
    )


@router.put("", response_model=SettingsResponse)
async def update_settings(update: SettingsUpdate):
    """Update environment settings.
    
    This updates the .env file and reinitializes all data stores,
    so changes take effect immediately without requiring a server restart.
    """
    # Get current values, use existing if not provided
    new_token = update.github_token if update.github_token else settings.github_token
    new_repo = update.github_repo if update.github_repo else settings.github_repo
    new_path = update.github_localpath if update.github_localpath else settings.github_localpath
    new_user = update.current_user if update.current_user else settings.current_user
    new_main_user = update.main_user if update.main_user is not None else settings.main_user
    
    # Validate required fields
    if not new_token or not new_repo or not new_path:
        raise HTTPException(
            status_code=400,
            detail="All fields are required: github_token, github_repo, github_localpath"
        )
    
    # Validate the local path exists
    if not Path(new_path).exists():
        raise HTTPException(
            status_code=400,
            detail=f"Local path does not exist: {new_path}. Please clone your data repository first."
        )
    
    # Write to .env file
    write_env_file(new_token, new_repo, new_path, new_user, new_main_user)
    
    # Update the settings object directly for immediate effect
    settings.github_token = new_token
    settings.github_repo = new_repo
    settings.github_localpath = new_path
    settings.current_user = new_user
    settings.main_user = new_main_user
    
    # Reinitialize all stores to pick up the new data path
    reset_stores()
    
    return SettingsResponse(
        github_token_masked=mask_token(new_token),
        github_repo=new_repo,
        github_localpath=new_path,
        current_user=new_user,
        main_user=new_main_user,
        is_configured=True,
    )


@router.post("/verify")
async def verify_settings():
    """Verify that the current settings are working correctly.
    
    Checks:
    1. Local path exists and is a git repository
    2. GitHub token has push access to the repository
    """
    issues = []
    
    # Check local path
    local_path = Path(settings.github_localpath)
    if not local_path.exists():
        issues.append(f"Local path does not exist: {settings.github_localpath}")
    elif not (local_path / ".git").exists():
        issues.append(f"Local path is not a git repository: {settings.github_localpath}")
    
    # Check token is set
    if not settings.github_token:
        issues.append("GitHub token is not set")
    
    # Check repo format
    if not settings.github_repo or "/" not in settings.github_repo:
        issues.append("GitHub repository should be in format: username/repo-name")
    
    if issues:
        return {"status": "error", "issues": issues}
    
    return {"status": "ok", "message": "Settings verified successfully"}


@router.get("/check-path")
async def check_data_path():
    """Check if the data path exists and is accessible.
    
    Returns detailed status about the data path configuration.
    Used by frontend to show a popup if the path is invalid.
    """
    local_path = settings.github_localpath
    storage_mode = settings.storage_mode
    
    # Check if path is configured
    if not local_path:
        return {
            "status": "error",
            "error_type": "not_configured",
            "message": "Data path is not configured. Please set up a research folder.",
            "storage_mode": storage_mode,
        }
    
    # Check if path exists
    path_obj = Path(local_path)
    if not path_obj.exists():
        return {
            "status": "error",
            "error_type": "path_not_found",
            "message": f"Local path does not exist: {local_path}",
            "configured_path": local_path,
            "storage_mode": storage_mode,
        }
    
    # In GitHub mode, check if it's a git repository
    if settings.is_github_mode() and not (path_obj / ".git").exists():
        return {
            "status": "error",
            "error_type": "not_git_repo",
            "message": f"Local path is not a git repository: {local_path}",
            "configured_path": local_path,
            "storage_mode": storage_mode,
        }
    
    # Check if data directory exists or can be created
    data_dir = path_obj / "data"
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
    except PermissionError:
        return {
            "status": "error",
            "error_type": "permission_denied",
            "message": f"Cannot create data directory at: {local_path}",
            "configured_path": local_path,
            "storage_mode": storage_mode,
        }
    
    return {
        "status": "ok",
        "message": "Data path is valid and accessible",
        "configured_path": local_path,
        "storage_mode": storage_mode,
    }


def validate_folder_structure(path: Path, create_if_missing: bool = False) -> dict:
    """Validate and optionally create folder structure.
    
    Returns:
        dict with 'valid', 'message', 'created', 'missing' keys
    """
    required_structure = [
        "users",
        "users/public",
    ]
    
    results = {
        "valid": True,
        "message": "",
        "created": False,
        "missing": []
    }
    
    for subdir in required_structure:
        full_path = path / subdir
        if not full_path.exists():
            if create_if_missing:
                try:
                    full_path.mkdir(parents=True, exist_ok=True)
                    results["created"] = True
                except PermissionError:
                    results["missing"].append(subdir)
                    results["valid"] = False
            else:
                results["missing"].append(subdir)
                results["valid"] = False
    
    if results["missing"]:
        results["message"] = f"Missing folders: {', '.join(results['missing'])}"
    
    return results


@router.get("/storage-mode", response_model=StorageModeResponse)
async def get_storage_mode():
    """Get the current storage mode configuration."""
    return StorageModeResponse(
        mode=settings.storage_mode,
        path=settings.github_localpath,
        is_configured=bool(settings.github_localpath),
    )


@router.post("/setup-folder", response_model=FolderSetupResponse)
async def setup_research_folder(request: FolderSetupRequest):
    """Set up or connect a research folder.
    
    Validates the path, creates folder structure if needed,
    and updates the .env configuration.
    """
    # Validate mode
    if request.mode not in ("github", "local"):
        raise HTTPException(
            status_code=400,
            detail="Mode must be 'github' or 'local'"
        )
    
    # Validate path
    if not request.local_path:
        raise HTTPException(
            status_code=400,
            detail="Local path is required"
        )
    
    path_obj = Path(request.local_path)
    
    # Check if path exists
    if not path_obj.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Path does not exist: {request.local_path}"
        )
    
    # In GitHub mode, validate git repo and token
    if request.mode == "github":
        if not (path_obj / ".git").exists():
            raise HTTPException(
                status_code=400,
                detail=f"Path is not a git repository: {request.local_path}"
            )
        
        if not request.github_token:
            raise HTTPException(
                status_code=400,
                detail="GitHub token is required for GitHub mode"
            )
        
        if not request.github_repo:
            raise HTTPException(
                status_code=400,
                detail="GitHub repository is required for GitHub mode"
            )
    
    # Validate/create folder structure
    validation = validate_folder_structure(path_obj, request.create_if_missing)
    if not validation["valid"]:
        raise HTTPException(
            status_code=400,
            detail=validation["message"] + ". Use create_if_missing=true to create them."
        )
    
    # Write to .env file
    github_token = request.github_token or ""
    github_repo = request.github_repo or ""
    
    write_env_file(
        github_token=github_token,
        github_repo=github_repo,
        github_localpath=request.local_path,
        current_user=settings.current_user,
        main_user=settings.main_user,
        storage_mode=request.mode,
    )
    
    # Update settings object directly
    settings.github_token = github_token
    settings.github_repo = github_repo
    settings.github_localpath = request.local_path
    settings.storage_mode = request.mode
    
    # Reinitialize stores
    reset_stores()
    
    return FolderSetupResponse(
        status="ok",
        message="Research folder configured successfully",
        path=request.local_path,
        mode=request.mode,
        created_folders=validation["created"],
    )


@router.post("/reload")
async def reload_settings():
    """Manually reload settings from the .env file.
    
    This is useful when the .env file has been edited manually
    and you want the changes to take effect without restarting.
    """
    global _last_mtime
    
    try:
        # Update the mtime to prevent duplicate reload
        if _env_path.exists():
            _last_mtime = _env_path.stat().st_mtime
        
        # Reload settings
        settings.reload()
        
        # Reinitialize stores
        reset_stores()
        
        return {
            "status": "ok",
            "message": "Settings reloaded successfully",
            "github_localpath": settings.github_localpath,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reload settings: {str(e)}"
        )


class DesktopLauncherRequest(BaseModel):
    """Request to create a desktop app launcher."""
    app_name: str


class DesktopLauncherResponse(BaseModel):
    """Response after creating a desktop app launcher."""
    app_path: str
    message: str
    platform: str  # "mac", "windows", or "linux"


def _sanitize_app_name(app_name: str) -> str:
    """Sanitize app name by removing potentially dangerous characters."""
    app_name = app_name.strip()
    if not app_name:
        return ""
    # Remove potentially dangerous characters, keep alphanumeric, spaces, hyphens, underscores
    return "".join(c for c in app_name if c.isalnum() or c in " -_").strip()


def _create_mac_launcher(app_name: str, project_dir: Path) -> DesktopLauncherResponse:
    """Create a macOS .app bundle that launches ResearchOS."""
    desktop_path = Path.home() / "Desktop"
    app_path = desktop_path / f"{app_name}.app"
    
    # Create app bundle structure
    contents_path = app_path / "Contents"
    macos_path = contents_path / "MacOS"
    resources_path = contents_path / "Resources"
    
    # Create directories
    macos_path.mkdir(parents=True, exist_ok=True)
    resources_path.mkdir(parents=True, exist_ok=True)
    
    # Create the executable script
    run_script = macos_path / "run"
    script_content = f"""#!/bin/bash
# {app_name} Launcher - Starts backend + frontend and opens browser

cd "{project_dir}"

# Start ResearchOS in background with nohup so it survives after this script exits
nohup ./start.sh > /tmp/researchos-launcher.log 2>&1 &
disown

# Wait for frontend to be ready, then open browser
sleep 5
open http://localhost:3000
"""
    run_script.write_text(script_content)
    
    # Make it executable
    run_script.chmod(0o755)
    
    # Create Info.plist
    info_plist = contents_path / "Info.plist"
    plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>run</string>
    <key>CFBundleName</key>
    <string>{app_name}</string>
    <key>CFBundleDisplayName</key>
    <string>{app_name}</string>
    <key>CFBundleIdentifier</key>
    <string>com.researchos.{app_name.lower().replace(' ', '').replace('-', '')}</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
</dict>
</plist>
"""
    info_plist.write_text(plist_content)
    
    # Create PkgInfo
    pkg_info = contents_path / "PkgInfo"
    pkg_info.write_text("APPL????")
    
    # Refresh the app bundle
    subprocess.run(["touch", str(app_path)], check=False)
    
    return DesktopLauncherResponse(
        app_path=str(app_path),
        message=f"Successfully created {app_name}.app on your Desktop",
        platform="mac"
    )


def _create_windows_launcher(app_name: str, project_dir: Path) -> DesktopLauncherResponse:
    """Create a Windows batch file that launches ResearchOS."""
    desktop_path = Path.home() / "Desktop"
    bat_path = desktop_path / f"{app_name}.bat"
    
    # Convert to Windows-style path for the batch file
    project_dir_win = str(project_dir).replace("/", "\\")
    
    # Create the batch file
    batch_content = f"""@echo off
REM {app_name} Launcher - Starts backend + frontend and opens browser
REM Console window stays open for debugging

echo Starting {app_name}...
cd /d "{project_dir_win}"

REM Kill existing processes on ports 8000 and 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)

REM Wait for ports to be released
timeout /t 2 /nobreak > nul

REM Start backend
echo Starting backend on http://localhost:8000 ...
cd backend
start "ResearchOS Backend" /min python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

REM Start frontend
echo Starting frontend on http://localhost:3000 ...
cd ..\\frontend
start "ResearchOS Frontend" /min npm run dev

REM Wait for frontend to be ready
echo Waiting for services to start...
timeout /t 5 /nobreak > nul

REM Open browser
echo Opening browser...
start http://localhost:3000

echo.
echo {app_name} is running!
echo Frontend: http://localhost:3000
echo Backend:  http://localhost:8000
echo.
echo Close this window to stop the services (or press Ctrl+C)
echo.
pause
"""
    bat_path.write_text(batch_content)
    
    return DesktopLauncherResponse(
        app_path=str(bat_path),
        message=f"Successfully created {app_name}.bat on your Desktop",
        platform="windows"
    )


def _create_linux_launcher(app_name: str, project_dir: Path) -> DesktopLauncherResponse:
    """Create a Linux .desktop file that launches ResearchOS."""
    desktop_path = Path.home() / "Desktop"
    desktop_file = desktop_path / f"{app_name}.desktop"
    
    # Create the .desktop file
    desktop_content = f"""[Desktop Entry]
Version=1.0
Name={app_name}
Comment=Launch ResearchOS
Exec=bash -c "cd '{project_dir}' && ./start.sh"
Icon=applications-science
Terminal=true
Type=Application
Categories=Science;
StartupNotify=true
"""
    desktop_file.write_text(desktop_content)
    
    # Make it executable and trusted
    desktop_file.chmod(0o755)
    
    # Mark as trusted (requires gio on GNOME)
    try:
        subprocess.run(["gio", "set", str(desktop_file), "metadata::trusted", "true"], 
                      check=False, capture_output=True)
    except FileNotFoundError:
        pass  # gio not available, that's okay
    
    return DesktopLauncherResponse(
        app_path=str(desktop_file),
        message=f"Successfully created {app_name}.desktop on your Desktop",
        platform="linux"
    )


@router.post("/create-desktop-launcher", response_model=DesktopLauncherResponse)
async def create_desktop_launcher(request: DesktopLauncherRequest):
    """Create a desktop launcher that starts ResearchOS.
    
    Creates a platform-specific launcher:
    - macOS: .app bundle
    - Windows: .bat batch file
    - Linux: .desktop file
    
    The launcher starts the backend and frontend servers and opens the browser.
    """
    app_name = _sanitize_app_name(request.app_name)
    if not app_name:
        raise HTTPException(
            status_code=400,
            detail="App name cannot be empty or contain only invalid characters"
        )
    
    # Get the project directory (parent of backend)
    project_dir = Path(__file__).parent.parent.parent
    
    # Detect platform and create appropriate launcher
    current_platform = platform.system()
    
    try:
        if current_platform == "Darwin":
            return _create_mac_launcher(app_name, project_dir)
        elif current_platform == "Windows":
            return _create_windows_launcher(app_name, project_dir)
        elif current_platform == "Linux":
            return _create_linux_launcher(app_name, project_dir)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported platform: {current_platform}. Supported platforms are macOS, Windows, and Linux."
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create launcher: {str(e)}"
        )


# Keep old endpoint for backwards compatibility (deprecated)
class MacAppCreateRequest(BaseModel):
    """Request to create a Mac desktop app launcher."""
    app_name: str


class MacAppCreateResponse(BaseModel):
    """Response after creating a Mac desktop app launcher."""
    app_path: str
    message: str


@router.post("/create-mac-app", response_model=MacAppCreateResponse, deprecated=True)
async def create_mac_app(request: MacAppCreateRequest):
    """Create a Mac .app bundle that launches ResearchOS.
    
    DEPRECATED: Use /create-desktop-launcher instead.
    This endpoint is kept for backwards compatibility.
    """
    app_name = _sanitize_app_name(request.app_name)
    if not app_name:
        raise HTTPException(
            status_code=400,
            detail="App name cannot be empty or contain only invalid characters"
        )
    
    project_dir = Path(__file__).parent.parent.parent
    
    try:
        result = _create_mac_launcher(app_name, project_dir)
        return MacAppCreateResponse(
            app_path=result.app_path,
            message=result.message
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create app: {str(e)}"
        )


# ── Data Migration Endpoints ────────────────────────────────────────────────────

# Global migration state (for progress tracking)
_migration_state = {
    "status": "idle",  # "idle", "in_progress", "complete", "error"
    "bytes_copied": 0,
    "total_bytes": 0,
    "files_copied": 0,
    "total_files": 0,
    "current_file": "",
    "error_message": "",
    "start_time": 0,
}
_migration_lock = threading.Lock()


class MigrationRequest(BaseModel):
    """Request to migrate data to a new location."""
    destination_path: str
    migration_type: str = "copy"  # "copy" or "move"
    target_mode: str = "local"    # "github" or "local"
    remove_git_folder: bool = False
    new_github_repo: str = ""
    new_github_token: str = ""


class MigrationPreview(BaseModel):
    """Preview of migration before execution."""
    source_path: str
    destination_path: str
    total_size_bytes: int
    file_count: int
    folder_count: int
    has_git_folder: bool
    users_found: List[str]
    warnings: List[str]
    can_proceed: bool


class MigrationProgress(BaseModel):
    """Current migration progress."""
    status: str
    bytes_copied: int
    total_bytes: int
    files_copied: int
    total_files: int
    current_file: str
    error_message: str = ""
    progress_percent: float = 0.0


class MigrationResponse(BaseModel):
    """Response after migration completes."""
    status: str
    message: str
    source_path: str
    destination_path: str
    bytes_copied: int
    files_copied: int
    new_storage_mode: str


def _calculate_folder_stats(path: Path) -> tuple:
    """Calculate total size, file count, and folder count.
    
    Returns:
        tuple: (total_bytes, file_count, folder_count)
    """
    total_bytes = 0
    file_count = 0
    folder_count = 0
    
    try:
        for item in path.rglob("*"):
            if item.is_file():
                try:
                    total_bytes += item.stat().st_size
                    file_count += 1
                except (OSError, PermissionError):
                    pass
            elif item.is_dir():
                folder_count += 1
    except (OSError, PermissionError):
        pass
    
    return total_bytes, file_count, folder_count


def _get_users_in_folder(path: Path) -> List[str]:
    """Get list of user directories in the data folder."""
    users = []
    users_dir = path / "users"
    
    if users_dir.exists():
        for user_dir in users_dir.iterdir():
            if user_dir.is_dir() and user_dir.name not in ("public", "lab", "_no_user_"):
                users.append(user_dir.name)
    
    return sorted(users)


def _copy_folder_with_progress(src: Path, dst: Path, skip_git: bool = False) -> None:
    """Copy folder contents with progress tracking.
    
    Args:
        src: Source folder path
        dst: Destination folder path
        skip_git: If True, skip the .git folder
    """
    global _migration_state
    
    # Get list of all items to copy
    items_to_copy = []
    for item in src.rglob("*"):
        # Skip .git folder if requested
        if skip_git and ".git" in item.parts:
            continue
        items_to_copy.append(item)
    
    # Update total counts
    with _migration_lock:
        _migration_state["total_files"] = len([i for i in items_to_copy if i.is_file()])
        _migration_state["total_bytes"] = sum(
            i.stat().st_size for i in items_to_copy if i.is_file()
        )
    
    # Copy each item
    for item in items_to_copy:
        # Check for cancellation or error
        with _migration_lock:
            if _migration_state["status"] == "error":
                return
        
        try:
            relative_path = item.relative_to(src)
            dest_path = dst / relative_path
            
            if item.is_dir():
                dest_path.mkdir(parents=True, exist_ok=True)
            elif item.is_file():
                # Update current file
                with _migration_lock:
                    _migration_state["current_file"] = str(relative_path)
                
                # Create parent directories
                dest_path.parent.mkdir(parents=True, exist_ok=True)
                
                # Copy file
                shutil.copy2(item, dest_path)
                
                # Update progress
                file_size = item.stat().st_size
                with _migration_lock:
                    _migration_state["bytes_copied"] += file_size
                    _migration_state["files_copied"] += 1
                    
        except Exception as e:
            with _migration_lock:
                _migration_state["status"] = "error"
                _migration_state["error_message"] = f"Error copying {item}: {str(e)}"
            raise


@router.post("/migrate/preview", response_model=MigrationPreview)
async def preview_migration(request: MigrationRequest):
    """Preview what will be migrated without making changes.
    
    Returns statistics about the source folder and any warnings.
    """
    source_path = settings.github_localpath
    
    # Validate source path
    if not source_path:
        return MigrationPreview(
            source_path="",
            destination_path=request.destination_path,
            total_size_bytes=0,
            file_count=0,
            folder_count=0,
            has_git_folder=False,
            users_found=[],
            warnings=["No data path is currently configured"],
            can_proceed=False,
        )
    
    source = Path(source_path)
    if not source.exists():
        return MigrationPreview(
            source_path=source_path,
            destination_path=request.destination_path,
            total_size_bytes=0,
            file_count=0,
            folder_count=0,
            has_git_folder=False,
            users_found=[],
            warnings=[f"Source path does not exist: {source_path}"],
            can_proceed=False,
        )
    
    # Validate destination path
    dest = Path(request.destination_path)
    warnings = []
    
    # Check if destination exists
    if dest.exists():
        warnings.append(f"Destination path already exists: {request.destination_path}")
        # Check if it has data
        if (dest / "users").exists():
            warnings.append("Destination already contains user data - files may be overwritten")
    else:
        # Check if parent exists
        if not dest.parent.exists():
            warnings.append(f"Parent directory does not exist: {dest.parent}")
    
    # Check destination is not a subdirectory of source
    try:
        dest.resolve().relative_to(source.resolve())
        warnings.append("Destination cannot be inside the source directory")
        can_proceed = False
    except ValueError:
        # dest is not a subdirectory of source, which is good
        can_proceed = True
    
    # Check destination is not the same as source
    if dest.resolve() == source.resolve():
        warnings.append("Destination cannot be the same as source")
        can_proceed = False
    
    # Calculate stats
    total_bytes, file_count, folder_count = _calculate_folder_stats(source)
    has_git = (source / ".git").exists()
    users = _get_users_in_folder(source)
    
    # Check for large data
    if total_bytes > 1_000_000_000:  # > 1GB
        gb_size = total_bytes / 1_000_000_000
        warnings.append(f"Large data size ({gb_size:.1f} GB) - migration may take several minutes")
    
    # Check disk space (basic check)
    try:
        if dest.exists():
            # Use parent if dest exists
            check_path = dest
        else:
            check_path = dest.parent
        
        if check_path.exists():
            stat = shutil.disk_usage(check_path)
            free_gb = stat.free / 1_000_000_000
            needed_gb = total_bytes / 1_000_000_000
            if stat.free < total_bytes * 1.1:  # 10% buffer
                warnings.append(f"Insufficient disk space: {free_gb:.1f} GB free, need {needed_gb:.1f} GB")
                can_proceed = False
    except Exception:
        warnings.append("Could not check available disk space")
    
    return MigrationPreview(
        source_path=source_path,
        destination_path=request.destination_path,
        total_size_bytes=total_bytes,
        file_count=file_count,
        folder_count=folder_count,
        has_git_folder=has_git,
        users_found=users,
        warnings=warnings,
        can_proceed=can_proceed,
    )


@router.get("/migrate/progress", response_model=MigrationProgress)
async def get_migration_progress():
    """Get the current migration progress.
    
    Poll this endpoint during migration to show progress to the user.
    """
    with _migration_lock:
        progress = MigrationProgress(
            status=_migration_state["status"],
            bytes_copied=_migration_state["bytes_copied"],
            total_bytes=_migration_state["total_bytes"],
            files_copied=_migration_state["files_copied"],
            total_files=_migration_state["total_files"],
            current_file=_migration_state["current_file"],
            error_message=_migration_state["error_message"],
        )
        
        # Calculate percentage
        if progress.total_bytes > 0:
            progress.progress_percent = (progress.bytes_copied / progress.total_bytes) * 100
        else:
            progress.progress_percent = 0.0
        
        return progress


def _execute_migration_task(request: MigrationRequest) -> None:
    """Background task to execute the migration.
    
    This runs in a separate thread to avoid blocking the API.
    """
    global _migration_state
    
    try:
        source = Path(settings.github_localpath)
        dest = Path(request.destination_path)
        
        # Create destination
        dest.mkdir(parents=True, exist_ok=True)
        
        # Determine if we should skip .git
        skip_git = request.remove_git_folder or request.target_mode == "local"
        
        # Copy data
        _copy_folder_with_progress(source, dest, skip_git=skip_git)
        
        # If move, delete source (but not .git if we skipped it)
        if request.migration_type == "move":
            for item in source.iterdir():
                if skip_git and item.name == ".git":
                    continue
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
        
        # Update .env file
        new_token = request.new_github_token if request.new_github_token else (
            "" if request.target_mode == "local" else settings.github_token
        )
        new_repo = request.new_github_repo if request.new_github_repo else (
            "" if request.target_mode == "local" else settings.github_repo
        )
        
        write_env_file(
            github_token=new_token,
            github_repo=new_repo,
            github_localpath=request.destination_path,
            current_user=settings.current_user,
            main_user=settings.main_user,
            storage_mode=request.target_mode,
        )
        
        # Update settings object
        settings.github_token = new_token
        settings.github_repo = new_repo
        settings.github_localpath = request.destination_path
        settings.storage_mode = request.target_mode
        
        # Reinitialize stores
        reset_stores()
        
        # Mark complete
        with _migration_lock:
            _migration_state["status"] = "complete"
            
    except Exception as e:
        with _migration_lock:
            _migration_state["status"] = "error"
            _migration_state["error_message"] = str(e)


@router.post("/migrate", response_model=MigrationResponse)
async def execute_migration(request: MigrationRequest):
    """Execute the data migration.
    
    This copies or moves all data to the new location and updates settings.
    For large data sets, poll /migrate/progress for status updates.
    """
    global _migration_state
    
    # Check if migration is already in progress
    with _migration_lock:
        if _migration_state["status"] == "in_progress":
            raise HTTPException(
                status_code=409,
                detail="A migration is already in progress"
            )
        
        # Reset state
        _migration_state = {
            "status": "in_progress",
            "bytes_copied": 0,
            "total_bytes": 0,
            "files_copied": 0,
            "total_files": 0,
            "current_file": "",
            "error_message": "",
            "start_time": time.time(),
        }
    
    # Validate request
    if request.migration_type not in ("copy", "move"):
        raise HTTPException(
            status_code=400,
            detail="migration_type must be 'copy' or 'move'"
        )
    
    if request.target_mode not in ("github", "local"):
        raise HTTPException(
            status_code=400,
            detail="target_mode must be 'github' or 'local'"
        )
    
    if request.target_mode == "github":
        if not request.new_github_token and not settings.github_token:
            raise HTTPException(
                status_code=400,
                detail="GitHub token is required for GitHub mode"
            )
        if not request.new_github_repo and not settings.github_repo:
            raise HTTPException(
                status_code=400,
                detail="GitHub repository is required for GitHub mode"
            )
    
    # Validate source exists
    source = Path(settings.github_localpath)
    if not source.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Source path does not exist: {settings.github_localpath}"
        )
    
    # For small migrations, execute synchronously
    total_bytes, file_count, _ = _calculate_folder_stats(source)
    
    if total_bytes < 100_000_000:  # < 100MB, do synchronously
        _execute_migration_task(request)
        
        with _migration_lock:
            final_status = _migration_state["status"]
            error_msg = _migration_state["error_message"]
        
        if final_status == "error":
            raise HTTPException(
                status_code=500,
                detail=f"Migration failed: {error_msg}"
            )
        
        return MigrationResponse(
            status="success",
            message="Migration completed successfully",
            source_path=str(source),
            destination_path=request.destination_path,
            bytes_copied=total_bytes,
            files_copied=file_count,
            new_storage_mode=request.target_mode,
        )
    
    # For large migrations, start background thread
    thread = threading.Thread(target=_execute_migration_task, args=(request,))
    thread.start()
    
    return MigrationResponse(
        status="in_progress",
        message="Migration started. Poll /migrate/progress for updates.",
        source_path=str(source),
        destination_path=request.destination_path,
        bytes_copied=0,
        files_copied=0,
        new_storage_mode=request.target_mode,
    )


@router.post("/migrate/cancel")
async def cancel_migration():
    """Cancel an in-progress migration.
    
    Note: This only prevents further copying. Partial data may remain at destination.
    """
    global _migration_state
    
    with _migration_lock:
        if _migration_state["status"] != "in_progress":
            return {"status": "no_migration", "message": "No migration in progress"}
        
        _migration_state["status"] = "error"
        _migration_state["error_message"] = "Cancelled by user"
    
    return {"status": "cancelled", "message": "Migration cancelled"}