"""PCR Protocol API endpoints."""

import json
from typing import List

from fastapi import APIRouter, HTTPException

from app.schemas import PCRProtocolCreate, PCRProtocolUpdate, PCRProtocolOut
from app.storage import JsonStore, methods_store

router = APIRouter(prefix="/pcr", tags=["pcr"])

# Create a store for PCR protocols
pcr_store = JsonStore("pcr_protocols")

# Default PCR gradient with proper structure
DEFAULT_GRADIENT = {
    "initial": [
        {"name": "Init. Denaturation", "temperature": 95.0, "duration": "2 min"}
    ],
    "cycle": {
        "repeats": 35,
        "steps": [
            {"name": "Denaturation", "temperature": 95.0, "duration": "20 sec"},
            {"name": "Annealing", "temperature": 58.0, "duration": "20 sec"},
            {"name": "Extension", "temperature": 72.0, "duration": "2 min"}
        ]
    },
    "final": [
        {"name": "Final Extension", "temperature": 72.0, "duration": "3 min"}
    ],
    "hold": {"name": "Hold", "temperature": 12.0, "duration": "Indef."}
}

DEFAULT_INGREDIENTS = [
    {"id": "1", "name": "Reaction Buffer", "concentration": "", "amount_per_reaction": ""},
    {"id": "2", "name": "dNTPs", "concentration": "", "amount_per_reaction": ""},
    {"id": "3", "name": "Primer F", "concentration": "", "amount_per_reaction": ""},
    {"id": "4", "name": "Primer R", "concentration": "", "amount_per_reaction": ""},
    {"id": "5", "name": "Polymerase", "concentration": "", "amount_per_reaction": ""},
    {"id": "6", "name": "DNA", "concentration": "", "amount_per_reaction": ""},
    {"id": "7", "name": "dH2O", "concentration": "", "amount_per_reaction": ""},
    {"id": "8", "name": "Total", "concentration": "", "amount_per_reaction": ""},
]


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
    }


@router.get("/", response_model=List[PCRProtocolOut])
def list_pcr_protocols():
    """List all PCR protocols."""
    items = pcr_store.list_all()
    return [_parse_protocol(item) for item in items]


@router.get("/{protocol_id}", response_model=PCRProtocolOut)
def get_pcr_protocol(protocol_id: int):
    """Get a specific PCR protocol."""
    item = pcr_store.get(protocol_id)
    if not item:
        raise HTTPException(status_code=404, detail="PCR protocol not found")
    return _parse_protocol(item)


@router.post("/", response_model=PCRProtocolOut, status_code=201)
def create_pcr_protocol(data: PCRProtocolCreate):
    """Create a new PCR protocol."""
    # Check for duplicate method name
    existing_methods = methods_store.list_all()
    for method in existing_methods:
        if method.get("name", "").lower() == data.name.lower():
            raise HTTPException(
                status_code=400, 
                detail=f"A method with the name '{data.name}' already exists. Please choose a different name."
            )
    
    item = {
        "name": data.name,
        "gradient": json.dumps(data.gradient.model_dump()),
        "ingredients": json.dumps([i.model_dump() for i in data.ingredients]),
        "notes": data.notes,
    }
    created = pcr_store.create(item)
    
    # Also create a method entry so it shows up in the methods list
    method_entry = {
        "name": data.name,
        "github_path": f"pcr://protocol/{created['id']}",  # Special path to indicate PCR
        "method_type": "pcr",
        "folder_path": None,
        "parent_method_id": None,
        "tags": [],
    }
    methods_store.create(method_entry)
    
    return _parse_protocol(created)


@router.put("/{protocol_id}", response_model=PCRProtocolOut)
def update_pcr_protocol(protocol_id: int, data: PCRProtocolUpdate):
    """Update a PCR protocol."""
    existing = pcr_store.get(protocol_id)
    if not existing:
        raise HTTPException(status_code=404, detail="PCR protocol not found")
    
    update_data = {}
    if data.name is not None:
        update_data["name"] = data.name
    if data.gradient is not None:
        update_data["gradient"] = json.dumps(data.gradient.model_dump())
    if data.ingredients is not None:
        update_data["ingredients"] = json.dumps([i.model_dump() for i in data.ingredients])
    if data.notes is not None:
        update_data["notes"] = data.notes
    
    updated = pcr_store.update(protocol_id, update_data)
    return _parse_protocol(updated)


@router.delete("/{protocol_id}", status_code=204)
def delete_pcr_protocol(protocol_id: int):
    """Delete a PCR protocol."""
    existing = pcr_store.get(protocol_id)
    if not existing:
        raise HTTPException(status_code=404, detail="PCR protocol not found")
    pcr_store.delete(protocol_id)
    return None


@router.get("/defaults/gradient")
def get_default_gradient():
    """Get the default PCR gradient."""
    return DEFAULT_GRADIENT


@router.get("/defaults/ingredients")
def get_default_ingredients():
    """Get the default PCR ingredients."""
    return DEFAULT_INGREDIENTS
