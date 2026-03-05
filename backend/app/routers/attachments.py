"""Attachment management endpoints for images and files.

This module provides endpoints for uploading, managing, and retrieving
image and file attachments with experiment-specific folder organization.

Folder structure:
- Images/{date-name}/{filename}
- Files/{date-name}/{filename}

Where {date-name} is like "Mar-04-2026-My-Experiment"
"""

import base64
import logging
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.git_sync import commit_and_push
from app.schemas import (
    AttachmentUploadRequest,
    AttachmentUploadResponse,
    ImageMetadataOut,
    FileMetadataOut,
)
from app.storage import (
    generate_experiment_folder_name,
    get_image_metadata_store,
    get_file_metadata_store,
    get_tasks_store,
    get_projects_store,
)

router = APIRouter(prefix="/attachments", tags=["attachments"])
logger = logging.getLogger(__name__)

# GitHub's recommended maximum file size (100 MB)
GITHUB_MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB in bytes

# Warning threshold (50 MB) - files this large will trigger a warning
GITHUB_WARNING_FILE_SIZE = 50 * 1024 * 1024  # 50 MB in bytes


# ── Helper Functions ────────────────────────────────────────────────────────────


def _repo_root() -> Path:
    """Get the data repo root path."""
    root = Path(settings.github_localpath)
    if not root.exists():
        raise HTTPException(
            status_code=503,
            detail=f"Data repo not found at {root}. Set GITHUB_LOCALPATH in .env",
        )
    return root


def _add_to_local_exclude(file_path: str) -> bool:
    """Add a file path to .git/info/exclude in the repo root.
    
    This uses Git's local-only exclude file, so each user's large file
    ignores stay local and don't affect other collaborators.
    
    Returns True if the path was added, False if it was already present.
    """
    exclude_path = _repo_root() / ".git" / "info" / "exclude"
    # Normalize the path for gitignore (use forward slashes)
    normalized_path = file_path.lstrip("/")
    
    # Ensure the .git/info directory exists
    exclude_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Read existing exclude content
    existing_lines = []
    if exclude_path.exists():
        existing_content = exclude_path.read_text(encoding="utf-8")
        existing_lines = existing_content.splitlines()
    
    # Check if the path is already in exclude
    if normalized_path in existing_lines:
        return False
    
    # Add the path to exclude
    with open(exclude_path, "a", encoding="utf-8") as f:
        # Add newline if file doesn't end with one
        if existing_lines and existing_lines[-1] != "":
            f.write("\n")
        f.write(f"{normalized_path}\n")
    
    logger.info("Added %s to .git/info/exclude due to large file size", normalized_path)
    return True


