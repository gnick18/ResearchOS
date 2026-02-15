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


settings = Settings()
