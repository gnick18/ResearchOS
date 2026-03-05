"""Migration to populate shared_with field on existing shared items.

This migration scans all users' _shared_with_me.json files and updates
the actual items (tasks, methods, projects) to have the correct shared_with field.

This is needed because the original sharing implementation only updated the
registry files, not the items themselves.
"""

import json
from pathlib import Path
from typing import Dict, List, Any

from app.config import settings


def _get_users_dir() -> Path:
    """Get the users directory."""
    return Path(settings.github_localpath) / "users"


def _read_json_file(path: Path) -> Dict[str, Any]:
    """Read a JSON file, returning empty dict if not found."""
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def _write_json_file(path: Path, data: Dict[str, Any]) -> None:
    """Write a JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, default=str))


def migrate_shared_with_fields():
    """Migrate shared_with field from registry files to actual items.
    
    This function:
    1. Scans all users' _shared_with_me.json files
    2. For each shared item, updates the item's shared_with field
    3. Handles tasks, methods, and projects
    """
    users_dir = _get_users_dir()
    
    if not users_dir.exists():
        print("Users directory does not exist, nothing to migrate.")
        return
    
    migrated_count = 0
    
    # Iterate through all user directories
    for user_dir in users_dir.iterdir():
        if not user_dir.is_dir():
            continue
        if user_dir.name in ("public", "lab", "_no_user_"):
            continue
        
        username = user_dir.name
        shared_with_me_file = user_dir / "_shared_with_me.json"
        
        if not shared_with_me_file.exists():
            continue
        
        print(f"\nProcessing user: {username}")
        
        shared_data = _read_json_file(shared_with_me_file)
        
        # Process shared tasks
        for task_entry in shared_data.get("tasks", []):
            task_id = task_entry.get("id")
            owner = task_entry.get("owner")
            permission = task_entry.get("permission", "view")
            
            if not task_id or not owner:
                continue
            
            # Get the task file from the owner's directory
            owner_dir = users_dir / owner
            task_file = owner_dir / "tasks" / f"{task_id}.json"
            
            if not task_file.exists():
                print(f"  Task {task_id} not found for owner {owner}")
                continue
            
            task_data = _read_json_file(task_file)
            if not task_data:
                continue
            
            # Update shared_with field
            shared_with = task_data.get("shared_with", [])
            
            # Check if user is already in shared_with
            existing_idx = next(
                (i for i, u in enumerate(shared_with) if u.get("username") == username),
                None
            )
            
            if existing_idx is None:
                shared_with.append({
                    "username": username,
                    "permission": permission
                })
                task_data["shared_with"] = shared_with
                _write_json_file(task_file, task_data)
                print(f"  Added {username} to task {task_id}'s shared_with field")
                migrated_count += 1
            else:
                # Update permission if different
                if shared_with[existing_idx].get("permission") != permission:
                    shared_with[existing_idx]["permission"] = permission
                    task_data["shared_with"] = shared_with
                    _write_json_file(task_file, task_data)
                    print(f"  Updated {username}'s permission on task {task_id}")
                    migrated_count += 1
        
        # Process shared methods
        for method_entry in shared_data.get("methods", []):
            method_id = method_entry.get("id")
            owner = method_entry.get("owner")
            permission = method_entry.get("permission", "view")
            
            if not method_id or not owner:
                continue
            
            # Get the method file - check both owner's private store and public store
            owner_dir = users_dir / owner
            method_file = owner_dir / "methods" / f"{method_id}.json"
            
            if not method_file.exists():
                # Check public store
                method_file = users_dir / "public" / "methods" / f"{method_id}.json"
            
            if not method_file.exists():
                print(f"  Method {method_id} not found for owner {owner}")
                continue
            
            method_data = _read_json_file(method_file)
            if not method_data:
                continue
            
            # Update shared_with field
            shared_with = method_data.get("shared_with", [])
            
            # Check if user is already in shared_with
            existing_idx = next(
                (i for i, u in enumerate(shared_with) if u.get("username") == username),
                None
            )
            
            if existing_idx is None:
                shared_with.append({
                    "username": username,
                    "permission": permission
                })
                method_data["shared_with"] = shared_with
                _write_json_file(method_file, method_data)
                print(f"  Added {username} to method {method_id}'s shared_with field")
                migrated_count += 1
            else:
                # Update permission if different
                if shared_with[existing_idx].get("permission") != permission:
                    shared_with[existing_idx]["permission"] = permission
                    method_data["shared_with"] = shared_with
                    _write_json_file(method_file, method_data)
                    print(f"  Updated {username}'s permission on method {method_id}")
                    migrated_count += 1
        
        # Process shared projects
        for project_entry in shared_data.get("projects", []):
            project_id = project_entry.get("id")
            owner = project_entry.get("owner")
            permission = project_entry.get("permission", "view")
            
            if not project_id or not owner:
                continue
            
            # Get the project file from the owner's directory
            owner_dir = users_dir / owner
            project_file = owner_dir / "projects" / f"{project_id}.json"
            
            if not project_file.exists():
                print(f"  Project {project_id} not found for owner {owner}")
                continue
            
            project_data = _read_json_file(project_file)
            if not project_data:
                continue
            
            # Update shared_with field
            shared_with = project_data.get("shared_with", [])
            
            # Check if user is already in shared_with
            existing_idx = next(
                (i for i, u in enumerate(shared_with) if u.get("username") == username),
                None
            )
            
            if existing_idx is None:
                shared_with.append({
                    "username": username,
                    "permission": permission
                })
                project_data["shared_with"] = shared_with
                _write_json_file(project_file, project_data)
                print(f"  Added {username} to project {project_id}'s shared_with field")
                migrated_count += 1
            else:
                # Update permission if different
                if shared_with[existing_idx].get("permission") != permission:
                    shared_with[existing_idx]["permission"] = permission
                    project_data["shared_with"] = shared_with
                    _write_json_file(project_file, project_data)
                    print(f"  Updated {username}'s permission on project {project_id}")
                    migrated_count += 1
    
    print(f"\n=== Migration complete. Updated {migrated_count} items. ===")
    return migrated_count


if __name__ == "__main__":
    migrate_shared_with_fields()
