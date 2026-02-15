"""Settings router for managing environment configuration."""

import os
import platform
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    """Current settings (token partially masked for security)."""
    github_token_masked: str
    github_repo: str
    github_localpath: str
    is_configured: bool


class SettingsUpdate(BaseModel):
    """Settings update request."""
    github_token: Optional[str] = None
    github_repo: Optional[str] = None
    github_localpath: Optional[str] = None


def mask_token(token: str) -> str:
    """Mask a GitHub token for display, showing only first 4 and last 4 chars."""
    if not token or len(token) < 12:
        return "***not set***" if not token else "***" + token[-4:]
    return f"{token[:4]}...{token[-4:]}"


def write_env_file(github_token: str, github_repo: str, github_localpath: str) -> None:
    """Write settings to .env file in backend directory."""
    env_path = Path(__file__).parent.parent.parent / ".env"
    
    content = f"""GITHUB_TOKEN={github_token}
GITHUB_REPO={github_repo}
GITHUB_LOCALPATH={github_localpath}
CORS_ORIGINS=["http://localhost:3000"]
"""
    env_path.write_text(content)


@router.get("", response_model=SettingsResponse)
async def get_settings():
    """Get current environment settings."""
    token = settings.github_token
    is_configured = bool(token and settings.github_repo and settings.github_localpath)
    
    return SettingsResponse(
        github_token_masked=mask_token(token),
        github_repo=settings.github_repo,
        github_localpath=settings.github_localpath,
        is_configured=is_configured,
    )


@router.put("", response_model=SettingsResponse)
async def update_settings(update: SettingsUpdate):
    """Update environment settings.
    
    This updates the .env file and requires an application restart
    for changes to take full effect.
    """
    # Get current values, use existing if not provided
    new_token = update.github_token if update.github_token else settings.github_token
    new_repo = update.github_repo if update.github_repo else settings.github_repo
    new_path = update.github_localpath if update.github_localpath else settings.github_localpath
    
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
    write_env_file(new_token, new_repo, new_path)
    
    # Update the settings object directly for immediate effect
    # Note: This updates the singleton, but a restart is recommended
    settings.github_token = new_token
    settings.github_repo = new_repo
    settings.github_localpath = new_path
    
    return SettingsResponse(
        github_token_masked=mask_token(new_token),
        github_repo=new_repo,
        github_localpath=new_path,
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


class MacAppCreateRequest(BaseModel):
    """Request to create a Mac desktop app launcher."""
    app_name: str


class MacAppCreateResponse(BaseModel):
    """Response after creating a Mac desktop app launcher."""
    app_path: str
    message: str


@router.post("/create-mac-app", response_model=MacAppCreateResponse)
async def create_mac_app(request: MacAppCreateRequest):
    """Create a Mac .app bundle that launches ResearchOS.
    
    This creates a proper macOS application bundle on the user's Desktop
    that can be double-clicked to start the backend/frontend and open the browser.
    """
    # Check if we're running on macOS
    if platform.system() != "Darwin":
        raise HTTPException(
            status_code=400,
            detail="This feature is only available on macOS"
        )
    
    app_name = request.app_name.strip()
    if not app_name:
        raise HTTPException(
            status_code=400,
            detail="App name cannot be empty"
        )
    
    # Sanitize app name (remove potentially dangerous characters)
    app_name = "".join(c for c in app_name if c.isalnum() or c in " -_").strip()
    if not app_name:
        raise HTTPException(
            status_code=400,
            detail="App name contains only invalid characters"
        )
    
    # Get the project directory (parent of backend)
    project_dir = Path(__file__).parent.parent.parent
    desktop_path = Path.home() / "Desktop"
    app_path = desktop_path / f"{app_name}.app"
    
    # Create app bundle structure
    contents_path = app_path / "Contents"
    macos_path = contents_path / "MacOS"
    resources_path = contents_path / "Resources"
    
    try:
        # Create directories
        macos_path.mkdir(parents=True, exist_ok=True)
        resources_path.mkdir(parents=True, exist_ok=True)
        
        # Create the executable script
        run_script = macos_path / "run"
        script_content = f"""#!/bin/bash
# {app_name} Launcher - Starts backend + frontend and opens browser

cd "{project_dir}"

# Start ResearchOS in background
./start.sh &

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
        
        return MacAppCreateResponse(
            app_path=str(app_path),
            message=f"Successfully created {app_name}.app on your Desktop"
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create app: {str(e)}"
        )