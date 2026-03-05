"""Migration: Renumber public methods and PCR protocols to use global IDs.

This migration fixes the ID collision bug where private and public methods
could have the same ID, causing experiments to appear linked to the wrong method.

What this migration does:
1. Finds all existing method IDs across both private and public stores
2. Renumbers all public methods to use IDs that don't conflict with private methods
3. Updates all task references (method_ids, method_attachments, method_id)
4. Updates parent_method_id references in child methods
5. Same for PCR protocols
6. Sets up the global counter for future IDs

Usage:
    python -m app.migrations.migrate_method_ids [--dry-run] [--user USERNAME]

Options:
    --dry-run       Show what would be changed without making changes
    --user          Specify which user's data to migrate (default: all users)
"""

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set, Any


def get_data_repo_path() -> Path:
    """Get the data repository path from settings."""
    from app.config import settings
    return Path(settings.github_localpath)


def get_all_user_dirs(data_repo: Path) -> List[Path]:
    """Get all user directories (excluding special directories)."""
    users_dir = data_repo / "users"
    if not users_dir.exists():
        return []
    
    user_dirs = []
    for d in users_dir.iterdir():
        if d.is_dir() and d.name not in ("public", "lab", "_no_user_"):
            user_dirs.append(d)
    return user_dirs


def get_private_method_ids(user_dir: Path) -> Set[int]:
    """Get all method IDs from a user's private store."""
    methods_dir = user_dir / "methods"
    if not methods_dir.exists():
        return set()
    
    ids = set()
    for f in methods_dir.glob("*.json"):
        try:
            ids.add(int(f.stem))
        except ValueError:
            continue
    return ids


def get_private_pcr_ids(user_dir: Path) -> Set[int]:
    """Get all PCR protocol IDs from a user's private store."""
    pcr_dir = user_dir / "pcr_protocols"
    if not pcr_dir.exists():
        return set()
    
    ids = set()
    for f in pcr_dir.glob("*.json"):
        try:
            ids.add(int(f.stem))
        except ValueError:
            continue
    return ids


def get_public_methods(data_repo: Path) -> List[Dict[str, Any]]:
    """Get all public methods."""
    methods_dir = data_repo / "users" / "public" / "methods"
    if not methods_dir.exists():
        return []
    
    methods = []
    for f in sorted(methods_dir.glob("*.json")):
        try:
            method = json.loads(f.read_text())
            methods.append(method)
        except (json.JSONDecodeError, OSError):
            continue
    return methods


def get_public_pcrs(data_repo: Path) -> List[Dict[str, Any]]:
    """Get all public PCR protocols."""
    pcr_dir = data_repo / "users" / "public" / "pcr_protocols"
    if not pcr_dir.exists():
        return []
    
    pcrs = []
    for f in sorted(pcr_dir.glob("*.json")):
        try:
            pcr = json.loads(f.read_text())
            pcrs.append(pcr)
        except (json.JSONDecodeError, OSError):
            continue
    return pcrs


def build_id_mapping(existing_ids: Set[int], items_to_renumber: List[Dict[str, Any]]) -> Dict[int, int]:
    """Build a mapping from old IDs to new IDs.
    
    New IDs start from max(existing_ids) + 1 to avoid collisions.
    """
    if not items_to_renumber:
        return {}
    
    max_id = max(existing_ids) if existing_ids else 0
    id_mapping = {}
    
    for item in items_to_renumber:
        max_id += 1
        id_mapping[item["id"]] = max_id
    
    return id_mapping


def renumber_public_items(
    items_dir: Path,
    id_mapping: Dict[int, int],
    dry_run: bool = False
) -> None:
    """Renumber public items according to the ID mapping."""
    if not items_dir.exists() or not id_mapping:
        return
    
    for old_id, new_id in id_mapping.items():
        old_path = items_dir / f"{old_id}.json"
        new_path = items_dir / f"{new_id}.json"
        
        if not old_path.exists():
            print(f"  Warning: File not found: {old_path}")
            continue
        
        if dry_run:
            print(f"  Would rename: {old_id}.json -> {new_id}.json")
        else:
            # Read the item, update ID, write to new location, delete old
            item = json.loads(old_path.read_text())
            item["id"] = new_id
            new_path.write_text(json.dumps(item, indent=2, default=str))
            old_path.unlink()
            print(f"  Renamed: {old_id}.json -> {new_id}.json")