def _format_file_size(size_bytes: int) -> str:
    """Format file size in human-readable format."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"


def _get_mime_type(filename: str) -> str:
    """Get MIME type from filename."""
    mime_type, _ = mimetypes.guess_type(filename)
    return mime_type or "application/octet-stream"


def _is_image_file(mime_type: str) -> bool:
    """Check if a MIME type is an image."""
    return mime_type.startswith("image/")


# ── Image Endpoints ─────────────────────────────────────────────────────────────


@router.post("/images", response_model=AttachmentUploadResponse)
async def upload_image(body: AttachmentUploadRequest):
    """Upload an image attachment.
    
    Creates a folder based on experiment date and name, saves the image,
    and records metadata.
    """
    # Decode base64 content
    try:
        image_bytes = base64.b64decode(body.base64_content)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 content")
    
    file_size = len(image_bytes)
    mime_type = _get_mime_type(body.original_filename)
    
    # Validate it's an image
    if not _is_image_file(mime_type):
        raise HTTPException(
            status_code=400, 
            detail=f"File type '{mime_type}' is not an image. Use the files endpoint for other file types."
        )
    
    # Generate folder name
    folder_name = generate_experiment_folder_name(body.experiment_name, body.experiment_date)
    
    # Generate unique filename with timestamp prefix
    timestamp = int(datetime.now().timestamp() * 1000)
    safe_filename = body.original_filename.replace(" ", "_")
    filename = f"{timestamp}-{safe_filename}"
    
    # Build paths
    relative_path = f"users/{settings.current_user}/Images/{folder_name}/{filename}"
    full_path = _repo_root() / relative_path
    
    # Create directory and write file
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(image_bytes)
    
    # Check file size and handle large files
    warning = None
    added_to_gitignore = False
    
    if file_size >= GITHUB_MAX_FILE_SIZE:
        _add_to_local_exclude(relative_path)
        added_to_gitignore = True
        warning = (
            f"File size ({_format_file_size(file_size)}) exceeds GitHub's 100MB limit. "
            f"The file has been saved locally but added to .git/info/exclude and will NOT be "
            f"uploaded to GitHub. The image will display in your local app but "
            f"won't be available to others."
        )
        logger.warning(
            "File %s (%s) exceeds GitHub limit, added to .git/info/exclude",
            relative_path, _format_file_size(file_size)
        )
    elif file_size >= GITHUB_WARNING_FILE_SIZE:
        warning = (
            f"File size ({_format_file_size(file_size)}) is approaching GitHub's 100MB limit. "
            f"Consider reducing file size for better repository performance."
        )
        logger.info(
            "File %s (%s) is large but within GitHub limits",
            relative_path, _format_file_size(file_size)
        )
    
    # Record metadata
    metadata_store = get_image_metadata_store()
    entry = metadata_store.add_entry({
        "filename": filename,
        "original_filename": body.original_filename,
        "path": f"Images/{folder_name}/{filename}",
        "experiment_id": body.experiment_id,
        "experiment_name": body.experiment_name,
        "project_id": body.project_id,
        "project_name": body.project_name,
        "uploaded_at": datetime.utcnow().isoformat(),
        "file_size": file_size,
        "file_type": mime_type,
        "folder": folder_name,
    })
    
    # Commit and push (if not excluded)
    if not added_to_gitignore:
        await commit_and_push(f"Upload image for {body.experiment_name}: {body.original_filename}")
    
    return AttachmentUploadResponse(
        id=entry["id"],
        filename=filename,
        original_filename=body.original_filename,
        path=entry["path"],
        folder=folder_name,
        file_size=file_size,
        file_type=mime_type,
        warning=warning,
        added_to_gitignore=added_to_gitignore,
    )


@router.get("/images", response_model=List[ImageMetadataOut])
async def list_images(
    experiment_id: Optional[int] = None,
    folder: Optional[str] = None,
):
    """List all images, optionally filtered by experiment or folder."""
    metadata_store = get_image_metadata_store()
    
    if experiment_id is not None:
        entries = metadata_store.get_by_experiment(experiment_id)
    elif folder is not None:
        entries = metadata_store.get_by_folder(folder)
    else:
        entries = metadata_store.list_all()
    
    return [ImageMetadataOut(**entry) for entry in entries]


@router.get("/images/{image_id}", response_model=ImageMetadataOut)
async def get_image(image_id: int):
    """Get metadata for a specific image."""
    metadata_store = get_image_metadata_store()
    entry = metadata_store.get_entry(image_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Image not found")
    return ImageMetadataOut(**entry)


@router.delete("/images/{image_id}")
async def delete_image(image_id: int):
    """Delete an image and its metadata."""
    metadata_store = get_image_metadata_store()
    entry = metadata_store.get_entry(image_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # Delete the file
    file_path = _repo_root() / "users" / settings.current_user / entry["path"]
    if file_path.exists():
        file_path.unlink()
    
    # Delete metadata
    metadata_store.delete_entry(image_id)
    
    await commit_and_push(f"Delete image: {entry.get('original_filename', entry['filename'])}")
    
    return {"status": "deleted", "id": image_id}


# ── File Endpoints ─────────────────────────────────────────────────────────────


@router.post("/files", response_model=AttachmentUploadResponse)
async def upload_file(body: AttachmentUploadRequest):
    """Upload a file attachment (PDFs, documents, etc.).
    
    Creates a folder based on experiment date and name, saves the file,
    and records metadata.
    """
    # Decode base64 content
    try:
        file_bytes = base64.b64decode(body.base64_content)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 content")
    
    file_size = len(file_bytes)
    mime_type = _get_mime_type(body.original_filename)
    
    # Generate folder name
    folder_name = generate_experiment_folder_name(body.experiment_name, body.experiment_date)
    
    # Generate unique filename with timestamp prefix
    timestamp = int(datetime.now().timestamp() * 1000)
    safe_filename = body.original_filename.replace(" ", "_")
    filename = f"{timestamp}-{safe_filename}"
    
    # Build paths
    relative_path = f"users/{settings.current_user}/Files/{folder_name}/{filename}"
    full_path = _repo_root() / relative_path
    
    # Create directory and write file
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(file_bytes)
    
    # Check file size and handle large files
    warning = None
    added_to_gitignore = False
    
    if file_size >= GITHUB_MAX_FILE_SIZE:
        _add_to_local_exclude(relative_path)
        added_to_gitignore = True
        warning = (
            f"File size ({_format_file_size(file_size)}) exceeds GitHub's 100MB limit. "
            f"The file has been saved locally but added to .git/info/exclude and will NOT be "
            f"uploaded to GitHub. The file will be available in your local app but "
            f"won't be available to others."
        )
        logger.warning(
            "File %s (%s) exceeds GitHub limit, added to .git/info/exclude",
            relative_path, _format_file_size(file_size)
        )
    elif file_size >= GITHUB_WARNING_FILE_SIZE:
        warning = (
            f"File size ({_format_file_size(file_size)}) is approaching GitHub's 100MB limit. "
            f"Consider reducing file size for better repository performance."
        )
    
    # Record metadata
    metadata_store = get_file_metadata_store()
    entry = metadata_store.add_entry({
        "filename": filename,
        "original_filename": body.original_filename,
        "path": f"Files/{folder_name}/{filename}",
        "experiment_id": body.experiment_id,
        "experiment_name": body.experiment_name,
        "project_id": body.project_id,
        "project_name": body.project_name,
        "uploaded_at": datetime.utcnow().isoformat(),
        "file_size": file_size,
        "file_type": mime_type,
        "folder": folder_name,
        "attachment_type": body.attachment_type,
    })
    
    # Commit and push (if not excluded)
    if not added_to_gitignore:
        await commit_and_push(f"Upload file for {body.experiment_name}: {body.original_filename}")
    
    return AttachmentUploadResponse(
        id=entry["id"],
        filename=filename,
        original_filename=body.original_filename,
        path=entry["path"],
        folder=folder_name,
        file_size=file_size,
        file_type=mime_type,
        warning=warning,
        added_to_gitignore=added_to_gitignore,
    )


@router.get("/files", response_model=List[FileMetadataOut])
async def list_files(
    experiment_id: Optional[int] = None,
    folder: Optional[str] = None,
    attachment_type: Optional[str] = None,
):
    """List all files, optionally filtered by experiment, folder, or type."""
    metadata_store = get_file_metadata_store()
    
    if experiment_id is not None:
        entries = metadata_store.get_by_experiment(experiment_id)
    elif folder is not None:
        entries = metadata_store.get_by_folder(folder)
    else:
        entries = metadata_store.list_all()
    
    # Filter by attachment_type if specified
    if attachment_type is not None:
        entries = [e for e in entries if e.get("attachment_type") == attachment_type]
    
    return [FileMetadataOut(**entry) for entry in entries]


@router.get("/files/{file_id}", response_model=FileMetadataOut)
async def get_file(file_id: int):
    """Get metadata for a specific file."""
    metadata_store = get_file_metadata_store()
    entry = metadata_store.get_entry(file_id)
    if not entry:
        raise HTTPException(status_code=404, detail="File not found")
    return FileMetadataOut(**entry)


@router.delete("/files/{file_id}")
async def delete_file(file_id: int):
    """Delete a file and its metadata."""
    metadata_store = get_file_metadata_store()
    entry = metadata_store.get_entry(file_id)
    if not entry:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Delete the file
    file_path = _repo_root() / "users" / settings.current_user / entry["path"]
    if file_path.exists():
        file_path.unlink()
    
    # Delete metadata
    metadata_store.delete_entry(file_id)
    
    await commit_and_push(f"Delete file: {entry.get('original_filename', entry['filename'])}")
    
    return {"status": "deleted", "id": file_id}


# ── Utility Endpoints ──────────────────────────────────────────────────────────


@router.get("/folder-name")
async def get_folder_name(experiment_name: str, experiment_date: str):
    """Generate a folder name for an experiment.
    
    Useful for previewing the folder name before uploading.
    """
    from datetime import date
    try:
        exp_date = date.fromisoformat(experiment_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    
    folder_name = generate_experiment_folder_name(experiment_name, exp_date)
    return {"folder_name": folder_name}


@router.get("/search-by-filename")
async def search_image_by_filename(filename: str):
    """Search for an image file by its filename across all image folders.
    
    Returns a list of matching image paths that can be used to fix broken image links.
    """
    import os
    
    if not filename:
        raise HTTPException(status_code=400, detail="Filename is required")
    
    # Clean the filename - remove any path components and get just the filename
    clean_filename = os.path.basename(filename)
    
    repo_root = _repo_root()
    images_dir = repo_root / "users" / settings.current_user / "Images"
    
    matches = []
    
    if images_dir.exists():
        # Walk through all subdirectories to find matching files
        for root, dirs, files in os.walk(images_dir):
            for file in files:
                # Check for exact match or match with timestamp prefix
                if file == clean_filename:
                    # Found exact match
                    rel_path = os.path.relpath(os.path.join(root, file), repo_root)
                    matches.append({
                        "path": rel_path,
                        "filename": file,
                        "match_type": "exact"
                    })
                elif file.endswith(clean_filename) and clean_filename in file:
                    # Found match with timestamp prefix (e.g., "1234567890-image.png" matches "image.png")
                    rel_path = os.path.relpath(os.path.join(root, file), repo_root)
                    matches.append({
                        "path": rel_path,
                        "filename": file,
                        "match_type": "with_timestamp"
                    })
    
    return {
        "search_term": filename,
        "matches": matches,
        "count": len(matches)
    }


@router.get("/stats")
async def get_attachment_stats():
    """Get statistics about attachments."""
    image_store = get_image_metadata_store()
    file_store = get_file_metadata_store()
    
    images = image_store.list_all()
    files = file_store.list_all()
    
    total_image_size = sum(i.get("file_size", 0) for i in images)
    total_file_size = sum(f.get("file_size", 0) for f in files)
    
    return {
        "images": {
            "count": len(images),
            "total_size": total_image_size,
            "total_size_formatted": _format_file_size(total_image_size),
        },
        "files": {
            "count": len(files),
            "total_size": total_file_size,
            "total_size_formatted": _format_file_size(total_file_size),
        },
        "total": {
            "count": len(images) + len(files),
            "total_size": total_image_size + total_file_size,
            "total_size_formatted": _format_file_size(total_image_size + total_file_size),
        },
    }
