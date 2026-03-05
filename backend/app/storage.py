"""JSON-file-backed storage layer replacing SQLAlchemy/PostgreSQL.

Each entity type (projects, tasks, dependencies, methods) gets its own
directory under ``{data_repo}/users/{current_user}/{entity}/``.  
Every record is stored as ``{id}.json``.  
A ``_counters.json`` file in the data root tracks the next auto-increment ID.

Public methods and PCR protocols are stored in:
``{data_repo}/users/public/{entity}/``
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
    """Return the ``users/{current_user}/`` directory inside the local data-repo clone."""
    if not settings.current_user:
        # Return a dummy path if no user is set - don't create directories
        return Path(settings.github_localpath) / "users" / "_no_user_"
    root = Path(settings.github_localpath) / "users" / settings.current_user
    root.mkdir(parents=True, exist_ok=True)
    return root


def _public_data_root() -> Path:
    """Return the ``users/public/`` directory for shared methods/protocols."""
    root = Path(settings.github_localpath) / "users" / "public"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _counters_path() -> Path:
    return _data_root() / "_counters.json"


def _public_counters_path() -> Path:
    return _public_data_root() / "_counters.json"


def _global_counters_path() -> Path:
    """Path to global counters for methods and PCR protocols.
    
    Global counters ensure unique IDs across both private and public stores
    for entities that can be shared (methods, pcr_protocols).
    """
    return Path(settings.github_localpath) / "users" / "_global_counters.json"


def _read_counters(public: bool = False) -> Dict[str, int]:
    p = _public_counters_path() if public else _counters_path()
    if p.exists():
        return json.loads(p.read_text())
    return {}


def _write_counters(counters: Dict[str, int], public: bool = False) -> None:
    p = _public_counters_path() if public else _counters_path()
    p.write_text(json.dumps(counters, indent=2))


def _read_global_counters() -> Dict[str, int]:
    """Read global counters for methods/pcr_protocols."""
    p = _global_counters_path()
    if p.exists():
        return json.loads(p.read_text())
    return {}


def _write_global_counters(counters: Dict[str, int]) -> None:
    """Write global counters for methods/pcr_protocols."""
    p = _global_counters_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(counters, indent=2))


def _next_id(entity: str, public: bool = False) -> int:
    """Atomically get and increment the counter for *entity*."""
    with _lock:
        counters = _read_counters(public)
        current = counters.get(entity, 0) + 1
        counters[entity] = current
        _write_counters(counters, public)
    return current


def _next_global_id(entity: str) -> int:
    """Atomically get and increment the global counter for *entity*.
    
    Used for methods and PCR protocols to ensure unique IDs across
    both private and public stores.
    """
    with _lock:
        counters = _read_global_counters()
        current = counters.get(entity, 0) + 1
        counters[entity] = current
        _write_global_counters(counters)
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
        # Use global counter for methods and PCR protocols to ensure unique IDs
        # across both private and public stores
        if self.entity in PUBLIC_ENTITIES:
            new_id = _next_global_id(self.entity)
        else:
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
    
    Stores data in users/public/{entity}/ instead of user-specific folder.
    """
    
    @property
    def dir(self) -> Path:
        """Return the public directory for shared entities."""
        d = _public_data_root() / self.entity
        d.mkdir(parents=True, exist_ok=True)
        return d
    
    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new record with an auto-assigned ``id``.
        
        Uses the global counter for methods and PCR protocols to ensure
        unique IDs across both private and public stores.
        """
        # Use global counter for methods and PCR protocols
        if self.entity in PUBLIC_ENTITIES:
            new_id = _next_global_id(self.entity)
        else:
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
_notes_store = JsonStore("notes")

# Public (shared) stores for methods and PCR protocols
_public_methods_store = PublicJsonStore("methods")
_public_pcr_store = PublicJsonStore("pcr_protocols")

# Lab-level (shared across all users) stores
_funding_accounts_store = None  # Initialized lazily


def _lab_data_root() -> Path:
    """Return the ``users/lab/`` directory for lab-level shared data."""
    root = Path(settings.github_localpath) / "users" / "lab"
    root.mkdir(parents=True, exist_ok=True)
    return root


class LabJsonStore(JsonStore):
    """Store for lab-level shared data (funding accounts, etc.)."""
    
    @property
    def dir(self) -> Path:
        """Return the lab-level directory for shared entities."""
        d = _lab_data_root() / self.entity
        d.mkdir(parents=True, exist_ok=True)
        return d
    
    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new record with an auto-assigned ``id`` from lab counters."""
        new_id = _next_id(self.entity, public=False)  # Use lab-level counters
        data["id"] = new_id
        self._write_json(self._path(new_id), data)
        return data


