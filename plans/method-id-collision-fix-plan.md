# Method ID Collision Fix Plan

## Problem Summary

The system uses separate ID counters for private and public methods, causing ID collisions. When a new public method is created with an ID that matches an existing private method's ID, experiments linked to the private method incorrectly appear linked to the public method as well.

### Root Cause

In [`storage.py`](backend/app/storage.py:63-70), the `_next_id()` function uses separate counters:
- Private methods: `users/{current_user}/_counters.json`
- Public methods: `users/public/_counters.json`

Tasks store only the integer `method_id` without indicating whether the method is public or private, making it impossible to distinguish between methods with the same ID from different stores.

## Solution: Global ID Counter for Methods

Use a single, global counter for all methods (both private and public) to guarantee unique IDs across both stores.

## Implementation Plan

### Phase 1: Storage Layer Changes

#### 1.1 Add Global Counter for Methods

Modify [`storage.py`](backend/app/storage.py) to:

```python
def _global_counters_path() -> Path:
    """Path to global counters for methods and PCR protocols."""
    return Path(settings.github_localpath) / "users" / "_global_counters.json"

def _read_global_counters() -> Dict[str, int]:
    p = _global_counters_path()
    if p.exists():
        return json.loads(p.read_text())
    return {}

def _write_global_counters(counters: Dict[str, int]) -> None:
    p = _global_counters_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(counters, indent=2))

def _next_global_id(entity: str) -> int:
    """Get next ID from global counter for methods/pcr."""
    with _lock:
        counters = _read_global_counters()
        current = counters.get(entity, 0) + 1
        counters[entity] = current
        _write_global_counters(counters)
    return current
```

#### 1.2 Modify PublicJsonStore.create()

Update [`PublicJsonStore.create()`](backend/app/storage.py:174-179) to use the global counter:

```python
class PublicJsonStore(JsonStore):
    def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create with ID from global counter for methods/pcr."""
        if self.entity in PUBLIC_ENTITIES:
            new_id = _next_global_id(self.entity)
        else:
            new_id = _next_id(self.entity, public=True)
        data["id"] = new_id
        self._write_json(self._path(new_id), data)
        return data
```

#### 1.3 Modify JsonStore.create() for Methods

Update [`JsonStore.create()`](backend/app/storage.py:122-127) to use the global counter for methods:

```python
def create(self, data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new record with an auto-assigned ``id``."""
    if self.entity in PUBLIC_ENTITIES:
        new_id = _next_global_id(self.entity)
    else:
        new_id = _next_id(self.entity)
    data["id"] = new_id
    self._write_json(self._path(new_id), data)
    return data
```

### Phase 2: Migration Script

Create a migration script to renumber existing public methods and update all references.

#### 2.1 Migration Script Location

Create: [`backend/app/migrations/migrate_method_ids.py`](backend/app/migrations/migrate_method_ids.py)

#### 2.2 Migration Logic

```python
"""
Migration: Renumber public methods to use global IDs.

This migration:
1. Finds the highest existing method ID across both stores
2. Renumers all public methods starting from that + 1
3. Updates all task references to use the new IDs
4. Updates parent_method_id references in child methods
"""

def migrate():
    # 1. Get all private method IDs
    private_ids = [m["id"] for m in get_methods_store().list_all()]
    
    # 2. Get all public methods
    public_methods = get_public_methods_store().list_all()
    
    # 3. Find max ID to start renumbering from
    max_id = max(private_ids + [0])
    
    # 4. Build ID mapping: old_id -> new_id
    id_mapping = {}
    for method in public_methods:
        max_id += 1
        id_mapping[method["id"]] = max_id
    
    # 5. Renumber public methods
    for method in public_methods:
        old_id = method["id"]
        new_id = id_mapping[old_id]
        method["id"] = new_id
        
        # Update parent_method_id if it references another public method
        if method.get("parent_method_id") in id_mapping:
            method["parent_method_id"] = id_mapping[method["parent_method_id"]]
        
        # Write new file
        get_public_methods_store()._write_json(
            get_public_methods_store()._path(new_id), 
            method
        )
        # Delete old file
        get_public_methods_store()._path(old_id).unlink()
    
    # 6. Update task references
    for task in get_tasks_store().list_all():
        updated = False
        
        # Update method_ids
        if task.get("method_ids"):
            new_method_ids = []
            for mid in task["method_ids"]:
                if mid in id_mapping:
                    new_method_ids.append(id_mapping[mid])
                    updated = True
                else:
                    new_method_ids.append(mid)
            task["method_ids"] = new_method_ids
        
        # Update method_attachments
        if task.get("method_attachments"):
            for att in task["method_attachments"]:
                if att.get("method_id") in id_mapping:
                    att["method_id"] = id_mapping[att["method_id"]]
                    updated = True
        
        # Update legacy method_id
        if task.get("method_id") in id_mapping:
            task["method_id"] = id_mapping[task["method_id"]]
            updated = True
        
        if updated:
            get_tasks_store().save(task["id"], task)
    
    # 7. Update global counter
    _write_global_counters({"methods": max_id})
    
    # 8. Clean up old public counter
    _public_counters_path().unlink(missing_ok=True)
```

### Phase 3: Testing

#### 3.1 Test Cases

1. **Create private method**: Verify it gets a unique ID from global counter
2. **Create public method**: Verify it gets a unique ID from global counter
3. **Link experiment to method**: Verify the link works correctly
4. **Move method to public**: Verify ID changes and references update
5. **Move method to private**: Verify ID changes and references update
6. **View method experiments**: Verify only correct experiments are shown

#### 3.2 Manual Testing

1. Run migration on test data
2. Verify all method-experiment links are preserved
3. Create new methods and verify unique IDs
4. Check that the bug no longer reproduces

## Files to Modify

| File | Changes |
|------|---------|
| [`backend/app/storage.py`](backend/app/storage.py) | Add global counter functions, modify create() methods |
| [`backend/app/migrations/migrate_method_ids.py`](backend/app/migrations/migrate_method_ids.py) | New migration script |

## Rollback Plan

If issues arise after migration:

1. The migration should create a backup of the original data
2. Store the ID mapping in a `_method_id_migration_backup.json` file
3. Provide a rollback script to reverse the migration

## Estimated Complexity

- **Storage changes**: Low complexity, ~20 lines of code
- **Migration script**: Medium complexity, ~100 lines of code
- **Testing**: Medium complexity, requires careful verification

## Notes

- The same issue exists for PCR protocols (also stored in both private and public stores)
- Consider applying the same fix to PCR protocols in the same migration
- The migration should be run once per user database
