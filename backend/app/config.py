"""Configuration management for VERTEX backend."""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings with environment variable support."""
    
    # Server settings
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = True
    
    # Analysis settings
    CACHE_TIMEOUT: int = 5000  # milliseconds
    MAX_FILE_SIZE: int = 1_000_000  # 1MB max file size
    
    # Session settings
    SESSION_TIMEOUT: int = 3600  # 1 hour in seconds
    
    class Config:
        env_prefix = "VERTEX_"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()