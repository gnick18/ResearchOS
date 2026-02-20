"""Lab Mode dependencies for read-only enforcement."""

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.config import settings

security = HTTPBearer(auto_error_error=False)


async def require_not_lab_user():
    """Dependency that blocks write operations for Lab Mode users.
    
    Raises:
        HTTPException: 403 Forbidden if the current user is the Lab user
    """
    if settings.is_lab_user():
        raise HTTPException(
            status_code=403,
            detail="Lab mode is view-only. Cannot modify data."
        )
    return True


def is_lab_mode() -> bool:
    """Check if the current session is in Lab Mode."""
    return settings.is_lab_user()
