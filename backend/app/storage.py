"""JSON-file-backed storage layer replacing SQLAlchemy/PostgreSQL.

Each entity type (projects, tasks, dependencies, methods) gets its own
directory under ``{data_repo}/data/{entity}/``.  Every record is stored
as ``{id}.json``.  A ``_counters.json`` file in the data root tracks
the next auto-increment ID for each entity.
"""

import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import settings

_lock = threading.Lock()


def _data_root() -> Path:
    """Return the ``data/`` directory inside the local data-repo clone."""
    root = Path(settings.github_localpath) / "data"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _counters_path() -> Path:
    return _data_root() / "_counters.json"


def _read_counters() -> Dict[str, int]:
    p = _counters_path()
    if p.exists():
        return json.loads(p.read_text())
    return {}


def _write_counters(counters: Dict[str, int]) -> None:
    _counters_path().write_text(json.dumps(counters, indent=2))


def _next_id(entity: str) -> int:
    """Atomically get and increment the counter for *entity*."""
    counters = _read_counters()
    current = counters.get(entity, 0) + 1
    counters[entity] = current
    _write_counters(counters)
    return current


class JsonStore:
    """Generic CRUD store backed by one-JSON-file-per-record on disk."""

    def __init__(self, entity: str) -> None:
        self.entity = entity
        self.dir = _data_root() / entity
        self.dir.mkdir(parents=True, exist_ok=True)

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
        with _lock:
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


# ── Convenience singletons ────────────────────────────────────────────────────

projects_store = JsonStore("projects")
tasks_store = JsonStore("tasks")
dependencies_store = JsonStore("dependencies")
methods_store = JsonStore("methods")
events_store = JsonStore("events")
goals_store = JsonStore("goals")