def get_funding_accounts_store() -> LabJsonStore:
    """Get the funding accounts store (lab-level, shared across all users)."""
    global _funding_accounts_store
    if _funding_accounts_store is None:
        _funding_accounts_store = LabJsonStore("funding_accounts")
    return _funding_accounts_store


def list_all_users_purchase_items() -> List[Dict[str, Any]]:
    """List all purchase items from ALL users (for lab-level aggregation).
    
    This iterates through all user directories and collects purchase items
    for lab-level reporting.
    """
    all_items: List[Dict[str, Any]] = []
    users_dir = Path(settings.github_localpath) / "users"
    
    if not users_dir.exists():
        return all_items
    
    for user_dir in users_dir.iterdir():
        # Skip non-directories and special directories (public, lab)
        if not user_dir.is_dir():
            continue
        if user_dir.name in ("public", "lab", "_no_user_"):
            continue
        
        purchase_items_dir = user_dir / "purchase_items"
        if not purchase_items_dir.exists():
            continue
        
        for item_file in sorted(purchase_items_dir.glob("*.json")):
            try:
                item_data = json.loads(item_file.read_text())
                # Add the username to track who made the purchase
                item_data["_username"] = user_dir.name
                all_items.append(item_data)
            except (json.JSONDecodeError, OSError):
                continue
    
    return all_items


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


def get_notes_store() -> JsonStore:
    """Get the notes store for the current user."""
    return _notes_store


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


# ── Attachment Metadata Stores ────────────────────────────────────────────────

from datetime import date as date_type
import re


def generate_experiment_folder_name(experiment_name: str, exp_date: date_type) -> str:
    """Generate folder name like 'Mar-04-2026-My-Experiment'.
    
    Uses abbreviated month name to avoid US/EU date confusion.
    """
    # Format date as abbreviated month-day-year
    date_str = exp_date.strftime("%b-%d-%Y")  # Mar-04-2026
    
    # Sanitize experiment name
    safe_name = sanitize_experiment_name(experiment_name)
    
    return f"{date_str}-{safe_name}"


def sanitize_experiment_name(name: str) -> str:
    """Remove special characters and replace spaces with hyphens."""
    # Replace spaces with hyphens
    safe = name.replace(" ", "-")
    # Remove any character that's not alphanumeric, hyphen, or underscore
    safe = "".join(c for c in safe if c.isalnum() or c in "-_")
    # Remove consecutive hyphens
    while "--" in safe:
        safe = safe.replace("--", "-")
    # Remove leading/trailing hyphens
    safe = safe.strip("-")
    return safe


