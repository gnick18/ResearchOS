import os
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    github_token: str = ""
    github_repo: str = ""  # e.g. "username/research-eln"
    github_localpath: str = ""  # local path to data repo clone
    cors_origins: List[str] = ["http://localhost:3000"]

    class Config:
        env_file = ".env"
        extra = "ignore"

    def reload(self) -> None:
        """Reload settings from the .env file.
        
        This allows settings to be updated without restarting the server.
        """
        # Re-read environment variables from .env file
        env_path = Path(__file__).parent.parent / ".env"
        if env_path.exists():
            # Parse .env file manually and update environment
            with open(env_path) as f:
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


settings = Settings()
