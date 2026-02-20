"""Lab Links API endpoints."""

import re
from datetime import datetime
from typing import List, Optional

import httpx
from fastapi import APIRouter, HTTPException

from app.schemas import LabLinkCreate, LabLinkUpdate, LabLinkOut
from app.storage import get_lab_links_store

router = APIRouter(prefix="/lab-links", tags=["lab-links"])


async def fetch_link_preview(url: str) -> dict:
    """Fetch Open Graph metadata from a URL."""
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; ResearchOS/1.0; +https://github.com/researchos)"
            })
            response.raise_for_status()
            html = response.text
            
            # Extract Open Graph metadata
            def extract_meta(property_name: str) -> Optional[str]:
                # Try og: property
                pattern = rf'<meta[^>]+property=["\']og:{property_name}["\'][^>]+content=["\']([^"\']+)["\']'
                match = re.search(pattern, html, re.IGNORECASE)
                if match:
                    return match.group(1)
                # Try content before property
                pattern = rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:{property_name}["\']'
                match = re.search(pattern, html, re.IGNORECASE)
                if match:
                    return match.group(1)
                return None
            
            # Extract Twitter Card metadata as fallback
            def extract_twitter_meta(property_name: str) -> Optional[str]:
                pattern = rf'<meta[^>]+name=["\']twitter:{property_name}["\'][^>]+content=["\']([^"\']+)["\']'
                match = re.search(pattern, html, re.IGNORECASE)
                if match:
                    return match.group(1)
                pattern = rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:{property_name}["\']'
                match = re.search(pattern, html, re.IGNORECASE)
                if match:
                    return match.group(1)
                return None
            
            # Get image from og:image or twitter:image
            image = extract_meta("image") or extract_twitter_meta("image")
            
            # Also check for og:image:url
            if not image:
                image = extract_meta("image:url")
            
            return {
                "title": extract_meta("title") or extract_twitter_meta("title"),
                "description": extract_meta("description") or extract_twitter_meta("description"),
                "image": image,
                "site_name": extract_meta("site_name"),
            }
    except Exception:
        return {
            "title": None,
            "description": None,
            "image": None,
            "site_name": None,
        }


@router.get("", response_model=List[LabLinkOut])
async def list_lab_links():
    """List all lab links."""
    links = get_lab_links_store().list_all()
    # Sort by sort_order, then by created_at
    links.sort(key=lambda x: (x.get("sort_order", 0), x.get("created_at", "")))
    return links


@router.get("/{link_id}", response_model=LabLinkOut)
async def get_lab_link(link_id: int):
    """Get a single lab link by ID."""
    link = get_lab_links_store().get(link_id)
    if not link:
        raise HTTPException(status_code=404, detail="Lab link not found")
    return link


@router.post("", response_model=LabLinkOut)
async def create_lab_link(link: LabLinkCreate):
    """Create a new lab link."""
    data = link.model_dump()
    data["created_at"] = datetime.now().isoformat()
    data["sort_order"] = data.get("sort_order", 0)
    
    # If no preview_image_url provided, try to fetch one
    if not data.get("preview_image_url"):
        preview = await fetch_link_preview(data["url"])
        data["preview_image_url"] = preview.get("image")
        
        # Auto-fill title and description if not provided
        if not data.get("title") and preview.get("title"):
            data["title"] = preview["title"]
        if not data.get("description") and preview.get("description"):
            data["description"] = preview["description"]
    
    created = get_lab_links_store().create(data)
    return created


@router.put("/{link_id}", response_model=LabLinkOut)
async def update_lab_link(link_id: int, link: LabLinkUpdate):
    """Update an existing lab link."""
    data = link.model_dump(exclude_unset=True)
    updated = get_lab_links_store().update(link_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Lab link not found")
    return updated


@router.delete("/{link_id}")
async def delete_lab_link(link_id: int):
    """Delete a lab link."""
    deleted = get_lab_links_store().delete(link_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Lab link not found")
    return {"status": "deleted"}


@router.post("/preview")
async def get_link_preview(url: str):
    """Fetch preview metadata for a URL."""
    preview = await fetch_link_preview(url)
    return preview
