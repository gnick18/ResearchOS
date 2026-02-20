"""Events (Calendar) API endpoints."""

from typing import List

from fastapi import APIRouter, HTTPException

from app.schemas import EventCreate, EventUpdate, EventOut
from app.storage import get_events_store

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=List[EventOut])
async def list_events():
    """List all events."""
    events = get_events_store().list_all()
    return events


@router.get("/{event_id}", response_model=EventOut)
async def get_event(event_id: int):
    """Get a single event by ID."""
    event = get_events_store().get(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.post("", response_model=EventOut)
async def create_event(event: EventCreate):
    """Create a new event."""
    data = event.model_dump()
    # If end_date is not set, use start_date
    if data.get("end_date") is None:
        data["end_date"] = data["start_date"]
    created = get_events_store().create(data)
    return created


@router.put("/{event_id}", response_model=EventOut)
async def update_event(event_id: int, event: EventUpdate):
    """Update an existing event."""
    data = event.model_dump(exclude_unset=True)
    updated = get_events_store().update(event_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Event not found")
    return updated


@router.delete("/{event_id}")
async def delete_event(event_id: int):
    """Delete an event."""
    deleted = get_events_store().delete(event_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"status": "deleted"}
