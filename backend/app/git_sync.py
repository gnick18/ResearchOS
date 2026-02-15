"""Auto git commit + push for the data repo after mutations."""

import asyncio
import logging
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)


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
    """
    repo = Path(settings.github_localpath)
    if not repo.exists():
        logger.warning("Data repo path does not exist: %s", repo)
        return

    # Stage everything
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
