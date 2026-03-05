"""Migration script to restructure file and image storage.

This script:
1. Scans all existing results/task-{id}/ directories (GLOBAL, not per-user)
2. Matches tasks to users by checking task ownership
3. Moves images to users/{user}/Images/{date-name}/
4. Moves files to users/{user}/Files/{date-name}/
5. Creates metadata files in each user's Images/Files folders
6. Updates markdown paths in notes.md and results.md

IMPORTANT: Results are stored globally at {data_repo}/results/task-{id}/
but the new structure stores images/files per-user at {data_repo}/users/{user}/Images|Files/

Usage:
    cd backend
    python -m app.migrations.migrate_attachments [--dry-run] [--user USERNAME]
"""

import argparse
import json
import re
import shutil
from datetime import date, datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Set


def parse_args():
    parser = argparse.ArgumentParser(description="Migrate attachments to new folder structure")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    parser.add_argument("--user", type=str, help="Migrate for specific user (default: all users)")
    parser.add_argument("--data-path", type=str, help="Path to data repo (overrides config)")
    return parser.parse_args()


def get_data_root(data_path: Optional[str] = None) -> Path:
    """Get the data repo root path."""
    if data_path:
        return Path(data_path)
    
    # Try to get from config
    try:
        from app.config import settings
        return Path(settings.github_localpath)
    except:
        # Fallback - ask user
        return Path(input("Enter path to data repo: ").strip())


def sanitize_experiment_name(name: str) -> str:
    """Remove special characters and replace spaces with hyphens."""
    safe = name.replace(" ", "-")
    safe = "".join(c for c in safe if c.isalnum() or c in "-_")
    while "--" in safe:
        safe = safe.replace("--", "-")
    safe = safe.strip("-")
    return safe


def generate_folder_name(experiment_name: str, exp_date: date) -> str:
    """Generate folder name like 'Mar-04-2026-My-Experiment'."""
    date_str = exp_date.strftime("%b-%d-%Y")
    safe_name = sanitize_experiment_name(experiment_name)
    return f"{date_str}-{safe_name}"


