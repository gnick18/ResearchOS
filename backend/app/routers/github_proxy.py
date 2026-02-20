"""GitHub proxy endpoints — local filesystem for the data repo.

Reads/writes Markdown and image files directly from the local data repo
clone. git_sync handles committing and pushing to GitHub.
"""

import base64
import hashlib
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.git_sync import commit_and_push

router = APIRouter(prefix="/github", tags=["github"])
logger = logging.getLogger(__name__)

# GitHub's recommended maximum file size (100 MB)
GITHUB_MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB in bytes

# Warning threshold (50 MB) - files this large will trigger a warning
GITHUB_WARNING_FILE_SIZE = 50 * 1024 * 1024  # 50 MB in bytes


# ── Schemas ───────────────────────────────────────────────────────────────────


class FileContent(BaseModel):
    path: str
    content: str  # Markdown text or base64-encoded image
    message: str = "Update via ResearchOS"


class FileResponse(BaseModel):
    path: str
    content: str
    sha: str
    html_url: str


class ImageUpload(BaseModel):
    path: str
    base64_content: str  # base64-encoded image data
    message: str = "Upload image via ResearchOS"


# ── Helpers ───────────────────────────────────────────────────────────────────


def _repo_root() -> Path:
    root = Path(settings.github_localpath)
    if not root.exists():
        raise HTTPException(
            status_code=503,
            detail=f"Data repo not found at {root}. Set GITHUB_LOCALPATH in .env",
        )
    return root


def _resolve(path: str) -> Path:
    """Resolve a relative path inside the data repo safely."""
    resolved = (_repo_root() / path.lstrip("/")).resolve()
    # Prevent path traversal
    if not str(resolved).startswith(str(_repo_root().resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")
    return resolved


def _sha(content: bytes) -> str:
    """Compute a git-like SHA for content."""
    return hashlib.sha1(content).hexdigest()


def _html_url(path: str) -> str:
    """Build a GitHub html_url from config."""
    if settings.github_repo:
        return f"https://github.com/{settings.github_repo}/blob/main/{path}"
    return ""


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


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/file", response_model=FileResponse)
async def read_file(path: str):
    """Read a file from the local data repo."""
    fp = _resolve(path)
    if not fp.exists() or not fp.is_file():
        raise HTTPException(status_code=404, detail="File not found in repository")

    content_bytes = fp.read_bytes()
    try:
        content = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        content = base64.b64encode(content_bytes).decode("ascii")

    return FileResponse(
        path=path,
        content=content,
        sha=_sha(content_bytes),
        html_url=_html_url(path),
    )


@router.put("/file")
async def write_file(body: FileContent):
    """Create or update a Markdown file in the local data repo."""
    fp = _resolve(body.path)
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(body.content, encoding="utf-8")

    content_bytes = body.content.encode("utf-8")
    await commit_and_push(body.message)

    return {
        "path": body.path,
        "sha": _sha(content_bytes),
        "html_url": _html_url(body.path),
    }


@router.put("/image")
async def upload_image(body: ImageUpload):
    """Save a base64-encoded image to the local data repo.
    
    If the file is too large for GitHub (>100MB), it will be added to .git/info/exclude
    (local-only ignore) and a warning will be returned. The file will still be saved locally.
    """
    fp = _resolve(body.path)
    fp.parent.mkdir(parents=True, exist_ok=True)

    image_bytes = base64.b64decode(body.base64_content)
    file_size = len(image_bytes)
    fp.write_bytes(image_bytes)
    
    # Check file size and handle large files
    warning = None
    added_to_gitignore = False
    
    if file_size >= GITHUB_MAX_FILE_SIZE:
        # File exceeds GitHub's limit - add to local exclude
        _add_to_local_exclude(body.path)
        added_to_gitignore = True
        warning = (
            f"File size ({_format_file_size(file_size)}) exceeds GitHub's 100MB limit. "
            f"The file has been saved locally but added to .git/info/exclude and will NOT be "
            f"uploaded to GitHub. The image/PDF will display in your local app but "
            f"won't be available to others."
        )
        logger.warning(
            "File %s (%s) exceeds GitHub limit, added to .git/info/exclude",
            body.path, _format_file_size(file_size)
        )
    elif file_size >= GITHUB_WARNING_FILE_SIZE:
        # File is large but still uploadable - warn the user
        warning = (
            f"File size ({_format_file_size(file_size)}) is approaching GitHub's 100MB limit. "
            f"Consider reducing file size for better repository performance."
        )
        logger.info(
            "File %s (%s) is large but within GitHub limits",
            body.path, _format_file_size(file_size)
        )
    
    # Only commit and push if file is not excluded
    if not added_to_gitignore:
        await commit_and_push(body.message)
    # Note: No need to commit when added to .git/info/exclude since it's local-only

    return {
        "path": body.path,
        "sha": _sha(image_bytes),
        "download_url": _html_url(body.path),
        "file_size": file_size,
        "warning": warning,
        "added_to_gitignore": added_to_gitignore,
    }


@router.get("/raw")
async def read_raw_file(path: str):
    """Serve a raw file from the local data repo (for images, PDFs, etc.)."""
    from fastapi.responses import FileResponse as FastAPIFileResponse

    fp = _resolve(path)
    if not fp.exists() or not fp.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # Determine media type
    suffix = fp.suffix.lower()
    media_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".pdf": "application/pdf",
        ".md": "text/markdown",
    }
    media_type = media_types.get(suffix, "application/octet-stream")

    return FastAPIFileResponse(path=str(fp), media_type=media_type)


@router.delete("/directory")
async def delete_directory(path: str):
    """Delete a directory and all its contents from the local data repo."""
    import shutil

    target = _resolve(path)
    if not target.exists():
        return {"status": "not_found"}
    if target.is_file():
        target.unlink()
    else:
        shutil.rmtree(str(target))
    await commit_and_push(f"Delete: {path}")
    return {"status": "deleted", "path": path}


@router.get("/tree")
async def list_directory(path: str = ""):
    """List files in a directory of the local data repo."""
    target = _resolve(path) if path else _repo_root()
    if not target.exists():
        raise HTTPException(status_code=404, detail="Directory not found")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Path is a file, not a directory")

    items = []
    for item in sorted(target.iterdir()):
        # Skip hidden files/dirs (like .git)
        if item.name.startswith("."):
            continue
        items.append(
            {
                "name": item.name,
                "path": str(item.relative_to(_repo_root())),
                "type": "dir" if item.is_dir() else "file",
                "size": item.stat().st_size if item.is_file() else 0,
            }
        )
    return items