class AttachmentMetadataStore:
    """Store for attachment metadata (images and files).
    
    Stores metadata in a single JSON file per folder:
    - Images/_metadata.json
    - Files/_metadata.json
    
    Each file contains a list of metadata entries with:
    - id, filename, path, experiment_id, experiment_name, etc.
    """
    
    def __init__(self, folder_name: str) -> None:
        """Initialize the store.
        
        Args:
            folder_name: Either "Images" or "Files"
        """
        self.folder_name = folder_name
    
    @property
    def _metadata_path(self) -> Path:
        """Path to the metadata JSON file."""
        return _data_root() / self.folder_name / "_metadata.json"
    
    @property
    def _folder_path(self) -> Path:
        """Path to the attachments folder."""
        return _data_root() / self.folder_name
    
    def _read_metadata(self) -> Dict[str, Any]:
        """Read the metadata file."""
        p = self._metadata_path
        if not p.exists():
            return {"version": 1, "entries": [], "next_id": 1}
        try:
            return json.loads(p.read_text())
        except (json.JSONDecodeError, OSError):
            return {"version": 1, "entries": [], "next_id": 1}
    
    def _write_metadata(self, data: Dict[str, Any]) -> None:
        """Write the metadata file."""
        self._metadata_path.parent.mkdir(parents=True, exist_ok=True)
        self._metadata_path.write_text(json.dumps(data, indent=2, default=str))
    
    def add_entry(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        """Add a new metadata entry.
        
        Args:
            entry: Metadata dictionary (without id)
            
        Returns:
            The entry with id assigned
        """
        with _lock:
            metadata = self._read_metadata()
            new_id = metadata.get("next_id", 1)
            entry["id"] = new_id
            metadata["entries"].append(entry)
            metadata["next_id"] = new_id + 1
            self._write_metadata(metadata)
        return entry
    
    def get_entry(self, entry_id: int) -> Optional[Dict[str, Any]]:
        """Get a metadata entry by ID."""
        metadata = self._read_metadata()
        for entry in metadata.get("entries", []):
            if entry.get("id") == entry_id:
                return entry
        return None
    
    def get_entry_by_filename(self, filename: str) -> Optional[Dict[str, Any]]:
        """Get a metadata entry by filename."""
        metadata = self._read_metadata()
        for entry in metadata.get("entries", []):
            if entry.get("filename") == filename:
                return entry
        return None
    
    def list_all(self) -> List[Dict[str, Any]]:
        """List all metadata entries."""
        metadata = self._read_metadata()
        return metadata.get("entries", [])
    
    def get_by_experiment(self, experiment_id: int) -> List[Dict[str, Any]]:
        """Get all entries for a specific experiment."""
        metadata = self._read_metadata()
        return [
            entry for entry in metadata.get("entries", [])
            if entry.get("experiment_id") == experiment_id
        ]
    
    def get_by_folder(self, folder: str) -> List[Dict[str, Any]]:
        """Get all entries in a specific folder."""
        metadata = self._read_metadata()
        return [
            entry for entry in metadata.get("entries", [])
            if entry.get("folder") == folder
        ]
    
    def update_entry(self, entry_id: int, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a metadata entry."""
        with _lock:
            metadata = self._read_metadata()
            for i, entry in enumerate(metadata.get("entries", [])):
                if entry.get("id") == entry_id:
                    entry.update(updates)
                    metadata["entries"][i] = entry
                    self._write_metadata(metadata)
                    return entry
        return None
    
    def delete_entry(self, entry_id: int) -> bool:
        """Delete a metadata entry."""
        with _lock:
            metadata = self._read_metadata()
            original_count = len(metadata.get("entries", []))
            metadata["entries"] = [
                entry for entry in metadata.get("entries", [])
                if entry.get("id") != entry_id
            ]
            if len(metadata["entries"]) < original_count:
                self._write_metadata(metadata)
                return True
        return False
    
    def delete_by_experiment(self, experiment_id: int) -> int:
        """Delete all entries for a specific experiment.
        
        Returns:
            Number of entries deleted
        """
        with _lock:
            metadata = self._read_metadata()
            original_count = len(metadata.get("entries", []))
            metadata["entries"] = [
                entry for entry in metadata.get("entries", [])
                if entry.get("experiment_id") != experiment_id
            ]
            deleted_count = original_count - len(metadata["entries"])
            if deleted_count > 0:
                self._write_metadata(metadata)
            return deleted_count
    
    def get_experiment_folder(self, experiment_id: int) -> Optional[str]:
        """Get the folder name for an experiment (if any entries exist)."""
        entries = self.get_by_experiment(experiment_id)
        if entries:
            return entries[0].get("folder")
        return None


# Create store instances
_image_metadata_store = AttachmentMetadataStore("Images")
_file_metadata_store = AttachmentMetadataStore("Files")


def get_image_metadata_store() -> AttachmentMetadataStore:
    """Get the image metadata store for the current user."""
    return _image_metadata_store


def get_file_metadata_store() -> AttachmentMetadataStore:
    """Get the file metadata store for the current user."""
    return _file_metadata_store


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
notes_store = _notes_store


def reset_stores() -> None:
    """Reinitialize all store instances to pick up new settings.
    
    NOTE: With the new dynamic directory property, this function is largely
    unnecessary. The stores will automatically use the new user's directory
    on the next operation. This is kept for backwards compatibility.
    """
    global projects_store, tasks_store, dependencies_store
    global methods_store, events_store, goals_store
    global pcr_store, purchase_items_store, item_catalog_store, lab_links_store, notes_store
    
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
        _notes_store.dir
    
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
    notes_store = _notes_store


# ── Sharing Storage Functions ─────────────────────────────────────────────────

from datetime import datetime as dt_datetime, timezone
import uuid


def _get_user_data_root(username: str) -> Path:
    """Get the data root for a specific user (not current user)."""
    return Path(settings.github_localpath) / "users" / username


def _shared_with_me_path(username: str) -> Path:
    """Path to a user's shared_with_me.json file."""
    return _get_user_data_root(username) / "_shared_with_me.json"


def _notifications_path(username: str) -> Path:
    """Path to a user's notifications.json file."""
    return _get_user_data_root(username) / "_notifications.json"


def _read_shared_with_me(username: str) -> Dict[str, Any]:
    """Read a user's shared_with_me registry."""
    p = _shared_with_me_path(username)
    if not p.exists():
        return {
            "version": 1,
            "projects": [],
            "tasks": [],
            "methods": []
        }
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return {
            "version": 1,
            "projects": [],
            "tasks": [],
            "methods": []
        }


def _write_shared_with_me(username: str, data: Dict[str, Any]) -> None:
    """Write a user's shared_with_me registry."""
    p = _shared_with_me_path(username)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2, default=str))


