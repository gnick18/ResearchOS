"""Purchase items CRUD + item catalog with fuzzy matching."""

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.git_sync import commit_and_push
from app.storage import get_purchase_items_store, get_item_catalog_store, get_funding_accounts_store, list_all_users_purchase_items

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
    funding_string: Optional[str] = None  # New field for funding account


class PurchaseItemUpdate(BaseModel):
    item_name: Optional[str] = None
    quantity: Optional[int] = None
    link: Optional[str] = None
    cas: Optional[str] = None
    price_per_unit: Optional[float] = None
    shipping_fees: Optional[float] = None
    notes: Optional[str] = None
    funding_string: Optional[str] = None  # New field for funding account


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
    funding_string: Optional[str] = None  # New field for funding account


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
        funding_string=rec.get("funding_string"),
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


# ── Funding Accounts Endpoints (Lab-level, shared across all users) ───────────


class FundingAccountCreate(BaseModel):
    name: str  # The funding string identifier (e.g., "GRANT-123-ABC")
    description: Optional[str] = None
    total_budget: float = 0.0  # Total amount available in this account


class FundingAccountUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    total_budget: Optional[float] = None


class FundingAccountOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    total_budget: float
    spent: float = 0.0  # Computed: total of all purchase items with this funding_string
    remaining: float = 0.0  # Computed: total_budget - spent


class FundingSummaryOut(BaseModel):
    """Summary of spending by funding account."""
    accounts: List[FundingAccountOut]
    total_budget: float
    total_spent: float
    total_remaining: float
    uncategorized_spent: float  # Spent on items without a funding string


@router.get("/funding-accounts", response_model=List[FundingAccountOut])
async def list_funding_accounts():
    """List all funding accounts with computed spending across ALL users."""
    store = get_funding_accounts_store()
    # Use the new function that aggregates across all users
    all_purchase_items = list_all_users_purchase_items()
    
    accounts = []
    for acc in store.list_all():
        # Calculate spent amount for this funding string across ALL users
        spent = 0.0
        for item in all_purchase_items:
            if item.get("funding_string") == acc.get("name"):
                qty = item.get("quantity", 0)
                ppu = item.get("price_per_unit", 0.0)
                ship = item.get("shipping_fees", 0.0)
                spent += qty * ppu + ship
        
        total_budget = acc.get("total_budget", 0.0)
        accounts.append(FundingAccountOut(
            id=acc["id"],
            name=acc.get("name", ""),
            description=acc.get("description"),
            total_budget=total_budget,
            spent=round(spent, 2),
            remaining=round(total_budget - spent, 2),
        ))
    
    return accounts


@router.post("/funding-accounts", response_model=FundingAccountOut, status_code=201)
async def create_funding_account(body: FundingAccountCreate):
    """Create a new funding account."""
    store = get_funding_accounts_store()
    
    # Check for duplicate name
    for acc in store.list_all():
        if acc.get("name") == body.name:
            raise HTTPException(status_code=400, detail="Funding account with this name already exists")
    
    data = body.model_dump()
    rec = store.create(data)
    await commit_and_push(f"Create funding account: {rec['name']}")
    
    return FundingAccountOut(
        id=rec["id"],
        name=rec.get("name", ""),
        description=rec.get("description"),
        total_budget=rec.get("total_budget", 0.0),
        spent=0.0,
        remaining=rec.get("total_budget", 0.0),
    )


@router.put("/funding-accounts/{account_id}", response_model=FundingAccountOut)
async def update_funding_account(account_id: int, body: FundingAccountUpdate):
    """Update a funding account."""
    store = get_funding_accounts_store()
    # Use the new function that aggregates across all users
    all_purchase_items = list_all_users_purchase_items()
    
    rec = store.get(account_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Funding account not found")
    
    # Check for duplicate name if name is being changed
    if body.name and body.name != rec.get("name"):
        for acc in store.list_all():
            if acc.get("name") == body.name:
                raise HTTPException(status_code=400, detail="Funding account with this name already exists")
    
    updates = body.model_dump(exclude_unset=True)
    updated = store.update(account_id, updates)
    await commit_and_push(f"Update funding account: {updated['name']}")
    
    # Calculate spent amount across ALL users
    spent = 0.0
    for item in all_purchase_items:
        if item.get("funding_string") == updated.get("name"):
            qty = item.get("quantity", 0)
            ppu = item.get("price_per_unit", 0.0)
            ship = item.get("shipping_fees", 0.0)
            spent += qty * ppu + ship
    
    total_budget = updated.get("total_budget", 0.0)
    return FundingAccountOut(
        id=updated["id"],
        name=updated.get("name", ""),
        description=updated.get("description"),
        total_budget=total_budget,
        spent=round(spent, 2),
        remaining=round(total_budget - spent, 2),
    )


@router.delete("/funding-accounts/{account_id}", status_code=204)
async def delete_funding_account(account_id: int):
    """Delete a funding account."""
    store = get_funding_accounts_store()
    rec = store.get(account_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Funding account not found")
    store.delete(account_id)
    await commit_and_push(f"Delete funding account: {rec['name']}")


@router.get("/funding-summary", response_model=FundingSummaryOut)
async def get_funding_summary():
    """Get a summary of all funding accounts and spending across ALL users."""
    store = get_funding_accounts_store()
    # Use the new function that aggregates across all users
    all_purchase_items = list_all_users_purchase_items()
    
    accounts = []
    total_budget = 0.0
    total_spent = 0.0
    uncategorized_spent = 0.0
    
    # Get all funding account names
    account_names = set()
    for acc in store.list_all():
        account_names.add(acc.get("name", ""))
        total_budget += acc.get("total_budget", 0.0)
        
        # Calculate spent for this account across ALL users
        spent = 0.0
        for item in all_purchase_items:
            if item.get("funding_string") == acc.get("name"):
                qty = item.get("quantity", 0)
                ppu = item.get("price_per_unit", 0.0)
                ship = item.get("shipping_fees", 0.0)
                spent += qty * ppu + ship
        
        total_spent += spent
        accounts.append(FundingAccountOut(
            id=acc["id"],
            name=acc.get("name", ""),
            description=acc.get("description"),
            total_budget=acc.get("total_budget", 0.0),
            spent=round(spent, 2),
            remaining=round(acc.get("total_budget", 0.0) - spent, 2),
        ))
    
    # Calculate uncategorized spending (items without a funding string or with unknown funding string)
    for item in all_purchase_items:
        funding_string = item.get("funding_string")
        if not funding_string or funding_string not in account_names:
            qty = item.get("quantity", 0)
            ppu = item.get("price_per_unit", 0.0)
            ship = item.get("shipping_fees", 0.0)
            uncategorized_spent += qty * ppu + ship
    
    return FundingSummaryOut(
        accounts=accounts,
        total_budget=round(total_budget, 2),
        total_spent=round(total_spent, 2),
        total_remaining=round(total_budget - total_spent, 2),
        uncategorized_spent=round(uncategorized_spent, 2),
    )
