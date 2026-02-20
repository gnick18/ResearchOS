"""JSON-file-backed storage layer replacing SQLAlchemy/PostgreSQL.

Each entity type (projects, tasks, dependencies, methods) gets its own
directory under ``{data_repo}/data/users/{current_user}/{entity}/``.  
Every record is stored as ``{id}.json``.  
A ``_counters.json`` file in the data root tracks the next auto-increment ID.

Public methods and PCR protocols are stored in:
``{data_repo}/data/users/public/{entity}/``
"""

import json
import shutil
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import settings

_lock = threading.Lock()

# Entities that can be public (shared across all users)
PUBLIC_ENTITIES = {"methods", "pcr_protocols"}


def _data_root() -> Path:
    """Return the ``data/users/{current_user}/`` directory inside the local data-repo clone."""
    if not settings.current_user:
        # Return a dummy path if no user is set - don't create directories
        return Path(settings.github_localpath) / "data" / "users" / "_no_user_"
    root = Path(settings.github_localpath) / "data" / "users" / settings.current_user
    root.mkdir(parents=True, exist_ok=True)
    return root


def _public_data_root() -> Path:
    """Return the ``data/users/public/`` directory for shared methods/protocols."""
    root = Path(settings.github_localpath) / "data" / "users" / "public"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _counters_path() -> Path:
    return _data_root() / "_counters.json"


def _public_counters_path() -> Path:
    return _public_data_root() / "_counters.json"


def _read_counters(public: bool = False) -> Dict[str, int]:
    p = _public_counters_path() if public else _counters_path()
    if p.exists():
        return json.loads(p.read_text())
    return {}


def _write_counters(counters: Dict[str, int], public: bool = False) -> None:
    p = _public_counters_path() if public else _counters_path()
    p.write_text(json.dumps(counters, indent=2))


def _next_id(entity: str, public: bool = False) -> int:
    """Atomically get and increment the counter for *entity*."""
    with _lock:
        counters = _read_counters(public)
        current = counters.get(entity, 0) + 1
        counters[entity] = current
        _write_counters(counters, public)
    return current