def _read_notifications(username: str) -> Dict[str, Any]:
    """Read a user's notifications."""
    p = _notifications_path(username)
    if not p.exists():
        return {
            "version": 1,
            "notifications": []
        }
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return {
            "version": 1,
            "notifications": []
        }


def _write_notifications(username: str, data: Dict[str, Any]) -> None:
    """Write a user's notifications."""
    p = _notifications_path(username)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2, default=str))


def _update_item_shared_with_field(
    item_type: str,
    item_id: int,
    owner: str,
    target_username: str,
    permission: Optional[str],
    add: bool
) -> None:
    """Update the shared_with field on an item when sharing/unsharing.
    
    Args:
        item_type: "task", "method", or "project"
        item_id: The item's ID
        owner: The item's owner (username)
        target_username: The user being added/removed from shared_with
        permission: The permission level (only used when add=True)
        add: True to add, False to remove
    """
    # Get the item file path based on type and owner
    owner_dir = _get_user_data_root(owner)
    
    if item_type == "task":
        item_file = owner_dir / "tasks" / f"{item_id}.json"
    elif item_type == "method":
        # Methods can be in private or public store
        item_file = owner_dir / "methods" / f"{item_id}.json"
        if not item_file.exists():
            # Check public store
            item_file = _public_data_root() / "methods" / f"{item_id}.json"
    elif item_type == "project":
        item_file = owner_dir / "projects" / f"{item_id}.json"
    else:
        return
    
    if not item_file.exists():
        return
    
    try:
        item = json.loads(item_file.read_text())
        
        # Get current shared_with list
        shared_with = item.get("shared_with", [])
        
        if add:
            # Add user to shared_with if not already there
            existing_idx = next(
                (i for i, u in enumerate(shared_with) if u.get("username") == target_username),
                None
            )
            if existing_idx is None:
                shared_with.append({
                    "username": target_username,
                    "permission": permission or "view"
                })
            else:
                # Update permission if already exists
                shared_with[existing_idx]["permission"] = permission or "view"
        else:
            # Remove user from shared_with
            shared_with = [u for u in shared_with if u.get("username") != target_username]
        
        # Update the item
        item["shared_with"] = shared_with
        item_file.write_text(json.dumps(item, indent=2, default=str))
    except (json.JSONDecodeError, OSError):
        pass