def get_task_info(tasks_dir: Path, task_id: int) -> Optional[Dict]:
    """Get task info from JSON file."""
    task_file = tasks_dir / f"{task_id}.json"
    if not task_file.exists():
        return None
    
    try:
        return json.loads(task_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def get_project_info(projects_dir: Path, project_id: int) -> Optional[Dict]:
    """Get project info from JSON file."""
    project_file = projects_dir / f"{project_id}.json"
    if not project_file.exists():
        return None
    
    try:
        return json.loads(project_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def find_task_owner(users_dir: Path, task_id: int) -> Optional[str]:
    """Find which user owns a task by scanning all user task directories.
    
    Returns the username if found, None otherwise.
    """
    excluded = {"public", "_no_user_", ".git"}
    
    for user_dir in users_dir.iterdir():
        if not user_dir.is_dir():
            continue
        if user_dir.name in excluded or user_dir.name.startswith("."):
            continue
        
        tasks_dir = user_dir / "tasks"
        if not tasks_dir.exists():
            continue
        
        task_file = tasks_dir / f"{task_id}.json"
        if task_file.exists():
            return user_dir.name
    
    return None


def build_task_owner_map(users_dir: Path, task_ids: Set[int]) -> Dict[int, str]:
    """Build a mapping of task_id -> username for all task IDs.
    
    This is more efficient than calling find_task_owner for each task.
    """
    task_to_user = {}
    excluded = {"public", "_no_user_", ".git"}
    
    for user_dir in users_dir.iterdir():
        if not user_dir.is_dir():
            continue
        if user_dir.name in excluded or user_dir.name.startswith("."):
            continue
        
        tasks_dir = user_dir / "tasks"
        if not tasks_dir.exists():
            continue
        
        for task_file in tasks_dir.glob("*.json"):
            try:
                task_id = int(task_file.stem)
                if task_id in task_ids:
                    task_to_user[task_id] = user_dir.name
            except ValueError:
                continue
    
    return task_to_user


def parse_task_id_from_path(path: Path) -> Optional[int]:
    """Extract task ID from results/task-{id}/ path."""
    match = re.search(r'task-(\d+)', str(path))
    if match:
        return int(match.group(1))
    return None


def find_image_references_in_markdown(content: str) -> List[Tuple[str, str]]:
    """Find all image references in markdown content.
    
    Returns list of (full_match, image_path) tuples.
    """
    # Match ![alt](./Images/filename) or ![alt](Images/filename)
    pattern = r'!\[([^\]]*)\]\(\.?/?Images/([^)]+)\)'
    matches = []
    
    for match in re.finditer(pattern, content):
        full_match = match.group(0)
        image_path = match.group(2)
        matches.append((full_match, image_path))
    
    return matches


def update_markdown_image_paths(content: str, folder_name: str) -> Tuple[str, int]:
    """Update image paths in markdown content.
    
    Changes:
        ![alt](./Images/filename.png) -> ![alt](../../Images/{folder_name}/filename.png)
    
    Returns (updated_content, count_of_changes)
    """
    changes = 0
    
    def replace_path(match):
        nonlocal changes
        alt_text = match.group(1)
        filename = match.group(2)
        # Extract just the filename (remove any path prefix)
        if '/' in filename:
            filename = filename.split('/')[-1]
        changes += 1
        return f'![{alt_text}](../../Images/{folder_name}/{filename})'
    
    # Match ![alt](./Images/filename) or ![alt](Images/filename)
    pattern = r'!\[([^\]]*)\]\(\.?/?Images/([^)]+)\)'
    updated = re.sub(pattern, replace_path, content)
    
    return updated, changes


def migrate_results(
    data_root: Path, 
    users_dir: Path, 
    dry_run: bool = False,
    specific_user: Optional[str] = None
) -> Dict:
    """Migrate attachments from global results directory to per-user structure.
    
    The results directory is GLOBAL at {data_root}/results/task-{id}/
    Tasks are stored per-user at {users_dir}/{user}/tasks/{id}.json
    New images/files go to {users_dir}/{user}/Images|Files/{folder}/
    
    Returns statistics about the migration.
    """
    stats = {
        "tasks_processed": 0,
        "images_moved": 0,
        "files_moved": 0,
        "markdown_updated": 0,
        "errors": [],
        "per_user": {},  # Stats broken down by user
    }
    
    results_dir = data_root / "results"
    
    if not results_dir.exists():
        print(f"No results directory found at {results_dir}")
        return stats
    
    # Find all task directories and collect task IDs
    task_dirs = []
    task_ids = set()
    for task_dir in sorted(results_dir.glob("task-*")):
        if not task_dir.is_dir():
            continue
        task_id = parse_task_id_from_path(task_dir)
        if task_id is not None:
            task_dirs.append((task_dir, task_id))
            task_ids.add(task_id)
    
    if not task_dirs:
        print("No task directories found in results/")
        return stats
    
    print(f"Found {len(task_dirs)} task directories in results/")
    
    # Build mapping of task_id -> username
    print("Building task owner map...")
    task_owner_map = build_task_owner_map(users_dir, task_ids)
    print(f"Found owners for {len(task_owner_map)} tasks")
    
    # Track metadata per user
    user_image_metadata: Dict[str, Dict] = {}
    user_file_metadata: Dict[str, Dict] = {}
    
    # Create orphaned directory for tasks without owners
    orphaned_dir = data_root / "results_orphaned"
    
    # Process each task directory
    for task_dir, task_id in task_dirs:
        # Find the owner of this task
        username = task_owner_map.get(task_id)
        if not username:
            # Move to orphaned directory instead of just logging error
            if dry_run:
                print(f"  Would move orphaned: {task_dir.name} -> {orphaned_dir / task_dir.name}")
            else:
                orphaned_dir.mkdir(parents=True, exist_ok=True)
                target_path = orphaned_dir / task_dir.name
                if not target_path.exists():
                    shutil.move(str(task_dir), str(target_path))
                    print(f"  Moved orphaned: {task_dir.name} -> {orphaned_dir.name}/")
                else:
                    print(f"  Skipping orphaned (already exists): {task_dir.name}")
            
            stats["errors"].append(f"Task {task_id} has no owner (moved to results_orphaned/)")
            continue
        
        # Filter by specific user if requested
        if specific_user and username != specific_user:
            continue
        
        # Get user directories
        user_dir = users_dir / username
        tasks_dir = user_dir / "tasks"
        projects_dir = user_dir / "projects"
        
        # Initialize user metadata if needed
        if username not in user_image_metadata:
            user_image_metadata[username] = {"version": 1, "entries": [], "next_id": 1}
            user_file_metadata[username] = {"version": 1, "entries": [], "next_id": 1}
            stats["per_user"][username] = {
                "tasks_processed": 0,
                "images_moved": 0,
                "files_moved": 0,
                "markdown_updated": 0,
            }
        
        # Get task info
        task_info = get_task_info(tasks_dir, task_id)
        if not task_info:
            stats["errors"].append(f"Task {task_id} not found for user {username}")
            continue
        
        # Skip non-experiment tasks
        if task_info.get("task_type") != "experiment":
            continue
        
        task_name = task_info.get("name", f"Task {task_id}")
        task_date_str = task_info.get("start_date", "")
        project_id = task_info.get("project_id")
        
        # Parse task date
        try:
            task_date = date.fromisoformat(task_date_str)
        except ValueError:
            task_date = date.today()
        
        # Get project info
        project_name = None
        if project_id:
            project_info = get_project_info(projects_dir, project_id)
            if project_info:
                project_name = project_info.get("name")
        
        # Generate folder name
        folder_name = generate_folder_name(task_name, task_date)
        
        print(f"  Task {task_id} ({username}): {task_name} -> {folder_name}")
        stats["tasks_processed"] += 1
        stats["per_user"][username]["tasks_processed"] += 1
        
        # Create target directories for this user
        images_dir = user_dir / "Images"
        files_dir = user_dir / "Files"
        
        if not dry_run:
            images_dir.mkdir(parents=True, exist_ok=True)
            files_dir.mkdir(parents=True, exist_ok=True)
        
        # Track files to move
        images_to_move = []
        files_to_move = []
        
        # Check for Images directory
        old_images_dir = task_dir / "Images"
        if old_images_dir.exists() and old_images_dir.is_dir():
            for img_file in old_images_dir.iterdir():
                if img_file.is_file():
                    images_to_move.append(img_file)
        
        # Check for NotesPDFs directory
        old_notes_pdfs_dir = task_dir / "NotesPDFs"
        if old_notes_pdfs_dir.exists() and old_notes_pdfs_dir.is_dir():
            for pdf_file in old_notes_pdfs_dir.iterdir():
                if pdf_file.is_file():
                    files_to_move.append((pdf_file, "notes"))
        
        # Check for ResultsPDFs directory
        old_results_pdfs_dir = task_dir / "ResultsPDFs"
        if old_results_pdfs_dir.exists() and old_results_pdfs_dir.is_dir():
            for pdf_file in old_results_pdfs_dir.iterdir():
                if pdf_file.is_file():
                    files_to_move.append((pdf_file, "results"))
        
        # Move images
        for img_file in images_to_move:
            target_dir = images_dir / folder_name
            target_path = target_dir / img_file.name
            
            # Check if file still exists (might have been moved in previous run)
            if not img_file.exists():
                print(f"    Skipping (already moved): {img_file.name}")
                continue
            
            # Get file stats BEFORE moving
            try:
                file_mtime = img_file.stat().st_mtime
                file_size = img_file.stat().st_size
            except FileNotFoundError:
                print(f"    Skipping (file not found): {img_file.name}")
                continue
            
            if dry_run:
                print(f"    Would move: {img_file.relative_to(data_root)} -> {target_path.relative_to(data_root)}")
            else:
                # Check if target already exists
                if target_path.exists():
                    print(f"    Skipping (target exists): {target_path.name}")
                else:
                    target_dir.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(img_file), str(target_path))
                
                # Add to metadata
                user_image_metadata[username]["entries"].append({
                    "id": user_image_metadata[username]["next_id"],
                    "filename": img_file.name,
                    "original_filename": img_file.name.split("-", 1)[-1] if "-" in img_file.name else img_file.name,
                    "path": f"Images/{folder_name}/{img_file.name}",
                    "experiment_id": task_id,
                    "experiment_name": task_name,
                    "project_id": project_id,
                    "project_name": project_name,
                    "uploaded_at": datetime.fromtimestamp(file_mtime).isoformat(),
                    "file_size": file_size,
                    "file_type": f"image/{img_file.suffix.lstrip('.').lower()}",
                    "folder": folder_name,
                })
                user_image_metadata[username]["next_id"] += 1
            
            stats["images_moved"] += 1
            stats["per_user"][username]["images_moved"] += 1
        
        # Move files
        for pdf_file, attachment_type in files_to_move:
            target_dir = files_dir / folder_name
            target_path = target_dir / pdf_file.name
            
            # Check if file still exists (might have been moved in previous run)
            if not pdf_file.exists():
                print(f"    Skipping (already moved): {pdf_file.name}")
                continue
            
            # Get file stats BEFORE moving
            try:
                file_mtime = pdf_file.stat().st_mtime
                file_size = pdf_file.stat().st_size
            except FileNotFoundError:
                print(f"    Skipping (file not found): {pdf_file.name}")
                continue
            
            if dry_run:
                print(f"    Would move: {pdf_file.relative_to(data_root)} -> {target_path.relative_to(data_root)}")
            else:
                # Check if target already exists
                if target_path.exists():
                    print(f"    Skipping (target exists): {target_path.name}")
                else:
                    target_dir.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(pdf_file), str(target_path))
                
                # Add to metadata
                user_file_metadata[username]["entries"].append({
                    "id": user_file_metadata[username]["next_id"],
                    "filename": pdf_file.name,
                    "original_filename": pdf_file.name.split("-", 1)[-1] if "-" in pdf_file.name else pdf_file.name,
                    "path": f"Files/{folder_name}/{pdf_file.name}",
                    "experiment_id": task_id,
                    "experiment_name": task_name,
                    "project_id": project_id,
                    "project_name": project_name,
                    "uploaded_at": datetime.fromtimestamp(file_mtime).isoformat(),
                    "file_size": file_size,
                    "file_type": f"application/{pdf_file.suffix.lstrip('.').lower()}",
                    "folder": folder_name,
                    "attachment_type": attachment_type,
                })
                user_file_metadata[username]["next_id"] += 1
            
            stats["files_moved"] += 1
            stats["per_user"][username]["files_moved"] += 1
        
        # Update markdown paths in notes.md and results.md
        for md_file in ["notes.md", "results.md"]:
            md_path = task_dir / md_file
            if md_path.exists():
                content = md_path.read_text()
                updated_content, changes = update_markdown_image_paths(content, folder_name)
                
                if changes > 0:
                    if dry_run:
                        print(f"    Would update {changes} image paths in {md_file}")
                    else:
                        md_path.write_text(updated_content)
                    
                    stats["markdown_updated"] += changes
                    stats["per_user"][username]["markdown_updated"] += changes
    
    # Write metadata files per user
    if not dry_run:
        for username, metadata in user_image_metadata.items():
            if metadata["entries"]:
                user_dir = users_dir / username
                metadata_path = user_dir / "Images" / "_metadata.json"
                metadata_path.parent.mkdir(parents=True, exist_ok=True)
                metadata_path.write_text(json.dumps(metadata, indent=2))
                print(f"  Wrote {len(metadata['entries'])} image metadata entries for {username}")
        
        for username, metadata in user_file_metadata.items():
            if metadata["entries"]:
                user_dir = users_dir / username
                metadata_path = user_dir / "Files" / "_metadata.json"
                metadata_path.parent.mkdir(parents=True, exist_ok=True)
                metadata_path.write_text(json.dumps(metadata, indent=2))
                print(f"  Wrote {len(metadata['entries'])} file metadata entries for {username}")
    
    return stats


