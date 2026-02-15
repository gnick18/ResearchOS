"""Auto git commit + push for the data repo after mutations."""

import asyncio
import logging
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)

# Mutex to prevent concurrent git operations from colliding
_git_lock = asyncio.Lock()


def _remove_stale_lock(repo: Path) -> None:
    """Remove a stale .git/index.lock file if it exists.
    
    This file is left behind when a git process crashes or is interrupted.
    Having it present blocks ALL subsequent git operations.
    """
    lock_file = repo / ".git" / "index.lock"
    if lock_file.exists():
        try:
            lock_file.unlink()
            logger.warning("Removed stale git lock file: %s", lock_file)
        except OSError as e:
            logger.error("Failed to remove git lock file: %s", e)


async def _run(cmd: list[str], cwd: Path) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode, stdout.decode(), stderr.decode()


async def commit_and_push(message: str = "Update via ResearchOS") -> None:
    """Stage all changes in the data repo, commit, and push to origin.

    Silently succeeds if there is nothing to commit.
    Uses an async lock to prevent concurrent git operations from colliding,
    and automatically removes stale .git/index.lock files.
    """
    repo = Path(settings.github_localpath)
    if not repo.exists():
        logger.warning("Data repo path does not exist: %s", repo)
        return

    async with _git_lock:
        # Remove stale lock file if present (from a previous crash/interruption)
        _remove_stale_lock(repo)

        # Stage everything
        rc, out, err = await _run(["git", "add", "-A"], repo)
        if rc != 0:
            # If git add fails due to lock file (race condition), try removing it
            if "index.lock" in err:
                _remove_stale_lock(repo)
                rc, out, err = await _run(["git", "add", "-A"], repo)
            if rc != 0:
                logger.error("git add failed: %s", err)
                return

        # Commit (--allow-empty is not used; if nothing changed, commit returns 1)
        rc, out, err = await _run(
            ["git", "commit", "-m", message], repo
        )
        if rc != 0:
            # rc=1 with "nothing to commit" is fine
            if "nothing to commit" in out or "nothing to commit" in err:
                logger.debug("Nothing to commit")
                return
            logger.error("git commit failed: %s %s", out, err)
            return

        # Push
        rc, out, err = await _run(["git", "push"], repo)
        if rc != 0:
            logger.error("git push failed: %s %s", out, err)
            return

        logger.info("Committed and pushed: %s", message)