def add_shared_item(
    target_username: str,
    item_type: str,  # "task", "method", "project"
    item_id: int,
    owner: str,
    permission: str = "edit",
    item_name: str = ""
) -> bool:
    """Add an item to a user's shared_with_me registry and create notification.
    
    Also updates the item's shared_with field to include the new user.
    
    Returns True if successful, False if already shared.
    """
    with _lock:
        # Add to shared_with_me
        shared = _read_shared_with_me(target_username)
        
        # Check if already shared
        key = f"{item_type}s"  # "tasks", "methods", "projects"
        for item in shared.get(key, []):
            if item.get("id") == item_id and item.get("owner") == owner:
                return False  # Already shared
        
        # Add new entry
        entry = {
            "id": item_id,
            "owner": owner,
            "permission": permission,
            "shared_at": dt_datetime.now(timezone.utc).isoformat()
        }
        shared.setdefault(key, []).append(entry)
        _write_shared_with_me(target_username, shared)
        
        # Create notification
        notif_data = _read_notifications(target_username)
        notification = {
            "id": str(uuid.uuid4()),
            "type": f"{item_type}_shared",
            "from_user": owner,
            "item_type": item_type,
            "item_id": item_id,
            "item_name": item_name,
            "permission": permission,
            "created_at": dt_datetime.now(timezone.utc).isoformat(),
            "read": False
        }
        notif_data.setdefault("notifications", []).append(notification)
        _write_notifications(target_username, notif_data)
        
        # Update the item's shared_with field
        _update_item_shared_with_field(item_type, item_id, owner, target_username, permission, add=True)
        
        return True


def remove_shared_item(
    target_username: str,
    item_type: str,
    item_id: int,
    owner: str
) -> bool:
    """Remove an item from a user's shared_with_me registry.
    
    Also updates the item's shared_with field to remove the user.
    
    Returns True if removed, False if not found.
    """
    with _lock:
        shared = _read_shared_with_me(target_username)
        key = f"{item_type}s"
        
        original_count = len(shared.get(key, []))
        shared[key] = [
            item for item in shared.get(key, [])
            if not (item.get("id") == item_id and item.get("owner") == owner)
        ]
        
        if len(shared[key]) < original_count:
            _write_shared_with_me(target_username, shared)
            # Update the item's shared_with field
            _update_item_shared_with_field(item_type, item_id, owner, target_username, None, add=False)
            return True
        return False


def get_shared_items_for_user(username: str, item_type: Optional[str] = None) -> Dict[str, Any]:
    """Get all items shared with a user, optionally filtered by type.
    
    Returns the full shared_with_me data or just one type if specified.
    """
    shared = _read_shared_with_me(username)
    if item_type:
        key = f"{item_type}s"
        return {key: shared.get(key, [])}
    return shared


def get_notifications_for_user(username: str, unread_only: bool = False) -> List[Dict[str, Any]]:
    """Get notifications for a user.
    
    Args:
        username: The user to get notifications for
        unread_only: If True, only return unread notifications
    
    Returns:
        List of notification dictionaries
    """
    notif_data = _read_notifications(username)
    notifications = notif_data.get("notifications", [])
    
    if unread_only:
        return [n for n in notifications if not n.get("read", False)]
    return notifications


def dismiss_notification(username: str, notification_id: str) -> bool:
    """Mark a notification as read.
    
    Returns True if found and updated, False otherwise.
    """
    with _lock:
        notif_data = _read_notifications(username)
        
        for notif in notif_data.get("notifications", []):
            if notif.get("id") == notification_id:
                notif["read"] = True
                _write_notifications(username, notif_data)
                return True
        return False