def update_parent_references(
    items_dir: Path,
    id_mapping: Dict[int, int],
    dry_run: bool = False
) -> None:
    """Update parent_method_id references in child items."""
    if not items_dir.exists() or not id_mapping:
        return
    
    for item_file in items_dir.glob("*.json"):
        try:
            item = json.loads(item_file.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        
        parent_id = item.get("parent_method_id")
        if parent_id is not None and parent_id in id_mapping:
            new_parent_id = id_mapping[parent_id]
            if dry_run:
                print(f"  Would update parent_method_id in {item_file.name}: {parent_id} -> {new_parent_id}")
            else:
                item["parent_method_id"] = new_parent_id
                item_file.write_text(json.dumps(item, indent=2, default=str))
                print(f"  Updated parent_method_id in {item_file.name}: {parent_id} -> {new_parent_id}")


def update_task_references(
    tasks_dir: Path,
    method_id_mapping: Dict[int, int],
    pcr_id_mapping: Dict[int, int],
    dry_run: bool = False
) -> int:
    """Update method references in all tasks.
    
    Returns the number of tasks updated.
    """
    if not tasks_dir.exists():
        return 0
    
    updated_count = 0
    
    for task_file in tasks_dir.glob("*.json"):
        try:
            task = json.loads(task_file.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        
        changed = False
        
        # Update method_ids list
        if task.get("method_ids"):
            new_method_ids = []
            for mid in task["method_ids"]:
                if mid in method_id_mapping:
                    new_method_ids.append(method_id_mapping[mid])
                    changed = True
                else:
                    new_method_ids.append(mid)
            task["method_ids"] = new_method_ids
        
        # Update method_attachments
        if task.get("method_attachments"):
            for att in task["method_attachments"]:
                old_mid = att.get("method_id")
                if old_mid in method_id_mapping:
                    att["method_id"] = method_id_mapping[old_mid]
                    changed = True
        
        # Update legacy method_id field
        if task.get("method_id") in method_id_mapping:
            task["method_id"] = method_id_mapping[task["method_id"]]
            changed = True
        
        if changed:
            updated_count += 1
            if dry_run:
                print(f"  Would update task {task_file.name}")
            else:
                task_file.write_text(json.dumps(task, indent=2, default=str))
                print(f"  Updated task {task_file.name}")
    
    return updated_count


def update_global_counter(
    data_repo: Path,
    entity: str,
    max_id: int,
    dry_run: bool = False
) -> None:
    """Update the global counter file."""
    counters_path = data_repo / "users" / "_global_counters.json"
    
    if dry_run:
        print(f"  Would set global counter for {entity} to {max_id}")
        return
    
    # Read existing counters or create new
    if counters_path.exists():
        counters = json.loads(counters_path.read_text())
    else:
        counters = {}
    
    # Update the counter (only if new value is higher)
    counters[entity] = max(counters.get(entity, 0), max_id)
    
    # Write back
    counters_path.parent.mkdir(parents=True, exist_ok=True)
    counters_path.write_text(json.dumps(counters, indent=2))
    print(f"  Set global counter for {entity} to {counters[entity]}")


def create_backup(data_repo: Path, backup_suffix: str = None) -> Path:
    """Create a backup of the users directory before migration."""
    if backup_suffix is None:
        backup_suffix = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    users_dir = data_repo / "users"
    backup_dir = data_repo / f"users_backup_{backup_suffix}"
    
    if users_dir.exists():
        shutil.copytree(users_dir, backup_dir)
        print(f"Created backup at: {backup_dir}")
    
    return backup_dir


def migrate(
    dry_run: bool = False,
    create_backup_flag: bool = True,
    specific_user: Optional[str] = None
) -> None:
    """Run the migration."""
    data_repo = get_data_repo_path()
    
    print("=" * 60)
    print("Method/PCR ID Collision Migration")
    print("=" * 60)
    print(f"Data repo: {data_repo}")
    print(f"Dry run: {dry_run}")
    print(f"Specific user: {specific_user or 'all users'}")
    print()
    
    # Create backup before migration
    if create_backup_flag and not dry_run:
        create_backup(data_repo)
        print()
    
    # Step 1: Collect all private method IDs
    print("Step 1: Collecting private method IDs...")
    all_private_method_ids: Set[int] = set()
    user_dirs = get_all_user_dirs(data_repo)
    
    if specific_user:
        user_dirs = [d for d in user_dirs if d.name == specific_user]
    
    for user_dir in user_dirs:
        ids = get_private_method_ids(user_dir)
        all_private_method_ids.update(ids)
        print(f"  {user_dir.name}: {len(ids)} private methods")
    
    print(f"  Total private methods: {len(all_private_method_ids)}")
    print()
    
    # Step 2: Collect all private PCR IDs
    print("Step 2: Collecting private PCR protocol IDs...")
    all_private_pcr_ids: Set[int] = set()
    
    for user_dir in user_dirs:
        ids = get_private_pcr_ids(user_dir)
        all_private_pcr_ids.update(ids)
        print(f"  {user_dir.name}: {len(ids)} private PCR protocols")
    
    print(f"  Total private PCR protocols: {len(all_private_pcr_ids)}")
    print()
    
    # Step 3: Get public methods and build ID mapping
    print("Step 3: Building ID mapping for public methods...")
    public_methods = get_public_methods(data_repo)
    print(f"  Found {len(public_methods)} public methods")
    
    method_id_mapping = build_id_mapping(all_private_method_ids, public_methods)
    print(f"  Need to renumber {len(method_id_mapping)} public methods")
    print()
    
    # Step 4: Get public PCR protocols and build ID mapping
    print("Step 4: Building ID mapping for public PCR protocols...")
    public_pcrs = get_public_pcrs(data_repo)
    print(f"  Found {len(public_pcrs)} public PCR protocols")
    
    pcr_id_mapping = build_id_mapping(all_private_pcr_ids, public_pcrs)
    print(f"  Need to renumber {len(pcr_id_mapping)} public PCR protocols")
    print()
    
    # Check if there's anything to do
    if not method_id_mapping and not pcr_id_mapping:
        print("No ID collisions detected. Migration not needed.")
        return
    
    # Step 5: Renumber public methods
    if method_id_mapping:
        print("Step 5: Renumbering public methods...")
        methods_dir = data_repo / "users" / "public" / "methods"
        renumber_public_items(methods_dir, method_id_mapping, dry_run)
        print()
    
    # Step 6: Renumber public PCR protocols
    if pcr_id_mapping:
        print("Step 6: Renumbering public PCR protocols...")
        pcr_dir = data_repo / "users" / "public" / "pcr_protocols"
        renumber_public_items(pcr_dir, pcr_id_mapping, dry_run)
        print()
    
    # Step 7: Update parent_method_id references
    if method_id_mapping:
        print("Step 7: Updating parent_method_id references...")
        methods_dir = data_repo / "users" / "public" / "methods"
        update_parent_references(methods_dir, method_id_mapping, dry_run)
        print()
    
    # Step 8: Update task references
    print("Step 8: Updating task references...")
    total_tasks_updated = 0
    
    for user_dir in user_dirs:
        tasks_dir = user_dir / "tasks"
        count = update_task_references(tasks_dir, method_id_mapping, pcr_id_mapping, dry_run)
        if count > 0:
            print(f"  {user_dir.name}: {count} tasks updated")
            total_tasks_updated += count
    
    print(f"  Total tasks updated: {total_tasks_updated}")
    print()
    
    # Step 9: Update global counters
    print("Step 9: Updating global counters...")
    
    if method_id_mapping:
        max_method_id = max(
            all_private_method_ids | set(method_id_mapping.values())
        )
        update_global_counter(data_repo, "methods", max_method_id, dry_run)
    
    if pcr_id_mapping:
        max_pcr_id = max(
            all_private_pcr_ids | set(pcr_id_mapping.values())
        )
        update_global_counter(data_repo, "pcr_protocols", max_pcr_id, dry_run)
    
    print()
    
    # Summary
    print("=" * 60)
    print("Migration Summary")
    print("=" * 60)
    print(f"Public methods renumbered: {len(method_id_mapping)}")
    print(f"Public PCR protocols renumbered: {len(pcr_id_mapping)}")
    print(f"Tasks updated: {total_tasks_updated}")
    
    if dry_run:
        print()
        print("This was a dry run. No changes were made.")
        print("Run without --dry-run to apply changes.")
    else:
        print()
        print("Migration complete!")
        print("A backup was created before migration.")


def main():
    parser = argparse.ArgumentParser(
        description="Migrate method/PCR IDs to use global counter"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without making changes"
    )
    parser.add_argument(
        "--user",
        type=str,
        default=None,
        help="Specify which user's data to migrate (default: all users)"
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip creating a backup before migration"
    )
    
    args = parser.parse_args()
    
    migrate(
        dry_run=args.dry_run,
        create_backup_flag=not args.no_backup,
        specific_user=args.user
    )


if __name__ == "__main__":
    main()
