"""PCR Protocol API endpoints.

Supports public/private PCR protocols:
- Private protocols: Only visible to the creator
- Public protocols: Visible to all users, only editable by creator
"""

import json
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.git_sync import commit_and_push
from app.storage import (
    get_pcr_store,
    get_public_pcr_store,
    get_methods_store,
    get_public_methods_store,
    list_all_pcr_protocols,
    get_pcr_by_id,
    move_pcr_to_public,
    move_pcr_to_private,
)

router = APIRouter(prefix="/pcr", tags=["pcr"])

# Default PCR gradient with proper structure (using 'cycles' to match frontend)
DEFAULT_GRADIENT = {
    "initial": [
        {"name": "Init. Denaturation", "temperature": 95.0, "duration": "2 min"}
    ],
    "cycles": [{
        "repeats": 35,
        "steps": [
            {"name": "Denaturation", "temperature": 95.0, "duration": "20 sec"},
            {"name": "Annealing", "temperature": 58.0, "duration": "20 sec"},
            {"name": "Extension", "temperature": 72.0, "duration": "2 min"}
        ]
    }],
    "final": [
        {"name": "Final Extension", "temperature": 72.0, "duration": "3 min"}
    ],
    "hold": {"name": "Hold", "temperature": 12.0, "duration": "Indef."}
}

DEFAULT_INGREDIENTS = [
    {"id": "1", "name": "Reaction Buffer", "concentration": "", "amount_per_reaction": "", "checked": False},
    {"id": "2", "name": "dNTPs", "concentration": "", "amount_per_reaction": "", "checked": False},
    {"id": "3", "name": "Primer F", "concentration": "", "amount_per_reaction": "", "checked": False},
    {"id": "4", "name": "Primer R", "concentration": "", "amount_per_reaction": "", "checked": False},
    {"id": "5", "name": "Polymerase", "concentration": "", "amount_per_reaction": "", "checked": False},
    {"id": "6", "name": "DNA", "concentration": "", "amount_per_reaction": "", "checked": False},
    {"id": "7", "name": "dH2O", "concentration": "", "amount_per_reaction": "", "checked": False},
    {"id": "8", "name": "Total", "concentration": "", "amount_per_reaction": "", "checked": False},
]


# -- Schemas -------------------------------------------------------------------

class PCRStep(BaseModel):
    """A single step in a PCR gradient."""
    name: str
    temperature: float
    duration: str


class PCRCycle(BaseModel):
    """A cycle group in a PCR gradient."""
    repeats: int
    steps: List[PCRStep]


class PCRGradient(BaseModel):
    """Full PCR gradient structure."""
    initial: List[PCRStep] = []
    cycles: List[PCRCycle] = []
    final: List[PCRStep] = []
    hold: Optional[PCRStep] = None


class PCRIngredient(BaseModel):
    """A single ingredient in a PCR reaction."""
    id: str
    name: str
    concentration: str = ""
    amount_per_reaction: str = ""
    checked: bool = False


class PCRProtocolCreate(BaseModel):
    """Schema for creating a PCR protocol."""
    name: str
    gradient: PCRGradient
    ingredients: List[PCRIngredient]
    notes: Optional[str] = None
    folder_path: Optional[str] = None
    is_public: bool = False  # Whether this protocol is shared with all users


class PCRProtocolUpdate(BaseModel):
    """Schema for updating a PCR protocol."""
    name: Optional[str] = None
    gradient: Optional[PCRGradient] = None
    ingredients: Optional[List[PCRIngredient]] = None
    notes: Optional[str] = None
    is_public: Optional[bool] = None  # Toggle public/private


class PCRProtocolOut(BaseModel):
    """Schema for PCR protocol output."""
    id: int
    name: str
    gradient: PCRGradient
    ingredients: List[PCRIngredient]
    notes: Optional[str] = None
    is_public: bool = False
    created_by: Optional[str] = None


def _parse_protocol(item: dict) -> dict:
    """Parse a stored item into a protocol response."""
    gradient = item.get("gradient")
    if isinstance(gradient, str):
        gradient = json.loads(gradient)
    if not gradient:
        gradient = DEFAULT_GRADIENT
    
    ingredients = item.get("ingredients")
    if isinstance(ingredients, str):
        ingredients = json.loads(ingredients)
    if not ingredients:
        ingredients = DEFAULT_INGREDIENTS
    
    return {
        "id": item["id"],
        "name": item["name"],
        "gradient": gradient,
        "ingredients": ingredients,
        "notes": item.get("notes"),
        "is_public": item.get("is_public", False),
        "created_by": item.get("created_by"),
    }


@router.get("/", response_model=List[PCRProtocolOut])
def list_pcr_protocols():
    """List all PCR protocols: user's private + all public."""
    items = list_all_pcr_protocols()
    return [_parse_protocol(item) for item in items]