def dismiss_all_notifications(username: str) -> int:
    """Mark all notifications as read.
    
    Returns count of notifications marked as read.
    """
    with _lock:
        notif_data = _read_notifications(username)
        count = 0
        
        for notif in notif_data.get("notifications", []):
            if not notif.get("read", False):
                notif["read"] = True
                count += 1
        
        if count > 0:
            _write_notifications(username, notif_data)
        return count


def get_dependency_chain(task_id: int) -> List[int]:
    """Get all task IDs in the dependency chain for a task.
    
    Traverses both up (parents) and down (children) the dependency tree.
    """
    visited = set()
    
    def traverse_up(tid: int) -> None:
        """Find all parent tasks (tasks this task depends on)."""
        for dep in _dependencies_store.query(child_id=tid):
            parent_id = dep.get("parent_id")
            if parent_id and parent_id not in visited:
                visited.add(parent_id)
                traverse_up(parent_id)
    
    def traverse_down(tid: int) -> None:
        """Find all child tasks (tasks that depend on this task)."""
        for dep in _dependencies_store.query(parent_id=tid):
            child_id = dep.get("child_id")
            if child_id and child_id not in visited:
                visited.add(child_id)
                traverse_down(child_id)
    
    visited.add(task_id)
    traverse_up(task_id)
    traverse_down(task_id)
    return list(visited)


def get_task_from_owner(owner: str, task_id: int) -> Optional[Dict[str, Any]]:
    """Get a task from a specific owner's store (for shared task access)."""
    owner_tasks_dir = _get_user_data_root(owner) / "tasks"
    task_file = owner_tasks_dir / f"{task_id}.json"
    
    if not task_file.exists():
        return None
    
    try:
        task = json.loads(task_file.read_text())
        task["_owner"] = owner
        return task
    except (json.JSONDecodeError, OSError):
        return None


def get_project_from_owner(owner: str, project_id: int) -> Optional[Dict[str, Any]]:
    """Get a project from a specific owner's store (for shared project access)."""
    owner_projects_dir = _get_user_data_root(owner) / "projects"
    project_file = owner_projects_dir / f"{project_id}.json"
    
    if not project_file.exists():
        return None
    
    try:
        project = json.loads(project_file.read_text())
        project["_owner"] = owner
        return project
    except (json.JSONDecodeError, OSError):
        return None


def get_method_from_owner(owner: str, method_id: int, is_public: bool = False) -> Optional[Dict[str, Any]]:
    """Get a method from a specific owner's store (for shared method access)."""
    if is_public:
        # Public methods are in the public store
        return get_method_by_id(method_id)
    
    owner_methods_dir = _get_user_data_root(owner) / "methods"
    method_file = owner_methods_dir / f"{method_id}.json"
    
    if not method_file.exists():
        return None
    
    try:
        method = json.loads(method_file.read_text())
        method["_owner"] = owner
        method["_is_public"] = False
        return method
    except (json.JSONDecodeError, OSError):
        return None


def list_tasks_including_shared(username: str) -> List[Dict[str, Any]]:
    """List user's own tasks plus tasks shared with them.
    
    This is the main function for getting all tasks visible to a user.
    """
    # Get user's own tasks
    own_tasks = _tasks_store.list_all()
    for task in own_tasks:
        task["_owner"] = settings.current_user
        task["_is_shared"] = False
    
    # Get shared tasks
    shared = _read_shared_with_me(username)
    shared_tasks = []
    
    for entry in shared.get("tasks", []):
        task = get_task_from_owner(entry["owner"], entry["id"])
        if task:
            task["_is_shared"] = True
            task["_shared_permission"] = entry.get("permission", "view")
            shared_tasks.append(task)
    
    # Get tasks from shared projects
    for entry in shared.get("projects", []):
        project_tasks = list_tasks_from_shared_project(entry["owner"], entry["id"])
        for task in project_tasks:
            task["_is_shared"] = True
            task["_shared_permission"] = entry.get("permission", "view")
            task["_inherited_from_project"] = entry["id"]
            shared_tasks.append(task)
    
    return own_tasks + shared_tasks


