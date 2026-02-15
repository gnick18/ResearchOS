"""GitHub proxy endpoints — local filesystem for the data repo.

Reads/writes Markdown and image files directly from the local data repo
clone. git_sync handles committing and pushing to GitHub.
"""

import base64
import hashlib
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.git_sync import commit_and_push

router = APIRouter(prefix="/github", tags=["github"])


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
    """Save a base64-encoded image to the local data repo."""
    fp = _resolve(body.path)
    fp.parent.mkdir(parents=True, exist_ok=True)

    image_bytes = base64.b64decode(body.base64_content)
    fp.write_bytes(image_bytes)

    await commit_and_push(body.message)

    return {
        "path": body.path,
        "sha": _sha(image_bytes),
        "download_url": _html_url(body.path),
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