@router.get("/{protocol_id}", response_model=PCRProtocolOut)
def get_pcr_protocol(protocol_id: int):
    """Get a specific PCR protocol by ID."""
    item = get_pcr_by_id(protocol_id)
    if not item:
        raise HTTPException(status_code=404, detail="PCR protocol not found")
    return _parse_protocol(item)


@router.post("/", response_model=PCRProtocolOut, status_code=201)
def create_pcr_protocol(data: PCRProtocolCreate):
    """Create a new PCR protocol. If is_public=True, creates in public store."""
    # Check for duplicate name in appropriate store
    if data.is_public:
        existing_pcr = get_public_pcr_store().list_all()
    else:
        existing_pcr = get_pcr_store().list_all()
    
    for pcr in existing_pcr:
        if pcr.get("name", "").lower() == data.name.lower():
            raise HTTPException(
                status_code=400, 
                detail=f"A PCR protocol with the name '{data.name}' already exists. Please choose a different name."
            )
    
    item = {
        "name": data.name,
        "gradient": json.dumps(data.gradient.model_dump()),
        "ingredients": json.dumps([i.model_dump() for i in data.ingredients]),
        "notes": data.notes,
        "is_public": data.is_public,
        "created_by": settings.current_user,
    }
    
    # Create in appropriate store
    if data.is_public:
        created = get_public_pcr_store().create(item)
        created["_is_public"] = True
    else:
        created = get_pcr_store().create(item)
        created["_is_public"] = False
    
    # Also create a method entry so it shows up in the methods list
    method_entry = {
        "name": data.name,
        "github_path": f"pcr://protocol/{created['id']}",  # Special path to indicate PCR
        "method_type": "pcr",
        "folder_path": data.folder_path,
        "parent_method_id": None,
        "tags": [],
        "is_public": data.is_public,
        "created_by": settings.current_user,
    }
    
    if data.is_public:
        get_public_methods_store().create(method_entry)
    else:
        get_methods_store().create(method_entry)
    
    return _parse_protocol(created)


@router.put("/{protocol_id}", response_model=PCRProtocolOut)
def update_pcr_protocol(protocol_id: int, data: PCRProtocolUpdate):
    """Update a PCR protocol.
    
    Only the creator can edit a public protocol.
    Toggling is_public moves the protocol between stores.
    """
    existing = get_pcr_by_id(protocol_id)
    if not existing:
        raise HTTPException(status_code=404, detail="PCR protocol not found")
    
    is_public = existing.get("_is_public", False)
    
    # Check edit permissions for public protocols
    if is_public and existing.get("created_by") != settings.current_user:
        raise HTTPException(
            status_code=403,
            detail="Only the creator can edit a public PCR protocol"
        )
    
    update_data = {}
    if data.name is not None:
        update_data["name"] = data.name
    if data.gradient is not None:
        update_data["gradient"] = json.dumps(data.gradient.model_dump())
    if data.ingredients is not None:
        update_data["ingredients"] = json.dumps([i.model_dump() for i in data.ingredients])
    if data.notes is not None:
        update_data["notes"] = data.notes
    
    # Handle is_public toggle
    if "is_public" in data.model_dump(exclude_unset=True):
        new_is_public = data.is_public
        if new_is_public != is_public:
            if new_is_public:
                # Moving to public
                moved = move_pcr_to_public(protocol_id)
                if not moved:
                    raise HTTPException(status_code=500, detail="Failed to move protocol to public")
                existing = moved
                is_public = True
            else:
                # Moving to private
                moved = move_pcr_to_private(protocol_id)
                if not moved:
                    raise HTTPException(status_code=500, detail="Failed to move protocol to private")
                existing = moved
                is_public = False
    
    # Apply remaining updates
    if update_data:
        if is_public:
            updated = get_public_pcr_store().update(protocol_id, update_data)
        else:
            updated = get_pcr_store().update(protocol_id, update_data)
        
        if not updated:
            raise HTTPException(status_code=500, detail="Failed to update protocol")
        updated["_is_public"] = is_public
    else:
        updated = existing
    
    return _parse_protocol(updated)


@router.delete("/{protocol_id}", status_code=204)
def delete_pcr_protocol(protocol_id: int):
    """Delete a PCR protocol. Only the creator can delete a public protocol."""
    existing = get_pcr_by_id(protocol_id)
    if not existing:
        raise HTTPException(status_code=404, detail="PCR protocol not found")
    
    is_public = existing.get("_is_public", False)
    
    # Check delete permissions for public protocols
    if is_public and existing.get("created_by") != settings.current_user:
        raise HTTPException(
            status_code=403,
            detail="Only the creator can delete a public PCR protocol"
        )
    
    if is_public:
        get_public_pcr_store().delete(protocol_id)
    else:
        get_pcr_store().delete(protocol_id)
    
    return None


@router.get("/defaults/gradient")
def get_default_gradient():
    """Get the default PCR gradient."""
    return DEFAULT_GRADIENT


@router.get("/defaults/ingredients")
def get_default_ingredients():
    """Get the default PCR ingredients."""
    return DEFAULT_INGREDIENTS
