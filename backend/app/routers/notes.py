"""Meeting Notes API endpoints."""

import uuid
from datetime import datetime
from typing import List

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.schemas import (
    NoteCreate,
    NoteUpdate,
    NoteOut,
    NoteEntry,
    NoteEntryCreate,
    NoteEntryUpdate,
    NoteEntriesReorderRequest,
)
from app.storage import get_notes_store

router = APIRouter(prefix="/notes", tags=["notes"])


def _note_to_out(note: dict) -> dict:
    """Convert a note dict to output format with username."""
    note["username"] = settings.current_user or "unknown"
    return note


@router.get("", response_model=List[NoteOut])
async def list_notes():
    """List all notes for the current user."""
    notes = get_notes_store().list_all()
    return [_note_to_out(n) for n in notes]


@router.get("/{note_id}", response_model=NoteOut)
async def get_note(note_id: int):
    """Get a single note by ID."""
    note = get_notes_store().get(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return _note_to_out(note)


@router.post("", response_model=NoteOut)
async def create_note(note: NoteCreate):
    """Create a new note."""
    now = datetime.utcnow()
    data = note.model_dump()
    
    # Convert entry creates to full entries with IDs and timestamps
    entries = []
    for entry_create in data.pop("entries", []):
        entry = NoteEntry(
            id=str(uuid.uuid4()),
            title=entry_create["title"],
            date=entry_create["date"],
            content=entry_create.get("content", ""),
            created_at=now,
            updated_at=now,
        )
        entries.append(entry.model_dump())
    
    # If this is a single note (not running log), create one entry
    if not data.get("is_running_log") and not entries:
        entry = NoteEntry(
            id=str(uuid.uuid4()),
            title=data["title"],
            date=datetime.utcnow().date(),
            content="",
            created_at=now,
            updated_at=now,
        )
        entries.append(entry.model_dump())
    
    data["entries"] = entries
    data["created_at"] = now
    data["updated_at"] = now
    
    created = get_notes_store().create(data)
    return _note_to_out(created)


@router.put("/{note_id}", response_model=NoteOut)
async def update_note(note_id: int, note: NoteUpdate):
    """Update note metadata (title, description, is_shared)."""
    data = note.model_dump(exclude_unset=True)
    data["updated_at"] = datetime.utcnow()
    
    updated = get_notes_store().update(note_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Note not found")
    return _note_to_out(updated)


@router.delete("/{note_id}")
async def delete_note(note_id: int):
    """Delete a note."""
    deleted = get_notes_store().delete(note_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"status": "deleted"}


# ── Entry Management ───────────────────────────────────────────────────────────


@router.post("/{note_id}/entries", response_model=NoteOut)
async def add_entry(note_id: int, entry: NoteEntryCreate):
    """Add a new entry to a note (for running logs)."""
    store = get_notes_store()
    note = store.get(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    now = datetime.utcnow()
    new_entry = NoteEntry(
        id=str(uuid.uuid4()),
        title=entry.title,
        date=entry.date,
        content=entry.content or "",
        created_at=now,
        updated_at=now,
    )
    
    note["entries"].append(new_entry.model_dump())
    note["updated_at"] = now
    
    # Ensure is_running_log is True if we have multiple entries
    if len(note["entries"]) > 1:
        note["is_running_log"] = True
    
    updated = store.save(note_id, note)
    return _note_to_out(updated)


@router.put("/{note_id}/entries/{entry_id}", response_model=NoteOut)
async def update_entry(note_id: int, entry_id: str, entry: NoteEntryUpdate):
    """Update an entry within a note."""
    store = get_notes_store()
    note = store.get(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    # Find the entry
    entry_found = False
    for i, e in enumerate(note["entries"]):
        if e["id"] == entry_id:
            entry_found = True
            # Update only provided fields
            update_data = entry.model_dump(exclude_unset=True)
            update_data["updated_at"] = datetime.utcnow()
            note["entries"][i].update(update_data)
            break
    
    if not entry_found:
        raise HTTPException(status_code=404, detail="Entry not found")
    
    note["updated_at"] = datetime.utcnow()
    updated = store.save(note_id, note)
    return _note_to_out(updated)


@router.delete("/{note_id}/entries/{entry_id}", response_model=NoteOut)
async def delete_entry(note_id: int, entry_id: str):
    """Delete an entry from a note."""
    store = get_notes_store()
    note = store.get(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    original_count = len(note["entries"])
    note["entries"] = [e for e in note["entries"] if e["id"] != entry_id]
    
    if len(note["entries"]) == original_count:
        raise HTTPException(status_code=404, detail="Entry not found")
    
    note["updated_at"] = datetime.utcnow()
    updated = store.save(note_id, note)
    return _note_to_out(updated)


@router.put("/{note_id}/entries/reorder", response_model=NoteOut)
async def reorder_entries(note_id: int, request: NoteEntriesReorderRequest):
    """Reorder entries within a note."""
    store = get_notes_store()
    note = store.get(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    # Create a map of entry id to entry
    entry_map = {e["id"]: e for e in note["entries"]}
    
    # Verify all entry IDs are valid
    for entry_id in request.entry_ids:
        if entry_id not in entry_map:
            raise HTTPException(status_code=400, detail=f"Invalid entry ID: {entry_id}")
    
    # Reorder entries based on the new order
    note["entries"] = [entry_map[eid] for eid in request.entry_ids]
    note["updated_at"] = datetime.utcnow()
    
    updated = store.save(note_id, note)
    return _note_to_out(updated)