def main():
    args = parse_args()
    
    print("=" * 60)
    print("Attachment Migration Script")
    print("=" * 60)
    print("\nThis script migrates attachments from the global results/")
    print("directory to per-user Images/ and Files/ folders.")
    print()
    
    if args.dry_run:
        print("*** DRY RUN - No changes will be made ***\n")
    
    # Get data root
    data_root = get_data_root(args.data_path)
    print(f"Data repo: {data_root}")
    
    if not data_root.exists():
        print(f"ERROR: Data repo not found at {data_root}")
        return 1
    
    users_dir = data_root / "users"
    if not users_dir.exists():
        print(f"ERROR: Users directory not found at {users_dir}")
        return 1
    
    results_dir = data_root / "results"
    print(f"Results directory: {results_dir}")
    print(f"Users directory: {users_dir}")
    print()
    
    # Run migration
    stats = migrate_results(
        data_root=data_root,
        users_dir=users_dir,
        dry_run=args.dry_run,
        specific_user=args.user
    )
    
    # Print summary
    print("\n" + "=" * 60)
    print("Migration Summary")
    print("=" * 60)
    
    print(f"\nTotal:")
    print(f"  Tasks processed: {stats['tasks_processed']}")
    print(f"  Images moved: {stats['images_moved']}")
    print(f"  Files moved: {stats['files_moved']}")
    print(f"  Markdown paths updated: {stats['markdown_updated']}")
    
    if stats["errors"]:
        print(f"\n  Errors: {len(stats['errors'])}")
        for err in stats["errors"][:10]:  # Show first 10 errors
            print(f"    - {err}")
        if len(stats["errors"]) > 10:
            print(f"    ... and {len(stats['errors']) - 10} more")
    
    # Per-user breakdown
    if stats["per_user"]:
        print("\nPer-user breakdown:")
        for username, user_stats in sorted(stats["per_user"].items()):
            if user_stats["tasks_processed"] > 0:
                print(f"\n  {username}:")
                print(f"    Tasks: {user_stats['tasks_processed']}")
                print(f"    Images: {user_stats['images_moved']}")
                print(f"    Files: {user_stats['files_moved']}")
                print(f"    Markdown updates: {user_stats['markdown_updated']}")
    
    if args.dry_run:
        print("\n*** DRY RUN COMPLETE - No changes were made ***")
        print("Run without --dry-run to apply changes.")
    else:
        print("\n*** Migration complete! ***")
        print("Please verify the migration and commit the changes.")
    
    return 0


if __name__ == "__main__":
    exit(main())
