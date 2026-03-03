import os
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings

# Path to the .env file (backend/.env)
ENV_FILE_PATH = Path(__file__).parent.parent / ".env"

# Default .env content template
DEFAULT_ENV_CONTENT = """GITHUB_TOKEN=
GITHUB_REPO=
GITHUB_LOCALPATH=
CORS_ORIGINS="["http://localhost:3000"]"
CURRENT_USER=
MAIN_USER=
STORAGE_MODE=github
"""

# Reserved username for Lab Mode (view-only access across all users)
LAB_USER = "lab"


def ensure_env_file_exists() -> None:
    """Create .env file with default values if it doesn't exist."""
    if not ENV_FILE_PATH.exists():
        ENV_FILE_PATH.write_text(DEFAULT_ENV_CONTENT)
        print(f"Created default .env file at {ENV_FILE_PATH}")


# Ensure .env exists before loading settings
ensure_env_file_exists()


class Settings(BaseSettings):
    github_token: str = ""
    github_repo: str = ""  # e.g. "username/research-eln"
    github_localpath: str = ""  # local path to data repo clone
    cors_origins: List[str] = ["http://localhost:3000"]
    current_user: str = "GrantNickles"  # the active user for this instance
    main_user: str = ""  # the default user to return to when exiting lab mode
    storage_mode: str = "github"  # "github" or "local"

    class Config:
        env_file = ".env"
        extra = "ignore"
    
    def is_github_mode(self) -> bool:
        """Check if using GitHub sync mode."""
        return self.storage_mode == "github"
    
    def is_local_mode(self) -> bool:
        """Check if using local-only mode."""
        return self.storage_mode == "local"

    def reload(self) -> None:
        """Reload settings from the .env file.
        
        This allows settings to be updated without restarting the server.
        """
        # Ensure .env exists and re-read environment variables
        ensure_env_file_exists()
        if ENV_FILE_PATH.exists():
            # Parse .env file manually and update environment
            with open(ENV_FILE_PATH) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        key, _, value = line.partition("=")
                        key = key.strip()
                        value = value.strip()
                        # Remove quotes if present
                        if value.startswith('"') and value.endswith('"'):
                            value = value[1:-1]
                        os.environ[key] = value
        
        # Re-create settings from updated environment
        self.__init__()

    def is_lab_user(self) -> bool:
        """Check if the current user is the Lab Mode user."""
        return self.current_user == LAB_USER


settings = Settings()