class JsonStore:
    """Generic CRUD store backed by one-JSON-file-per-record on disk.
    
    The directory path is computed dynamically on each access, ensuring
    that user switches are immediately reflected without needing to
    recreate store instances.
    """

    def __init__(self, entity: str) -> None:
        self.entity = entity

    @property
    def dir(self) -> Path:
        """Dynamically compute the directory based on current user settings."""
        d = _data_root() / self.entity
        d.mkdir(parents=True, exist_ok=True)
        return d

    # ── helpers ────────────────────────────────────────────────────────────

    def _path(self, record_id: int) -> Path:
        return self.dir / f"{record_id}.json"

    @staticmethod
    def _read_json(path: Path) -> Dict[str, Any]:
        return json.loads(path.read_text())

    @staticmethod
    def _write_json(path: Path, data: Dict[str, Any]) -> None:
        path.write_text(json.dumps(data, indent=2, default=str))

    # ── public API ─────────────────────────────────────────────────────────

    def list_all(self) -> List[Dict[str, Any]]:
        """Return every record for this entity, sorted by ID."""
        records: List[Dict[str, Any]] = []
        for p in sorted(self.dir.glob("*.json")):
            try:
                records.append(self._read_json(p))
            except (json.JSONDecodeError, OSError):
                continue
        return records

    def get(self, record_id: int) -> Optional[Dict[str, Any]]:
        p = self._path(record_id)
        if not p.exists():
            return None
        return self._read_json(p)

    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new record with an auto-assigned ``id``."""
        new_id = _next_id(self.entity)
        data["id"] = new_id
        self._write_json(self._path(new_id), data)
        return data

    def update(self, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Merge *data* into the existing record.  Returns updated record or None."""
        p = self._path(record_id)
        if not p.exists():
            return None
        existing = self._read_json(p)
        existing.update({k: v for k, v in data.items() if v is not None})
        self._write_json(p, existing)
        return existing

    def save(self, record_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        """Overwrite the full record (used when the caller builds the whole dict)."""
        data["id"] = record_id
        self._write_json(self._path(record_id), data)
        return data

    def delete(self, record_id: int) -> bool:
        p = self._path(record_id)
        if not p.exists():
            return False
        p.unlink()
        return True

    def query(self, **filters: Any) -> List[Dict[str, Any]]:
        """Simple filter: return records where all key=value pairs match."""
        results: List[Dict[str, Any]] = []
        for rec in self.list_all():
            if all(rec.get(k) == v for k, v in filters.items()):
                results.append(rec)
        return results


class PublicJsonStore(JsonStore):
    """Store for public (shared) records like methods and PCR protocols.
    
    Stores data in data/users/public/{entity}/ instead of user-specific folder.
    """
    
    @property
    def dir(self) -> Path:
        """Return the public directory for shared entities."""
        d = _public_data_root() / self.entity
        d.mkdir(parents=True, exist_ok=True)
        return d
    
    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new record with an auto-assigned ``id`` from public counters."""
        new_id = _next_id(self.entity, public=True)
        data["id"] = new_id
        self._write_json(self._path(new_id), data)
        return data


# ── Store instances ────────────────────────────────────────────────────

# User-specific stores
_projects_store = JsonStore("projects")
_tasks_store = JsonStore("tasks")
_dependencies_store = JsonStore("dependencies")
_methods_store = JsonStore("methods")
_events_store = JsonStore("events")
_goals_store = JsonStore("goals")
_pcr_store = JsonStore("pcr_protocols")
_purchase_items_store = JsonStore("purchase_items")
_item_catalog_store = JsonStore("item_catalog")
_lab_links_store = JsonStore("lab_links")

# Public (shared) stores for methods and PCR protocols
_public_methods_store = PublicJsonStore("methods")
_public_pcr_store = PublicJsonStore("pcr_protocols")


# ── Getter functions (use these in routers) ──────────────────────────────

def get_projects_store() -> JsonStore:
    """Get the projects store for the current user."""
    return _projects_store


def get_tasks_store() -> JsonStore:
    """Get the tasks store for the current user."""
    return _tasks_store


def get_dependencies_store() -> JsonStore:
    """Get the dependencies store for the current user."""
    return _dependencies_store


def get_methods_store() -> JsonStore:
    """Get the methods store for the current user (private methods only)."""
    return _methods_store


def get_public_methods_store() -> PublicJsonStore:
    """Get the public methods store (shared across all users)."""
    return _public_methods_store


def get_events_store() -> JsonStore:
    """Get the events store for the current user."""
    return _events_store


def get_goals_store() -> JsonStore:
    """Get the goals store for the current user."""
    return _goals_store


def get_pcr_store() -> JsonStore:
    """Get the PCR protocols store for the current user (private only)."""
    return _pcr_store


def get_public_pcr_store() -> PublicJsonStore:
    """Get the public PCR protocols store (shared across all users)."""
    return _public_pcr_store


def get_purchase_items_store() -> JsonStore:
    """Get the purchase items store for the current user."""
    return _purchase_items_store


def get_item_catalog_store() -> JsonStore:
    """Get the item catalog store for the current user."""
    return _item_catalog_store


def get_lab_links_store() -> JsonStore:
    """Get the lab links store for the current user."""
    return _lab_links_store


# ── Combined methods/PCR helpers ─────────────────────────────────────────

def list_all_methods() -> List[Dict[str, Any]]:
    """List all methods: user's private methods + all public methods."""
    private = _methods_store.list_all()
    public = _public_methods_store.list_all()
    # Mark public methods with their source
    for m in private:
        m["_is_public"] = False
    for m in public:
        m["_is_public"] = True
    return private + public


def get_method_by_id(method_id: int) -> Optional[Dict[str, Any]]:
    """Get a method by ID, checking both private and public stores."""
    # Try private first
    method = _methods_store.get(method_id)
    if method:
        method["_is_public"] = False
        return method
    # Then try public
    method = _public_methods_store.get(method_id)
    if method:
        method["_is_public"] = True
    return method


def list_all_pcr_protocols() -> List[Dict[str, Any]]:
    """List all PCR protocols: user's private + all public."""
    private = _pcr_store.list_all()
    public = _public_pcr_store.list_all()
    for p in private:
        p["_is_public"] = False
    for p in public:
        p["_is_public"] = True
    return private + public


def get_pcr_by_id(pcr_id: int) -> Optional[Dict[str, Any]]:
    """Get a PCR protocol by ID, checking both private and public stores."""
    pcr = _pcr_store.get(pcr_id)
    if pcr:
        pcr["_is_public"] = False
        return pcr
    pcr = _public_pcr_store.get(pcr_id)
    if pcr:
        pcr["_is_public"] = True
    return pcr


def move_method_to_public(method_id: int) -> Optional[Dict[str, Any]]:
    """Move a method from private to public storage."""
    method = _methods_store.get(method_id)
    if not method:
        return None
    
    # Create in public store with new ID
    method.pop("id", None)
    method["is_public"] = True
    public_method = _public_methods_store.create(method)
    
    # Delete from private store
    _methods_store.delete(method_id)
    
    public_method["_is_public"] = True
    return public_method


def move_method_to_private(method_id: int) -> Optional[Dict[str, Any]]:
    """Move a method from public to private storage."""
    method = _public_methods_store.get(method_id)
    if not method:
        return None
    
    # Create in private store with new ID
    method.pop("id", None)
    method["is_public"] = False
    private_method = _methods_store.create(method)
    
    # Delete from public store
    _public_methods_store.delete(method_id)
    
    private_method["_is_public"] = False
    return private_method


def move_pcr_to_public(pcr_id: int) -> Optional[Dict[str, Any]]:
    """Move a PCR protocol from private to public storage."""
    pcr = _pcr_store.get(pcr_id)
    if not pcr:
        return None
    
    pcr.pop("id", None)
    pcr["is_public"] = True
    public_pcr = _public_pcr_store.create(pcr)
    
    _pcr_store.delete(pcr_id)
    
    public_pcr["_is_public"] = True
    return public_pcr


def move_pcr_to_private(pcr_id: int) -> Optional[Dict[str, Any]]:
    """Move a PCR protocol from public to private storage."""
    pcr = _public_pcr_store.get(pcr_id)
    if not pcr:
        return None
    
    pcr.pop("id", None)
    pcr["is_public"] = False
    private_pcr = _pcr_store.create(pcr)
    
    _public_pcr_store.delete(pcr_id)
    
    private_pcr["_is_public"] = False
    return private_pcr


# ── Legacy singletons (for backwards compatibility during migration) ─────

projects_store = _projects_store
tasks_store = _tasks_store
dependencies_store = _dependencies_store
methods_store = _methods_store
events_store = _events_store
goals_store = _goals_store
pcr_store = _pcr_store
purchase_items_store = _purchase_items_store
item_catalog_store = _item_catalog_store
lab_links_store = _lab_links_store


def reset_stores() -> None:
    """Reinitialize all store instances to pick up new settings.
    
    NOTE: With the new dynamic directory property, this function is largely
    unnecessary. The stores will automatically use the new user's directory
    on the next operation. This is kept for backwards compatibility.
    """
    global projects_store, tasks_store, dependencies_store
    global methods_store, events_store, goals_store
    global pcr_store, purchase_items_store, item_catalog_store, lab_links_store
    
    # Only force directory creation if there's a current user
    if settings.current_user:
        _projects_store.dir  # Force directory creation
        _tasks_store.dir
        _dependencies_store.dir
        _methods_store.dir
        _events_store.dir
        _goals_store.dir
        _pcr_store.dir
        _purchase_items_store.dir
        _item_catalog_store.dir
        _lab_links_store.dir
    
    # Update legacy references
    projects_store = _projects_store
    tasks_store = _tasks_store
    dependencies_store = _dependencies_store
    methods_store = _methods_store
    events_store = _events_store
    goals_store = _goals_store
    pcr_store = _pcr_store
    purchase_items_store = _purchase_items_store
    item_catalog_store = _item_catalog_store
    lab_links_store = _lab_links_store