def list_tasks_from_shared_project(owner: str, project_id: int) -> List[Dict[str, Any]]:
    """List all tasks in a project that's been shared."""
    owner_tasks_dir = _get_user_data_root(owner) / "tasks"
    tasks = []
    
    if not owner_tasks_dir.exists():
        return tasks
    
    for task_file in sorted(owner_tasks_dir.glob("*.json")):
        try:
            task = json.loads(task_file.read_text())
            if task.get("project_id") == project_id:
                task["_owner"] = owner
                tasks.append(task)
        except (json.JSONDecodeError, OSError):
            continue
    
    return tasks


def list_projects_including_shared(username: str) -> List[Dict[str, Any]]:
    """List user's own projects plus projects shared with them."""
    # Get user's own projects
    own_projects = _projects_store.list_all()
    for proj in own_projects:
        proj["_owner"] = settings.current_user
        proj["_is_shared"] = False
    
    # Get shared projects
    shared = _read_shared_with_me(username)
    shared_projects = []
    
    for entry in shared.get("projects", []):
        project = get_project_from_owner(entry["owner"], entry["id"])
        if project:
            project["_is_shared"] = True
            project["_shared_permission"] = entry.get("permission", "view")
            shared_projects.append(project)
    
    return own_projects + shared_projects


def list_methods_including_shared(username: str) -> List[Dict[str, Any]]:
    """List user's own methods, public methods, and methods shared with them."""
    # Get user's own methods + public methods (existing logic)
    methods = list_all_methods()
    
    for m in methods:
        if m.get("_is_public"):
            m["_owner"] = m.get("owner") or m.get("created_by", "")
        else:
            m["_owner"] = settings.current_user
        m["_is_shared"] = False
    
    # Get methods specifically shared with user
    shared = _read_shared_with_me(username)
    shared_methods = []
    
    for entry in shared.get("methods", []):
        method = get_method_from_owner(entry["owner"], entry["id"])
        if method:
            method["_is_shared"] = True
            method["_shared_permission"] = entry.get("permission", "view")
            shared_methods.append(method)
    
    return methods + shared_methods


def check_task_access(username: str, task_id: int, owner: str, required_permission: str = "view") -> Optional[Dict[str, Any]]:
    """Check if a user has access to a task and return the task if so.
    
    Args:
        username: The user requesting access
        task_id: The task ID
        owner: The task owner's username
        required_permission: "view" or "edit"
    
    Returns:
        The task dict if access is granted, None otherwise
    """
    # If user owns the task, full access
    if username == owner:
        task = _tasks_store.get(task_id)
        if task:
            task["_owner"] = owner
            return task
        return None
    
    # Check if task is directly shared
    shared = _read_shared_with_me(username)
    for entry in shared.get("tasks", []):
        if entry.get("id") == task_id and entry.get("owner") == owner:
            permission = entry.get("permission", "view")
            if required_permission == "edit" and permission != "edit":
                return None  # Need edit but only have view
            task = get_task_from_owner(owner, task_id)
            if task:
                task["_shared_permission"] = permission
            return task
    
    # Check if task is in a shared project
    task = get_task_from_owner(owner, task_id)
    if not task:
        return None
    
    project_id = task.get("project_id")
    if project_id:
        for entry in shared.get("projects", []):
            if entry.get("id") == project_id and entry.get("owner") == owner:
                permission = entry.get("permission", "view")
                if required_permission == "edit" and permission != "edit":
                    return None
                task["_shared_permission"] = permission
                task["_inherited_from_project"] = project_id
                return task
    
    return None


def update_shared_task(owner: str, task_id: int, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update a task in the owner's store (for shared task editing).
    
    This allows a user with edit permission to update a shared task.
    """
    owner_tasks_dir = _get_user_data_root(owner) / "tasks"
    task_file = owner_tasks_dir / f"{task_id}.json"
    
    if not task_file.exists():
        return None
    
    try:
        with _lock:
            task = json.loads(task_file.read_text())
            task.update({k: v for k, v in updates.items() if v is not None})
            task_file.write_text(json.dumps(task, indent=2, default=str))
            task["_owner"] = owner
            return task
    except (json.JSONDecodeError, OSError):
        return None
