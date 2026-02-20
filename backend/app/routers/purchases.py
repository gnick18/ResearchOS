"""Purchase items CRUD + item catalog with fuzzy matching."""

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.git_sync import commit_and_push
from app.storage import get_purchase_items_store, get_item_catalog_store

router = APIRouter(prefix="/purchases", tags=["purchases"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class PurchaseItemCreate(BaseModel):
    task_id: int
    item_name: str
    quantity: int
    link: Optional[str] = None
    cas: Optional[str] = None
    price_per_unit: float = 0.0
    shipping_fees: float = 0.0
    notes: Optional[str] = None


class PurchaseItemUpdate(BaseModel):
    item_name: Optional[str] = None
    quantity: Optional[int] = None
    link: Optional[str] = None
    cas: Optional[str] = None
    price_per_unit: Optional[float] = None
    shipping_fees: Optional[float] = None
    notes: Optional[str] = None


class PurchaseItemOut(BaseModel):
    id: int
    task_id: int
    item_name: str
    quantity: int
    link: Optional[str]
    cas: Optional[str]
    price_per_unit: float
    shipping_fees: float
    total_price: float
    notes: Optional[str]


class CatalogItemOut(BaseModel):
    id: int
    item_name: str
    link: Optional[str]
    cas: Optional[str]
    price_per_unit: float


class CatalogItemUpdate(BaseModel):
    item_name: Optional[str] = None
    link: Optional[str] = None
    cas: Optional[str] = None
    price_per_unit: Optional[float] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _compute_total(rec: dict) -> float:
    qty = rec.get("quantity", 0)
    ppu = rec.get("price_per_unit", 0.0)
    ship = rec.get("shipping_fees", 0.0)
    return round(qty * ppu + ship, 2)


def _to_out(rec: dict) -> PurchaseItemOut:
    return PurchaseItemOut(
        id=rec["id"],
        task_id=rec["task_id"],
        item_name=rec.get("item_name", ""),
        quantity=rec.get("quantity", 0),
        link=rec.get("link"),
        cas=rec.get("cas"),
        price_per_unit=rec.get("price_per_unit", 0.0),
        shipping_fees=rec.get("shipping_fees", 0.0),
        total_price=_compute_total(rec),
        notes=rec.get("notes"),
    )


def _levenshtein(s1: str, s2: str) -> int:
    """Simple Levenshtein distance for fuzzy matching."""
    if len(s1) < len(s2):
        return _levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = prev_row[j + 1] + 1
            deletions = curr_row[j] + 1
            substitutions = prev_row[j] + (c1 != c2)
            curr_row.append(min(insertions, deletions, substitutions))
        prev_row = curr_row
    return prev_row[-1]


# ── Purchase Item Endpoints ───────────────────────────────────────────────────


@router.get("/by-task/{task_id}", response_model=List[PurchaseItemOut])
async def list_purchase_items(task_id: int):
    items = get_purchase_items_store().query(task_id=task_id)
    return [_to_out(i) for i in items]


@router.get("/all", response_model=List[PurchaseItemOut])
async def list_all_purchases():
    items = get_purchase_items_store().list_all()
    return [_to_out(i) for i in items]


@router.post("", response_model=PurchaseItemOut, status_code=201)
async def create_purchase_item(body: PurchaseItemCreate):
    data = body.model_dump()
    rec = get_purchase_items_store().create(data)

    # Also add/update the item catalog
    _upsert_catalog(body.item_name, body.link, body.cas, body.price_per_unit)

    await commit_and_push(f"Add purchase item: {rec['item_name']}")
    return _to_out(rec)


@router.put("/{item_id}", response_model=PurchaseItemOut)
async def update_purchase_item(item_id: int, body: PurchaseItemUpdate):
    rec = get_purchase_items_store().get(item_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Purchase item not found")

    updates = body.model_dump(exclude_unset=True)
    updated = get_purchase_items_store().update(item_id, updates)
    await commit_and_push(f"Update purchase item: {updated['item_name']}")
    return _to_out(updated)


@router.delete("/{item_id}", status_code=204)
async def delete_purchase_item(item_id: int):
    rec = get_purchase_items_store().get(item_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Purchase item not found")
    get_purchase_items_store().delete(item_id)
    await commit_and_push(f"Delete purchase item: {rec['item_name']}")


# ── Item Catalog Endpoints ────────────────────────────────────────────────────


def _upsert_catalog(
    item_name: str,
    link: Optional[str],
    cas: Optional[str],
    price_per_unit: float,
) -> None:
    """Add or update an item in the global catalog."""
    name_lower = item_name.strip().lower()
    catalog = get_item_catalog_store()
    # Check if exact match exists
    for cat in catalog.list_all():
        if cat.get("item_name", "").strip().lower() == name_lower:
            # Update existing
            catalog.update(cat["id"], {
                "item_name": item_name.strip(),
                "link": link,
                "cas": cas,
                "price_per_unit": price_per_unit,
            })
            return
    # Create new
    catalog.create({
        "item_name": item_name.strip(),
        "link": link,
        "cas": cas,
        "price_per_unit": price_per_unit,
    })


@router.get("/catalog/search", response_model=List[CatalogItemOut])
async def search_catalog(q: str = ""):
    """Search the item catalog with fuzzy matching (up to 3 char difference)."""
    if not q.strip():
        return []

    query_lower = q.strip().lower()
    results: list[tuple[int, dict]] = []

    for cat in get_item_catalog_store().list_all():
        cat_name = cat.get("item_name", "").strip().lower()
        # Exact substring match
        if query_lower in cat_name or cat_name in query_lower:
            results.append((0, cat))
            continue
        # Fuzzy match: Levenshtein distance <= 3
        dist = _levenshtein(query_lower, cat_name)
        if dist <= 3:
            results.append((dist, cat))

    # Sort by distance (closest first)
    results.sort(key=lambda x: x[0])
    return [
        CatalogItemOut(
            id=r["id"],
            item_name=r.get("item_name", ""),
            link=r.get("link"),
            cas=r.get("cas"),
            price_per_unit=r.get("price_per_unit", 0.0),
        )
        for _, r in results[:10]
    ]


@router.put("/catalog/{catalog_id}", response_model=CatalogItemOut)
async def update_catalog_item(catalog_id: int, body: CatalogItemUpdate):
    """Update an existing catalog item (overwrite)."""
    catalog = get_item_catalog_store()
    rec = catalog.get(catalog_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Catalog item not found")

    updates = body.model_dump(exclude_unset=True)
    updated = catalog.update(catalog_id, updates)
    await commit_and_push(f"Update catalog item: {updated['item_name']}")
    return CatalogItemOut(
        id=updated["id"],
        item_name=updated.get("item_name", ""),
        link=updated.get("link"),
        cas=updated.get("cas"),
        price_per_unit=updated.get("price_per_unit", 0.0),
    )


@router.post("/catalog", response_model=CatalogItemOut, status_code=201)
async def create_catalog_item(body: CatalogItemUpdate):
    """Create a new catalog item (save as new)."""
    data = body.model_dump(exclude_unset=True)
    rec = get_item_catalog_store().create(data)
    await commit_and_push(f"New catalog item: {rec.get('item_name', '')}")
    return CatalogItemOut(
        id=rec["id"],
        item_name=rec.get("item_name", ""),
        link=rec.get("link"),
        cas=rec.get("cas"),
        price_per_unit=rec.get("price_per_unit", 0.0),
    )
